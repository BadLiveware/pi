import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { WorkerRun } from "../state/core.ts";
import { loadState, mutateState } from "../state/store.ts";
import { clearTerminalOwnerEvidence, removeOwnershipToken } from "./ownership-records.ts";
import { assertNoActiveStageWork, assertStageReviewDecided } from "./active-work.ts";
import type { ExecutionAttempt, ExecutionNode, ExecutionStage } from "./contracts.ts";
import type { RunReadyAdapter } from "./run-ready.ts";
import { TreehouseAdapter, type PartialTreehouseLease, type TreehouseLease } from "./treehouse-adapter.ts";

export type ReconcileClassification = "needs_review" | "accepted" | "retry_ready" | "detached" | "failed" | "released";

export interface ReconciledAttempt {
	nodeId: string;
	attemptId: string;
	classification: ReconcileClassification;
	reason: string;
	headCommit?: string;
	clean?: boolean;
	workerRunStatus?: string;
}

export interface StageResourceReconciliation {
	ok: boolean;
	readOnly: boolean;
	graphId: string;
	stageId: string;
	stateRevision: number;
	attempts: ReconciledAttempt[];
}

function stageAndNodes(ctx: ExtensionContext, loopName: string, graphId: string, stageId: string) {
	const state = loadState(ctx, loopName);
	if (!state?.executionGraph || state.executionGraph.id !== graphId) throw new Error(`Execution graph "${graphId}" was not found.`);
	const graph = state.executionGraph;
	const stage = graph.stages.find((candidate) => candidate.id === stageId);
	if (!stage) throw new Error(`Execution stage "${stageId}" was not found.`);
	const nodes = stage.implementationNodeIds.map((nodeId) => graph.nodes.find((candidate) => candidate.id === nodeId)).filter((node): node is ExecutionNode => Boolean(node));
	return { state, graph, stage, nodes };
}

function leaseFor(attempt: ExecutionAttempt): TreehouseLease | undefined {
	if (!attempt.worktreePath || !attempt.repositoryCommonDir || !attempt.leaseHolder) return undefined;
	return {
		worktreePath: attempt.worktreePath,
		repositoryCommonDir: attempt.repositoryCommonDir,
		contractCommit: attempt.baseCommit,
		branchRef: attempt.branchRef,
		leaseHolder: attempt.leaseHolder,
	};
}

function partialLeaseFor(attempt: ExecutionAttempt, statusContextCwd?: string): PartialTreehouseLease | undefined {
	if (!attempt.worktreePath && !attempt.repositoryCommonDir && !attempt.leaseHolder) return undefined;
	const partial: PartialTreehouseLease = {
		contractCommit: attempt.baseCommit,
	};
	if (attempt.worktreePath) partial.worktreePath = attempt.worktreePath;
	if (attempt.repositoryCommonDir) partial.repositoryCommonDir = attempt.repositoryCommonDir;
	if (attempt.leaseHolder) partial.leaseHolder = attempt.leaseHolder;
	if (attempt.branchRef) partial.branchRef = attempt.branchRef;
	if (statusContextCwd) partial.statusContextCwd = statusContextCwd;
	return partial;
}

function attemptTracksLease(attempt: ExecutionAttempt): boolean {
	if (attempt.leaseDisposition !== undefined) return true;
	return Boolean(attempt.worktreePath || attempt.repositoryCommonDir || attempt.leaseHolder);
}

function releaseSatisfied(attempt: ExecutionAttempt): boolean {
	if (attempt.leaseDisposition === "released") return true;
	return !attemptTracksLease(attempt);
}

function workerForAttempt(workerRuns: WorkerRun[], attempt: ExecutionAttempt): WorkerRun | undefined {
	return workerRuns.find((run) => run.id === attempt.workerRunId && run.attemptId === attempt.id);
}

async function inspectReturnedLease(ctx: ExtensionContext, adapter: RunReadyAdapter, attempt: ExecutionAttempt, signal?: AbortSignal): Promise<{ state: "held" | "absent" | "ambiguous"; reason: string }> {
	const lease = partialLeaseFor(attempt, ctx.cwd);
	if (!lease) return { state: "ambiguous", reason: `Attempt "${attempt.id}" lacks exact worktree, holder, or repository identity, so Treehouse pool evidence cannot prove whether a lease still exists.` };
	const inspection = await adapter.inspectLeaseReservation(lease, signal);
	return { state: inspection.state, reason: inspection.reason };
}

async function recoverReleasedLeaseIfAbsent(ctx: ExtensionContext, adapter: RunReadyAdapter, attempt: ExecutionAttempt, signal?: AbortSignal): Promise<ReconciledAttempt | undefined> {
	try {
		const inspection = await inspectReturnedLease(ctx, adapter, attempt, signal);
		if (inspection.state === "absent") {
			return { nodeId: "", attemptId: attempt.id, classification: "released", reason: inspection.reason };
		}
		if (inspection.state === "ambiguous") {
			return { nodeId: "", attemptId: attempt.id, classification: "failed", reason: inspection.reason };
		}
	} catch (error) {
		let message = String(error);
		if (error instanceof Error) message = error.message;
		return { nodeId: "", attemptId: attempt.id, classification: "failed", reason: `Treehouse pool inspection failed: ${message}` };
	}
	return undefined;
}

async function classifyAttempt(ctx: ExtensionContext, adapter: RunReadyAdapter, node: ExecutionNode, attempt: ExecutionAttempt, workerRuns: WorkerRun[], signal?: AbortSignal): Promise<ReconciledAttempt> {
	if (attempt.leaseDisposition === "released") return { nodeId: node.id, attemptId: attempt.id, classification: "released", reason: "Lease disposition is durably released." };
	const lease = leaseFor(attempt);
	if (attempt.leaseDisposition === "release_pending" || !lease) {
		const recoveredBeforeInspect = await recoverReleasedLeaseIfAbsent(ctx, adapter, attempt, signal);
		if (recoveredBeforeInspect) return { ...recoveredBeforeInspect, nodeId: node.id };
	}
	if (!lease) {
		const inspection = await inspectReturnedLease(ctx, adapter, attempt, signal);
		return { nodeId: node.id, attemptId: attempt.id, classification: "failed", reason: inspection.reason };
	}
	let evidence;
	try {
		evidence = await adapter.inspectLaneCompletion(lease, signal);
	} catch (error) {
		const recoveredAfterInspect = await recoverReleasedLeaseIfAbsent(ctx, adapter, attempt, signal);
		if (recoveredAfterInspect) return { ...recoveredAfterInspect, nodeId: node.id };
		let message = String(error);
		if (error instanceof Error) message = error.message;
		return { nodeId: node.id, attemptId: attempt.id, classification: "failed", reason: `Lease/ref inspection failed: ${message}` };
	}
	const run = workerForAttempt(workerRuns, attempt);
	if (evidence.branchRef !== `refs/heads/${attempt.branchRef}`) {
		return { nodeId: node.id, attemptId: attempt.id, classification: "failed", reason: `Branch mismatch: expected refs/heads/${attempt.branchRef}, received ${evidence.branchRef ?? "detached HEAD"}.`, headCommit: evidence.headCommit, clean: evidence.clean, workerRunStatus: run?.status };
	}
	if (!evidence.baseIsAncestor) {
		return { nodeId: node.id, attemptId: attempt.id, classification: "failed", reason: `Contract/base ${attempt.baseCommit} is not an ancestor of ${evidence.headCommit}.`, headCommit: evidence.headCommit, clean: evidence.clean, workerRunStatus: run?.status };
	}
	if (!evidence.clean) return { nodeId: node.id, attemptId: attempt.id, classification: "detached", reason: "Lease is dirty and must be preserved for inspection.", headCommit: evidence.headCommit, clean: false, workerRunStatus: run?.status };
	if (evidence.headCommit === attempt.baseCommit) return { nodeId: node.id, attemptId: attempt.id, classification: "retry_ready", reason: "Lease is clean and unchanged from its immutable base.", headCommit: evidence.headCommit, clean: true, workerRunStatus: run?.status };
	if (run?.status === "accepted") return { nodeId: node.id, attemptId: attempt.id, classification: "accepted", reason: "Clean committed work retains its explicit accepted WorkerRun evidence.", headCommit: evidence.headCommit, clean: true, workerRunStatus: run.status };
	return { nodeId: node.id, attemptId: attempt.id, classification: "needs_review", reason: "Lease contains clean committed work awaiting an explicit governor accept or dismiss decision.", headCommit: evidence.headCommit, clean: true, workerRunStatus: run?.status };
}

function applyClassification(node: ExecutionNode, attempt: ExecutionAttempt, result: ReconciledAttempt, stage: ExecutionStage): void {
	const terminal = stage.status === "integrated" || stage.status === "abandoned";
	if (result.classification === "released") {
		attempt.leaseDisposition = "released";
		return;
	}
	if (terminal) {
		if (attempt.leaseDisposition === "release_pending") attempt.leaseDisposition = "preserved";
		return;
	}
	if (attempt.leaseDisposition === "release_pending") attempt.leaseDisposition = "preserved";
	if (attempt.headCommit === undefined && result.headCommit) attempt.headCommit = result.headCommit;
	if (attempt.clean === undefined && result.clean !== undefined) attempt.clean = result.clean;
	if (result.classification === "accepted") {
		node.status = "succeeded";
		attempt.status = "needs_review";
		return;
	}
	if (result.classification === "needs_review") {
		node.status = "needs_review";
		attempt.status = "needs_review";
		return;
	}
	if (result.classification === "retry_ready") {
		node.status = "retry_ready";
		attempt.status = "failed";
		attempt.leaseDisposition = "preserved";
		return;
	}
	if (result.classification === "detached") {
		node.status = "detached";
		attempt.status = "detached";
		attempt.leaseDisposition = "preserved";
		return;
	}
	node.status = "failed";
	attempt.status = "failed";
	attempt.leaseDisposition = "preserved";
	if (!(attempt.violations ?? []).includes(result.reason)) (attempt.violations ??= []).push(result.reason);
}

export async function reconcileStageResources(
	ctx: ExtensionContext,
	input: { loopName: string; graphId: string; stageId: string; expectedGraphRevision?: number; apply?: boolean },
	signal?: AbortSignal,
	adapter: RunReadyAdapter = new TreehouseAdapter(),
): Promise<StageResourceReconciliation> {
	const { state, graph, stage, nodes } = stageAndNodes(ctx, input.loopName, input.graphId, input.stageId);
	if (input.expectedGraphRevision !== undefined && graph.revision !== input.expectedGraphRevision) throw new Error(`Stale execution graph revision: expected ${input.expectedGraphRevision}, current ${graph.revision}.`);
	const results: ReconciledAttempt[] = [];
	for (const node of nodes) {
		for (const attempt of node.attempts.filter((candidate) => candidate.leaseDisposition !== "released")) {
			results.push(await classifyAttempt(ctx, adapter, node, attempt, state.workerRuns, signal));
		}
	}
	if (input.apply === true) {
		mutateState(ctx, input.loopName, (candidate) => {
			const currentGraph = candidate.executionGraph;
			const currentStage = currentGraph?.stages.find((value) => value.id === stage.id);
			if (!currentGraph || !currentStage) throw new Error("Execution stage changed during reconciliation.");
			for (const result of results) {
				const node = currentGraph.nodes.find((value) => value.id === result.nodeId);
				const attempt = node?.attempts.find((value) => value.id === result.attemptId);
				if (!node || !attempt) throw new Error(`Attempt "${result.attemptId}" changed during reconciliation.`);
				applyClassification(node, attempt, result, currentStage);
			}
			const prepared = currentStage.status === "integration_prepared" && currentStage.integration?.status === "prepared";
			const terminal = currentStage.status === "integrated" || currentStage.status === "abandoned";
			if (!prepared && !terminal) {
				if (results.some((result) => result.classification === "detached")) currentStage.status = "detached";
				else if (results.some((result) => result.classification === "failed")) currentStage.status = "failed";
				else if (currentStage.implementationNodeIds.every((nodeId) => currentGraph.nodes.find((node) => node.id === nodeId)?.status === "succeeded")) currentStage.status = "awaiting_integration";
				else currentStage.status = "running";
			}
		}, { expectedGraphRevision: graph.revision });
	}
	const currentRevision = loadState(ctx, input.loopName)?.executionGraph?.revision ?? graph.revision;
	return { ok: !results.some((result) => result.classification === "failed"), readOnly: input.apply !== true, graphId: graph.id, stageId: stage.id, stateRevision: currentRevision, attempts: results };
}

async function assertCleanAttempt(adapter: RunReadyAdapter, attempt: ExecutionAttempt, signal?: AbortSignal): Promise<TreehouseLease> {
	const lease = leaseFor(attempt);
	if (!lease) throw new Error(`Attempt "${attempt.id}" lacks exact lease identity and cannot be abandoned or released.`);
	const evidence = await adapter.inspectLaneCompletion(lease, signal);
	if (!evidence.clean) throw new Error(`Attempt "${attempt.id}" lease is dirty and was preserved.`);
	if (evidence.branchRef !== `refs/heads/${attempt.branchRef}`) throw new Error(`Attempt "${attempt.id}" branch mapping changed and was preserved.`);
	const expectedHead = attempt.headCommit ?? attempt.baseCommit;
	if (evidence.headCommit !== expectedHead) throw new Error(`Attempt "${attempt.id}" HEAD changed from ${expectedHead} to ${evidence.headCommit}; lease was preserved.`);
	return lease;
}

export async function abandonStage(
	ctx: ExtensionContext,
	input: { loopName: string; graphId: string; stageId: string; expectedGraphRevision: number; rationale: string; approvalRef: string },
	signal?: AbortSignal,
	adapter: RunReadyAdapter = new TreehouseAdapter(),
): Promise<{ ok: true; graphId: string; stageId: string; stateRevision: number; abandonedAttemptIds: string[] }> {
	const { state, graph, stage, nodes } = stageAndNodes(ctx, input.loopName, input.graphId, input.stageId);
	if (graph.revision !== input.expectedGraphRevision) throw new Error(`Stale execution graph revision: expected ${input.expectedGraphRevision}, current ${graph.revision}.`);
	if (!input.rationale.trim()) throw new Error("Abandon requires a nonblank rationale.");
	if (!input.approvalRef.trim()) throw new Error("Abandon requires a nonblank governor authorization reference in approvalRef.");
	if (stage.status === "integrated") throw new Error("Integrated stages cannot be abandoned.");
	if (stage.abandonment) {
		const rationale = input.rationale.trim();
		const approvalRef = input.approvalRef.trim();
		if (stage.abandonment.rationale !== rationale || stage.abandonment.approvalRef !== approvalRef || stage.status !== "abandoned") {
			throw new Error("Abandonment rationale, approvalRef, and abandonedAt are immutable after the first transition.");
		}
		const ids = nodes.flatMap((node) => node.attempts.filter((attempt) => attempt.leaseDisposition === "abandoned").map((attempt) => attempt.id));
		return { ok: true, graphId: graph.id, stageId: stage.id, stateRevision: graph.revision, abandonedAttemptIds: ids };
	}
	const openRuns = state.workerRuns.filter((run) => run.graphId === graph.id && run.stageId === stage.id && (run.status === "running" || run.status === "needs_review"));
	if (openRuns.some((run) => run.status === "running")) throw new Error("Running WorkerRuns must settle before explicit abandonment.");
	const attempts = nodes.flatMap((node) => node.attempts.filter((attempt) => attempt.leaseDisposition !== "released" && attemptTracksLease(attempt)));
	for (const attempt of attempts) await assertCleanAttempt(adapter, attempt, signal);
	const ids = attempts.map((attempt) => attempt.id);
	const saved = mutateState(ctx, input.loopName, (candidate) => {
		const currentGraph = candidate.executionGraph;
		const currentStage = currentGraph?.stages.find((value) => value.id === stage.id);
		if (!currentGraph || !currentStage) throw new Error("Execution stage changed during abandonment.");
		currentStage.abandonment = { rationale: input.rationale.trim(), approvalRef: input.approvalRef.trim(), abandonedAt: new Date().toISOString() };
		for (const nodeId of currentStage.implementationNodeIds) {
			const node = currentGraph.nodes.find((value) => value.id === nodeId);
			if (!node) continue;
			node.status = "abandoned";
			for (const attempt of node.attempts) {
				if (ids.includes(attempt.id) && attempt.leaseDisposition !== "released") attempt.leaseDisposition = "abandoned";
			}
		}
		const fanIn = currentGraph.nodes.find((node) => node.id === currentStage.fanInNodeId);
		if (fanIn) fanIn.status = "abandoned";
		currentStage.status = "abandoned";
	}, { expectedGraphRevision: input.expectedGraphRevision });
	return { ok: true, graphId: graph.id, stageId: stage.id, stateRevision: saved.executionGraph?.revision as number, abandonedAttemptIds: ids };
}

async function markAttemptReleased(
	ctx: ExtensionContext,
	loopName: string,
	attemptId: string,
	expectedGraphRevision: number | undefined,
): Promise<number> {
	const saved = mutateState(ctx, loopName, (candidate) => {
		const target = candidate.executionGraph?.nodes.flatMap((node) => node.attempts).find((value) => value.id === attemptId);
		if (!target || target.leaseDisposition === "released") throw new Error(`Attempt "${attemptId}" changed before durable release recovery.`);
		target.leaseDisposition = "released";
	}, { expectedGraphRevision });
	return saved.executionGraph?.revision as number;
}

function trackedAttemptIds(current: ReturnType<typeof stageAndNodes>): string[] {
	return current.nodes.flatMap((node) => node.attempts.filter((attempt) => attemptTracksLease(attempt) && attempt.leaseDisposition !== "released").map((attempt) => attempt.id));
}

export async function releaseStage(
	ctx: ExtensionContext,
	input: { loopName: string; graphId: string; stageId: string; expectedGraphRevision: number },
	signal?: AbortSignal,
	adapter: RunReadyAdapter = new TreehouseAdapter(),
): Promise<{ ok: boolean; graphId: string; stageId: string; stateRevision: number; releasedAttemptIds: string[]; preserved: Array<{ attemptId: string; reason: string }>; ownershipReleased: boolean }> {
	let current = stageAndNodes(ctx, input.loopName, input.graphId, input.stageId);
	if (current.graph.revision !== input.expectedGraphRevision) throw new Error(`Stale execution graph revision: expected ${input.expectedGraphRevision}, current ${current.graph.revision}.`);
	if (!["contracts_ready", "settled", "integrated", "failed", "abandoned"].includes(current.stage.status)) throw new Error(`Release requires an inactive decided stage; current status is "${current.stage.status}".`);
	assertNoActiveStageWork(current.state, current.graph.id, current.stage.id);
	assertStageReviewDecided(current.state, current.stage.id);
	const releasedAttemptIds: string[] = [];
	const preserved: Array<{ attemptId: string; reason: string }> = [];
	const attemptIds = trackedAttemptIds(current);
	for (const attemptId of attemptIds) {
		current = stageAndNodes(ctx, input.loopName, input.graphId, input.stageId);
		assertNoActiveStageWork(current.state, current.graph.id, current.stage.id);
		assertStageReviewDecided(current.state, current.stage.id);
		const attempt = current.nodes.flatMap((node) => node.attempts).find((value) => value.id === attemptId);
		if (!attempt || attempt.leaseDisposition === "released" || !attemptTracksLease(attempt)) continue;
		const recovered = await recoverReleasedLeaseIfAbsent(ctx, adapter, attempt, signal);
		if (recovered?.classification === "released") {
			await markAttemptReleased(ctx, input.loopName, attemptId, current.graph.revision);
			releasedAttemptIds.push(attemptId);
			continue;
		}
		if (recovered?.classification === "failed") {
			preserved.push({ attemptId, reason: recovered.reason });
			mutateState(ctx, input.loopName, (candidate) => {
				const target = candidate.executionGraph?.nodes.flatMap((node) => node.attempts).find((value) => value.id === attemptId);
				if (!target || target.leaseDisposition === "released") return;
				if (target.leaseDisposition === "release_pending" || !leaseFor(target)) target.leaseDisposition = "preserved";
			}, { expectedGraphRevision: current.graph.revision });
			continue;
		}
		const exactLease = leaseFor(attempt);
		if (!exactLease) {
			const inspection = await inspectReturnedLease(ctx, adapter, attempt, signal);
			preserved.push({ attemptId, reason: inspection.reason });
			if (attempt.leaseDisposition !== "preserved") {
				mutateState(ctx, input.loopName, (candidate) => {
					const target = candidate.executionGraph?.nodes.flatMap((node) => node.attempts).find((value) => value.id === attemptId);
					if (target && target.leaseDisposition !== "released") target.leaseDisposition = "preserved";
				}, { expectedGraphRevision: current.graph.revision });
			}
			continue;
		}
		let lease: TreehouseLease;
		try {
			lease = await assertCleanAttempt(adapter, attempt, signal);
		} catch (error) {
			let reason = String(error);
			if (error instanceof Error) reason = error.message;
			preserved.push({ attemptId, reason });
			if (attempt.leaseDisposition !== "preserved") {
				mutateState(ctx, input.loopName, (candidate) => {
					const target = candidate.executionGraph?.nodes.flatMap((node) => node.attempts).find((value) => value.id === attemptId);
					if (target && target.leaseDisposition !== "released") target.leaseDisposition = "preserved";
				}, { expectedGraphRevision: current.graph.revision });
			}
			continue;
		}
		const pending = mutateState(ctx, input.loopName, (candidate) => {
			assertNoActiveStageWork(candidate, input.graphId, input.stageId);
			assertStageReviewDecided(candidate, input.stageId);
			const target = candidate.executionGraph?.nodes.flatMap((node) => node.attempts).find((value) => value.id === attemptId);
			if (!target || target.leaseDisposition === "released") throw new Error(`Attempt "${attemptId}" changed before lease return.`);
			target.leaseDisposition = "release_pending";
		}, { expectedGraphRevision: current.graph.revision });
		try {
			await adapter.returnLease({ lease, expectedHeadCommit: attempt.headCommit ?? attempt.baseCommit, signal });
		} catch (error) {
			let reason = String(error);
			if (error instanceof Error) reason = error.message;
			preserved.push({ attemptId, reason });
			const latest = loadState(ctx, input.loopName)?.executionGraph;
			mutateState(ctx, input.loopName, (candidate) => {
				const target = candidate.executionGraph?.nodes.flatMap((node) => node.attempts).find((value) => value.id === attemptId);
				if (target?.leaseDisposition === "release_pending") target.leaseDisposition = "preserved";
			}, { expectedGraphRevision: latest?.revision });
			continue;
		}
		await markAttemptReleased(ctx, input.loopName, attemptId, pending.executionGraph?.revision);
		releasedAttemptIds.push(attemptId);
	}
	current = stageAndNodes(ctx, input.loopName, input.graphId, input.stageId);
	const allReleased = current.nodes.flatMap((node) => node.attempts).every((attempt) => releaseSatisfied(attempt));
	let ownershipReleased = false;
	let stateRevision = current.graph.revision;
	if (allReleased && current.graph.ownership?.stageId === current.stage.id) {
		const ownership = structuredClone(current.graph.ownership);
		const saved = mutateState(ctx, input.loopName, (candidate) => {
			const graph = candidate.executionGraph;
			const stage = graph?.stages.find((value) => value.id === input.stageId);
			if (!graph || !stage) throw new Error("Execution graph disappeared during terminal release.");
			stage.terminalOwnershipCleanup = structuredClone(ownership);
			delete graph.ownership;
			const allTerminal = graph.stages.every((item) => item.status === "settled" || item.status === "integrated" || item.status === "abandoned");
			if (allTerminal) {
				graph.status = "completed";
				if (graph.stages.some((item) => item.status === "abandoned")) graph.status = "abandoned";
			}
		}, { expectedGraphRevision: current.graph.revision, releaseOwnership: ownership });
		stateRevision = saved.executionGraph?.revision as number;
		ownershipReleased = true;
	}
	if (allReleased && !ownershipReleased && current.stage.terminalOwnershipCleanup) {
		const cleanup = current.stage.terminalOwnershipCleanup;
		if (cleanup.graphId !== current.graph.id || cleanup.stageId !== current.stage.id) {
			throw new Error("terminal ownership cleanup requires exact graph and stage identity evidence.");
		}
		clearTerminalOwnerEvidence(ctx, input.loopName, cleanup, current.graph.revision);
		removeOwnershipToken(ctx, input.loopName, cleanup.sessionId);
		ownershipReleased = true;
		// A governor can complete a settled plan before Treehouse proves every
		// lease was returned. When cleanup eventually succeeds without a graph
		// owner, converge the mechanical graph to its terminal state too.
		if (current.graph.stages.every((stage) => ["settled", "integrated", "abandoned"].includes(stage.status))) {
			const terminalStatus = current.graph.stages.some((stage) => stage.status === "abandoned") ? "abandoned" : "completed";
			if (current.graph.status !== terminalStatus) {
				const saved = mutateState(ctx, input.loopName, (candidate) => {
					candidate.executionGraph!.status = terminalStatus;
				}, { expectedGraphRevision: current.graph.revision });
				stateRevision = saved.executionGraph!.revision;
			}
		}
	}
	return { ok: preserved.length === 0, graphId: input.graphId, stageId: input.stageId, stateRevision, releasedAttemptIds, preserved, ownershipReleased };
}
