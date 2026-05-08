import type { Criterion, FinalVerificationReport, LoopState } from "./state/core.ts";
import type { CompletionPolicyResult, PolicyFinding } from "./policy.ts";

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

function reportHasFailedValidation(report: FinalVerificationReport): boolean {
	return report.validation.some((record) => record.result === "failed");
}

function passedAuditorCoversReport(state: LoopState, reportId: string): boolean {
	return state.auditorReviews.some((review) => review.status === "passed" && review.finalReportIds.includes(reportId) && review.requiredFollowups.length === 0);
}

function passedAuditorCoversCriterion(state: LoopState, criterionId: string): boolean {
	return state.auditorReviews.some((review) => review.status === "passed" && review.criterionIds.includes(criterionId) && review.requiredFollowups.length === 0);
}

function passedReportCoversCriterion(state: LoopState, criterionId: string): FinalVerificationReport | undefined {
	return state.finalVerificationReports.find((report) => report.status === "passed" && report.criterionIds.includes(criterionId));
}

function reportNeedsAuditorReview(state: LoopState, report: FinalVerificationReport): boolean {
	if (!report.unresolvedGaps.length && !report.validation.some((record) => record.result !== "passed")) return false;
	if (reportHasFailedValidation(report)) return true;
	return !passedAuditorCoversReport(state, report.id);
}

function acceptedDeferredCriterion(state: LoopState, criterion: Criterion): boolean {
	if (criterion.status !== "blocked" && criterion.status !== "skipped") return false;
	const resolvedBreakout = state.breakoutPackages.find((breakout) =>
		(breakout.status === "resolved" || breakout.status === "dismissed") &&
		breakout.blockedCriterionIds.includes(criterion.id) &&
		(Boolean(breakout.requestedDecision?.trim()) || breakout.recommendedNextActions.length > 0)
	);
	if (!resolvedBreakout) return false;
	const report = passedReportCoversCriterion(state, criterion.id);
	const reportCovered = Boolean(report && !reportHasFailedValidation(report));
	const auditorCovered = passedAuditorCoversCriterion(state, criterion.id) || Boolean(report && passedAuditorCoversReport(state, report.id));
	return reportCovered || auditorCovered;
}

function acceptedReportStatusForDeferredWork(state: LoopState, report: FinalVerificationReport, acceptedCriterionIds: Set<string>): boolean {
	if (report.status !== "blocked" && report.status !== "skipped") return false;
	if (reportHasFailedValidation(report)) return false;
	if (report.criterionIds.length === 0 || !report.criterionIds.every((id) => acceptedCriterionIds.has(id))) return false;
	return passedAuditorCoversReport(state, report.id) || report.criterionIds.some((id) => passedAuditorCoversCriterion(state, id));
}

function artifactRequiresFinalReport(state: LoopState, acceptedCriterionIds: Set<string>): boolean {
	return state.verificationArtifacts.some((artifact) => !artifact.criterionIds?.length || artifact.criterionIds.some((criterionId) => !acceptedCriterionIds.has(criterionId)));
}

export function evaluateCompletionPolicy(state: LoopState): CompletionPolicyResult {
	const findings: PolicyFinding[] = [];
	const acceptedDeferred = state.criterionLedger.criteria.filter((criterion) => acceptedDeferredCriterion(state, criterion));
	const acceptedDeferredIds = new Set(acceptedDeferred.map((criterion) => criterion.id));
	const unresolved = criteriaByStatus(state, new Set(["pending", "failed", "blocked"])).filter((criterion) => !acceptedDeferredIds.has(criterion.id));
	const skipped = criteriaByStatus(state, new Set(["skipped"])).filter((criterion) => !acceptedDeferredIds.has(criterion.id));
	const passed = criteriaByStatus(state, new Set(["passed"]));
	const hasCriteria = state.criterionLedger.criteria.length > 0;
	const hasArtifacts = state.verificationArtifacts.length > 0;
	const passingFinalReports = state.finalVerificationReports.filter((report) => report.status === "passed");
	const incompleteFinalReports = state.finalVerificationReports.filter((report) => ["draft", "partial", "failed"].includes(report.status) || acceptedReportStatusForDeferredWork(state, report, acceptedDeferredIds) === false && ["blocked", "skipped"].includes(report.status));
	const reportsWithGaps = state.finalVerificationReports.filter((report) => reportNeedsAuditorReview(state, report));
	const concernedAudits = state.auditorReviews.filter((review) => review.status === "concerns" || review.status === "blocked" || review.requiredFollowups.length > 0);
	const openBreakouts = state.breakoutPackages.filter((breakout) => breakout.status === "open" || breakout.status === "draft");
	const criteriaNeedingFinalReport = state.criterionLedger.criteria.filter((criterion) => !acceptedDeferredIds.has(criterion.id));

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

	if ((criteriaNeedingFinalReport.length > 0 || artifactRequiresFinalReport(state, acceptedDeferredIds) || passed.length > 0) && passingFinalReports.length === 0) {
		findings.push(
			finding({
				id: "missing-final-report",
				severity: "recommend",
				recommendation: "final_report",
				rationale: "Criteria or verification artifacts exist but no passed final verification report summarizes completion evidence.",
				criterionIds: criteriaNeedingFinalReport.map((criterion) => criterion.id),
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
				rationale: "At least one final verification report is draft, partial, failed, blocked, or skipped without accepted-deferral coverage; update or supersede it before claiming completion.",
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

	if (acceptedDeferred.length > 0) {
		findings.push(
			finding({
				id: "accepted-deferred-criteria",
				severity: "info",
				recommendation: "ready",
				rationale: "Some blocked or skipped criteria are explicitly accepted as deferred work with resolved decision packaging and final/auditor evidence.",
				criterionIds: acceptedDeferred.map((criterion) => criterion.id),
				breakoutPackageIds: state.breakoutPackages.filter((breakout) => (breakout.status === "resolved" || breakout.status === "dismissed") && breakout.blockedCriterionIds.some((id) => acceptedDeferredIds.has(id))).map((breakout) => breakout.id),
				finalReportIds: state.finalVerificationReports.filter((report) => report.criterionIds.some((id) => acceptedDeferredIds.has(id))).map((report) => report.id),
				auditorReviewIds: state.auditorReviews.filter((review) => review.criterionIds.some((id) => acceptedDeferredIds.has(id)) || review.finalReportIds.some((reportId) => state.finalVerificationReports.find((report) => report.id === reportId)?.criterionIds.some((id) => acceptedDeferredIds.has(id)))).map((review) => review.id),
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
	let status: CompletionPolicyResult["status"] = ready && acceptedDeferred.length > 0 ? "ready_with_accepted_gaps" : "ready";
	if (findings.some((item) => item.recommendation === "breakout_package")) status = "needs_decision";
	else if (findings.some((item) => item.recommendation === "auditor_review")) status = "needs_review";
	else if (!ready) status = "needs_evidence";
	return {
		loopName: state.name,
		ready,
		status,
		summary: ready
			? acceptedDeferred.length > 0
				? `Completion policy found no unsatisfied readiness gaps. Accepted deferred criteria: ${acceptedDeferred.map((criterion) => criterion.id).join(", ")}.`
				: "Completion policy found no obvious readiness gaps."
			: "Completion policy recommends additional evidence, review, or decision packaging before claiming substantial completion.",
		findings,
	};
}
