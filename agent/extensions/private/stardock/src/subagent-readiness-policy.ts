/** Read-only Stardock policy checks that prepare for provider/subagent adapters. */

import { formatCriterionCounts } from "./ledger.ts";
import { compactText, type Criterion, type LoopState } from "./state/core.ts";
import type { PolicyFinding, PolicySeverity } from "./policy.ts";

export interface ParentReviewPolicyResult {
	loopName: string;
	recommended: boolean;
	status: "no_parent_review_needed" | "parent_review_recommended" | "parent_review_required";
	summary: string;
	findings: PolicyFinding[];
}

export interface AuditorGatePolicyResult {
	loopName: string;
	recommended: boolean;
	status: "no_gate_needed" | "gate_review_recommended" | "gate_review_required";
	summary: string;
	findings: PolicyFinding[];
}

function criteriaByStatus(state: LoopState, statuses: Set<Criterion["status"]>): Criterion[] {
	return state.criterionLedger.criteria.filter((criterion) => statuses.has(criterion.status));
}

function finding(input: Omit<PolicyFinding, "criterionIds" | "artifactIds" | "finalReportIds" | "auditorReviewIds" | "breakoutPackageIds" | "workerReportIds" | "advisoryHandoffIds" | "attemptIds" | "outsideRequestIds"> & Partial<Pick<PolicyFinding, "criterionIds" | "artifactIds" | "finalReportIds" | "auditorReviewIds" | "breakoutPackageIds" | "workerReportIds" | "advisoryHandoffIds" | "attemptIds" | "outsideRequestIds">>): PolicyFinding {
	return {
		criterionIds: [],
		artifactIds: [],
		finalReportIds: [],
		auditorReviewIds: [],
		breakoutPackageIds: [],
		workerReportIds: [],
		advisoryHandoffIds: [],
		attemptIds: [],
		outsideRequestIds: [],
		...input,
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
		finding.workerReportIds.length ? `workerReports=${finding.workerReportIds.join(",")}` : "",
		finding.advisoryHandoffIds.length ? `advisoryHandoffs=${finding.advisoryHandoffIds.join(",")}` : "",
		finding.attemptIds.length ? `attempts=${finding.attemptIds.join(",")}` : "",
		finding.outsideRequestIds.length ? `outsideRequests=${finding.outsideRequestIds.join(",")}` : "",
	].filter(Boolean);
	if (refs.length) lines.push(`  Refs: ${refs.join("; ")}`);
	return lines;
}

function formatPolicyHeader(state: LoopState): string[] {
	return [formatCriterionCounts(state.criterionLedger), `Artifacts: ${state.verificationArtifacts.length}`, `Baseline validations: ${state.baselineValidations.length}`, `Final reports: ${state.finalVerificationReports.length}`, `Auditor reviews: ${state.auditorReviews.length}`, `Breakout packages: ${state.breakoutPackages.length}`, `Worker reports: ${state.workerReports.length}`];
}

function statusFrom(findings: PolicyFinding[], soft: string, hard: string, none: string): string {
	if (findings.some((item) => item.severity === "blocker" || item.severity === "warning")) return hard;
	if (findings.some((item) => item.recommendation !== "ready")) return soft;
	return none;
}

export function evaluateParentReviewPolicy(state: LoopState): ParentReviewPolicyResult {
	const findings: PolicyFinding[] = [];
	const riskyReports = state.workerReports.filter((report) => report.status === "needs_review" || report.risks.length > 0 || report.openQuestions.length > 0 || report.reviewHints.length > 0 || report.validation.some((record) => record.result !== "passed"));
	const changedReports = state.workerReports.filter((report) => report.changedFiles.length > 0);
	const implementerHandoffs = state.advisoryHandoffs.filter((handoff) => handoff.role === "implementer" && (handoff.status === "answered" || handoff.status === "requested"));
	if (riskyReports.length > 0) findings.push(finding({ id: "risky-worker-parent-review", severity: riskyReports.some((report) => report.validation.some((record) => record.result === "failed")) ? "blocker" : "warning", recommendation: "parent_review", rationale: "WorkerReports with risks, open questions, review hints, or non-passing validation require parent/governor review before relying on the worker output.", workerReportIds: riskyReports.map((report) => report.id), artifactIds: riskyReports.flatMap((report) => report.artifactIds), suggestedTool: "stardock_worker_report" }));
	if (changedReports.length > 0) findings.push(finding({ id: "changed-file-parent-review", severity: "recommend" as PolicySeverity, recommendation: "parent_review", rationale: "WorkerReports that name changed files should drive selective file inspection for risky, ambiguous, failed-validation, public-contract, or explicitly hinted areas rather than a blind reread of every file.", workerReportIds: changedReports.map((report) => report.id) }));
	if (implementerHandoffs.length > 0) findings.push(finding({ id: "implementer-handoff-parent-review", severity: "warning", recommendation: "parent_review", rationale: "Implementer handoffs cross the edit-ownership boundary; parent/governor review should inspect the returned evidence and any touched files before accepting the result.", advisoryHandoffIds: implementerHandoffs.map((handoff) => handoff.id), suggestedTool: "stardock_handoff" }));
	if (findings.length === 0) findings.push(finding({ id: "no-parent-review-trigger", severity: "info", recommendation: "ready", rationale: "No worker or handoff evidence currently requires selective parent review. This does not replace judgment for high-risk changes." }));
	const recommended = findings.some((item) => item.recommendation === "parent_review");
	const status = statusFrom(findings, "parent_review_recommended", "parent_review_required", "no_parent_review_needed") as ParentReviewPolicyResult["status"];
	return { loopName: state.name, recommended, status, summary: recommended ? "Parent review policy recommends selective inspection before relying on worker or handoff output." : "Parent review policy found no obvious selective-review trigger.", findings };
}

export function evaluateAuditorGatePolicy(state: LoopState): AuditorGatePolicyResult {
	const findings: PolicyFinding[] = [];
	const blockingAudits = state.auditorReviews.filter((review) => review.status === "blocked" || review.requiredFollowups.length > 0);
	const implementerHandoffs = state.advisoryHandoffs.filter((handoff) => handoff.role === "implementer" && (handoff.status === "answered" || handoff.status === "requested"));
	const openBreakouts = state.breakoutPackages.filter((breakout) => breakout.status === "open" || breakout.status === "draft");
	const unresolvedCriteria = criteriaByStatus(state, new Set(["failed", "blocked", "skipped"]));
	if (blockingAudits.length > 0) findings.push(finding({ id: "auditor-blocker-followup", severity: "blocker", recommendation: "gate_decision", rationale: "Blocking auditor reviews or required follow-ups must be complied with, explicitly rejected with rationale, or escalated to the user before gated moves continue.", auditorReviewIds: blockingAudits.map((review) => review.id), suggestedTool: "stardock_auditor" }));
	if (implementerHandoffs.length > 0) findings.push(finding({ id: "editing-subagent-gate", severity: "warning", recommendation: "gate_decision", rationale: "Implementer handoffs are an automation gate; require auditor review or explicit user approval before treating provider-produced edits as accepted.", advisoryHandoffIds: implementerHandoffs.map((handoff) => handoff.id), suggestedTool: "stardock_auditor" }));
	if (openBreakouts.length > 0 || unresolvedCriteria.length > 0) findings.push(finding({ id: "unresolved-completion-gate", severity: "warning", recommendation: "gate_decision", rationale: "Open breakout packages or unresolved criteria require an explicit decision before relaxing scope, applying automation, or completing with gaps.", breakoutPackageIds: openBreakouts.map((breakout) => breakout.id), criterionIds: unresolvedCriteria.map((criterion) => criterion.id), suggestedTool: "stardock_breakout" }));
	if (state.modeState.kind === "evolve") findings.push(finding({ id: "evolve-execution-gate", severity: "warning", recommendation: "gate_decision", rationale: "Evolve execution requires evaluator bounds, candidate isolation, artifact handling, and auditor/user approval before running candidate search or applying patches.", suggestedTool: "stardock_auditor" }));
	if (findings.length === 0) findings.push(finding({ id: "no-auditor-gate-trigger", severity: "info", recommendation: "ready", rationale: "No obvious auditor gate is currently active. Direct provider execution still requires a separate approved adapter design." }));
	const recommended = findings.some((item) => item.recommendation === "gate_decision");
	const status = statusFrom(findings, "gate_review_recommended", "gate_review_required", "no_gate_needed") as AuditorGatePolicyResult["status"];
	return { loopName: state.name, recommended, status, summary: recommended ? "Auditor gate policy requires an explicit decision before high-risk automation or completion moves." : "Auditor gate policy found no active gate trigger.", findings };
}

export function formatParentReviewPolicy(state: LoopState): string {
	const result = evaluateParentReviewPolicy(state);
	return [`Parent review policy for ${state.name}`, `Recommended: ${result.recommended ? "yes" : "no"}`, `Status: ${result.status}`, ...formatPolicyHeader(state), "", result.summary, "", "Findings", ...result.findings.flatMap(formatFinding), "", "Policy note: recommendations are advisory. Stardock does not inspect files, accept worker output, call models, spawn agents, run providers/processes, or apply edits from this policy surface."].join("\n");
}

export function formatAuditorGatePolicy(state: LoopState): string {
	const result = evaluateAuditorGatePolicy(state);
	return [`Auditor gate policy for ${state.name}`, `Recommended: ${result.recommended ? "yes" : "no"}`, `Status: ${result.status}`, ...formatPolicyHeader(state), "", result.summary, "", "Findings", ...result.findings.flatMap(formatFinding), "", "Policy note: recommendations are advisory. Stardock does not enforce gates, call models, spawn agents, run providers/processes, or apply edits from this policy surface."].join("\n");
}
