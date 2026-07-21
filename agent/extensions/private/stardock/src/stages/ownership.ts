import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import type { LoopState } from "../state/core.ts";
import { loadState, mutateState } from "../state/store.ts";
import { stageOwnerPath } from "../state/paths.ts";
import { readyExecutionNodeIds, validateExecutionGraph } from "./graph.ts";
import type { ExecutionGraph, ExecutionStageOwnership } from "./contracts.ts";
import {
	acquireMutationMutex,
	atomicWriteJson,
	createOwnerRecordExclusive,
	digestOwnershipToken,
	generateOwnershipToken,
	isProcessAlive,
	OWNER_HEARTBEAT_MS,
	OWNER_SUSPECT_MS,
	ownedLoopsForSession,
	OwnershipProtocolError,
	ownershipTokenForContext,
	quarantineOwnershipFile,
	readMutationRecord,
	readOwnerRecord,
	registerOwnershipToken,
	releaseMatchingMutationMutex,
	removeMatchingAcquiringOwner,
	removeOwnershipToken,
	setOwnershipHeartbeat,
	type StageOwnerRecord,
	type StateMutationRecord,
} from "./ownership-records.ts";

export interface AcquireStageOwnershipRequest {
	loopName: string;
	graphId: string;
	stageId: string;
	expectedGraphRevision: number;
	sessionId: string;
	priorOwnershipEvidence?: ExecutionStageOwnership;
}

export interface OwnershipAcquisition {
	ok: true;
	graphId: string;
	stageId: string;
	stateRevision: number;
	owner: Omit<StageOwnerRecord, "tokenDigest"> & { tokenDigest: string };
}

export interface OwnershipInspection {
	loopName: string;
	owner: StageOwnerRecord | null;
	mutex: ReturnType<typeof readMutationRecord>;
	stateOwnership: ExecutionStageOwnership | null;
	ownerProcess: "live" | "dead" | "missing";
	mutexProcess: "live" | "dead" | "missing";
	heartbeatSuspected: boolean;
	stateRevision?: number;
	stateIdentityMatchesOwner: boolean;
	stateMatchesOwner: boolean;
	mutexMatchesOwner: boolean;
	nextAction: string;
}

export interface ReconcileOwnershipRequest {
	loopName: string;
	takeOwnership?: boolean;
	rationale?: string;
	approvalRef?: string;
	classification?: string;
	graphId?: string;
	stageId?: string;
	sessionId?: string;
}

function ownerRecordWithoutSecret(record: StageOwnerRecord): OwnershipAcquisition["owner"] {
	return { ...record, tokenDigest: record.tokenDigest };
}

function assertStageAcquirable(graph: ExecutionGraph, stageId: string, repoRoot: string, reconciliation = false): void {
	const validation = validateExecutionGraph(graph, repoRoot);
	if (!validation.ok) throw new OwnershipProtocolError("graph_invalid", `Execution graph validation failed before ownership acquisition: ${validation.errors.join(" ")}`);
	if (graph.status === "completed" || graph.status === "abandoned") {
		throw new OwnershipProtocolError("graph_terminal", `Execution graph "${graph.id}" is terminal and cannot acquire stage ownership.`);
	}
	const stage = graph.stages.find((candidate) => candidate.id === stageId);
	if (!stage) throw new OwnershipProtocolError("stage_missing", `Execution stage "${stageId}" was not found in graph "${graph.id}".`);
	if (stage.status === "integrated" || stage.status === "abandoned") {
		throw new OwnershipProtocolError("stage_terminal", `Execution stage "${stage.id}" is terminal and cannot acquire ownership.`);
	}
	if (reconciliation) return;
	if (stage.status !== "draft" && stage.status !== "contracts_ready") {
		throw new OwnershipProtocolError("stage_unready", `Execution stage "${stage.id}" has status "${stage.status}" and cannot begin ownership acquisition.`);
	}
	const ready = new Set(readyExecutionNodeIds(graph));
	const missing = stage.implementationNodeIds.filter((nodeId) => !ready.has(nodeId));
	if (missing.length > 0) throw new OwnershipProtocolError("stage_unready", `Execution stage "${stage.id}" is not fully ready; blocked implementation nodes: ${missing.sort().join(", ")}.`);
}

function startHeartbeat(ctx: ExtensionContext, loopName: string, sessionId: string): void {
	const timer = setInterval(() => {
		try {
			heartbeatStageOwnership(ctx, loopName);
		} catch (error) {
			if (error instanceof OwnershipProtocolError && error.code === "mutex_busy") return;
			clearInterval(timer);
		}
	}, OWNER_HEARTBEAT_MS);
	setOwnershipHeartbeat(ctx, loopName, sessionId, timer);
}

export function acquireStageOwnership(ctx: ExtensionContext, request: AcquireStageOwnershipRequest): OwnershipAcquisition {
	const state = loadState(ctx, request.loopName);
	if (!state?.executionGraph) throw new OwnershipProtocolError("graph_missing", `Loop "${request.loopName}" has no execution graph.`);
	if (state.executionGraph.id !== request.graphId) throw new OwnershipProtocolError("graph_mismatch", `Execution graph mismatch: expected "${request.graphId}", current "${state.executionGraph.id}".`);
	const priorOwnership = request.priorOwnershipEvidence;
	if (priorOwnership) {
		const currentOwnership = state.executionGraph.ownership;
		if (!currentOwnership || !ownershipIdentityMatches(currentOwnership, priorOwnership)) {
			throw new OwnershipProtocolError("evidence_changed", "Prior graph ownership evidence changed before replacement acquisition.");
		}
	}
	assertStageAcquirable(state.executionGraph, request.stageId, ctx.cwd, priorOwnership !== undefined);
	const token = generateOwnershipToken();
	const tokenDigest = digestOwnershipToken(token);
	const now = new Date().toISOString();
	const acquiring: StageOwnerRecord = {
		version: 1,
		status: "acquiring",
		graphId: request.graphId,
		stageId: request.stageId,
		sessionId: request.sessionId,
		pid: process.pid,
		tokenDigest,
		expectedGraphRevision: request.expectedGraphRevision,
		acquiredAt: now,
		heartbeatAt: now,
	};
	try {
		createOwnerRecordExclusive(ctx, request.loopName, acquiring);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			const existing = readOwnerRecord(ctx, request.loopName);
			if (existing) throw new OwnershipProtocolError("owner_busy", `Stage owner already exists for graph "${existing.graphId}" stage "${existing.stageId}" in session "${existing.sessionId}". Inspect with reconcile; no stale evidence is cleared automatically.`);
			throw new OwnershipProtocolError("owner_busy", `Stage owner evidence already exists for loop "${request.loopName}". Inspect with reconcile; no stale evidence is cleared automatically.`);
		}
		throw error;
	}
	registerOwnershipToken(ctx, {
		loopName: request.loopName,
		graphId: request.graphId,
		stageId: request.stageId,
		sessionId: request.sessionId,
		token,
		tokenDigest,
	});
	let committed = false;
	let active: StageOwnerRecord | undefined;
	try {
		const saved = mutateState(ctx, request.loopName, (candidate) => {
			const graph = candidate.executionGraph;
			if (!graph || graph.id !== request.graphId) throw new OwnershipProtocolError("graph_mismatch", "Execution graph changed during ownership acquisition.");
			assertStageAcquirable(graph, request.stageId, ctx.cwd, priorOwnership !== undefined);
			const stage = graph.stages.find((value) => value.id === request.stageId);
			if (!stage) throw new OwnershipProtocolError("stage_missing", `Execution stage "${request.stageId}" disappeared during ownership acquisition.`);
			if (!priorOwnership) stage.status = "running";
			graph.ownership = {
				graphId: request.graphId,
				stageId: request.stageId,
				sessionId: request.sessionId,
				pid: process.pid,
				tokenDigest,
				status: "active",
				acquiredAt: now,
				heartbeatAt: now,
				stateRevision: request.expectedGraphRevision + 1,
			};
		}, {
			expectedGraphRevision: request.expectedGraphRevision,
			allowAcquiringOwner: true,
			priorOwnershipEvidence: priorOwnership,
			afterCommit(candidate) {
				const stateRevision = candidate.executionGraph?.revision;
				if (stateRevision === undefined) throw new OwnershipProtocolError("graph_missing", "Execution graph disappeared after ownership acquisition.");
				const currentOwner = readOwnerRecord(ctx, request.loopName);
				if (!currentOwner || currentOwner.tokenDigest !== tokenDigest || currentOwner.status !== "acquiring") throw new OwnershipProtocolError("evidence_changed", "Acquiring owner evidence changed before activation.");
				active = { ...acquiring, status: "active", stateRevision };
				atomicWriteJson(stageOwnerPath(ctx, request.loopName), active);
			},
		});
		committed = true;
		const stateRevision = saved.executionGraph?.revision;
		if (stateRevision === undefined || !active) throw new OwnershipProtocolError("owner_activation_failed", "Stage owner activation did not produce durable evidence.");
		startHeartbeat(ctx, request.loopName, request.sessionId);
		return { ok: true, graphId: request.graphId, stageId: request.stageId, stateRevision, owner: ownerRecordWithoutSecret(active) };
	} catch (error) {
		const durable = loadState(ctx, request.loopName)?.executionGraph?.ownership;
		if (durable?.tokenDigest === tokenDigest && durable.sessionId === request.sessionId) committed = true;
		if (!committed) {
			removeMatchingAcquiringOwner(ctx, request.loopName, tokenDigest);
			removeOwnershipToken(ctx, request.loopName, request.sessionId);
		}
		throw error;
	}
}

function ownerMutationRecord(owner: StageOwnerRecord): StateMutationRecord {
	return {
		version: 1,
		graphId: owner.graphId,
		stageId: owner.stageId,
		sessionId: owner.sessionId,
		pid: process.pid,
		tokenDigest: owner.tokenDigest,
		acquiredAt: new Date().toISOString(),
	};
}

function assertHeartbeatEvidence(ctx: ExtensionContext, loopName: string, owner: StageOwnerRecord): void {
	const entry = ownershipTokenForContext(ctx, loopName);
	if (!entry
		|| entry.graphId !== owner.graphId
		|| entry.stageId !== owner.stageId
		|| entry.tokenDigest !== owner.tokenDigest
		|| entry.sessionId !== owner.sessionId
		|| digestOwnershipToken(entry.token) !== owner.tokenDigest
		|| owner.pid !== process.pid) {
		throw new OwnershipProtocolError("non_owner", `Only owner session "${owner.sessionId}" may refresh this heartbeat.`);
	}
	const graph = loadState(ctx, loopName)?.executionGraph;
	const ownership = graph?.ownership;
	if (!graph || !ownership
		|| graph.id !== owner.graphId
		|| ownership.graphId !== owner.graphId
		|| ownership.stageId !== owner.stageId
		|| ownership.sessionId !== owner.sessionId
		|| ownership.pid !== owner.pid
		|| ownership.tokenDigest !== owner.tokenDigest
		|| ownership.stateRevision !== graph.revision
		|| owner.stateRevision !== graph.revision) {
		throw new OwnershipProtocolError("state_mismatch", "Heartbeat refused because owner and persisted graph ownership identity or revision do not match.");
	}
}

export function heartbeatStageOwnership(ctx: ExtensionContext, loopName: string): StageOwnerRecord {
	const initial = readOwnerRecord(ctx, loopName);
	if (!initial || initial.status !== "active") throw new OwnershipProtocolError("owner_missing", `No active stage owner exists for loop "${loopName}".`);
	assertHeartbeatEvidence(ctx, loopName, initial);
	const mutex = ownerMutationRecord(initial);
	acquireMutationMutex(ctx, loopName, mutex);
	try {
		const owner = readOwnerRecord(ctx, loopName);
		if (!owner || owner.status !== "active" || owner.tokenDigest !== initial.tokenDigest) {
			throw new OwnershipProtocolError("evidence_changed", "Owner evidence changed while heartbeat waited for the state mutation mutex.");
		}
		assertHeartbeatEvidence(ctx, loopName, owner);
		const refreshed = { ...owner, heartbeatAt: new Date().toISOString() };
		atomicWriteJson(stageOwnerPath(ctx, loopName), refreshed);
		return refreshed;
	} finally {
		releaseMatchingMutationMutex(ctx, loopName, mutex.tokenDigest);
	}
}

function processState(pid: number | undefined): "live" | "dead" | "missing" {
	if (pid === undefined) return "missing";
	if (isProcessAlive(pid)) return "live";
	return "dead";
}

export function inspectStageOwnership(ctx: ExtensionContext, loopName: string): OwnershipInspection {
	const owner = readOwnerRecord(ctx, loopName);
	const mutex = readMutationRecord(ctx, loopName);
	const state = loadState(ctx, loopName);
	const ownership = state?.executionGraph?.ownership;
	let stateIdentityMatchesOwner = false;
	let stateMatchesOwner = false;
	let mutexMatchesOwner = false;
	let heartbeatSuspected = false;
	if (owner && ownership) {
		stateIdentityMatchesOwner = ownership.graphId === owner.graphId
			&& ownership.stageId === owner.stageId
			&& ownership.sessionId === owner.sessionId
			&& ownership.pid === owner.pid
			&& ownership.tokenDigest === owner.tokenDigest;
		stateMatchesOwner = stateIdentityMatchesOwner
			&& ownership.stateRevision === owner.stateRevision
			&& state?.executionGraph?.revision === owner.stateRevision;
	}
	if (owner && mutex) {
		mutexMatchesOwner = mutex.graphId === owner.graphId
			&& mutex.stageId === owner.stageId
			&& mutex.sessionId === owner.sessionId
			&& mutex.tokenDigest === owner.tokenDigest;
	}
	if (owner) heartbeatSuspected = Date.now() - Date.parse(owner.heartbeatAt) > OWNER_SUSPECT_MS;
	let nextAction = "No ownership evidence exists.";
	if (mutex && !owner && !ownership) nextAction = "Standalone mutation evidence is durable. Inspect its process and use approved reconciliation only after confirmed death and graph matching.";
	if (ownership && !owner) nextAction = "Persisted graph ownership has no owner record. Mutations fail closed; approved reconciliation requires matching identity and confirmed process death.";
	if (owner) nextAction = "Owner evidence is durable. A stale heartbeat is suspicion only; inspect liveness and use approved takeover only after confirmed death.";
	return {
		loopName,
		owner,
		mutex,
		stateOwnership: ownership ?? null,
		ownerProcess: processState(owner?.pid),
		mutexProcess: processState(mutex?.pid),
		heartbeatSuspected,
		stateRevision: state?.executionGraph?.revision,
		stateIdentityMatchesOwner,
		stateMatchesOwner,
		mutexMatchesOwner,
		nextAction,
	};
}

function requireTakeoverEvidence(request: ReconcileOwnershipRequest): void {
	if (!request.rationale?.trim()) throw new OwnershipProtocolError("rationale_required", "Approved takeover requires a nonblank rationale.");
	if (!request.approvalRef?.trim()) throw new OwnershipProtocolError("approval_required", "Approved takeover requires an explicit approval reference.");
	if (!request.classification?.trim()) throw new OwnershipProtocolError("classification_required", "Approved takeover requires worker and Treehouse ownership classification evidence.");
	if (!request.sessionId?.trim()) throw new OwnershipProtocolError("session_required", "Approved takeover requires the new runtime session id.");
}

function mutationMatchesOwnership(mutex: NonNullable<OwnershipInspection["mutex"]>, ownership: ExecutionStageOwnership): boolean {
	return mutex.graphId === ownership.graphId
		&& mutex.stageId === ownership.stageId
		&& mutex.sessionId === ownership.sessionId
		&& mutex.pid === ownership.pid
		&& mutex.tokenDigest === ownership.tokenDigest;
}

function ownershipIdentityMatches(left: ExecutionStageOwnership, right: ExecutionStageOwnership): boolean {
	return left.graphId === right.graphId
		&& left.stageId === right.stageId
		&& left.sessionId === right.sessionId
		&& left.pid === right.pid
		&& left.tokenDigest === right.tokenDigest
		&& left.stateRevision === right.stateRevision;
}

function reacquireAfterReconciliation(
	ctx: ExtensionContext,
	request: ReconcileOwnershipRequest,
	graphId: string,
	stageId: string,
	priorOwnershipEvidence?: ExecutionStageOwnership,
): OwnershipAcquisition {
	const revision = loadState(ctx, request.loopName)?.executionGraph?.revision;
	if (revision === undefined) throw new OwnershipProtocolError("graph_missing", "Execution graph disappeared during takeover.");
	return acquireStageOwnership(ctx, {
		loopName: request.loopName,
		graphId,
		stageId,
		expectedGraphRevision: revision,
		sessionId: request.sessionId as string,
		priorOwnershipEvidence,
	});
}

export function reconcileStageOwnership(ctx: ExtensionContext, request: ReconcileOwnershipRequest): OwnershipInspection | OwnershipAcquisition {
	const inspection = inspectStageOwnership(ctx, request.loopName);
	if (request.takeOwnership !== true) return inspection;
	requireTakeoverEvidence(request);
	const owner = inspection.owner;
	if (owner) {
		if (inspection.ownerProcess === "live") throw new OwnershipProtocolError("owner_live", `Takeover refused: owner pid ${owner.pid} is live. Heartbeat expiry alone never permits takeover.`);
		if (inspection.mutex && !inspection.mutexMatchesOwner) throw new OwnershipProtocolError("mutex_mismatch", "Takeover refused: mutation mutex does not match the dead owner evidence.");
		if (inspection.mutexProcess === "live") throw new OwnershipProtocolError("mutex_live", `Takeover refused: mutation mutex pid ${inspection.mutex?.pid} is live.`);
		if (owner.status === "active" && !inspection.stateMatchesOwner) throw new OwnershipProtocolError("state_mismatch", "Takeover refused: durable state ownership identity and revision do not match the active owner record.");
		if (owner.status === "acquiring" && inspection.stateRevision !== owner.expectedGraphRevision) {
			const committedRevision = owner.expectedGraphRevision + 1;
			if (inspection.stateRevision !== committedRevision || !inspection.stateIdentityMatchesOwner) {
				throw new OwnershipProtocolError("state_mismatch", "Takeover refused: acquiring owner evidence cannot be matched to either the pre-commit or committed state revision.");
			}
		}
		if (request.graphId && request.graphId !== owner.graphId) throw new OwnershipProtocolError("graph_mismatch", "Requested takeover graph does not match durable owner evidence.");
		if (request.stageId && request.stageId !== owner.stageId) throw new OwnershipProtocolError("stage_mismatch", "Requested takeover stage does not match durable owner evidence.");
		if (inspection.mutex) quarantineOwnershipFile(ctx, request.loopName, "mutex", owner.tokenDigest);
		quarantineOwnershipFile(ctx, request.loopName, "owner", owner.tokenDigest);
		return reacquireAfterReconciliation(ctx, request, owner.graphId, owner.stageId, inspection.stateOwnership ?? undefined);
	}

	const ownership = inspection.stateOwnership;
	if (ownership) {
		if (isProcessAlive(ownership.pid)) throw new OwnershipProtocolError("owner_live", `Takeover refused: persisted owner pid ${ownership.pid} is live.`);
		if (!request.graphId || request.graphId !== ownership.graphId) throw new OwnershipProtocolError("graph_mismatch", "Orphaned ownership takeover requires the exact durable graphId.");
		if (!request.stageId || request.stageId !== ownership.stageId) throw new OwnershipProtocolError("stage_mismatch", "Orphaned ownership takeover requires the exact durable stageId.");
		if (inspection.stateRevision !== ownership.stateRevision) throw new OwnershipProtocolError("state_mismatch", "Orphaned ownership revision does not match the execution graph revision.");
		if (inspection.mutex && !mutationMatchesOwnership(inspection.mutex, ownership)) throw new OwnershipProtocolError("mutex_mismatch", "Mutation mutex does not match orphaned graph ownership evidence.");
		if (inspection.mutexProcess === "live") throw new OwnershipProtocolError("mutex_live", `Takeover refused: mutation mutex pid ${inspection.mutex?.pid} is live.`);
		if (inspection.mutex) quarantineOwnershipFile(ctx, request.loopName, "mutex", ownership.tokenDigest);
		return reacquireAfterReconciliation(ctx, request, ownership.graphId, ownership.stageId, ownership);
	}

	const mutex = inspection.mutex;
	if (!mutex) throw new OwnershipProtocolError("owner_missing", "There is no owner, orphaned graph ownership, or standalone mutex evidence to reconcile.");
	if (inspection.mutexProcess === "live") throw new OwnershipProtocolError("mutex_live", `Takeover refused: standalone mutation mutex pid ${mutex.pid} is live.`);
	if (!request.graphId || request.graphId !== mutex.graphId) throw new OwnershipProtocolError("graph_mismatch", "Standalone mutex recovery requires the exact durable graphId.");
	if (!request.stageId) throw new OwnershipProtocolError("stage_required", "Standalone mutex recovery requires the intended stageId.");
	if (mutex.stageId && mutex.stageId !== request.stageId) throw new OwnershipProtocolError("stage_mismatch", "Standalone mutex stage does not match the requested takeover stage.");
	quarantineOwnershipFile(ctx, request.loopName, "mutex", mutex.tokenDigest);
	return reacquireAfterReconciliation(ctx, request, request.graphId, request.stageId);
}

export function markOwnershipDetachedCandidate(state: LoopState): boolean {
	const graph = state.executionGraph;
	if (!graph?.ownership) return false;
	const now = new Date().toISOString();
	graph.ownership.status = "detached";
	graph.ownership.detachedAt = now;
	for (const stage of graph.stages) {
		if (stage.id === graph.ownership.stageId && stage.status !== "integrated" && stage.status !== "abandoned") stage.status = "detached";
	}
	for (const node of graph.nodes) {
		if (node.status === "leased" || node.status === "running") node.status = "detached";
	}
	return true;
}

function markDetachedState(ctx: ExtensionContext, loopName: string): number | undefined {
	const saved = mutateState(ctx, loopName, (state) => {
		markOwnershipDetachedCandidate(state);
	});
	return saved.executionGraph?.revision;
}

export function detachOwnedStages(ctx: ExtensionContext, sessionId: string): string[] {
	const detached: string[] = [];
	for (const loopName of ownedLoopsForSession(ctx, sessionId)) {
		markDetachedState(ctx, loopName);
		removeOwnershipToken(ctx, loopName, sessionId);
		detached.push(loopName);
	}
	return detached;
}

export function hasDurableOwner(ctx: ExtensionContext, loopName: string): boolean {
	return fs.existsSync(stageOwnerPath(ctx, loopName));
}
