import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { StardockRuntime } from "../runtime/types.ts";
import type { LoopState } from "../state/core.ts";
import { loadState } from "../state/store.ts";
import { authorExecutionPlan, releaseSupersededPlanResources, type ExecutionPlanAuthoringParams } from "./authoring.ts";
import { summarizeExecutionPlan } from "./graph.ts";
import { pendingResourceCleanup } from "./resource-cleanup.ts";
import { syncExecutionPlanSurface } from "./surface.ts";

const resourceClaimSchema = Type.Object({
	key: Type.String(),
	mode: StringEnum(["shared", "exclusive"] as const),
	value: Type.Optional(Type.String()),
});

const nodeSchema = Type.Object({
	id: Type.String(),
	kind: Type.Optional(StringEnum(["prerequisite", "work"] as const)),
	objective: Type.String(),
	task: Type.String(),
	dependsOn: Type.Optional(Type.Array(Type.String())),
	acceptanceCriteria: Type.Array(Type.String(), { minItems: 1 }),
	reads: Type.Optional(Type.Array(Type.String())),
	writes: Type.Optional(Type.Array(Type.String())),
	resourceClaims: Type.Optional(Type.Array(resourceClaimSchema)),
	validationCommands: Type.Optional(Type.Array(Type.String())),
	maxAttempts: Type.Optional(Type.Integer({ minimum: 1 })),
});



















function pendingReviewEvidence(state: LoopState) {
	return (state.executionPlan?.nodes ?? []).filter((node) => node.status === "needs_review" && node.currentWorkerRunId).map((node) => {
		const workerRun = state.workerRuns.find((run) => run.id === node.currentWorkerRunId);
		const report = state.workerReports.find((candidate) => candidate.id === workerRun?.reportId);
		return {
			planNodeId: node.id,
			workerRunId: node.currentWorkerRunId!,
			evidence: report ? {
				summary: report.summary,
				changedFiles: report.changedFiles,
				validation: report.validation,
				risks: report.risks,
				openQuestions: report.openQuestions,
				reviewHints: report.reviewHints,
				artifactIds: report.artifactIds,
			} : { summary: workerRun?.summary, changedFiles: workerRun?.changedFiles ?? [], validation: [] },
		};
	});
}

function formatSnapshot(state: LoopState): string {
	if (!state.executionPlan) return `Loop "${state.name}" has no simplified execution plan.`;
	const snapshot = summarizeExecutionPlan(state.executionPlan);
	const cleanup = pendingResourceCleanup(state);
	const cleanupActionable = cleanup && cleanup.runningWorkers === 0 && !state.executionPlan.nodes.some((node) => node.status === "needs_review");
	const availableActions = state.status === "completed"
		? cleanup ? "stardock_recover inspect (resource cleanup)" : "none (loop completed)"
		: [...snapshot.availableActions.map((action) => `stardock_${action}`), ...(cleanupActionable ? ["stardock_recover inspect (resource cleanup)"] : [])].join(", ");
	return [
		`Execution plan: ${snapshot.id}`,
		`Status: ${snapshot.status}`,
		`Objective: ${snapshot.objective}`,
		...(snapshot.supersededBy ? [`Superseded by: ${snapshot.supersededBy}`] : []),
		`Ready: ${snapshot.readyNodeIds.join(", ") || "none"}`,
		`Running: ${snapshot.runningNodeIds.join(", ") || "none"}`,
		`Needs review: ${snapshot.reviewNodeIds.join(", ") || "none"}`,
		`Review run IDs: ${snapshot.reviewRunIds.join(", ") || "none"}`,
		`Blocked: ${snapshot.blockedNodeIds.join(", ") || "none"}`,
		...(cleanup ? [cleanup.warning] : []),
		`Available actions: ${availableActions}`,
		`Suggested action: ${state.status === "completed" ? cleanup ? `stardock_recover({ action: "inspect", name: "${state.name}" })` : "none (loop completed)" : `stardock_${snapshot.nextAction}`}`,
	].join("\n");
}

export function registerExecutionPlanTools(pi: ExtensionAPI, runtime: StardockRuntime): void {
	pi.registerTool({
		name: "stardock_plan",
		label: "Plan Stardock Execution",
		description: "Author a declarative DAG of arbitrary isolated jobs. Nodes may return concise reports, findings, throw-away experiments, optional artifacts, optional commits, or no filesystem changes. The governor owns all semantic decisions; Stardock schedules ready nodes, packages context, and preserves bounded evidence.",
		promptSnippet: "Create or incrementally author a governor-controlled DAG of isolated jobs.",
		promptGuidelines: [
			"Use stardock_plan when finite work benefits from dependencies, parallel isolation, or concise worker-to-governor reports; expose every genuinely independent node.",
			"Treat nodes as arbitrary jobs, not PRs or mandatory code producers. Integration/promotion is an ordinary explicit DAG node only when downstream work needs combined code.",
			"For large plans, create a draft, upsert bounded node groups, then seal it. stardock_run rejects unsealed drafts.",
			"Do not serialize independent nodes merely because they share a prerequisite; Stardock runs the complete ready antichain with bounded concurrency after sealing.",
		],
		prepareArguments(args): any {
			if (!args || typeof args !== "object") return args;
			const input = args as { nodes?: Array<Record<string, unknown>> };
			if (!Array.isArray(input.nodes) || !input.nodes.some((node) => node.kind === "implementation")) return args;
			return { ...input, nodes: input.nodes.map((node) => node.kind === "implementation" ? { ...node, kind: "work" } : node) };
		},
		parameters: Type.Object({
			action: Type.Optional(StringEnum(["replace", "draft", "upsert", "seal"] as const, { description: "replace (default) creates a complete sealed plan or replaces a draft; draft starts incremental authoring; upsert adds or replaces draft nodes; seal validates and freezes the full DAG." })),
			name: Type.String({ description: "Loop/plan name. Use a new name when superseding an earlier plan." }),
			objective: Type.Optional(Type.String({ description: "Whole-request objective. Required for replace and draft." })),
			constraints: Type.Optional(Type.Array(Type.String())),
			supersedesPlan: Type.Optional(Type.String({ description: "Earlier plan superseded by this new plan." })),
			replanReason: Type.Optional(Type.String({ description: "Required reason when supersedesPlan is provided." })),
			maxConcurrency: Type.Optional(Type.Integer({ minimum: 1, maximum: 32 })),
			defaultMaxAttempts: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
			integrationValidationCommands: Type.Optional(Type.Array(Type.String(), { minItems: 1 })),
			nodes: Type.Optional(Type.Array(nodeSchema, { maxItems: 100 })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			try {
				const authoring = params as ExecutionPlanAuthoringParams;
				const { state, warnings } = authorExecutionPlan(ctx, runtime, authoring);
				if (state.executionPlan?.status !== "draft" && state.executionPlan?.supersedesPlan) {
					warnings.push(...await releaseSupersededPlanResources(ctx, state.executionPlan.supersedesPlan, signal));
				}
				syncExecutionPlanSurface(pi, state);
				runtime.updateUI(ctx);
				const actionSummary = authoring.action === "draft" ? "Draft created." : authoring.action === "upsert" ? "Draft nodes upserted." : authoring.action === "seal" ? "Draft sealed; execution topology is now immutable." : "Complete plan created and sealed.";
				const warningText = warnings.length ? `\nWarning: ${warnings.join(" ")}` : "";
				return { content: [{ type: "text", text: `${formatSnapshot(state)}\n${actionSummary} Plan records updated.${warnings.length ? "" : " Human-readable task projection updated."}${warningText}` }], details: { loopName: state.name, plan: summarizeExecutionPlan(state.executionPlan!), warnings } };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { content: [{ type: "text", text: `Could not author execution plan: ${message}` }], details: { ok: false }, isError: true };
			}
		},
	});

	pi.registerTool({
		name: "stardock_status",
		label: "Inspect Stardock Execution",
		description: "Return compact DAG progress, settled reports, pending workspace-lease cleanup and its next action, without dumping worker transcripts or internal ownership protocol.",
		promptSnippet: "Inspect compact graph progress, settled evidence, warnings, and available governor actions.",
		parameters: Type.Object({ name: Type.Optional(Type.String({ description: "Loop name. Defaults to the active loop." })) }),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const loopName = params.name ?? runtime.ref.currentLoop;
			if (!loopName) return { content: [{ type: "text", text: "No active Stardock execution plan." }], details: {} };
			const state = loadState(ctx, loopName);
			if (!state) return { content: [{ type: "text", text: `Loop "${loopName}" not found.` }], details: { loopName }, isError: true };
			const reviewLanes = pendingReviewEvidence(state);
			const reviewSummary = reviewLanes.length ? `\nPending review evidence:\n${reviewLanes.map((lane) => `- ${lane.planNodeId} [runId ${lane.workerRunId}]: ${lane.evidence.summary ?? "no worker summary"}; changed ${lane.evidence.changedFiles.map((file) => file.path).join(", ") || "none"}; validation ${lane.evidence.validation.map((record) => `${record.command ?? "unspecified"}=${record.result}`).join(", ") || "none"}`).join("\n")}` : "";
			const cleanup = pendingResourceCleanup(state);
			return { content: [{ type: "text", text: `${formatSnapshot(state)}${reviewSummary}` }], details: { loopName, plan: state.executionPlan ? summarizeExecutionPlan(state.executionPlan) : undefined, reviewLanes, ...(cleanup ? { resourceCleanup: { stageId: cleanup.stageId, stageIds: cleanup.stageIds, attemptIds: cleanup.attemptIds, warning: cleanup.warning } } : {}) } };
		},
	});
}
