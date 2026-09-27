import { randomUUID } from "node:crypto";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { finalOutput, outputRefs, type EventBus, type SubagentResponse } from "../brief-worker-run-bridge.ts";
import { compactText, type ChangedFileReport, type LoopState } from "../state/core.ts";
import { loadState, mutateState } from "../state/store.ts";
import { buildStageBriefWorkerInvocation } from "../worker-role-registry.ts";
import { executeWorkerInvocation, prepareWorkerInvocation } from "../worker-invocation.ts";
import { acquireOrReuseStageOwnership } from "./ownership.ts";
import { validateLaneResult } from "./lane-result-validation.ts";
import { aggregateRunReadyResult, combineRunReadyAbort, runBounded } from "./run-ready-execution.ts";
import { registerActiveStageRun } from "./run-ready-registry.ts";
import { mutatePreparedLanes, precreateLane, recordSetupFailure, returnLeaseWithDeadline, settleSetupFailure, type PreparedLane } from "./run-ready-state.ts";
import {
	digestIterationBriefContract,
	type ExecutionAttempt,
	type ExecutionNode,
	type ExecutionValidationRecord,
} from "./contracts.ts";
import { readyExecutionNodeIds, validateExecutionGraph } from "./graph.ts";
import {
	partialLeaseFromError,
	TreehouseAdapter,
	type LaneCompletionEvidence,
	type LaneValidationEvidence,
	type LeaseReservationInspection,
	type PartialTreehouseLease,
	type TreehouseLease,
} from "./treehouse-adapter.ts";

const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CLEANUP_TIMEOUT_MS = 15_000;
const MAX_CLEANUP_TIMEOUT_MS = 60_000;

export interface RunReadyRequest {
	loopName: string;
	graphId: string;
	stageId: string;
	nodeIds?: string[];
	expectedGraphRevision: number;
	sessionId: string;
	timeoutMs?: number;
}

export interface StageWorkerResponse {
	response: SubagentResponse;
}

export interface RunReadyAdapter {
	leaseAndAnchor(input: Parameters<TreehouseAdapter["leaseAndAnchor"]>[0]): Promise<TreehouseLease>;
	returnLease(input: Parameters<TreehouseAdapter["returnLease"]>[0]): Promise<unknown>;
	inspectLaneCompletion(lease: TreehouseLease, signal?: AbortSignal): Promise<LaneCompletionEvidence>;
	inspectLeaseReservation(lease: PartialTreehouseLease, signal?: AbortSignal): Promise<LeaseReservationInspection>;
	runValidationCommands(worktreePath: string, commands: string[], signal?: AbortSignal): Promise<LaneValidationEvidence[]>;
}

export interface RunReadyDependencies {
	adapter: RunReadyAdapter;
	events?: EventBus;
	invokeWorker?: (input: {
		requestId: string;
		invocation: Record<string, unknown>;
		signal: AbortSignal;
		onUpdate?: (text: string, details?: Record<string, unknown>) => void;
		node: ExecutionNode;
		attempt: ExecutionAttempt;
		lease: TreehouseLease;
	}) => Promise<StageWorkerResponse>;
	idFactory?: () => string;
	now?: () => string;
	cleanupTimeoutMs?: number;
	updateUI?: (ctx: ExtensionContext) => void;
}

export interface RunReadyLaneResult {
	nodeId: string;
	attemptId?: string;
	workerRunId?: string;
	status: "needs_review" | "failed" | "detached" | "not_started";
	violations: string[];
	error?: string;
}

export interface RunReadyResult {
	ok: boolean;
	graphId: string;
	stageId: string;
	stateRevision: number;
	selectedNodeIds: string[];
	lanes: RunReadyLaneResult[];
	counts: Record<RunReadyLaneResult["status"], number>;
	setupFailed: boolean;
	cancelled: boolean;
	timedOut: boolean;
}

function defaultId(): string {
	return randomUUID().replaceAll("-", "").slice(0, 12);
}

function selectedNodes(state: LoopState, request: RunReadyRequest): ExecutionNode[] {
	const graph = state.executionGraph;
	if (!graph || graph.id !== request.graphId) throw new Error(`Execution graph "${request.graphId}" was not found.`);
	const stage = graph.stages.find((candidate) => candidate.id === request.stageId);
	if (!stage) throw new Error(`Execution stage "${request.stageId}" was not found.`);
	const ready = new Set(readyExecutionNodeIds(graph));
	let requested = stage.implementationNodeIds;
	if (request.nodeIds?.length) requested = request.nodeIds;
	if (new Set(requested).size !== requested.length) throw new Error("runReady nodeIds must be unique.");
	const stageIds = new Set(stage.implementationNodeIds);
	for (const id of requested) {
		if (!stageIds.has(id)) throw new Error(`Node "${id}" is not an implementation node in stage "${stage.id}".`);
		if (!ready.has(id)) throw new Error(`Node "${id}" is not ready at graph revision ${graph.revision}.`);
	}
	const byId = new Map(graph.nodes.map((node) => [node.id, node]));
	return requested.map((id) => {
		const node = byId.get(id);
		if (!node || node.kind !== "implementation" || !node.briefId) throw new Error(`Node "${id}" is not a runnable implementation node.`);
		const brief = state.briefs.find((candidate) => candidate.id === node.briefId);
		if (!brief) throw new Error(`Node "${id}" references missing brief "${node.briefId}".`);
		const digest = digestIterationBriefContract(brief);
		if (digest !== node.briefDigest) throw new Error(`Node "${id}" brief contract drifted: expected ${node.briefDigest}, current ${digest}.`);
		return node;
	});
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function canonicalLeasePath(lease: PartialTreehouseLease): string | undefined {
	if (!lease.worktreePath) return undefined;
	if (path.isAbsolute(lease.worktreePath)) return path.resolve(lease.worktreePath);
	return path.normalize(lease.worktreePath);
}

function leaseIdentityConflicts(left: PartialTreehouseLease, right: PartialTreehouseLease): boolean {
	const leftPath = canonicalLeasePath(left);
	const rightPath = canonicalLeasePath(right);
	if (leftPath && rightPath && leftPath === rightPath) return true;
	if (left.leaseHolder && right.leaseHolder && left.leaseHolder === right.leaseHolder) return true;
	if (left.branchRef && right.branchRef && left.branchRef === right.branchRef) return true;
	return false;
}

function changedFileReports(paths: string[]): ChangedFileReport[] {
	return paths.map((filePath) => ({
		path: filePath,
		summary: "Committed change recorded from the isolated stage lane.",
		reviewReason: "Governor must accept or dismiss this lane by explicit WorkerRun id before fan-in.",
	}));
}

async function defaultInvoke(events: EventBus | undefined, input: Parameters<NonNullable<RunReadyDependencies["invokeWorker"]>>[0]): Promise<StageWorkerResponse> {
	const response = await executeWorkerInvocation({ events, requestId: input.requestId, params: input.invocation, signal: input.signal, onUpdate: input.onUpdate });
	return { response };
}

async function runLane(
	ctx: ExtensionContext,
	request: RunReadyRequest,
	lane: PreparedLane,
	deps: RunReadyDependencies,
	signal: AbortSignal,
	onUpdate?: (text: string, details?: Record<string, unknown>) => void,
): Promise<RunReadyLaneResult> {
	const state = loadState(ctx, request.loopName);
	const graph = state?.executionGraph;
	const stage = graph?.stages.find((candidate) => candidate.id === request.stageId);
	const node = graph?.nodes.find((candidate) => candidate.id === lane.nodeId);
	const attempt = node?.attempts.find((candidate) => candidate.id === lane.attemptId);
	if (!state || !graph || !stage || !node || !node.briefId || !attempt) throw new Error(`Prepared lane "${lane.nodeId}" disappeared.`);
	const built = buildStageBriefWorkerInvocation(state, lane.lease.worktreePath, {
		role: "implementer",
		briefId: node.briefId,
		contract: {
			graphId: graph.id,
			stageId: stage.id,
			nodeId: node.id,
			attemptId: lane.attemptId,
			contractCommit: stage.contractCommit,
			branchRef: lane.lease.branchRef,
			writes: attempt.writes ?? [],
			reads: node.reads,
			resourceClaims: attempt.resourceClaims ?? [],
			validationCommands: attempt.validationCommands ?? [],
		},
	});
	let worker: StageWorkerResponse | undefined;
	let workerError: string | undefined;
	if (!built.ok) {
		workerError = built.error;
	} else {
		const preparedInvocation = prepareWorkerInvocation(built.invocation, { requestId: lane.requestId, output: lane.outputPath, outputMode: "file-only" });
		try {
			signal.throwIfAborted();
			const invoke = deps.invokeWorker ?? ((input) => defaultInvoke(deps.events, input));
			worker = await invoke({ requestId: lane.requestId, invocation: preparedInvocation.params, signal, onUpdate, node, attempt, lease: lane.lease });
			if (worker.response.isError) workerError = worker.response.errorText ?? "Stage worker returned an error.";
		} catch (error) {
			workerError = errorMessage(error);
		}
	}
	let completion: LaneCompletionEvidence | undefined;
	let inspectionError: string | undefined;
	try {
		completion = await deps.adapter.inspectLaneCompletion(lane.lease, signal);
	} catch (error) {
		inspectionError = errorMessage(error);
	}
	let validationEvidence: LaneValidationEvidence[] = [];
	if (completion) {
		try {
			validationEvidence = await deps.adapter.runValidationCommands(lane.lease.worktreePath, attempt.validationCommands ?? [], signal);
		} catch (error) {
			const message = errorMessage(error);
			validationEvidence = node.validationCommands.map((command) => ({ command, result: "failed", summary: `Validation execution failed: ${message}` }));
		}
	}
	const validation: ExecutionValidationRecord[] = validationEvidence.map((record) => ({ command: record.command, result: record.result, summary: record.summary }));
	let violations = [inspectionError ?? "Lane completion evidence was unavailable."];
	if (completion) violations = validateLaneResult(ctx, node, attempt, stage.contractCommit, stage.contractDigest, lane.lease, completion, validation);
	if (workerError) violations.push(`Worker transport warning: ${workerError}`);
	if (signal.aborted) violations.push(`Execution phase ended after evidence collection: ${errorMessage(signal.reason ?? new Error("cancelled"))}`);
	// Every settled node is returned to the governor. Transport, validation, and
	// mutation-telemetry concerns are evidence, not semantic vetoes.
	const status: RunReadyLaneResult["status"] = "needs_review";
	const now = (deps.now ?? (() => new Date().toISOString()))();
	mutatePreparedLanes(ctx, request, [lane], (currentNode, attempt, run, report) => {
		attempt.status = status;
		attempt.completedAt = now;
		for (const commit of completion?.laneCommits ?? []) attempt.laneCommits.push(commit);
		for (const changedPath of completion?.changedPaths ?? []) (attempt.changedPaths ??= []).push(changedPath);
		for (const violation of violations) (attempt.violations ??= []).push(violation);
		for (const record of validation) attempt.validation.push(record);
		if (completion) {
			attempt.headCommit = completion.headCommit;
			attempt.clean = completion.clean;
			run.headCommit = completion.headCommit;
			run.changedFiles = changedFileReports(completion.changedPaths);
		}
		const bridgeRunId = worker?.response.result.details?.runId;
		if (bridgeRunId) attempt.bridgeRunId = bridgeRunId;
		currentNode.status = status;
		run.status = "needs_review";
		let workerSummary = workerError;
		if (worker) workerSummary = finalOutput(worker.response);
		let fallbackSummary = "Lane failed.";
		if (status === "needs_review") fallbackSummary = "Lane completed and needs review.";
		run.summary = compactText(workerSummary, 500) ?? fallbackSummary;
		run.outputRefs = [];
		if (worker) run.outputRefs = outputRefs(worker.response);
		run.completedAt = now;
		run.updatedAt = now;
		report.status = "needs_review";
		report.summary = workerError ?? "Node settled without worker narrative output; inspect durable evidence and decide.";
		if (worker) report.summary = finalOutput(worker.response);
		report.changedFiles = run.changedFiles;
		report.validation = validation.map((record) => ({ command: record.command, result: record.result, summary: record.summary }));
		report.risks = violations;
		report.reviewHints = ["Review this isolated lane using its explicit WorkerRun id before fan-in."];
		report.updatedAt = now;
	});
	deps.updateUI?.(ctx);
	return { nodeId: lane.nodeId, attemptId: lane.attemptId, workerRunId: lane.workerRunId, status, violations, error: workerError ?? inspectionError };
}

function settleCancelledLane(ctx: ExtensionContext, request: RunReadyRequest, lane: PreparedLane, message: string, now: string): RunReadyLaneResult {
	mutatePreparedLanes(ctx, request, [lane], (node, attempt, run, report) => {
		attempt.status = "needs_review";
		(attempt.violations ??= []).push(`Cancellation warning: ${message}`);
		attempt.completedAt = now;
		node.status = "needs_review";
		run.status = "needs_review";
		run.summary = message;
		run.completedAt = now;
		run.updatedAt = now;
		report.status = "needs_review";
		report.summary = message;
		report.risks = [message];
		report.updatedAt = now;
	});
	return { nodeId: lane.nodeId, attemptId: lane.attemptId, workerRunId: lane.workerRunId, status: "needs_review", violations: [message], error: message };
}

function settleUnexpectedLaneFailure(ctx: ExtensionContext, request: RunReadyRequest, lane: PreparedLane, message: string, now: string): RunReadyLaneResult {
	mutatePreparedLanes(ctx, request, [lane], (node, attempt, run, report) => {
		attempt.status = "needs_review";
		(attempt.violations ??= []).push(`Execution warning: ${message}`);
		attempt.completedAt = now;
		node.status = "needs_review";
		run.status = "needs_review";
		run.summary = message;
		run.completedAt = now;
		run.updatedAt = now;
		report.status = "needs_review";
		report.summary = message;
		report.risks = [message];
		report.updatedAt = now;
	});
	return { nodeId: lane.nodeId, attemptId: lane.attemptId, workerRunId: lane.workerRunId, status: "needs_review", violations: [message], error: message };
}

export async function runReadyStage(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	request: RunReadyRequest,
	signal: AbortSignal | undefined,
	onUpdate: ((text: string, details?: Record<string, unknown>) => void) | undefined,
	dependencies: Partial<RunReadyDependencies> = {},
): Promise<RunReadyResult> {
	const adapter = dependencies.adapter ?? new TreehouseAdapter();
	const deps: RunReadyDependencies = { ...dependencies, adapter, events: dependencies.events ?? (pi as unknown as { events?: EventBus }).events };
	const initial = loadState(ctx, request.loopName);
	if (!initial?.executionGraph) throw new Error(`Loop "${request.loopName}" has no execution graph.`);
	const validation = validateExecutionGraph(initial.executionGraph, ctx.cwd);
	if (!validation.ok) throw new Error(`Execution graph validation failed: ${validation.errors.join(" ")}`);
	if (initial.workerRuns.some((run) => run.role === "implementer" && run.isolation !== "treehouse" && (run.status === "running" || run.status === "needs_review"))) {
		throw new Error("runReady cannot start while a current-workspace implementer WorkerRun is open.");
	}
	const nodes = selectedNodes(initial, request);
	const acquisition = acquireOrReuseStageOwnership(ctx, request);
	const timeoutMs = Math.min(Math.max(1, request.timeoutMs ?? DEFAULT_TIMEOUT_MS), MAX_TIMEOUT_MS);
	const abort = combineRunReadyAbort(signal, timeoutMs);
	let resolveSettled: () => void = () => undefined;
	const settledPromise = new Promise<void>((resolve) => { resolveSettled = resolve; });
	let unregister: (() => void) | undefined;
	try {
		unregister = registerActiveStageRun(ctx, {
			loopName: request.loopName,
			sessionId: request.sessionId,
			controller: abort.controller,
			settled: settledPromise,
		});
		const ownedState = loadState(ctx, request.loopName);
		const stage = ownedState?.executionGraph?.stages.find((candidate) => candidate.id === request.stageId);
		if (!ownedState || !stage) throw new Error("Stage disappeared after durable ownership acquisition.");
		const idFactory = deps.idFactory ?? defaultId;
		const nowFactory = deps.now ?? (() => new Date().toISOString());
		const cleanupTimeoutMs = Math.min(Math.max(1, deps.cleanupTimeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS), MAX_CLEANUP_TIMEOUT_MS);
		const prepared: PreparedLane[] = [];
		const preserveNodeIds = new Set<string>();
		let setupError: string | undefined;
		let setupFailedNodeId: string | undefined;
		let setupFailedAttemptId: string | undefined;
		let setupFailedNodeStatus: "failed" | "detached" = "failed";
		for (const node of nodes) {
			const attemptId = `attempt-${idFactory()}`;
			const leaseHolder = `stardock:${request.loopName}:${request.stageId}:${node.id}:${attemptId}`;
			let acquiredLease: TreehouseLease | undefined;
			try {
				abort.controller.signal.throwIfAborted();
				const lease = await adapter.leaseAndAnchor({
					parentRepositoryPath: ctx.cwd,
					parentBranch: stage.parentBranch,
					parentHeadCommit: stage.integrationBaseCommit,
					integrationBaseCommit: stage.integrationBaseCommit,
					contractCommit: stage.contractCommit,
					loopId: request.loopName,
					stageId: request.stageId,
					nodeId: node.id,
					attemptId,
					leaseHolder,
					signal: abort.controller.signal,
				});
				acquiredLease = lease;
				abort.controller.signal.throwIfAborted();
				const conflicting = prepared.filter((candidate) => leaseIdentityConflicts(candidate.lease, lease));
				if (conflicting.length > 0) {
					for (const candidate of conflicting) preserveNodeIds.add(candidate.nodeId);
					preserveNodeIds.add(node.id);
					throw new Error(`Treehouse returned an ambiguous duplicate lease identity for node "${node.id}" at "${canonicalLeasePath(lease)}". All affected leases were preserved.`);
				}
				const requestId = `stardock-stage-${idFactory()}`;
				const outputPath = path.join(ctx.cwd, ".stardock", "runs", request.loopName, "workers", `${requestId}.md`);
				prepared.push(precreateLane(ctx, request, node, lease, attemptId, requestId, outputPath, nowFactory()));
			} catch (error) {
				setupError = String(error);
				if (error instanceof Error) setupError = error.message;
				setupFailedNodeId = node.id;
				setupFailedAttemptId = attemptId;
				const leaseEvidence = acquiredLease ?? partialLeaseFromError(error);
				const duplicateEvidence = leaseEvidence && prepared.some((candidate) => leaseIdentityConflicts(candidate.lease, leaseEvidence));
				if (duplicateEvidence) {
					setupFailedNodeStatus = "detached";
					preserveNodeIds.add(node.id);
					for (const candidate of prepared) {
						if (leaseIdentityConflicts(candidate.lease, leaseEvidence)) preserveNodeIds.add(candidate.nodeId);
					}
				} else if (abort.controller.signal.aborted || (leaseEvidence && !acquiredLease)) {
					setupFailedNodeStatus = "detached";
				} else if (acquiredLease) {
					const cleanup = await returnLeaseWithDeadline(adapter, acquiredLease, cleanupTimeoutMs);
					if (!cleanup.returned) {
						setupFailedNodeStatus = "detached";
						if (cleanup.error) setupError = `${setupError} ${cleanup.error}`;
					}
				}
				recordSetupFailure(
					ctx,
					request,
					node.id,
					attemptId,
					leaseHolder,
					leaseEvidence,
					setupFailedNodeStatus,
					setupError,
					nowFactory(),
				);
				break;
			}
		}
		if (setupError) {
			await settleSetupFailure(ctx, request, prepared, adapter, setupError, nowFactory(), cleanupTimeoutMs, preserveNodeIds);
			const stateRevision = loadState(ctx, request.loopName)?.executionGraph?.revision ?? acquisition.stateRevision;
			const settledState = loadState(ctx, request.loopName);
			const lanes = nodes.map((node): RunReadyLaneResult => {
				const lane = prepared.find((candidate) => candidate.nodeId === node.id);
				if (!lane) {
					if (node.id === setupFailedNodeId) return { nodeId: node.id, attemptId: setupFailedAttemptId, status: setupFailedNodeStatus, violations: [setupError], error: setupError };
					return { nodeId: node.id, status: "not_started", violations: [setupError], error: setupError };
				}
				const persistedStatus = settledState?.executionGraph?.nodes.find((candidate) => candidate.id === node.id)?.status;
				let status: RunReadyLaneResult["status"] = "failed";
				if (persistedStatus === "detached") status = "detached";
				return { nodeId: node.id, attemptId: lane.attemptId, workerRunId: lane.workerRunId, status, violations: [setupError], error: setupError };
			});
			return aggregateRunReadyResult(request, stateRevision, lanes, true, abort.controller.signal.aborted, abort.timedOut());
		}
		mutatePreparedLanes(ctx, request, prepared, (node, attempt) => {
			node.status = "running";
			attempt.status = "running";
		});
		let settled = 0;
		const reportSettled = (lane: PreparedLane, result: RunReadyLaneResult): RunReadyLaneResult => {
			settled += 1;
			onUpdate?.(`Stage ${request.stageId}: ${settled}/${prepared.length} lanes settled.`, {
				graphId: request.graphId,
				stageId: request.stageId,
				settled,
				total: prepared.length,
				nodeId: lane.nodeId,
				status: result.status,
			});
			return result;
		};
		const lanes = await runBounded(
			prepared,
			stage.maxConcurrency,
			abort.controller.signal,
			async (lane) => {
				let result: RunReadyLaneResult;
				try {
					result = await runLane(ctx, request, lane, deps, abort.controller.signal, (text, details) => {
						onUpdate?.(`[${lane.nodeId}] ${text}`, { graphId: request.graphId, stageId: request.stageId, nodeId: lane.nodeId, attemptId: lane.attemptId, ...details });
					});
				} catch (error) {
					const message = errorMessage(error);
					if (abort.controller.signal.aborted) result = settleCancelledLane(ctx, request, lane, message, nowFactory());
					else result = settleUnexpectedLaneFailure(ctx, request, lane, message, nowFactory());
				}
				return reportSettled(lane, result);
			},
			(lane) => reportSettled(lane, settleCancelledLane(ctx, request, lane, "runReady was cancelled before this queued worker was dispatched.", nowFactory())),
		);
		mutateState(ctx, request.loopName, (state) => {
			const graph = state.executionGraph;
			const currentStage = graph?.stages.find((candidate) => candidate.id === request.stageId);
			if (!graph || !currentStage) return;
			if (lanes.some((lane) => lane.status === "detached")) currentStage.status = "detached";
			else if (lanes.some((lane) => lane.status === "failed")) currentStage.status = "failed";
			else currentStage.status = "running";
			if (lanes.some((lane) => lane.status === "failed" || lane.status === "detached")) graph.status = "blocked";
		});
		const stateRevision = loadState(ctx, request.loopName)?.executionGraph?.revision ?? acquisition.stateRevision;
		return aggregateRunReadyResult(request, stateRevision, lanes, false, abort.controller.signal.aborted, abort.timedOut());
	} finally {
		abort.dispose();
		resolveSettled();
		unregister?.();
	}
}
