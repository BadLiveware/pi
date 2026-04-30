/**
 * Read-only Stardock governance policy recommendations.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { type Criterion, type LoopState, compactText, loadState } from "./state.ts";
import { formatCriterionCounts } from "./ledger.ts";

export interface PolicyToolDeps {
	getCurrentLoop(): string | null;
}

export type PolicySeverity = "info" | "recommend" | "warning" | "blocker";

export interface PolicyFinding {
	id: string;
	severity: PolicySeverity;
	recommendation: "final_report" | "auditor_review" | "breakout_package" | "ready";
	rationale: string;
	criterionIds: string[];
	artifactIds: string[];
	finalReportIds: string[];
	auditorReviewIds: string[];
	breakoutPackageIds: string[];
	suggestedTool?: string;
}

export interface CompletionPolicyResult {
	loopName: string;
	ready: boolean;
	status: "ready" | "needs_evidence" | "needs_review" | "needs_decision";
	summary: string;
	findings: PolicyFinding[];
}

function criteriaByStatus(state: LoopState, statuses: Set<Criterion["status"]>): Criterion[] {
	return state.criterionLedger.criteria.filter((criterion) => statuses.has(criterion.status));
}

function allArtifactIds(state: LoopState): string[] {
	return state.verificationArtifacts.map((artifact) => artifact.id);
}

function latestFinalReportIds(state: LoopState): string[] {
	return state.finalVerificationReports.slice(-3).map((report) => report.id);
}

function latestAuditorReviewIds(state: LoopState): string[] {
	return state.auditorReviews.slice(-3).map((review) => review.id);
}

function latestBreakoutPackageIds(state: LoopState): string[] {
	return state.breakoutPackages.slice(-3).map((breakout) => breakout.id);
}

function finding(input: Omit<PolicyFinding, "criterionIds" | "artifactIds" | "finalReportIds" | "auditorReviewIds" | "breakoutPackageIds"> & Partial<Pick<PolicyFinding, "criterionIds" | "artifactIds" | "finalReportIds" | "auditorReviewIds" | "breakoutPackageIds">>): PolicyFinding {
	return {
		criterionIds: [],
		artifactIds: [],
		finalReportIds: [],
		auditorReviewIds: [],
		breakoutPackageIds: [],
		...input,
	};
}

export function evaluateCompletionPolicy(state: LoopState): CompletionPolicyResult {
	const findings: PolicyFinding[] = [];
	const unresolved = criteriaByStatus(state, new Set(["pending", "failed", "blocked"]));
	const skipped = criteriaByStatus(state, new Set(["skipped"]));
	const passed = criteriaByStatus(state, new Set(["passed"]));
	const hasCriteria = state.criterionLedger.criteria.length > 0;
	const hasArtifacts = state.verificationArtifacts.length > 0;
	const passingFinalReports = state.finalVerificationReports.filter((report) => report.status === "passed");
	const incompleteFinalReports = state.finalVerificationReports.filter((report) => ["draft", "partial", "failed"].includes(report.status));
	const reportsWithGaps = state.finalVerificationReports.filter((report) => report.unresolvedGaps.length > 0 || report.validation.some((record) => record.result !== "passed"));
	const concernedAudits = state.auditorReviews.filter((review) => review.status === "concerns" || review.status === "blocked" || review.requiredFollowups.length > 0);
	const openBreakouts = state.breakoutPackages.filter((breakout) => breakout.status === "open" || breakout.status === "draft");

	if (!hasCriteria) {
		findings.push(
			finding({
				id: "no-criteria",
				severity: "recommend",
				recommendation: "final_report",
				rationale: "No criterion ledger entries exist, so completion readiness lacks explicit acceptance criteria.",
				suggestedTool: "stardock_ledger",
			}),
		);
	}

	if ((hasCriteria || hasArtifacts || passed.length > 0) && passingFinalReports.length === 0) {
		findings.push(
			finding({
				id: "missing-final-report",
				severity: "recommend",
				recommendation: "final_report",
				rationale: "Criteria or verification artifacts exist but no passed final verification report summarizes completion evidence.",
				criterionIds: state.criterionLedger.criteria.map((criterion) => criterion.id),
				artifactIds: allArtifactIds(state),
				finalReportIds: latestFinalReportIds(state),
				suggestedTool: "stardock_final_report",
			}),
		);
	}

	if (incompleteFinalReports.length > 0) {
		findings.push(
			finding({
				id: "incomplete-final-report",
				severity: "recommend",
				recommendation: "final_report",
				rationale: "At least one final verification report is draft, partial, or failed; update or supersede it before claiming completion.",
				finalReportIds: incompleteFinalReports.map((report) => report.id),
				suggestedTool: "stardock_final_report",
			}),
		);
	}

	if (unresolved.length > 0) {
		findings.push(
			finding({
				id: "unresolved-criteria",
				severity: unresolved.some((criterion) => criterion.status === "failed" || criterion.status === "blocked") ? "warning" : "recommend",
				recommendation: "breakout_package",
				rationale: "Some criteria are still pending, failed, or blocked; completion should either resolve them or package the decision/gap explicitly.",
				criterionIds: unresolved.map((criterion) => criterion.id),
				breakoutPackageIds: latestBreakoutPackageIds(state),
				suggestedTool: "stardock_breakout",
			}),
		);
	}

	if (skipped.length > 0 || reportsWithGaps.length > 0 || concernedAudits.length > 0) {
		findings.push(
			finding({
				id: "needs-auditor-review",
				severity: concernedAudits.some((review) => review.status === "blocked") ? "blocker" : "recommend",
				recommendation: "auditor_review",
				rationale: "Skipped evidence, unresolved final-report gaps, or auditor concerns should receive explicit oversight before substantial completion.",
				criterionIds: skipped.map((criterion) => criterion.id),
				finalReportIds: reportsWithGaps.map((report) => report.id),
				auditorReviewIds: concernedAudits.map((review) => review.id),
				suggestedTool: "stardock_auditor",
			}),
		);
	}

	if (openBreakouts.length > 0) {
		findings.push(
			finding({
				id: "open-breakout-package",
				severity: "warning",
				recommendation: "breakout_package",
				rationale: "Open breakout packages indicate unresolved decisions or resume criteria that should be resolved or explicitly accepted before completion.",
				breakoutPackageIds: openBreakouts.map((breakout) => breakout.id),
				suggestedTool: "stardock_breakout",
			}),
		);
	}

	if (findings.length === 0) {
		findings.push(
			finding({
				id: "completion-ready",
				severity: "info",
				recommendation: "ready",
				rationale: "No obvious missing criteria, final-report, auditor-review, or breakout-package recommendation was detected. This is advisory and does not replace judgment.",
				criterionIds: state.criterionLedger.criteria.map((criterion) => criterion.id),
				artifactIds: allArtifactIds(state),
				finalReportIds: latestFinalReportIds(state),
				auditorReviewIds: latestAuditorReviewIds(state),
			}),
		);
	}

	const ready = findings.every((item) => item.recommendation === "ready");
	let status: CompletionPolicyResult["status"] = "ready";
	if (findings.some((item) => item.recommendation === "breakout_package")) status = "needs_decision";
	else if (findings.some((item) => item.recommendation === "auditor_review")) status = "needs_review";
	else if (!ready) status = "needs_evidence";
	return {
		loopName: state.name,
		ready,
		status,
		summary: ready ? "Completion policy found no obvious readiness gaps." : "Completion policy recommends additional evidence, review, or decision packaging before claiming substantial completion.",
		findings,
	};
}

function formatFinding(finding: PolicyFinding): string[] {
	const lines = [`- ${finding.id} [${finding.severity}/${finding.recommendation}] ${compactText(finding.rationale, 220)}`];
	if (finding.suggestedTool) lines.push(`  Suggested tool: ${finding.suggestedTool}`);
	const refs = [
		finding.criterionIds.length ? `criteria=${finding.criterionIds.join(",")}` : "",
		finding.artifactIds.length ? `artifacts=${finding.artifactIds.join(",")}` : "",
		finding.finalReportIds.length ? `finalReports=${finding.finalReportIds.join(",")}` : "",
		finding.auditorReviewIds.length ? `auditorReviews=${finding.auditorReviewIds.join(",")}` : "",
		finding.breakoutPackageIds.length ? `breakoutPackages=${finding.breakoutPackageIds.join(",")}` : "",
	].filter(Boolean);
	if (refs.length) lines.push(`  Refs: ${refs.join("; ")}`);
	return lines;
}

export function formatCompletionPolicy(state: LoopState): string {
	const result = evaluateCompletionPolicy(state);
	const lines = [
		`Completion policy for ${state.name}`,
		`Ready: ${result.ready ? "yes" : "no"}`,
		`Status: ${result.status}`,
		formatCriterionCounts(state.criterionLedger),
		`Artifacts: ${state.verificationArtifacts.length}`,
		`Final reports: ${state.finalVerificationReports.length}`,
		`Auditor reviews: ${state.auditorReviews.length}`,
		`Breakout packages: ${state.breakoutPackages.length}`,
		"",
		result.summary,
		"",
		"Findings",
		...result.findings.flatMap(formatFinding),
		"",
		"Policy note: recommendations are advisory. Stardock does not block completion, call models, spawn agents, run providers/processes, or apply edits from this policy surface.",
	];
	return lines.join("\n");
}

export function registerPolicyTool(pi: ExtensionAPI, deps: PolicyToolDeps): void {
	pi.registerTool({
		name: "stardock_policy",
		label: "Inspect Stardock Governance Policy",
		description: "Read-only governance policy recommendations for Stardock loops. V1 supports completion readiness checks without enforcing gates.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("completion")], { description: "completion returns recommendation-only readiness findings." }),
			loopName: Type.Optional(Type.String({ description: "Loop name. Defaults to the active loop." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const loopName = params.loopName ?? deps.getCurrentLoop();
			if (!loopName) return { content: [{ type: "text", text: "No active Stardock loop." }], details: {} };
			const state = loadState(ctx, loopName);
			if (!state) return { content: [{ type: "text", text: `Loop "${loopName}" not found.` }], details: { loopName } };
			const result = evaluateCompletionPolicy(state);
			return { content: [{ type: "text", text: formatCompletionPolicy(state) }], details: { loopName, policy: result } };
		},
	});
}
