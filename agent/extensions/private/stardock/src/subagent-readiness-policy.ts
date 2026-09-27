/** Read-only Stardock policy checks that prepare for provider/subagent adapters. */

import { formatCriterionCounts } from "./ledger.ts";
import { compactText, type Criterion, type LoopState } from "./state/core.ts";
import type { PolicyFinding, PolicySeverity } from "./policy.ts";

export interface GovernorDecisionPolicyResult {
	loopName: string;
	recommended: boolean;
	status: "no_governor_decision_needed" | "governor_decision_recommended" | "governor_decision_required";
	summary: string;
	findings: PolicyFinding[];
}

export interface GovernorRiskPolicyResult {
	loopName: string;
	recommended: boolean;
	status: "no_governor_risk_decision_needed" | "governor_risk_decision_recommended" | "governor_risk_decision_required";
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
	return [formatCriterionCounts(state.criterionLedger), `Artifacts: ${state.verificationArtifacts.length}`, `Baseline validations: ${state.baselineValidations.length}`, `Final reports: ${state.finalVerificationReports.length}`, `Auditor reviews: ${state.auditorReviews.length}`, `Breakout packages: ${state.breakoutPackages.length}`, `Worker reports: ${state.workerReports.length}`, `Worker runs: ${state.workerRuns.length}`];
}

function statusFrom(findings: PolicyFinding[], soft: string, hard: string, none: string): string {
	if (findings.some((item) => item.severity === "blocker" || item.severity === "warning")) return hard;
	if (findings.some((item) => item.recommendation !== "ready")) return soft;
	return none;
}

export function evaluateGovernorDecisionPolicy(state: LoopState): GovernorDecisionPolicyResult {
	const findings: PolicyFinding[] = [];
	const riskyReports = state.workerReports.filter((report) => report.status === "needs_review" || report.risks.length > 0 || report.openQuestions.length > 0 || report.reviewHints.length > 0 || report.validation.some((record) => record.result !== "passed"));
	const changedReports = state.workerReports.filter((report) => report.changedFiles.length > 0);
	const implementerHandoffs = state.advisoryHandoffs.filter((handoff) => handoff.role === "implementer" && (handoff.status === "answered" || handoff.status === "requested"));
	const openImplementerRuns = state.workerRuns.filter((run) => run.role === "implementer" && (run.status === "running" || run.status === "needs_review"));
	if (openImplementerRuns.length > 0) findings.push(finding({ id: "implementer-worker-run-decision", severity: "warning", recommendation: "governor_decision", rationale: `Implementer WorkerRun(s) ${openImplementerRuns.map((run) => `${run.id}:${run.status}`).join(", ")} await a governor accept or dismiss decision before another mutable worker starts; they do not veto loop completion.`, suggestedTool: "stardock_worker" }));
	if (riskyReports.length > 0) findings.push(finding({ id: "risky-worker-governor-decision", severity: riskyReports.some((report) => report.validation.some((record) => record.result === "failed")) ? "warning" : "recommend", recommendation: "governor_decision", rationale: "WorkerReports with risks, open questions, review hints, or non-passing validation are advisory evidence for the governor to inspect before relying on the worker output.", workerReportIds: riskyReports.map((report) => report.id), artifactIds: riskyReports.flatMap((report) => report.artifactIds), suggestedTool: "stardock_worker_report" }));
	if (changedReports.length > 0) findings.push(finding({ id: "changed-file-governor-inspection", severity: "recommend" as PolicySeverity, recommendation: "governor_decision", rationale: "WorkerReports that name changed files should drive selective governor inspection for risky, ambiguous, failed-validation, public-contract, or explicitly hinted areas rather than a blind reread of every file.", workerReportIds: changedReports.map((report) => report.id) }));
	if (implementerHandoffs.length > 0) findings.push(finding({ id: "implementer-handoff-governor-decision", severity: "warning", recommendation: "governor_decision", rationale: "Implementer handoffs cross the edit-ownership boundary; the governor should inspect returned evidence and touched files before accepting or dismissing the result.", advisoryHandoffIds: implementerHandoffs.map((handoff) => handoff.id), suggestedTool: "stardock_handoff" }));
	if (findings.length === 0) findings.push(finding({ id: "no-governor-decision-trigger", severity: "info", recommendation: "ready", rationale: "No worker or handoff evidence currently calls for a selective governor decision. This does not replace judgment for high-risk changes." }));
	const recommended = findings.some((item) => item.recommendation === "governor_decision");
	const status = statusFrom(findings, "governor_decision_recommended", "governor_decision_required", "no_governor_decision_needed") as GovernorDecisionPolicyResult["status"];
	return { loopName: state.name, recommended, status, summary: recommended ? "Governor decision policy recommends selective evidence inspection before relying on worker or handoff output." : "Governor decision policy found no obvious decision trigger.", findings };
}

export function evaluateGovernorRiskPolicy(state: LoopState): GovernorRiskPolicyResult {
	const findings: PolicyFinding[] = [];
	const blockingAudits = state.auditorReviews.filter((review) => review.status === "blocked" || review.requiredFollowups.length > 0);
	const implementerHandoffs = state.advisoryHandoffs.filter((handoff) => handoff.role === "implementer" && (handoff.status === "answered" || handoff.status === "requested"));
	const openBreakouts = state.breakoutPackages.filter((breakout) => breakout.status === "open" || breakout.status === "draft");
	const unresolvedCriteria = criteriaByStatus(state, new Set(["failed", "blocked", "skipped"]));
	if (blockingAudits.length > 0) findings.push(finding({ id: "auditor-concern-disposition", severity: "warning", recommendation: "governor_risk_decision", rationale: "Auditor concerns and requested follow-ups are advisory evidence. The governor may comply, reject them with rationale, defer them, or complete with the warning recorded.", auditorReviewIds: blockingAudits.map((review) => review.id), suggestedTool: "stardock_auditor" }));
	if (implementerHandoffs.length > 0) findings.push(finding({ id: "editing-subagent-risk", severity: "warning", recommendation: "governor_risk_decision", rationale: "Implementer handoffs are advisory automation evidence; the governor explicitly accepts, dismisses, or defers them before treating provider-produced edits as accepted.", advisoryHandoffIds: implementerHandoffs.map((handoff) => handoff.id), suggestedTool: "stardock_handoff" }));
	if (openBreakouts.length > 0 || unresolvedCriteria.length > 0) findings.push(finding({ id: "unresolved-completion-risk", severity: "warning", recommendation: "governor_risk_decision", rationale: "Open breakout packages or unresolved criteria call for an explicit governor decision before relaxing scope, applying automation, or completing with gaps.", breakoutPackageIds: openBreakouts.map((breakout) => breakout.id), criterionIds: unresolvedCriteria.map((criterion) => criterion.id), suggestedTool: "stardock_breakout" }));
	if (state.modeState.kind === "evolve") findings.push(finding({ id: "evolve-execution-risk", severity: "warning", recommendation: "governor_risk_decision", rationale: "Evolve execution requires evaluator bounds, candidate isolation, artifact handling, and an explicit governor decision before running candidate search or applying patches.", suggestedTool: "stardock_governor_state" }));
	if (findings.length === 0) findings.push(finding({ id: "no-governor-risk-trigger", severity: "info", recommendation: "ready", rationale: "No obvious governor risk decision is currently pending. Direct provider execution still requires a separately designed adapter." }));
	const recommended = findings.some((item) => item.recommendation === "governor_risk_decision");
	const status = statusFrom(findings, "governor_risk_decision_recommended", "governor_risk_decision_required", "no_governor_risk_decision_needed") as GovernorRiskPolicyResult["status"];
	return { loopName: state.name, recommended, status, summary: recommended ? "Risk policy surfaces advisory evidence for an explicit governor decision." : "Risk policy found no active governor-decision trigger.", findings };
}

export function formatGovernorDecisionPolicy(state: LoopState): string {
	const result = evaluateGovernorDecisionPolicy(state);
	return [`Governor decision policy for ${state.name}`, `Recommended: ${result.recommended ? "yes" : "no"}`, `Status: ${result.status}`, ...formatPolicyHeader(state), "", result.summary, "", "Findings", ...result.findings.flatMap(formatFinding), "", "Policy note: findings are advisory evidence for the governor. Stardock does not inspect files, accept worker output, call models, spawn agents, run providers/processes, or apply edits from this policy surface."].join("\n");
}

export function formatGovernorRiskPolicy(state: LoopState): string {
	const result = evaluateGovernorRiskPolicy(state);
	return [`Governor risk policy for ${state.name}`, `Recommended: ${result.recommended ? "yes" : "no"}`, `Status: ${result.status}`, ...formatPolicyHeader(state), "", result.summary, "", "Findings", ...result.findings.flatMap(formatFinding), "", "Policy note: findings are advisory. Stardock does not call models, spawn agents, run providers/processes, apply edits, or override the governor from this policy surface."].join("\n");
}
