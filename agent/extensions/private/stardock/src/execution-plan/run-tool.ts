import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { StardockRuntime } from "../runtime/types.ts";
import type { RunReadyDependencies, RunReadyResult } from "../stages/run-ready.ts";
import { runReadyStage } from "../stages/run-ready.ts";
import type { StageGitAdapter } from "../stages/stage-git-adapter.ts";
import type { LoopState } from "../state/core.ts";
import { loadState, mutateState } from "../state/store.ts";
import { refreshExecutionPlan, summarizeExecutionPlan } from "./graph.ts";
import { materializeExecutionPlanWave, type MaterializedExecutionWave } from "./materialize.ts";
import { reconcileExecutionPlanWave } from "./wave-state.ts";
import { pendingResourceCleanup } from "./resource-cleanup.ts";
import { unresolvedWaveNodes } from "./unresolved-wave.ts";
import { beginExecutionActivities, settleExecutionActivities, updateExecutionActivity } from "./widget.ts";

interface ExecutionPlanRunParams {
	name?: string;
	timeoutMs?: number;
}

export interface ExecutionPlanRunDependencies {
	gitAdapter?: StageGitAdapter;
	runReady?: typeof runReadyStage;
	runReadyDependencies?: Partial<RunReadyDependencies>;
}

function publicLaneResults(state: LoopState | null | undefined, lanes: RunReadyResult["lanes"]) {
	return lanes.map((lane) => {
		const workerRun = state?.workerRuns.find((run) => run.id === lane.workerRunId);
		const report = state?.workerReports.find((candidate) => candidate.id === workerRun?.reportId);
		return {
			planNodeId: state?.executionPlan?.nodes.find((node) => node.currentExecutionNodeId === lane.nodeId)?.id,
			workerRunId: lane.workerRunId,
			status: lane.status,
			violations: lane.violations,
			evidence: report ? {
				summary: report.summary,
				changedFiles: report.changedFiles,
				validation: report.validation,
				risks: report.risks,
				openQuestions: report.openQuestions,
				reviewHints: report.reviewHints,
				artifactIds: report.artifactIds,
			} : { summary: workerRun?.summary, changedFiles: workerRun?.changedFiles ?? [] },
		};
	});
}

function prepareRetryWave(ctx: ExtensionContext, loopName: string) {
	const state = loadState(ctx, loopName);
	const plan = state?.executionPlan;
	const graph = state?.executionGraph;
	const wave = [...(plan?.waves ?? [])].reverse().find((item) => item.status === "review");
	const retryNodes = plan?.nodes.filter((node) => node.currentWaveId === wave?.id && node.status === "retry_ready") ?? [];
	if (!plan || !graph || !wave || !retryNodes.length) return undefined;
	if (plan.nodes.some((node) => node.currentWaveId === wave.id && node.status === "needs_review")) throw new Error("Review every settled lane before retrying rejected work.");
	const stage = graph.stages.find((candidate) => candidate.id === wave.stageId);
	if (!stage) throw new Error(`Execution stage "${wave.stageId}" disappeared before retry.`);
	const now = new Date().toISOString();
	const saved = mutateState(ctx, loopName, (candidate) => {
		const candidatePlan = candidate.executionPlan!;
		const candidateWave = candidatePlan.waves.find((item) => item.id === wave.id)!;
		for (const retryNode of retryNodes) {
			const node = candidatePlan.nodes.find((item) => item.id === retryNode.id)!;
			if (node.status !== "retry_ready") throw new Error(`Execution plan node "${node.id}" is no longer retryable.`);
			node.status = "running";
			delete node.currentWorkerRunId;
		}
		candidateWave.status = "running";
		candidatePlan.revision += 1;
		candidatePlan.updatedAt = now;
		refreshExecutionPlan(candidatePlan);
	});
	return {
		graphId: saved.executionGraph!.id,
		graphRevision: saved.executionGraph!.revision,
		waveId: wave.id,
		stageId: wave.stageId,
		nodeIds: retryNodes.map((node) => node.currentExecutionNodeId!),
		planNodeIds: retryNodes.map((node) => node.id),
		baseCommit: stage.contractCommit,
	};
}

function settlePlanFromRun(ctx: ExtensionContext, loopName: string, waveId: string, result: RunReadyResult): ReturnType<typeof summarizeExecutionPlan> {
	const now = new Date().toISOString();
	const state = mutateState(ctx, loopName, (candidate) => {
		const plan = candidate.executionPlan;
		const graph = candidate.executionGraph;
		if (!plan || !graph) throw new Error("Execution plan or graph disappeared while settling its worker wave.");
		const wave = plan.waves.find((item) => item.id === waveId);
		if (!wave || wave.status !== "running") throw new Error(`Execution wave "${waveId}" is not running.`);
		for (const lane of result.lanes) {
			const node = plan.nodes.find((item) => item.currentExecutionNodeId === lane.nodeId && item.currentWaveId === waveId);
			const executionNode = graph.nodes.find((item) => item.id === lane.nodeId);
			if (!node || !executionNode) throw new Error(`Worker lane "${lane.nodeId}" no longer maps to an execution-plan node.`);
			node.attemptsUsed = executionNode.attempts.length;
			if (lane.workerRunId) {
				node.currentWorkerRunId = lane.workerRunId;
				node.status = "needs_review";
				const warning = lane.error ?? lane.violations.join("; ");
				if (warning) node.lastError = warning;
			} else {
				node.status = "retry_ready";
				const budgetNote = node.attemptsUsed >= node.maxAttempts ? ` Advisory attempt budget ${node.maxAttempts} is exhausted; the governor may still retry or abandon.` : "";
				const warning = lane.error ?? (lane.violations.join("; ") || `Lane settled ${lane.status}.`);
				node.lastError = `${warning}${budgetNote}`;
			}
		}
		wave.status = "review";
		plan.revision += 1;
		plan.updatedAt = now;
		reconcileExecutionPlanWave(candidate, wave, now);
	});
	return summarizeExecutionPlan(state.executionPlan!);
}

function recoverSettledRunningWave(ctx: ExtensionContext, loopName: string): { snapshot: ReturnType<typeof summarizeExecutionPlan>; result: RunReadyResult } | undefined {
	const state = loadState(ctx, loopName);
	const plan = state?.executionPlan;
	const graph = state?.executionGraph;
	const wave = [...(plan?.waves ?? [])].reverse().find((item) => item.status === "running");
	if (!plan || !graph || !wave) return undefined;
	const stage = graph.stages.find((candidate) => candidate.id === wave.stageId);
	if (!stage || stage.status === "contracts_ready") return undefined;
	const executionNodes = unresolvedWaveNodes(plan, wave).map((planNode) => graph.nodes.find((node) => node.id === planNode.currentExecutionNodeId));
	if (!executionNodes.length || executionNodes.some((node) => !node)) throw new Error(`Execution wave "${wave.id}" has incomplete durable node evidence.`);
	if (executionNodes.every((node) => node!.status === "ready" || node!.status === "retry_ready")) return undefined;
	const active = executionNodes.filter((node) => ["leased", "running", "reconciling"].includes(node!.status));
	if (active.length) return undefined;
	const lanes: RunReadyResult["lanes"] = executionNodes.map((node) => {
		const attempt = node!.attempts.at(-1);
		const status = node!.status === "needs_review" ? "needs_review" : node!.status === "detached" ? "detached" : node!.status === "failed" ? "failed" : node!.status === "ready" || node!.status === "retry_ready" ? "not_started" : undefined;
		if (!status) throw new Error(`Execution node "${node!.id}" is ${node!.status}; its interrupted wave requires explicit reconciliation.`);
		return { nodeId: node!.id, attemptId: attempt?.id, workerRunId: status === "not_started" ? undefined : attempt?.workerRunId, status, violations: attempt?.violations ?? [], error: attempt?.violations?.join("; ") || undefined };
	});
	const counts = { needs_review: 0, failed: 0, detached: 0, not_started: 0 };
	for (const lane of lanes) counts[lane.status] += 1;
	const result: RunReadyResult = {
		ok: lanes.every((lane) => lane.status === "needs_review"),
		graphId: graph.id,
		stageId: wave.stageId,
		stateRevision: graph.revision,
		selectedNodeIds: executionNodes.map((node) => node!.id),
		lanes,
		counts,
		setupFailed: lanes.some((lane) => lane.status === "not_started"),
		cancelled: false,
		timedOut: false,
	};
	return { snapshot: settlePlanFromRun(ctx, loopName, wave.id, result), result };
}

function existingPlannedWave(ctx: ExtensionContext, loopName: string): MaterializedExecutionWave | undefined {
	const state = loadState(ctx, loopName);
	const plan = state?.executionPlan;
	const graph = state?.executionGraph;
	const wave = [...(plan?.waves ?? [])].reverse().find((item) => item.status === "running");
	if (!plan || !graph || !wave) return undefined;
	const stage = graph.stages.find((candidate) => candidate.id === wave.stageId);
	if (!stage) throw new Error(`Execution stage "${wave.stageId}" disappeared while resuming its wave.`);
	const unresolved = unresolvedWaveNodes(plan, wave);
	const executionNodeIds = unresolved.map((node) => node.currentExecutionNodeId!);
	if (!executionNodeIds.length) throw new Error(`Execution wave "${wave.id}" has no unresolved node identity mappings.`);
	const allReady = executionNodeIds.every((id) => ["ready", "retry_ready"].includes(graph.nodes.find((node) => node.id === id)?.status ?? ""));
	if (stage.status !== "contracts_ready" && !allReady) {
		const active = executionNodeIds.filter((id) => ["leased", "running", "reconciling"].includes(graph.nodes.find((node) => node.id === id)?.status ?? ""));
		if (active.length) throw new Error(`Execution wave "${wave.id}" still has active or interrupted lanes (${active.join(", ")}). Use stardock_status; if the owning session is gone, enable legacy recovery for explicit reconciliation.`);
		throw new Error(`Execution wave "${wave.id}" is ${stage.status} but could not be reconstructed from durable attempt evidence.`);
	}
	return {
		graphId: graph.id,
		graphRevision: graph.revision,
		waveId: wave.id,
		stageId: wave.stageId,
		nodeIds: executionNodeIds,
		planNodeIds: unresolved.map((node) => node.id),
		baseCommit: stage.contractCommit,
	};
}

export async function executeExecutionPlanRun(
	pi: ExtensionAPI,
	runtime: StardockRuntime,
	params: ExecutionPlanRunParams,
	signal: AbortSignal | undefined,
	onUpdate: ((update: { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> }) => void) | undefined,
	ctx: ExtensionContext,
	dependencies: ExecutionPlanRunDependencies = {},
) {
	const loopName = params.name ?? runtime.ref.currentLoop;
	if (!loopName) return { content: [{ type: "text" as const, text: "No active Stardock execution plan." }], details: {} };
	let activityNodeIds: string[] = [];
	try {
		const recovered = recoverSettledRunningWave(ctx, loopName);
		if (recovered) {
			runtime.updateUI(ctx);
			const recoveredState = loadState(ctx, loopName);
			const lanes = publicLaneResults(recoveredState, recovered.result.lanes);
			const laneSummary = lanes.map((lane) => `${lane.planNodeId ?? lane.workerRunId ?? "unknown-plan-node"}:${lane.status}${lane.workerRunId ? ` [runId ${lane.workerRunId}]` : ""}`).join(", ");
			const evidenceSummary = lanes.map((lane) => `- ${lane.planNodeId ?? lane.workerRunId ?? "unknown-plan-node"}: ${lane.evidence.summary ?? "no worker summary"}; changed ${lane.evidence.changedFiles.map((file) => file.path).join(", ") || "none"}`).join("\n");
			const leaseNote = recoveredState && pendingResourceCleanup(recoveredState)?.attemptIds.length ? "\nReview these run IDs with stardock_review before attempting workspace cleanup. Isolated workspaces remain leased until all lanes are decided; Stardock then attempts safe release." : "";
			return {
				content: [{ type: "text" as const, text: `Recovered durable results for an interrupted execution wave: ${laneSummary}.\nReview evidence:\n${evidenceSummary}${leaseNote}\nSuggested action: stardock_${recovered.snapshot.nextAction}.` }],
				details: { loopName, plan: recovered.snapshot, lanes, counts: recovered.result.counts, recovered: true },
				...(recovered.result.ok ? {} : { isError: true }),
			};
		}
		const wave = prepareRetryWave(ctx, loopName) ?? existingPlannedWave(ctx, loopName) ?? await materializeExecutionPlanWave(ctx, loopName, signal, dependencies.gitAdapter);
		activityNodeIds = [...wave.nodeIds];
		beginExecutionActivities(runtime.executionActivity, loopName, activityNodeIds);
		runtime.updateUI(ctx);
		const run = dependencies.runReady ?? runReadyStage;
		const result = await run(
			pi,
			ctx,
			{
				loopName,
				graphId: wave.graphId,
				stageId: wave.stageId,
				nodeIds: wave.nodeIds,
				expectedGraphRevision: wave.graphRevision,
				sessionId: runtime.ref.sessionId,
				timeoutMs: params.timeoutMs,
			},
			signal,
			(text, details) => {
				updateExecutionActivity(runtime.executionActivity, loopName, text, details ?? {});
				runtime.updateUI(ctx);
				onUpdate?.({ content: [{ type: "text", text }], details: details ?? {} });
			},
			{ ...dependencies.runReadyDependencies, updateUI: runtime.updateUI },
		);
		settleExecutionActivities(runtime.executionActivity, loopName, result.lanes.map((lane) => lane.nodeId));
		const snapshot = settlePlanFromRun(ctx, loopName, wave.waveId, result);
		runtime.updateUI(ctx);
		const settledState = loadState(ctx, loopName);
		const lanes = publicLaneResults(settledState, result.lanes);
		const laneSummary = lanes.map((lane) => `${lane.planNodeId ?? lane.workerRunId ?? "unknown-plan-node"}:${lane.status}${lane.workerRunId ? ` [runId ${lane.workerRunId}]` : ""}`).join(", ");
		const evidenceSummary = lanes.map((lane) => `- ${lane.planNodeId ?? lane.workerRunId ?? "unknown-plan-node"}: ${lane.evidence.summary ?? "no worker summary"}; changed ${lane.evidence.changedFiles.map((file) => file.path).join(", ") || "none"}`).join("\n");
		const leaseNote = settledState && pendingResourceCleanup(settledState)?.attemptIds.length ? "\nReview these run IDs with stardock_review before attempting workspace cleanup. Isolated workspaces remain leased until all lanes are decided; Stardock then attempts safe release." : "";
		return {
			content: [{ type: "text" as const, text: `Ran ready execution wave with ${result.lanes.length} isolated lane(s): ${laneSummary}.\nReview evidence:\n${evidenceSummary}${leaseNote}\nSuggested action: stardock_${snapshot.nextAction}.` }],
			details: { loopName, plan: snapshot, wave: { id: snapshot.currentWave?.id, stageId: wave.stageId, nodeIds: wave.planNodeIds }, lanes, counts: result.counts },
			...(result.ok ? {} : { isError: true }),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		settleExecutionActivities(runtime.executionActivity, loopName, activityNodeIds);
		runtime.updateUI(ctx);
		return { content: [{ type: "text" as const, text: `Could not run execution wave: ${message}` }], details: { loopName, ok: false }, isError: true };
	}
}

export function registerExecutionPlanRunTool(pi: ExtensionAPI, runtime: StardockRuntime): void {
	pi.registerTool({
		name: "stardock_run",
		label: "Run Stardock Execution",
		description: "Run the complete maximal ready antichain from a Stardock job DAG in isolated workers and return each lane's review run ID plus bounded evidence. Jobs may produce reports, findings, throw-away experiments, artifacts, commits, or no filesystem changes; width-one prerequisites run serially and independent ready leaves fan out automatically.",
		promptSnippet: "Run every ready work-DAG node with bounded isolated concurrency.",
		promptGuidelines: [
			"Call stardock_run after stardock_plan or stardock_integrate reports ready nodes; do not select only one independent ready node.",
			"After the wave settles, use stardock_review once for the returned lane set. Leases stay held until governor decisions; Stardock attempts safe return after the wave is decided.",
		],
		parameters: Type.Object({
			name: Type.Optional(Type.String({ description: "Loop name. Defaults to the active plan." })),
			timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 24 * 60 * 60 * 1000 })),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			return executeExecutionPlanRun(pi, runtime, params, signal, onUpdate, ctx);
		},
	});
}
