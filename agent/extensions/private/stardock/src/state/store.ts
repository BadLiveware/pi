/**
 * Stardock state persistence with cross-process compare-and-swap mutation.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { LoopState } from "./core.ts";
import { digestExecutionNodeContract, digestExecutionStageContract, type ExecutionAttempt, type ExecutionStageOwnership } from "../stages/contracts.ts";
import { migrateState } from "./migration.ts";
import { archiveDir, ensureDir, existingStatePath, runsDir, stageOwnerPath, stardockDir, statePath, tryRead } from "./paths.ts";
import {
	acquireMutationMutex,
	atomicWriteJson,
	digestOwnershipToken,
	OwnershipProtocolError,
	ownershipSessionForContext,
	ownershipTokenForContext,
	readOwnerRecord,
	releaseMatchingMutationMutex,
	type StateMutationRecord,
} from "../stages/ownership-records.ts";

export interface StateMutationOptions {
	expectedGraphRevision?: number;
	allowAcquiringOwner?: boolean;
	priorOwnershipEvidence?: ExecutionStageOwnership;
	mutexWaitMs?: number;
	afterCommit?: (state: LoopState) => void;
}

export function readStateFile(filePath: string): LoopState | null {
	const content = tryRead(filePath);
	if (!content) return null;
	return migrateState(JSON.parse(content));
}

export function loadState(ctx: ExtensionContext, name: string, archived = false): LoopState | null {
	return readStateFile(existingStatePath(ctx, name, archived));
}

function assertAppendOnly<T>(attemptId: string, field: string, current: T[], candidate: T[]): void {
	if (candidate.length < current.length) throw new OwnershipProtocolError("attempt_history_removed", `Execution attempt "${attemptId}" ${field} history cannot shrink.`);
	for (let index = 0; index < current.length; index++) {
		if (JSON.stringify(current[index]) !== JSON.stringify(candidate[index])) {
			throw new OwnershipProtocolError("attempt_history_immutable", `Execution attempt "${attemptId}" ${field} history is append-only.`);
		}
	}
}

function assertAttemptPreserved(current: ExecutionAttempt, candidate: ExecutionAttempt): void {
	for (const field of ["id", "baseCommit", "branchRef", "startedAt"] as const) {
		if (candidate[field] !== current[field]) throw new OwnershipProtocolError("attempt_history_immutable", `Execution attempt "${current.id}" field "${field}" is immutable.`);
	}
	for (const field of ["workerRunId", "workerReportId", "bridgeRunId", "nodeContractDigest", "stageContractDigest", "headCommit", "worktreePath", "leaseHolder", "clean", "completedAt"] as const) {
		if (current[field] !== undefined && candidate[field] !== current[field]) {
			throw new OwnershipProtocolError("attempt_history_immutable", `Execution attempt "${current.id}" once-set field "${field}" is immutable.`);
		}
	}
	for (const field of ["writes", "resourceClaims", "validationCommands"] as const) {
		if (current[field] !== undefined && JSON.stringify(candidate[field]) !== JSON.stringify(current[field])) {
			throw new OwnershipProtocolError("attempt_history_immutable", `Execution attempt "${current.id}" contract field "${field}" is immutable.`);
		}
	}
	assertAppendOnly(current.id, "lane commit", current.laneCommits, candidate.laneCommits);
	assertAppendOnly(current.id, "changed path", current.changedPaths ?? [], candidate.changedPaths ?? []);
	assertAppendOnly(current.id, "violation", current.violations ?? [], candidate.violations ?? []);
	assertAppendOnly(current.id, "validation", current.validation, candidate.validation);
}

function assertPriorAttemptsPreserved(current: LoopState, candidate: LoopState): void {
	const currentGraph = current.executionGraph;
	if (!currentGraph) return;
	const candidateGraph = candidate.executionGraph;
	if (!candidateGraph) throw new OwnershipProtocolError("attempt_history_removed", "Execution graph removal would discard durable attempt history.");
	const hasDurableAttempts = currentGraph.nodes.some((node) => node.attempts.length > 0);
	if (hasDurableAttempts && currentGraph.id !== candidateGraph.id) throw new OwnershipProtocolError("execution_contract_immutable", "Execution graph identity cannot change after durable attempts exist.");
	const candidateAttempts = candidateGraph.nodes.flatMap((node) => node.attempts);
	if (new Set(candidateAttempts.map((attempt) => attempt.id)).size !== candidateAttempts.length) {
		throw new OwnershipProtocolError("attempt_identity_duplicate", "Execution attempt ids must remain unique across the graph.");
	}
	const candidateNodes = new Map(candidateGraph.nodes.map((node) => [node.id, node]));
	for (const currentNode of currentGraph.nodes) {
		const candidateNode = candidateNodes.get(currentNode.id);
		if (!candidateNode && currentNode.attempts.length > 0) throw new OwnershipProtocolError("attempt_history_removed", `Execution node "${currentNode.id}" with durable attempts cannot be removed.`);
		if (!candidateNode) continue;
		if (currentNode.attempts.length > 0 && digestExecutionNodeContract(currentNode) !== digestExecutionNodeContract(candidateNode)) {
			throw new OwnershipProtocolError("execution_contract_immutable", `Execution node "${currentNode.id}" contract cannot change after its first durable attempt.`);
		}
		if (candidateNode.attempts.length < currentNode.attempts.length) {
			throw new OwnershipProtocolError("attempt_history_removed", `Execution node "${currentNode.id}" attempt history cannot shrink.`);
		}
		for (let index = 0; index < currentNode.attempts.length; index++) {
			const attempt = currentNode.attempts[index];
			const next = candidateNode.attempts[index];
			if (!next || next.id !== attempt.id) {
				throw new OwnershipProtocolError("attempt_history_immutable", `Execution node "${currentNode.id}" attempt order is append-only.`);
			}
			assertAttemptPreserved(attempt, next);
		}
	}
	const candidateStages = new Map(candidateGraph.stages.map((stage) => [stage.id, stage]));
	for (const currentStage of currentGraph.stages) {
		const hasAttempts = [currentStage.contractNodeId, ...currentStage.implementationNodeIds, currentStage.fanInNodeId]
			.some((nodeId) => currentGraph.nodes.find((node) => node.id === nodeId)?.attempts.length);
		if (!hasAttempts) continue;
		const candidateStage = candidateStages.get(currentStage.id);
		if (!candidateStage) throw new OwnershipProtocolError("execution_contract_immutable", `Execution stage "${currentStage.id}" cannot be removed after durable attempts exist.`);
		if (currentStage.contractDigest !== candidateStage.contractDigest || digestExecutionStageContract(currentGraph, currentStage) !== digestExecutionStageContract(candidateGraph, candidateStage)) {
			throw new OwnershipProtocolError("execution_contract_immutable", `Execution stage "${currentStage.id}" contract cannot change after its first durable attempt.`);
		}
	}
}

function ownershipIdentityMatches(left: ExecutionStageOwnership, right: ExecutionStageOwnership): boolean {
	return left.graphId === right.graphId
		&& left.stageId === right.stageId
		&& left.sessionId === right.sessionId
		&& left.pid === right.pid
		&& left.tokenDigest === right.tokenDigest
		&& left.stateRevision === right.stateRevision;
}

function assertActiveOwnerEvidence(ctx: ExtensionContext, state: LoopState, owner: NonNullable<ReturnType<typeof readOwnerRecord>>): void {
	const graph = state.executionGraph;
	const ownership = graph?.ownership;
	const entry = ownershipTokenForContext(ctx, state.name);
	if (!entry
		|| entry.graphId !== owner.graphId
		|| entry.stageId !== owner.stageId
		|| entry.sessionId !== owner.sessionId
		|| entry.tokenDigest !== owner.tokenDigest
		|| digestOwnershipToken(entry.token) !== owner.tokenDigest
		|| owner.pid !== process.pid) {
		throw new OwnershipProtocolError("non_owner", ownerMutationGuidance(owner.graphId, owner.stageId, owner.sessionId));
	}
	if (!graph || !ownership
		|| graph.id !== owner.graphId
		|| ownership.graphId !== owner.graphId
		|| ownership.stageId !== owner.stageId
		|| ownership.sessionId !== owner.sessionId
		|| ownership.pid !== owner.pid
		|| ownership.tokenDigest !== owner.tokenDigest
		|| ownership.stateRevision !== graph.revision
		|| owner.stateRevision !== graph.revision) {
		throw new OwnershipProtocolError("state_mismatch", "Active owner evidence does not exactly match persisted graph ownership and revision.");
	}
}

function assertPriorOwnershipCurrent(state: LoopState, expected: ExecutionStageOwnership | undefined): void {
	const durableOwnership = state.executionGraph?.ownership;
	if (!expected) {
		if (durableOwnership) {
			throw new OwnershipProtocolError("owner_orphaned", `Graph "${durableOwnership.graphId}" stage "${durableOwnership.stageId}" retains ownership without a valid owner record. Use approved stardock_stage reconciliation.`);
		}
		return;
	}
	if (!durableOwnership || !ownershipIdentityMatches(durableOwnership, expected)) {
		throw new OwnershipProtocolError("evidence_changed", "Prior graph ownership evidence changed before replacement acquisition.");
	}
}

function mutationIdentity(ctx: ExtensionContext, state: LoopState, options: StateMutationOptions): { record: StateMutationRecord; authorizedOwner: boolean } {
	const owner = readOwnerRecord(ctx, state.name);
	if (owner) {
		if (owner.status === "active") assertActiveOwnerEvidence(ctx, state, owner);
		if (owner.status === "acquiring") {
			const entry = ownershipTokenForContext(ctx, state.name);
			if (!entry || entry.tokenDigest !== owner.tokenDigest || entry.sessionId !== owner.sessionId || digestOwnershipToken(entry.token) !== owner.tokenDigest) {
				throw new OwnershipProtocolError("non_owner", ownerMutationGuidance(owner.graphId, owner.stageId, owner.sessionId));
			}
			assertPriorOwnershipCurrent(state, options.priorOwnershipEvidence);
		}
		return {
			authorizedOwner: true,
			record: {
				version: 1,
				graphId: owner.graphId,
				stageId: owner.stageId,
				sessionId: owner.sessionId,
				pid: process.pid,
				tokenDigest: owner.tokenDigest,
				acquiredAt: new Date().toISOString(),
			},
		};
	}
	assertPriorOwnershipCurrent(state, undefined);
	const token = randomBytes(32).toString("base64url");
	let sessionId = ownershipSessionForContext(ctx);
	if (!sessionId) sessionId = `process-${process.pid}`;
	let graphId = `${state.name}:execution`;
	if (state.executionGraph) graphId = state.executionGraph.id;
	return {
		authorizedOwner: false,
		record: {
			version: 1,
			graphId,
			sessionId,
			pid: process.pid,
			tokenDigest: digestOwnershipToken(token),
			acquiredAt: new Date().toISOString(),
		},
	};
}

function assertMutationIdentityCurrent(
	ctx: ExtensionContext,
	state: LoopState,
	identity: ReturnType<typeof mutationIdentity>,
	options: StateMutationOptions,
): void {
	const owner = readOwnerRecord(ctx, state.name);
	if (!owner) {
		if (identity.authorizedOwner) throw new OwnershipProtocolError("evidence_changed", "Stage owner evidence changed while waiting for the state mutation mutex.");
		assertPriorOwnershipCurrent(state, undefined);
		return;
	}
	if (!identity.authorizedOwner || owner.tokenDigest !== identity.record.tokenDigest || owner.sessionId !== identity.record.sessionId) {
		throw new OwnershipProtocolError("non_owner", ownerMutationGuidance(owner.graphId, owner.stageId, owner.sessionId));
	}
	if (owner.status === "acquiring" && options.allowAcquiringOwner !== true) {
		throw new OwnershipProtocolError("owner_acquiring", `Stage ownership for graph "${owner.graphId}" stage "${owner.stageId}" is still acquiring. Reconcile before mutating.`);
	}
	if (owner.status === "acquiring") assertPriorOwnershipCurrent(state, options.priorOwnershipEvidence);
	if (owner.status === "active") assertActiveOwnerEvidence(ctx, state, owner);
}

function compareGraphRevision(current: LoopState, expected: number | undefined): void {
	if (expected === undefined) return;
	const actual = current.executionGraph?.revision;
	if (actual === expected) return;
	throw new OwnershipProtocolError("stale_revision", `Stale execution graph revision: expected ${expected}, current ${String(actual)}. Reload state and retry the stable-id mutation.`);
}

function assertOwnedCandidatePreserved(current: LoopState, candidate: LoopState): void {
	const ownership = current.executionGraph?.ownership;
	if (!ownership) return;
	const next = candidate.executionGraph?.ownership;
	if (!next) throw new OwnershipProtocolError("owner_identity_changed", "An active or detached ownership record cannot be removed by a normal state mutation.");
	for (const field of ["graphId", "stageId", "sessionId", "pid", "tokenDigest", "acquiredAt"] as const) {
		if (next[field] !== ownership[field]) throw new OwnershipProtocolError("owner_identity_changed", `Persisted ownership field "${field}" is immutable during owner mutation.`);
	}
	if (next.stateRevision !== ownership.stateRevision) {
		throw new OwnershipProtocolError("stale_revision", "Persisted ownership revision must match the reloaded state before replacement.");
	}
}

function assertOwnershipReplacement(
	current: LoopState,
	candidate: LoopState,
	prior: ExecutionStageOwnership,
	identity: ReturnType<typeof mutationIdentity>,
): void {
	const ownership = current.executionGraph?.ownership;
	if (!ownership || !ownershipIdentityMatches(ownership, prior)) {
		throw new OwnershipProtocolError("evidence_changed", "Prior graph ownership evidence changed before atomic replacement.");
	}
	const replacement = candidate.executionGraph?.ownership;
	if (!replacement) throw new OwnershipProtocolError("owner_identity_changed", "Reconciliation acquisition must replace prior ownership without an unowned intermediate state.");
	if (replacement.graphId !== identity.record.graphId
		|| replacement.stageId !== identity.record.stageId
		|| replacement.sessionId !== identity.record.sessionId
		|| replacement.pid !== identity.record.pid
		|| replacement.tokenDigest !== identity.record.tokenDigest) {
		throw new OwnershipProtocolError("owner_identity_changed", "Replacement graph ownership must match the acquiring owner and mutation identity.");
	}
}

function prepareCandidate(
	current: LoopState,
	candidate: LoopState,
	identity: ReturnType<typeof mutationIdentity>,
	priorOwnershipEvidence: ExecutionStageOwnership | undefined,
): void {
	candidate.active = candidate.status === "active";
	assertPriorAttemptsPreserved(current, candidate);
	if (priorOwnershipEvidence) assertOwnershipReplacement(current, candidate, priorOwnershipEvidence, identity);
	else assertOwnedCandidatePreserved(current, candidate);
	const currentGraph = current.executionGraph;
	const candidateGraph = candidate.executionGraph;
	if (!currentGraph || !candidateGraph) return;
	if (candidateGraph.id !== currentGraph.id) throw new OwnershipProtocolError("graph_identity_changed", "Execution graph id cannot change during a guarded mutation.");
	if (candidateGraph.revision !== currentGraph.revision) {
		throw new OwnershipProtocolError("stale_revision", `Stale execution graph revision: candidate ${candidateGraph.revision}, current ${currentGraph.revision}. Reload state and retry.`);
	}
	candidateGraph.revision = currentGraph.revision + 1;
	candidateGraph.updatedAt = new Date().toISOString();
	if (candidateGraph.ownership) candidateGraph.ownership.stateRevision = candidateGraph.revision;
}

function atomicReplaceState(ctx: ExtensionContext, state: LoopState, archived: boolean): void {
	const filePath = statePath(ctx, state.name, archived);
	ensureDir(filePath);
	atomicWriteJson(filePath, state);
}

function syncActiveOwnerRevision(ctx: ExtensionContext, state: LoopState): void {
	const owner = readOwnerRecord(ctx, state.name);
	if (!owner || owner.status !== "active") return;
	const graph = state.executionGraph;
	const ownership = graph?.ownership;
	if (!graph || !ownership
		|| owner.graphId !== graph.id
		|| owner.graphId !== ownership.graphId
		|| owner.stageId !== ownership.stageId
		|| owner.sessionId !== ownership.sessionId
		|| owner.pid !== ownership.pid
		|| owner.tokenDigest !== ownership.tokenDigest
		|| ownership.stateRevision !== graph.revision) {
		throw new OwnershipProtocolError("evidence_changed", "Durable state ownership no longer matches the active owner record.");
	}
	const refreshed = { ...owner, stateRevision: graph.revision };
	if (ownership.detachedAt) refreshed.detachedAt = ownership.detachedAt;
	atomicWriteJson(stageOwnerPath(ctx, state.name), refreshed);
}

export function mutateState(
	ctx: ExtensionContext,
	name: string,
	mutate: (state: LoopState) => void,
	options: StateMutationOptions = {},
): LoopState {
	const initial = loadState(ctx, name);
	if (!initial) throw new OwnershipProtocolError("state_missing", `Loop "${name}" not found.`);
	const identity = mutationIdentity(ctx, initial, options);
	acquireMutationMutex(ctx, name, identity.record, options.mutexWaitMs);
	try {
		const current = loadState(ctx, name);
		if (!current) throw new OwnershipProtocolError("state_missing", `Loop "${name}" disappeared during guarded mutation.`);
		assertMutationIdentityCurrent(ctx, current, identity, options);
		compareGraphRevision(current, options.expectedGraphRevision);
		const candidate = structuredClone(current);
		mutate(candidate);
		prepareCandidate(current, candidate, identity, options.priorOwnershipEvidence);
		atomicReplaceState(ctx, candidate, false);
		syncActiveOwnerRevision(ctx, candidate);
		if (options.afterCommit) options.afterCommit(candidate);
		return candidate;
	} finally {
		releaseMatchingMutationMutex(ctx, name, identity.record.tokenDigest);
	}
}

export function saveState(ctx: ExtensionContext, state: LoopState, archived = false): void {
	if (archived) {
		state.active = state.status === "active";
		atomicReplaceState(ctx, state, true);
		return;
	}
	const current = loadState(ctx, state.name);
	if (!current) {
		const options: StateMutationOptions = {};
		const identity = mutationIdentity(ctx, state, options);
		acquireMutationMutex(ctx, state.name, identity.record);
		try {
			const owner = readOwnerRecord(ctx, state.name);
			if (owner) throw new OwnershipProtocolError("non_owner", ownerMutationGuidance(owner.graphId, owner.stageId, owner.sessionId));
			if (loadState(ctx, state.name)) throw new OwnershipProtocolError("state_exists", `Loop "${state.name}" was created by another runtime. Reload instead of overwriting it.`);
			state.active = state.status === "active";
			atomicReplaceState(ctx, state, false);
		} finally {
			releaseMatchingMutationMutex(ctx, state.name, identity.record.tokenDigest);
		}
		return;
	}
	if (current.status === "completed" && state.status === "active" && state.iteration === 1 && state.executionGraph && current.executionGraph) {
		const priorAttemptCount = current.executionGraph.nodes.reduce((count, node) => count + node.attempts.length, 0);
		if (priorAttemptCount > 0) throw new OwnershipProtocolError("attempt_history_immutable", `Loop "${state.name}" has durable execution attempts and cannot be restarted in place. Start a new loop generation with a new name.`);
		state.executionGraph.revision = current.executionGraph.revision;
	}
	const expectedGraphRevision = state.executionGraph?.revision;
	const saved = mutateState(ctx, state.name, (candidate) => {
		const replacement = structuredClone(state);
		for (const key of Object.keys(candidate) as Array<keyof LoopState>) delete candidate[key];
		Object.assign(candidate, replacement);
	}, { expectedGraphRevision });
	Object.assign(state, saved);
}

export function ownerMutationGuidance(graphId: string, stageId: string, sessionId: string): string {
	return `Mutation rejected: graph "${graphId}" stage "${stageId}" is owned by session "${sessionId}". Read-only state, policy, and status remain available. Use stardock_stage reconcile for bounded evidence; takeover requires confirmed owner death plus explicit rationale and approval.`;
}

function ownershipEvidenceFailureGuidance(error: unknown, action: "mutation" | "destruction"): string {
	if (!(error instanceof OwnershipProtocolError)) throw error;
	if (error.code !== "evidence_malformed" && error.code !== "evidence_unreadable") throw error;
	if (action === "destruction") {
		return `Destructive lifecycle action rejected: ownership evidence failed closed (${error.code}). No destruction ran. Use read-only \`stardock_stage list\` or \`stardock_stage reconcile\` to inspect ownership evidence.`;
	}
	return `Mutation rejected: ownership evidence failed closed (${error.code}). No mutation ran. Use read-only \`stardock_stage list\` or \`stardock_stage reconcile\` to inspect ownership evidence.`;
}

export function mutationBlockReason(ctx: ExtensionContext, name: string): string | undefined {
	let owner: ReturnType<typeof readOwnerRecord>;
	try {
		owner = readOwnerRecord(ctx, name);
	} catch (error) {
		return ownershipEvidenceFailureGuidance(error, "mutation");
	}
	const ownership = loadState(ctx, name)?.executionGraph?.ownership;
	if (!owner) {
		if (!ownership) return undefined;
		return `Mutation rejected: graph "${ownership.graphId}" stage "${ownership.stageId}" retains ownership without a valid owner record. Use approved stardock_stage reconciliation.`;
	}
	const entry = ownershipTokenForContext(ctx, name);
	if (entry && entry.tokenDigest === owner.tokenDigest && entry.sessionId === owner.sessionId) return undefined;
	return ownerMutationGuidance(owner.graphId, owner.stageId, owner.sessionId);
}

export function destructiveOwnershipBlockReason(ctx: ExtensionContext, name: string): string | undefined {
	let owner: ReturnType<typeof readOwnerRecord>;
	try {
		owner = readOwnerRecord(ctx, name);
	} catch (error) {
		return ownershipEvidenceFailureGuidance(error, "destruction");
	}
	const ownership = loadState(ctx, name)?.executionGraph?.ownership;
	if (!owner && !ownership) return undefined;
	let graphId = ownership?.graphId;
	let stageId = ownership?.stageId;
	if (owner) {
		graphId = owner.graphId;
		stageId = owner.stageId;
	}
	return `Destructive lifecycle action rejected: graph "${String(graphId)}" stage "${String(stageId)}" retains nonterminal ownership evidence. Reconcile and explicitly abandon/release the stage before cancel, archive, clean, or nuke.`;
}

export function listLoops(ctx: ExtensionContext, archived = false): LoopState[] {
	let currentDir = runsDir(ctx);
	let legacyDir = stardockDir(ctx);
	if (archived) {
		currentDir = archiveDir(ctx);
		legacyDir = archiveDir(ctx);
	}
	const byName = new Map<string, LoopState>();

	if (fs.existsSync(currentDir)) {
		for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const state = readStateFile(path.join(currentDir, entry.name, "state.json"));
			if (state) byName.set(state.name, state);
		}
	}

	if (fs.existsSync(legacyDir)) {
		for (const entry of fs.readdirSync(legacyDir, { withFileTypes: true })) {
			if (!entry.isFile() || !entry.name.endsWith(".state.json")) continue;
			const state = readStateFile(path.join(legacyDir, entry.name));
			if (state && !byName.has(state.name)) byName.set(state.name, state);
		}
	}

	return [...byName.values()];
}
