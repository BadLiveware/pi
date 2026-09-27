import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { StardockRuntime } from "../runtime/types.ts";
import { nextSequentialId, type LoopState, type VerificationArtifact, type WorkerReport, type WorkerRun } from "../state/core.ts";
import type { ExecutionAttempt } from "../stages/contracts.ts";
import { releaseStage } from "../stages/reconcile.ts";
import { loadState, mutateState } from "../state/store.ts";
import { summarizeExecutionPlan } from "./graph.ts";
import { reconcileExecutionPlanWave } from "./wave-state.ts";
import { pendingResourceCleanup } from "./resource-cleanup.ts";

interface ReviewDecision {
	runId: string;
	decision: "accept" | "retry" | "abandon" | "reject";
	rationale: string;
}

interface ExecutionPlanReviewParams {
	name?: string;
	decisions: ReviewDecision[];
}

function currentReviewWave(state: LoopState) {
	return [...(state.executionPlan?.waves ?? [])].reverse().find((wave) => wave.status === "review");
}

function reportForRun(state: LoopState, run: WorkerRun): WorkerReport | undefined {
	return run.reportId ? state.workerReports.find((report) => report.id === run.reportId) : undefined;
}

function promoteValidation(state: LoopState, planNodeId: string, run: WorkerRun, report: WorkerReport | undefined, attempt: ExecutionAttempt, now: string): string[] {
	const planNode = state.executionPlan!.nodes.find((node) => node.id === planNodeId)!;
	const artifactIds: string[] = [];
	const validationRecords = (report?.validation?.length ? report.validation : attempt.validation).filter((record) => record.result === "passed");
	for (const validation of validationRecords) {
		const id = nextSequentialId("artifact", state.verificationArtifacts);
		const artifact: VerificationArtifact = {
			id,
			kind: "test",
			command: validation.command,
			summary: validation.summary,
			criterionIds: [planNode.criterionId],
			createdAt: now,
		};
		state.verificationArtifacts.push(artifact);
		artifactIds.push(id);
	}
	const criterion = state.criterionLedger.criteria.find((item) => item.id === planNode.criterionId);
	if (criterion) {
		criterion.status = "passed";
		criterion.lastCheckedAt = now;
		criterion.greenEvidence = artifactIds.length ? artifactIds.join(", ") : `WorkerRun ${run.id} accepted by governor without promoted validation evidence.`;
	}
	return artifactIds;
}

function validateReviewBatch(state: LoopState, decisions: ReviewDecision[]): { waveId: string; runs: Map<string, WorkerRun> } {
	const plan = state.executionPlan;
	if (!plan) throw new Error("Loop has no simplified execution plan.");
	const wave = currentReviewWave(state);
	if (!wave) throw new Error("No execution wave currently needs a governor decision.");
	if (new Set(decisions.map((decision) => decision.runId)).size !== decisions.length) throw new Error("Governor decisions must use unique runId values.");
	const reviewNodes = plan.nodes.filter((node) => node.currentWaveId === wave.id && node.status === "needs_review");
	const availableRunIds = new Set(reviewNodes.map((node) => node.currentWorkerRunId).filter((id): id is string => Boolean(id)));
	const runs = new Map<string, WorkerRun>();
	for (const decision of decisions) {
		if (!decision.rationale.trim()) throw new Error(`Governor decision for "${decision.runId}" requires a rationale.`);
		if (!availableRunIds.has(decision.runId)) throw new Error(`WorkerRun "${decision.runId}" is not a settled lane awaiting a governor decision.`);
		const run = state.workerRuns.find((candidate) => candidate.id === decision.runId);
		if (!run || run.isolation !== "treehouse") throw new Error(`WorkerRun "${decision.runId}" lacks isolated lane evidence.`);
		runs.set(decision.runId, run);
	}
	return { waveId: wave.id, runs };
}

export function applyExecutionPlanReview(ctx: ExtensionContext, loopName: string, decisions: ReviewDecision[]) {
	const initial = loadState(ctx, loopName);
	if (!initial) throw new Error(`Loop "${loopName}" not found.`);
	const validated = validateReviewBatch(initial, decisions);
	const now = new Date().toISOString();
	const saved = mutateState(ctx, loopName, (state) => {
		const { waveId } = validateReviewBatch(state, decisions);
		const plan = state.executionPlan!;
		const graph = state.executionGraph;
		const wave = plan.waves.find((item) => item.id === waveId)!;
		const stage = graph?.stages.find((candidate) => candidate.id === wave.stageId);
		if (!graph || !stage) throw new Error(`Execution stage "${wave.stageId}" disappeared before governor decision.`);
		for (const decision of decisions) {
			const run = state.workerRuns.find((candidate) => candidate.id === decision.runId)!;
			const planNode = plan.nodes.find((node) => node.currentWorkerRunId === run.id && node.currentWaveId === wave.id)!;
			const executionNode = graph.nodes.find((node) => node.id === planNode.currentExecutionNodeId);
			const attempt = executionNode?.attempts.find((candidate) => candidate.workerRunId === run.id);
			if (!executionNode || !attempt) throw new Error(`WorkerRun "${run.id}" no longer matches durable execution attempt evidence.`);
			const report = reportForRun(state, run);
			planNode.attemptsUsed = executionNode.attempts.length;
			run.reviewRationale = decision.rationale.trim();
			run.updatedAt = now;
			if (decision.decision === "accept") {
				run.status = "accepted";
				if (report) {
					report.status = "accepted";
					report.updatedAt = now;
				}
				executionNode.status = "succeeded";
				planNode.status = "accepted";
				delete planNode.lastError;
				promoteValidation(state, planNode.id, run, report, attempt, now);
			} else if (decision.decision === "abandon") {
				run.status = "dismissed";
				if (report) {
					report.status = "dismissed";
					report.updatedAt = now;
				}
				executionNode.status = "abandoned";
				planNode.status = "abandoned";
				planNode.lastError = `Governor abandoned this node: ${decision.rationale.trim()}`;
			} else {
				run.status = "dismissed";
				if (report) {
					report.status = "dismissed";
					report.updatedAt = now;
				}
				executionNode.status = "retry_ready";
				planNode.status = "retry_ready";
				const budgetNote = planNode.attemptsUsed >= planNode.maxAttempts ? ` Advisory attempt budget ${planNode.maxAttempts} is exhausted; the governor may still retry.` : "";
				planNode.lastError = `${decision.rationale.trim()}${budgetNote}`;
			}
		}
		plan.revision += 1;
		plan.updatedAt = now;
		reconcileExecutionPlanWave(state, wave, now);
	});
	return { state: saved, plan: summarizeExecutionPlan(saved.executionPlan!), waveId: validated.waveId };
}

export async function executeExecutionPlanReview(runtime: StardockRuntime, params: ExecutionPlanReviewParams, ctx: ExtensionContext, signal?: AbortSignal, release: typeof releaseStage = releaseStage) {
	const loopName = params.name ?? runtime.ref.currentLoop;
	if (!loopName) return { content: [{ type: "text" as const, text: "No active Stardock execution plan." }], details: {} };
	try {
		const result = applyExecutionPlanReview(ctx, loopName, params.decisions);
		const warnings: string[] = [];
		let releasedAttemptIds: string[] = [];
		let releaseAttempted = false;
		let ownershipReleased = false;
		const decidedState = loadState(ctx, loopName)!;
		const wave = decidedState.executionPlan?.waves.find((item) => item.id === result.waveId);
		const stage = decidedState.executionGraph?.stages.find((item) => item.id === wave?.stageId);
		const undecided = decidedState.executionPlan?.nodes.some((node) => node.currentWaveId === result.waveId && node.status === "needs_review");
		if (stage && !undecided && (stage.status === "settled" || stage.status === "contracts_ready" || stage.status === "failed")) {
			releaseAttempted = true;
			try {
				const released = await release(ctx, {
					loopName,
					graphId: decidedState.executionGraph!.id,
					stageId: stage.id,
					expectedGraphRevision: decidedState.executionGraph!.revision,
				}, signal);
				releasedAttemptIds = released.releasedAttemptIds;
				ownershipReleased = released.ownershipReleased;
				for (const preserved of released.preserved) warnings.push(`Lease ${preserved.attemptId} was preserved: ${preserved.reason}`);
			} catch (error) {
				warnings.push(`Lease cleanup needs attention: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		const latest = loadState(ctx, loopName)!;
		const plan = summarizeExecutionPlan(latest.executionPlan!);
		const cleanup = pendingResourceCleanup(latest);
		runtime.updateUI(ctx);
		const warningText = warnings.length ? `\nWarnings:\n- ${warnings.join("\n- ")}` : "";
		const cleanupSummary = releaseAttempted
			? `\nWorkspace cleanup: returned ${releasedAttemptIds.length} lease(s); stage ownership ${ownershipReleased ? "released" : "retained"}.`
			: cleanup ? `\nWorkspace cleanup: ${cleanup.attemptIds.length ? "leases and stage ownership remain held" : "stage ownership remains held"} until every lane in this wave is decided; Stardock will then attempt safe release.` : "";
		const recoveryAction = cleanup && releaseAttempted ? `\nCleanup still pending: stardock_recover({ action: "inspect", name: "${loopName}" }) shows the exact stages and safe release options; dirty or unverified work remains preserved.` : "";
		return {
			content: [{ type: "text" as const, text: `Recorded ${params.decisions.length} governor decision(s).${cleanupSummary}${warningText}\nSuggested action: stardock_${plan.nextAction}.${recoveryAction}` }],
			details: { loopName, plan, waveId: result.waveId, warnings, releasedAttemptIds, ownershipReleased, ...(cleanup ? { resourceCleanup: cleanup } : {}) },
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { content: [{ type: "text" as const, text: `Could not record governor decision: ${message}` }], details: { loopName, ok: false }, isError: true };
	}
}

export function registerExecutionPlanReviewTool(pi: ExtensionAPI, runtime: StardockRuntime): void {
	pi.registerTool({
		name: "stardock_review",
		label: "Review Stardock Execution",
		description: "Record governor decisions for any subset of settled DAG nodes. Accept useful evidence, request another attempt, or abandon work; worker, validation, auditor, and attempt-budget signals are advisory.",
		promptSnippet: "Record governor-owned accept, retry, or abandon decisions for settled node reports.",
		promptGuidelines: [
			"The governor is the authority: decide only the settled runIds you are ready to act on; partial decisions are allowed.",
			"Accept may consume reports, findings, throw-away experiments, optional artifacts, optional commits, or no filesystem changes. Retry and abandon require a concise rationale; attempt limits are advisory.",
			"Accepted nodes satisfy dependencies immediately. Model code promotion/integration as an explicit DAG node when downstream work needs combined code.",
			"Stardock tries verified lease return after the last decision in a wave. If cleanup remains pending, inspect with stardock_recover; never discard a dirty lease to clear the warning.",
		],
		parameters: Type.Object({
			name: Type.Optional(Type.String({ description: "Loop name. Defaults to the active plan." })),
			decisions: Type.Array(Type.Object({
				runId: Type.String(),
				decision: StringEnum(["accept", "retry", "abandon", "reject"] as const),
				rationale: Type.String(),
			}), { minItems: 1, maxItems: 100 }),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			return executeExecutionPlanReview(runtime, params as ExecutionPlanReviewParams, ctx, signal);
		},
	});
}
