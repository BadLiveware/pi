import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { StardockRuntime } from "../runtime/types.ts";
import { loadState, mutateState } from "../state/store.ts";
import {
	digestIterationBriefContract,
	readPersistedExecutionGraph,
	type ExecutionAttempt,
	type ExecutionGraph,
	type ExecutionNode,
	type ExecutionStage,
} from "./contracts.ts";
import { initializeExecutionGraph, summarizeExecutionGraph, validateExecutionGraph } from "./graph.ts";
import { acquireStageOwnership, heartbeatStageOwnership, inspectStageOwnership, reconcileStageOwnership } from "./ownership.ts";
import { OwnershipProtocolError } from "./ownership-records.ts";
import { runReadyStage, type RunReadyDependencies, type RunReadyRequest } from "./run-ready.ts";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_NESTED_ITEMS = 20;
const MUTATING_FUTURE_ACTIONS = new Set(["integrationPlan", "prepareIntegration", "recordIntegrated", "retry", "abandon", "release"]);

export interface StageToolParams {
	action: "upsert" | "list" | "runReady" | "acquire" | "heartbeat" | "reconcile" | "integrationPlan" | "prepareIntegration" | "recordIntegrated" | "retry" | "abandon" | "release";
	loopName?: string;
	graphId?: string;
	stageId?: string;
	nodeIds?: string[];
	expectedGraphRevision?: number;
	graph?: unknown;
	takeOwnership?: boolean;
	rationale?: string;
	approvalRef?: string;
	classification?: string;
	limit?: number;
	offset?: number;
	timeoutMs?: number;
}

function textResult(text: string, details: Record<string, unknown>, isError = false) {
	const result: { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown>; isError?: boolean } = {
		content: [{ type: "text", text }],
		details,
	};
	if (isError) result.isError = true;
	return result;
}

function protocolFailure(error: unknown) {
	if (error instanceof OwnershipProtocolError) return textResult(error.message, { ok: false, code: error.code, blocked: true }, true);
	let message = String(error);
	if (error instanceof Error) message = error.message;
	return textResult(message, { ok: false, code: "stage_error" }, true);
}

function boundedPage<T>(items: T[], params: StageToolParams): { items: T[]; page: { offset: number; limit: number; total: number; nextOffset?: number } } {
	let offset = 0;
	if (Number.isInteger(params.offset) && (params.offset as number) >= 0) offset = params.offset as number;
	let requested = DEFAULT_LIMIT;
	if (Number.isInteger(params.limit)) requested = params.limit as number;
	const limit = Math.min(MAX_LIMIT, Math.max(1, requested));
	const pageItems = items.slice(offset, offset + limit);
	const page: { offset: number; limit: number; total: number; nextOffset?: number } = { offset, limit, total: items.length };
	if (offset + pageItems.length < items.length) page.nextOffset = offset + pageItems.length;
	return { items: pageItems, page };
}

function assertBriefDigests(graph: ExecutionGraph, state: NonNullable<ReturnType<typeof loadState>>): void {
	for (const node of graph.nodes) {
		if (node.kind !== "implementation" || !node.briefId) continue;
		const brief = state.briefs.find((candidate) => candidate.id === node.briefId);
		if (!brief) throw new Error(`Implementation node "${node.id}" references missing brief "${node.briefId}".`);
		const digest = digestIterationBriefContract(brief);
		if (node.briefDigest !== digest) throw new Error(`Implementation node "${node.id}" briefDigest mismatch: expected ${digest}, received ${String(node.briefDigest)}.`);
	}
}

export interface UpsertExecutionGraphHooks {
	beforeCreateMutation?: () => void;
}

export function upsertExecutionGraph(
	ctx: ExtensionContext,
	loopName: string,
	rawGraph: unknown,
	expectedGraphRevision?: number,
	hooks: UpsertExecutionGraphHooks = {},
): ExecutionGraph {
	const parsed = readPersistedExecutionGraph(rawGraph);
	if (!parsed) throw new Error("upsert requires a structurally valid execution graph.");
	const state = loadState(ctx, loopName);
	if (!state) throw new Error(`Loop "${loopName}" not found.`);
	assertBriefDigests(parsed, state);
	const validation = validateExecutionGraph(parsed, ctx.cwd);
	if (!validation.ok) throw new Error(`Execution graph validation failed: ${validation.errors.join(" ")}`);
	const existing = state.executionGraph;
	const emptyPlaceholder = existing && existing.revision === 0 && existing.nodes.length === 0 && existing.stages.length === 0 && !existing.ownership;
	if (!existing || emptyPlaceholder) {
		if (expectedGraphRevision !== undefined) throw new Error("Graph creation must omit expectedGraphRevision.");
		if (existing && parsed.id !== existing.id) throw new Error(`Initial execution graph id must remain "${existing.id}".`);
		const initialized = initializeExecutionGraph(parsed);
		initialized.revision = existing?.revision ?? 1;
		initialized.createdAt = existing?.createdAt ?? parsed.createdAt ?? new Date().toISOString();
		initialized.updatedAt = existing?.updatedAt ?? new Date().toISOString();
		hooks.beforeCreateMutation?.();
		const saved = mutateState(ctx, loopName, (candidate) => {
			const current = candidate.executionGraph;
			const currentIsPlaceholder = current && current.revision === 0 && current.nodes.length === 0 && current.stages.length === 0 && !current.ownership;
			if (current && !currentIsPlaceholder) throw new Error("Execution graph was created concurrently; reload and retry with its revision.");
			if (current && current.id !== initialized.id) throw new Error(`Initial execution graph id must remain "${current.id}".`);
			candidate.executionGraph = initialized;
		}, { expectedGraphRevision: existing?.revision });
		return saved.executionGraph as ExecutionGraph;
	}
	if (expectedGraphRevision === undefined) throw new Error("Graph update requires expectedGraphRevision.");
	if (expectedGraphRevision !== existing.revision) {
		throw new OwnershipProtocolError("stale_revision", `Stale execution graph revision: expected ${expectedGraphRevision}, current ${existing.revision}. Reload state and retry.`);
	}
	if (parsed.id !== existing.id) throw new Error(`Execution graph identity cannot change from "${existing.id}" to "${parsed.id}".`);
	if (existing.ownership) throw new Error("Execution graph cannot be upserted while durable stage ownership exists.");
	if (existing.nodes.some((node) => node.attempts.length > 0)) throw new Error("Execution graph contract cannot be replaced after immutable attempts exist; create a new graph generation.");
	const initialized = initializeExecutionGraph(parsed);
	initialized.revision = existing.revision;
	initialized.createdAt = existing.createdAt;
	initialized.updatedAt = existing.updatedAt;
	const saved = mutateState(ctx, loopName, (candidate) => {
		candidate.executionGraph = initialized;
	}, { expectedGraphRevision });
	return saved.executionGraph as ExecutionGraph;
}

function nestedPage<T>(items: T[]): { items: T[]; total: number; truncated: number } {
	const bounded = items.slice(0, MAX_NESTED_ITEMS);
	return { items: bounded, total: items.length, truncated: Math.max(0, items.length - bounded.length) };
}

function projectAttempt(nodeId: string, attempt: ExecutionAttempt): Record<string, unknown> {
	const commits = nestedPage(attempt.laneCommits);
	const changedPaths = nestedPage(attempt.changedPaths ?? []);
	const validation = nestedPage(attempt.validation);
	const violations = nestedPage(attempt.violations ?? []);
	return {
		nodeId,
		id: attempt.id,
		workerRunId: attempt.workerRunId,
		workerReportId: attempt.workerReportId,
		bridgeRunId: attempt.bridgeRunId,
		baseCommit: attempt.baseCommit,
		branchRef: attempt.branchRef,
		headCommit: attempt.headCommit,
		leaseHolder: attempt.leaseHolder,
		clean: attempt.clean,
		status: attempt.status,
		startedAt: attempt.startedAt,
		completedAt: attempt.completedAt,
		laneCommits: commits.items,
		changedPaths: changedPaths.items,
		validation: validation.items,
		violations: violations.items,
		counts: {
			laneCommits: commits.total,
			changedPaths: changedPaths.total,
			validation: validation.total,
			violations: violations.total,
		},
		truncated: {
			laneCommits: commits.truncated,
			changedPaths: changedPaths.truncated,
			validation: validation.truncated,
			violations: violations.truncated,
		},
	};
}

function projectNode(node: ExecutionNode): Record<string, unknown> {
	return {
		id: node.id,
		kind: node.kind,
		objective: node.objective,
		status: node.status,
		briefId: node.briefId,
		dependsOn: nestedPage(node.dependsOn),
		writes: nestedPage(node.writes),
		reads: nestedPage(node.reads),
		resourceClaims: nestedPage(node.resourceClaims),
		validationCommands: nestedPage(node.validationCommands),
		attemptCount: node.attempts.length,
		latestAttemptId: node.attempts.at(-1)?.id,
	};
}

function projectStage(stage: ExecutionStage): Record<string, unknown> {
	return {
		id: stage.id,
		status: stage.status,
		contractNodeId: stage.contractNodeId,
		fanInNodeId: stage.fanInNodeId,
		implementationNodeIds: nestedPage(stage.implementationNodeIds),
		integrationOrder: nestedPage(stage.integrationOrder),
		parentBranch: stage.parentBranch,
		integrationBaseCommit: stage.integrationBaseCommit,
		contractCommit: stage.contractCommit,
		contractDigest: stage.contractDigest,
		integrationBranch: stage.integrationBranch,
		maxConcurrency: stage.maxConcurrency,
		integrationStatus: stage.integration?.status,
	};
}

function listGraph(ctx: ExtensionContext, loopName: string, params: StageToolParams) {
	const state = loadState(ctx, loopName);
	if (!state) return textResult(`Loop "${loopName}" not found.`, { ok: false }, true);
	const graph = state.executionGraph;
	const inspection = inspectStageOwnership(ctx, loopName);
	if (!graph) return textResult(`Loop "${loopName}" has no execution graph.`, { ok: true, loopName, graph: null, inspection });
	if (params.graphId && params.graphId !== graph.id) return textResult(`Execution graph "${params.graphId}" not found.`, { ok: false, currentGraphId: graph.id }, true);
	let stages = graph.stages;
	if (params.stageId) stages = graph.stages.filter((stage) => stage.id === params.stageId);
	if (params.stageId && stages.length === 0) return textResult(`Execution stage "${params.stageId}" not found.`, { ok: false, graphId: graph.id }, true);
	const stageNodeIds = new Set(stages.flatMap((stage) => [stage.contractNodeId, ...stage.implementationNodeIds, stage.fanInNodeId]));
	let nodes = graph.nodes;
	if (params.stageId) nodes = graph.nodes.filter((node) => stageNodeIds.has(node.id));
	const nodePage = boundedPage(nodes, params);
	const stagePage = boundedPage(stages, params);
	const attemptPage = boundedPage(nodes.flatMap((node) => node.attempts.map((attempt) => ({ nodeId: node.id, attempt }))), params);
	const summary = summarizeExecutionGraph(graph, Math.min(params.limit ?? DEFAULT_LIMIT, MAX_LIMIT), Math.min(params.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
	return textResult(`Execution graph "${graph.id}" revision ${graph.revision}: ${summary.nodeCount} nodes, ${summary.stageCount} stages.`, {
		ok: true,
		loopName,
		graphId: graph.id,
		revision: graph.revision,
		status: graph.status,
		summary,
		stages: stagePage.items.map(projectStage),
		nodes: nodePage.items.map(projectNode),
		attempts: attemptPage.items.map(({ nodeId, attempt }) => projectAttempt(nodeId, attempt)),
		page: { nodes: nodePage.page, stages: stagePage.page, attempts: attemptPage.page },
		ownership: graph.ownership,
		inspection,
	});
}

export async function executeStageTool(
	pi: ExtensionAPI,
	runtime: StardockRuntime,
	params: StageToolParams,
	signal: AbortSignal | undefined,
	onUpdate: ((update: { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> }) => void) | undefined,
	ctx: ExtensionContext,
	runReadyDependencies?: Partial<RunReadyDependencies>,
) {
	const loopName = params.loopName ?? runtime.ref.currentLoop;
	if (!loopName) return textResult("No Stardock loop selected.", { ok: false }, true);
	try {
		if (params.action === "list") return listGraph(ctx, loopName, params);
		if (params.action === "upsert") {
			const graph = upsertExecutionGraph(ctx, loopName, params.graph, params.expectedGraphRevision);
			runtime.updateUI(ctx);
			return textResult(`Upserted execution graph "${graph.id}" at revision ${graph.revision}.`, { ok: true, graphId: graph.id, revision: graph.revision, summary: summarizeExecutionGraph(graph) });
		}
		if (params.action === "heartbeat") {
			const owner = heartbeatStageOwnership(ctx, loopName);
			return textResult(`Heartbeat refreshed for graph "${owner.graphId}" stage "${owner.stageId}".`, { ok: true, owner });
		}
		if (params.action === "reconcile") {
			const result = reconcileStageOwnership(ctx, {
				loopName,
				takeOwnership: params.takeOwnership,
				rationale: params.rationale,
				approvalRef: params.approvalRef,
				classification: params.classification,
				graphId: params.graphId,
				stageId: params.stageId,
				sessionId: runtime.ref.sessionId,
			});
			return textResult(`Ownership reconciliation inspected durable evidence for "${loopName}".`, { ok: true, result });
		}
		if (params.action === "acquire") {
			if (!params.graphId || !params.stageId || params.expectedGraphRevision === undefined) return textResult("Acquire requires graphId, stageId, and expectedGraphRevision.", { ok: false }, true);
			const acquisition = acquireStageOwnership(ctx, { loopName, graphId: params.graphId, stageId: params.stageId, expectedGraphRevision: params.expectedGraphRevision, sessionId: runtime.ref.sessionId });
			return textResult(`Acquired graph "${acquisition.graphId}" stage "${acquisition.stageId}" at revision ${acquisition.stateRevision}.`, { ok: true, acquisition });
		}
		if (params.action === "runReady") {
			if (!params.graphId || !params.stageId || params.expectedGraphRevision === undefined) return textResult("runReady requires exact graphId, stageId, and expectedGraphRevision.", { ok: false }, true);
			const request: RunReadyRequest = { loopName, graphId: params.graphId, stageId: params.stageId, nodeIds: params.nodeIds, expectedGraphRevision: params.expectedGraphRevision, sessionId: runtime.ref.sessionId, timeoutMs: params.timeoutMs };
			const result = await runReadyStage(pi, ctx, request, signal, (text, details) => onUpdate?.({ content: [{ type: "text", text }], details: details ?? {} }), { ...runReadyDependencies, updateUI: runtime.updateUI });
			runtime.updateUI(ctx);
			return textResult(`runReady settled ${result.lanes.length} lanes for stage "${result.stageId}": ${result.counts.needs_review} need review, ${result.counts.failed} failed, ${result.counts.detached} detached.`, { ...result }, !result.ok);
		}
		if (MUTATING_FUTURE_ACTIONS.has(params.action)) return textResult(`stardock_stage ${params.action} is not implemented by the current execution contract. No integration, parent-ref mutation, retry, abandonment, or release action ran.`, { ok: false, code: "not_implemented", action: params.action }, true);
		return textResult(`Unsupported stardock_stage action "${String(params.action)}".`, { ok: false }, true);
	} catch (error) {
		return protocolFailure(error);
	}
}

export function registerStageTool(pi: ExtensionAPI, runtime: StardockRuntime): void {
	pi.registerTool({
		name: "stardock_stage",
		label: "Stardock Execution Stage",
		description: "Validate/CAS-upsert bounded execution graphs, inspect graph/ownership state, and run ready implementation nodes concurrently only in distinct owned Treehouse leases. Integration actions remain explicitly disabled.",
		promptSnippet: "Upsert or inspect a validated execution graph, then run ready isolated lanes with exact graph/stage/revision inputs.",
		promptGuidelines: [
			"Use upsert with a canonical graph and brief digests; creation omits expectedGraphRevision and every update must compare-and-swap the current revision.",
			"Use runReady only for validated ready implementation nodes. It owns all lifecycle state while children work only inside distinct Treehouse leases.",
			"Review every stage WorkerRun with an explicit runId. Integration, retry, abandonment, and release actions return not_implemented without mutating durable state.",
		],
		parameters: Type.Object({
			action: StringEnum(["upsert", "list", "runReady", "acquire", "heartbeat", "reconcile", "integrationPlan", "prepareIntegration", "recordIntegrated", "retry", "abandon", "release"] as const),
			loopName: Type.Optional(Type.String()),
			graphId: Type.Optional(Type.String()),
			stageId: Type.Optional(Type.String()),
			nodeIds: Type.Optional(Type.Array(Type.String(), { maxItems: 100 })),
			expectedGraphRevision: Type.Optional(Type.Integer({ minimum: 0 })),
			graph: Type.Optional(Type.Any()),
			takeOwnership: Type.Optional(Type.Boolean()),
			rationale: Type.Optional(Type.String()),
			approvalRef: Type.Optional(Type.String()),
			classification: Type.Optional(Type.String()),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_LIMIT })),
			offset: Type.Optional(Type.Integer({ minimum: 0 })),
			timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 24 * 60 * 60 * 1000 })),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			return executeStageTool(pi, runtime, params as StageToolParams, signal, onUpdate, ctx);
		},
	});
}
