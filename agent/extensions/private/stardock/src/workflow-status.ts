/** Derived Stardock workflow status.
 *
 * This is a read-only interpretation of existing loop facts. It is not stored
 * as source of truth; tools and prompts should mutate criteria, reports,
 * reviews, and packages instead.
 */

import { evaluateCompletionPolicy } from "./completion-policy.ts";
import { criterionCounts } from "./ledger.ts";
import { evaluateBreakoutPolicy } from "./policy.ts";
import { evaluateAuditorGatePolicy, evaluateParentReviewPolicy } from "./subagent-readiness-policy.ts";
import { compactText, type LoopState } from "./state/core.ts";

export type WorkflowState = "ready_for_work" | "active_work" | "needs_parent_review" | "needs_auditor_review" | "needs_breakout_decision" | "ready_for_final_verification" | "blocked" | "completed";
export type WorkflowSeverity = "info" | "action" | "warning" | "blocked";

export interface WorkflowAction {
	label: string;
	tool?: string;
	args?: Record<string, unknown>;
	command?: string;
}

export interface WorkflowStatus {
	state: WorkflowState;
	severity: WorkflowSeverity;
	summary: string;
	reasons: string[];
	recommendedActions: WorkflowAction[];
}

function compactReasons(reasons: string[], maxItems = 4): string[] {
	const compacted = reasons.map((reason) => compactText(reason, 220) ?? reason).filter(Boolean);
	if (compacted.length <= maxItems) return compacted;
	return [...compacted.slice(0, maxItems), `... ${compacted.length - maxItems} more`];
}

function action(label: string, tool: string, args: Record<string, unknown> = {}): WorkflowAction {
	return { label, tool, args };
}

function blockingAuditorReasons(state: LoopState): string[] {
	return state.auditorReviews
		.filter((review) => review.status === "blocked" || review.requiredFollowups.length > 0)
		.map((review) => `Auditor review ${review.id} requires follow-up before gated moves continue.`);
}

function openBreakoutReasons(state: LoopState): string[] {
	return state.breakoutPackages
		.filter((pkg) => pkg.status === "open" || pkg.status === "draft")
		.map((pkg) => `Breakout package ${pkg.id} is ${pkg.status} and needs a decision.`);
}

export function evaluateWorkflowStatus(state: LoopState): WorkflowStatus {
	if (state.status === "completed") {
		return { state: "completed", severity: "info", summary: `Loop ${state.name} is completed.`, reasons: [], recommendedActions: [] };
	}
	if (state.status === "paused") {
		return { state: "blocked", severity: "blocked", summary: `Loop ${state.name} is paused.`, reasons: ["The loop is paused and will not queue more work until resumed."], recommendedActions: [{ label: "Resume loop", command: `/stardock resume ${state.name}` }] };
	}

	const auditorBlockers = blockingAuditorReasons(state);
	if (auditorBlockers.length) {
		return {
			state: "needs_auditor_review",
			severity: "blocked",
			summary: "Auditor follow-up blocks gated workflow progress.",
			reasons: compactReasons(auditorBlockers),
			recommendedActions: [action("Inspect auditor gate policy", "stardock_policy", { action: "auditorGate", loopName: state.name }), action("Record or update auditor review", "stardock_auditor", { action: "payload", loopName: state.name })],
		};
	}

	const breakout = evaluateBreakoutPolicy(state);
	const openBreakouts = openBreakoutReasons(state);
	if (breakout.recommended || openBreakouts.length) {
		return {
			state: "needs_breakout_decision",
			severity: breakout.status === "breakout_strongly_recommended" || openBreakouts.length ? "warning" : "action",
			summary: breakout.recommended ? breakout.summary : "Open breakout packages need a decision before the loop continues as if unblocked.",
			reasons: compactReasons([...openBreakouts, ...breakout.findings.filter((finding) => finding.recommendation === "breakout_package").map((finding) => finding.rationale)]),
			recommendedActions: [action("Inspect breakout policy", "stardock_policy", { action: "breakout", loopName: state.name }), action("Build breakout package", "stardock_breakout", { action: "payload", loopName: state.name })],
		};
	}

	const auditorGate = evaluateAuditorGatePolicy(state);
	if (auditorGate.recommended) {
		return {
			state: "needs_auditor_review",
			severity: auditorGate.status === "gate_review_required" ? "warning" : "action",
			summary: auditorGate.summary,
			reasons: compactReasons(auditorGate.findings.filter((finding) => finding.recommendation === "gate_decision").map((finding) => finding.rationale)),
			recommendedActions: [action("Inspect auditor gate policy", "stardock_policy", { action: "auditorGate", loopName: state.name }), action("Build auditor review payload", "stardock_auditor", { action: "payload", loopName: state.name })],
		};
	}

	const parentReview = evaluateParentReviewPolicy(state);
	if (parentReview.recommended) {
		return {
			state: "needs_parent_review",
			severity: parentReview.status === "parent_review_required" ? "blocked" : "action",
			summary: parentReview.summary,
			reasons: compactReasons(parentReview.findings.filter((finding) => finding.recommendation === "parent_review").map((finding) => finding.rationale)),
			recommendedActions: [action("Inspect parent review policy", "stardock_policy", { action: "parentReview", loopName: state.name })],
		};
	}

	const completion = evaluateCompletionPolicy(state);
	const missingFinalReport = completion.findings.find((finding) => finding.id === "missing-final-report");
	if (missingFinalReport && state.criterionLedger.criteria.length > 0 && criterionCounts(state.criterionLedger).pending === 0 && criterionCounts(state.criterionLedger).failed === 0 && criterionCounts(state.criterionLedger).blocked === 0) {
		return {
			state: "ready_for_final_verification",
			severity: "action",
			summary: "Criteria are resolved and final verification evidence should be summarized before completion.",
			reasons: compactReasons([missingFinalReport.rationale]),
			recommendedActions: [action("Record final verification report", "stardock_final_report", { action: "record", loopName: state.name }), action("Inspect completion policy", "stardock_policy", { action: "completion", loopName: state.name })],
		};
	}

	if (state.currentBriefId) {
		return {
			state: "active_work",
			severity: "info",
			summary: `Active brief ${state.currentBriefId} scopes the next work item.`,
			reasons: [],
			recommendedActions: [action("Inspect current Stardock state", "stardock_state", { loopName: state.name, view: "overview" })],
		};
	}

	return {
		state: "ready_for_work",
		severity: "info",
		summary: "No workflow gate is currently active.",
		reasons: [],
		recommendedActions: [action("Create or activate an iteration brief", "stardock_brief", { action: "upsert", loopName: state.name, activate: true })],
	};
}

export function formatWorkflowStatus(status: WorkflowStatus): string {
	const lines = [`Workflow: ${status.state} [${status.severity}]`, status.summary];
	if (status.reasons.length) lines.push("Reasons", ...status.reasons.map((reason) => `- ${reason}`));
	if (status.recommendedActions.length) {
		lines.push("Recommended actions");
		for (const recommended of status.recommendedActions.slice(0, 4)) {
			const target = recommended.tool ? `${recommended.tool}${recommended.args ? ` ${JSON.stringify(recommended.args)}` : ""}` : recommended.command ?? "";
			lines.push(`- ${recommended.label}${target ? `: ${target}` : ""}`);
		}
	}
	return lines.join("\n");
}
