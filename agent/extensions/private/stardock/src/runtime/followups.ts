/** Stardock-local read-only followup tool runner. */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { attachFollowup, booleanArg, cyclicFollowup, followupEffect, type FollowupOutput, type FollowupToolRequest, stringArg, type StardockTextResult, unsupportedFollowup } from "../app/tool-kernel.ts";
import { formatPageNote, paginateItems } from "../app/pagination.ts";
import { formatAdvisoryHandoffOverview } from "../advisory-handoffs.ts";
import { formatAuditorReviewOverview } from "../auditor-reviews.ts";
import { formatBreakoutPackageOverview } from "../breakout-packages.ts";
import { currentBrief, formatBriefOverview } from "../briefs.ts";
import { formatFinalReportOverview } from "../final-reports.ts";
import { formatCriterionCounts, formatLedgerOverview } from "../ledger.ts";
import { latestGovernorDecision } from "../outside-requests.ts";
import { evaluateAuditorGatePolicy, evaluateAuditorPolicy, evaluateBreakoutPolicy, evaluateCompletionPolicy, evaluateParentReviewPolicy, formatAuditorGatePolicy, formatAuditorPolicy, formatBreakoutPolicy, formatCompletionPolicy, formatParentReviewPolicy } from "../policy.ts";
import { formatWorkerReportOverview } from "../worker-reports.ts";
import { formatWorkerRunOverview } from "../worker-runs.ts";
import { existingStatePath } from "../state/paths.ts";
import { listLoops, loadState } from "../state/store.ts";
import { formatRunOverview, formatRunTimeline, formatStateSummary, governorRoutingInspection, summarizeLoopState } from "../views.ts";

export type { FollowupAttachMode, FollowupOutput, FollowupToolRequest } from "../app/tool-kernel.ts";

export const FollowupToolParameter = Type.Optional(
	Type.Object({
		name: Type.String({ description: "Read-only Stardock followup tool name, e.g. stardock_state or stardock_policy." }),
		args: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Arguments for the read-only followup tool." })),
		attachAs: Type.Optional(Type.Union([Type.Literal("content"), Type.Literal("details"), Type.Literal("both")], { description: "Where to attach the followup output. Default details." })),
	}),
);

function runStateFollowup(ctx: ExtensionContext, currentLoop: string | null, args: Record<string, unknown>): FollowupOutput {
	const archived = booleanArg(args, "archived");
	const includeDetails = booleanArg(args, "includeDetails");
	const view = stringArg(args, "view") ?? "summary";
	const loopName = stringArg(args, "loopName");
	if (loopName) {
		const state = loadState(ctx, loopName, archived);
		if (!state) return { name: "stardock_state", args, content: `Loop "${loopName}" not found.`, details: { loopName, archived, ok: false } };
		const baseText = view === "overview" ? formatRunOverview(ctx, state, archived) : view === "timeline" ? formatRunTimeline(state) : `Loop: ${state.name}\nStatus: ${state.status}\nMode: ${state.mode}\nIteration: ${state.iteration}${state.maxIterations > 0 ? `/${state.maxIterations}` : ""}\nTask file: ${state.taskFile}\nState file: ${ctx.cwd ? existingStatePath(ctx, state.name, archived).replace(`${ctx.cwd}/`, "") : existingStatePath(ctx, state.name, archived)}`;
		const governorWarning = governorRoutingInspection(state, latestGovernorDecision(state)).message;
		const text = governorWarning ? `${baseText}\n${governorWarning}` : baseText;
		return { name: "stardock_state", args, content: text, details: { loopName: state.name, archived, view, loop: summarizeLoopState(ctx, state, archived, includeDetails) } };
	}
	const loops = listLoops(ctx, archived).sort((a, b) => a.name.localeCompare(b.name));
	return { name: "stardock_state", args, content: loops.length > 0 ? `${archived ? "Archived Stardock loops" : "Stardock loops"}:\n${loops.map(formatStateSummary).join("\n")}` : `No ${archived ? "archived " : ""}Stardock loops found.`, details: { archived, currentLoop, loops: loops.map((state) => summarizeLoopState(ctx, state, archived, includeDetails)) } };
}

function loopStateForFollowup(ctx: ExtensionContext, currentLoop: string | null, args: Record<string, unknown>, toolName: string): { state?: ReturnType<typeof loadState>; loopName?: string; output?: FollowupOutput } {
	const loopName = stringArg(args, "loopName") ?? currentLoop;
	if (!loopName) return { output: { name: toolName, args, content: "No active Stardock loop.", details: { ok: false } } };
	const state = loadState(ctx, loopName);
	if (!state) return { loopName, output: { name: toolName, args, content: `Loop "${loopName}" not found.`, details: { loopName, ok: false } } };
	return { state, loopName };
}

function runListFollowup(ctx: ExtensionContext, currentLoop: string | null, args: Record<string, unknown>, toolName: string): FollowupOutput {
	if ((stringArg(args, "action") ?? "list") !== "list") return { name: toolName, args, content: `Rejected mutating Stardock followupTool action: ${toolName}.${String(args.action)}.`, details: { ok: false, reason: "mutating_action" } };
	const resolved = loopStateForFollowup(ctx, currentLoop, args, toolName);
	if (!resolved.state) return resolved.output!;
	const { state, loopName } = resolved;
	if (toolName === "stardock_brief") {
		const page = paginateItems(state.briefs, args);
		return { name: toolName, args, content: `${formatBriefOverview({ ...state, briefs: page.items }, page.page.total, currentBrief(state))}\n${formatPageNote(page.page)}`, details: { loopName, briefs: page.items, currentBriefId: state.currentBriefId, page: page.page } };
	}
	if (toolName === "stardock_ledger") {
		const criteria = paginateItems(state.criterionLedger.criteria, args);
		const requirementTrace = paginateItems(state.criterionLedger.requirementTrace, args);
		const artifacts = paginateItems(state.verificationArtifacts, args);
		const baselines = paginateItems(state.baselineValidations, args);
		const pageState = { ...state, criterionLedger: { criteria: criteria.items, requirementTrace: requirementTrace.items }, verificationArtifacts: artifacts.items, baselineValidations: baselines.items };
		return {
			name: toolName,
			args,
			content: `${formatLedgerOverview(pageState, state)}\nCriteria ${formatPageNote(criteria.page)}\nRequirement trace ${formatPageNote(requirementTrace.page)}\nArtifacts ${formatPageNote(artifacts.page)}\nBaselines ${formatPageNote(baselines.page)}`,
			details: { loopName, criterionLedger: pageState.criterionLedger, verificationArtifacts: artifacts.items, baselineValidations: baselines.items, pages: { criteria: criteria.page, requirementTrace: requirementTrace.page, artifacts: artifacts.page, baselines: baselines.page } },
		};
	}
	if (toolName === "stardock_final_report") {
		const page = paginateItems(state.finalVerificationReports, args);
		return { name: toolName, args, content: `${formatFinalReportOverview({ ...state, finalVerificationReports: page.items }, formatCriterionCounts, page.page.total)}\n${formatPageNote(page.page)}`, details: { loopName, finalVerificationReports: page.items, page: page.page } };
	}
	if (toolName === "stardock_auditor") {
		const page = paginateItems(state.auditorReviews, args);
		return { name: toolName, args, content: `${formatAuditorReviewOverview({ ...state, auditorReviews: page.items }, page.page.total)}\n${formatPageNote(page.page)}`, details: { loopName, auditorReviews: page.items, page: page.page } };
	}
	if (toolName === "stardock_breakout") {
		const page = paginateItems(state.breakoutPackages, args);
		return { name: toolName, args, content: `${formatBreakoutPackageOverview({ ...state, breakoutPackages: page.items }, page.page.total)}\n${formatPageNote(page.page)}`, details: { loopName, breakoutPackages: page.items, page: page.page } };
	}
	if (toolName === "stardock_handoff") {
		const page = paginateItems(state.advisoryHandoffs, args);
		return { name: toolName, args, content: `${formatAdvisoryHandoffOverview({ ...state, advisoryHandoffs: page.items }, page.page.total)}\n${formatPageNote(page.page)}`, details: { loopName, advisoryHandoffs: page.items, page: page.page } };
	}
	if (toolName === "stardock_worker_report") {
		const page = paginateItems(state.workerReports, args);
		return { name: toolName, args, content: `${formatWorkerReportOverview({ ...state, workerReports: page.items }, page.page.total)}\n${formatPageNote(page.page)}`, details: { loopName, workerReports: page.items, page: page.page } };
	}
	if (toolName === "stardock_worker") {
		const page = paginateItems(state.workerRuns, args);
		return { name: toolName, args, content: `${formatWorkerRunOverview({ ...state, workerRuns: page.items }, page.page.total)}\n${formatPageNote(page.page)}`, details: { loopName, workerRuns: page.items, page: page.page } };
	}
	return { name: toolName, args, content: `Unsupported read-only Stardock followupTool: ${toolName}.`, details: { ok: false, reason: "unsupported_readonly" } };
}

function runPolicyFollowup(ctx: ExtensionContext, currentLoop: string | null, args: Record<string, unknown>): FollowupOutput {
	const loopName = stringArg(args, "loopName") ?? currentLoop;
	if (!loopName) return { name: "stardock_policy", args, content: "No active Stardock loop.", details: { ok: false } };
	const state = loadState(ctx, loopName);
	if (!state) return { name: "stardock_policy", args, content: `Loop "${loopName}" not found.`, details: { loopName, ok: false } };
	const action = stringArg(args, "action") ?? "completion";
	if (action === "auditor") return { name: "stardock_policy", args, content: formatAuditorPolicy(state), details: { loopName, policy: evaluateAuditorPolicy(state) } };
	if (action === "breakout") return { name: "stardock_policy", args, content: formatBreakoutPolicy(state), details: { loopName, policy: evaluateBreakoutPolicy(state) } };
	if (action === "parentReview") return { name: "stardock_policy", args, content: formatParentReviewPolicy(state), details: { loopName, policy: evaluateParentReviewPolicy(state) } };
	if (action === "auditorGate") return { name: "stardock_policy", args, content: formatAuditorGatePolicy(state), details: { loopName, policy: evaluateAuditorGatePolicy(state) } };
	return { name: "stardock_policy", args, content: formatCompletionPolicy(state), details: { loopName, policy: evaluateCompletionPolicy(state) } };
}

export function runFollowupTool(ctx: ExtensionContext, currentLoop: string | null, request: FollowupToolRequest | undefined, stack: string[] = []): FollowupOutput | undefined {
	if (!request) return undefined;
	const args = request.args ?? {};
	if (stack.includes(request.name)) return cyclicFollowup(request.name, args, stack);
	if (followupEffect(request.name, args) !== "read") return unsupportedFollowup(request.name, args);
	if (request.name === "stardock_state") return runStateFollowup(ctx, currentLoop, args);
	if (request.name === "stardock_policy") return runPolicyFollowup(ctx, currentLoop, args);
	return runListFollowup(ctx, currentLoop, args, request.name);
}

export function withFollowupTool<T extends StardockTextResult>(result: T, ctx: ExtensionContext, currentLoop: string | null, request: FollowupToolRequest | undefined, stack: string[] = []): T {
	return attachFollowup(result, request, runFollowupTool(ctx, currentLoop, request, stack));
}
