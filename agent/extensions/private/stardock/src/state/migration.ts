/**
 * Stardock state migration and normalization.
 */

import {
compactText,
DEFAULT_REFLECT_INSTRUCTIONS,
type AdvisoryHandoff,
type AdvisoryHandoffRole,
type AdvisoryHandoffStatus,
type AuditorReview,
type AuditorReviewStatus,
type BaselineValidation,
type BreakoutPackage,
type BreakoutPackageStatus,
type ChangedFileReport,
type Criterion,
type CriterionLedger,
type CriterionStatus,
type FinalValidationRecord,
type FinalVerificationReport,
type FinalVerificationStatus,
type IterationBrief,
type IterationBriefSource,
type IterationBriefStatus,
type LoopMode,
type LoopState,
type OutsideRequest,
type ValidationResult,
type VerificationArtifact,
type VerificationArtifactKind,
type WorkerReport,
type WorkerReportStatus,
type WorkerValidationRecord,
} from "./core.ts";
import { migrateModeState, numberOrDefault } from "./modes.ts";
import { defaultTaskFile } from "./paths.ts";
import { migrateWorkerRuns } from "./worker-runs-migration.ts";

export function normalizeMode(value: unknown): LoopMode {
	return value === "recursive" || value === "evolve" || value === "checklist" ? value : "checklist";
}

export function stringOrDefault(value: unknown, fallback: string): string {
	return typeof value === "string" ? value : fallback;
}

export function migrateOutsideRequests(value: unknown): OutsideRequest[] {
	return Array.isArray(value) ? (value as OutsideRequest[]) : [];
}

export function defaultCriterionLedger(): CriterionLedger {
	return { criteria: [], requirementTrace: [] };
}

export function isCriterionStatus(value: unknown): value is CriterionStatus {
	return ["pending", "passed", "failed", "skipped", "blocked"].includes(String(value));
}

export function isArtifactKind(value: unknown): value is VerificationArtifactKind {
	return ["test", "smoke", "curl", "browser", "screenshot", "walkthrough", "benchmark", "log", "url", "pr", "diff", "command", "document", "other"].includes(String(value));
}

export function normalizeStringList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const items = value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
	return [...new Set(items)];
}

export function normalizeIds(value: unknown): string[] | undefined {
	const ids = normalizeStringList(value);
	return ids.length > 0 ? ids : undefined;
}

export function normalizeId(value: unknown, fallback: string): string {
	const raw = typeof value === "string" ? value.trim() : "";
	const normalized = raw.replace(/[^a-zA-Z0-9_.:-]/g, "_").replace(/_+/g, "_");
	return normalized || fallback;
}

export function rebuildRequirementTrace(criteria: Criterion[]): CriterionLedger["requirementTrace"] {
	const byRequirement = new Map<string, Set<string>>();
	for (const criterion of criteria) {
		const requirement = criterion.requirement?.trim();
		if (!requirement) continue;
		const ids = byRequirement.get(requirement) ?? new Set<string>();
		ids.add(criterion.id);
		byRequirement.set(requirement, ids);
	}
	return [...byRequirement.entries()].map(([requirement, ids]) => ({ requirement, criterionIds: [...ids].sort() }));
}

export function migrateCriterionLedger(value: unknown): CriterionLedger {
	if (!value || typeof value !== "object") return defaultCriterionLedger();
	const raw = value as { criteria?: unknown };
	const criteria = Array.isArray(raw.criteria)
		? raw.criteria
				.map((item, index): Criterion | null => {
					if (!item || typeof item !== "object") return null;
					const criterion = item as Partial<Criterion> & Record<string, unknown>;
					const description = typeof criterion.description === "string" ? criterion.description.trim() : "";
					const passCondition = typeof criterion.passCondition === "string" ? criterion.passCondition.trim() : "";
					if (!description || !passCondition) return null;
					return {
						id: normalizeId(criterion.id, `c${index + 1}`),
						taskId: typeof criterion.taskId === "string" && criterion.taskId.trim() ? criterion.taskId.trim() : undefined,
						sourceRef: typeof criterion.sourceRef === "string" && criterion.sourceRef.trim() ? criterion.sourceRef.trim() : undefined,
						requirement: typeof criterion.requirement === "string" && criterion.requirement.trim() ? criterion.requirement.trim() : undefined,
						description,
						passCondition,
						testMethod: typeof criterion.testMethod === "string" && criterion.testMethod.trim() ? criterion.testMethod.trim() : undefined,
						status: isCriterionStatus(criterion.status) ? criterion.status : "pending",
						evidence: typeof criterion.evidence === "string" && criterion.evidence.trim() ? criterion.evidence.trim() : undefined,
						redEvidence: typeof criterion.redEvidence === "string" && criterion.redEvidence.trim() ? criterion.redEvidence.trim() : undefined,
						greenEvidence: typeof criterion.greenEvidence === "string" && criterion.greenEvidence.trim() ? criterion.greenEvidence.trim() : undefined,
						lastCheckedAt: typeof criterion.lastCheckedAt === "string" ? criterion.lastCheckedAt : undefined,
					};
				})
				.filter((criterion): criterion is Criterion => criterion !== null)
		: [];
	return { criteria, requirementTrace: rebuildRequirementTrace(criteria) };
}

export function migrateVerificationArtifacts(value: unknown): VerificationArtifact[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((item, index): VerificationArtifact | null => {
			if (!item || typeof item !== "object") return null;
			const artifact = item as Partial<VerificationArtifact> & Record<string, unknown>;
			const summary = typeof artifact.summary === "string" ? artifact.summary.trim() : "";
			if (!summary) return null;
			return {
				id: normalizeId(artifact.id, `a${index + 1}`),
				kind: isArtifactKind(artifact.kind) ? artifact.kind : "other",
				command: typeof artifact.command === "string" && artifact.command.trim() ? artifact.command.trim() : undefined,
				path: typeof artifact.path === "string" && artifact.path.trim() ? artifact.path.trim() : undefined,
				summary,
				criterionIds: normalizeIds(artifact.criterionIds),
				createdAt: typeof artifact.createdAt === "string" ? artifact.createdAt : new Date().toISOString(),
			};
		})
		.filter((artifact): artifact is VerificationArtifact => artifact !== null);
}

export function migrateBaselineValidations(value: unknown): BaselineValidation[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((item, index): BaselineValidation | null => {
			if (!item || typeof item !== "object") return null;
			const baseline = item as Partial<BaselineValidation> & Record<string, unknown>;
			const summary = typeof baseline.summary === "string" ? baseline.summary.trim() : "";
			if (!summary) return null;
			return {
				id: normalizeId(baseline.id, `bv${index + 1}`),
				command: typeof baseline.command === "string" && baseline.command.trim() ? compactText(baseline.command.trim(), 240) : undefined,
				result: isValidationResult(baseline.result) ? baseline.result : "skipped",
				summary: compactText(summary, 500) ?? summary,
				criterionIds: normalizeStringList(baseline.criterionIds),
				artifactIds: normalizeStringList(baseline.artifactIds),
				recordedAt: typeof baseline.recordedAt === "string" ? baseline.recordedAt : new Date().toISOString(),
			};
		})
		.filter((baseline): baseline is BaselineValidation => baseline !== null);
}

export function isBriefStatus(value: unknown): value is IterationBriefStatus {
	return ["draft", "active", "completed", "dismissed"].includes(String(value));
}

export function isFinalVerificationStatus(value: unknown): value is FinalVerificationStatus {
	return ["draft", "passed", "failed", "partial", "blocked", "skipped"].includes(String(value));
}

export function isValidationResult(value: unknown): value is ValidationResult {
	return ["passed", "failed", "skipped"].includes(String(value));
}

export function isAuditorReviewStatus(value: unknown): value is AuditorReviewStatus {
	return ["draft", "passed", "concerns", "blocked"].includes(String(value));
}

export function isAdvisoryHandoffRole(value: unknown): value is AdvisoryHandoffRole {
	return ["explorer", "test_runner", "researcher", "reviewer", "governor", "auditor", "implementer"].includes(String(value));
}

export function isAdvisoryHandoffStatus(value: unknown): value is AdvisoryHandoffStatus {
	return ["draft", "requested", "answered", "failed", "dismissed"].includes(String(value));
}

export function isBreakoutPackageStatus(value: unknown): value is BreakoutPackageStatus {
	return ["draft", "open", "resolved", "dismissed"].includes(String(value));
}

export function isWorkerReportStatus(value: unknown): value is WorkerReportStatus {
	return ["draft", "submitted", "accepted", "needs_review", "dismissed"].includes(String(value));
}


function normalizeProviderMetadata(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 20));
}

export function isBriefSource(value: unknown): value is IterationBriefSource {
	return ["manual", "governor"].includes(String(value));
}

export function migrateBriefs(value: unknown): IterationBrief[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((item, index): IterationBrief | null => {
			if (!item || typeof item !== "object") return null;
			const brief = item as Partial<IterationBrief> & Record<string, unknown>;
			const objective = typeof brief.objective === "string" ? brief.objective.trim() : "";
			const task = typeof brief.task === "string" ? brief.task.trim() : "";
			if (!objective || !task) return null;
			const now = new Date().toISOString();
			return {
				id: normalizeId(brief.id, `b${index + 1}`),
				status: isBriefStatus(brief.status) ? brief.status : "draft",
				source: isBriefSource(brief.source) ? brief.source : "manual",
				requestId: typeof brief.requestId === "string" && brief.requestId.trim() ? brief.requestId.trim() : undefined,
				objective,
				task,
				criterionIds: normalizeStringList(brief.criterionIds),
				acceptanceCriteria: normalizeStringList(brief.acceptanceCriteria),
				verificationRequired: normalizeStringList(brief.verificationRequired),
				requiredContext: normalizeStringList(brief.requiredContext),
				constraints: normalizeStringList(brief.constraints),
				avoid: normalizeStringList(brief.avoid),
				outputContract: typeof brief.outputContract === "string" && brief.outputContract.trim() ? brief.outputContract.trim() : "Record changed files, validation evidence, risks, and the suggested next move.",
				sourceRefs: normalizeStringList(brief.sourceRefs),
				createdAt: typeof brief.createdAt === "string" ? brief.createdAt : now,
				updatedAt: typeof brief.updatedAt === "string" ? brief.updatedAt : now,
				completedAt: typeof brief.completedAt === "string" ? brief.completedAt : undefined,
			};
		})
		.filter((brief): brief is IterationBrief => brief !== null);
}

export function migrateCurrentBriefId(value: unknown, briefs: IterationBrief[]): string | undefined {
	const id = typeof value === "string" ? value.trim() : "";
	if (id && briefs.some((brief) => brief.id === id && brief.status === "active")) return id;
	return briefs.find((brief) => brief.status === "active")?.id;
}

export function migrateFinalValidationRecords(value: unknown): FinalValidationRecord[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((item): FinalValidationRecord | null => {
			if (!item || typeof item !== "object") return null;
			const record = item as Partial<FinalValidationRecord> & Record<string, unknown>;
			const summary = typeof record.summary === "string" ? record.summary.trim() : "";
			if (!summary) return null;
			return {
				command: typeof record.command === "string" && record.command.trim() ? compactText(record.command, 240) : undefined,
				result: isValidationResult(record.result) ? record.result : "skipped",
				summary: compactText(summary, 500) ?? summary,
				artifactIds: normalizeIds(record.artifactIds),
			};
		})
		.filter((record): record is FinalValidationRecord => record !== null);
}

export function migrateFinalVerificationReports(value: unknown): FinalVerificationReport[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((item, index): FinalVerificationReport | null => {
			if (!item || typeof item !== "object") return null;
			const report = item as Partial<FinalVerificationReport> & Record<string, unknown>;
			const summary = typeof report.summary === "string" ? report.summary.trim() : "";
			if (!summary) return null;
			const now = new Date().toISOString();
			return {
				id: normalizeId(report.id, `fr${index + 1}`),
				status: isFinalVerificationStatus(report.status) ? report.status : "draft",
				summary: compactText(summary, 500) ?? summary,
				criterionIds: normalizeStringList(report.criterionIds),
				artifactIds: normalizeStringList(report.artifactIds),
				validation: migrateFinalValidationRecords(report.validation),
				unresolvedGaps: normalizeStringList(report.unresolvedGaps).map((gap) => compactText(gap, 240) ?? gap),
				compatibilityNotes: normalizeStringList(report.compatibilityNotes).map((note) => compactText(note, 240) ?? note),
				securityNotes: normalizeStringList(report.securityNotes).map((note) => compactText(note, 240) ?? note),
				performanceNotes: normalizeStringList(report.performanceNotes).map((note) => compactText(note, 240) ?? note),
				createdAt: typeof report.createdAt === "string" ? report.createdAt : now,
				updatedAt: typeof report.updatedAt === "string" ? report.updatedAt : now,
			};
		})
		.filter((report): report is FinalVerificationReport => report !== null);
}

export function migrateAuditorReviews(value: unknown): AuditorReview[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((item, index): AuditorReview | null => {
			if (!item || typeof item !== "object") return null;
			const review = item as Partial<AuditorReview> & Record<string, unknown>;
			const summary = typeof review.summary === "string" ? review.summary.trim() : "";
			if (!summary) return null;
			const now = new Date().toISOString();
			return {
				id: normalizeId(review.id, `ar${index + 1}`),
				status: isAuditorReviewStatus(review.status) ? review.status : "draft",
				summary: compactText(summary, 500) ?? summary,
				focus: typeof review.focus === "string" && review.focus.trim() ? compactText(review.focus.trim(), 240) ?? review.focus.trim() : "General auditor review",
				criterionIds: normalizeStringList(review.criterionIds),
				artifactIds: normalizeStringList(review.artifactIds),
				finalReportIds: normalizeStringList(review.finalReportIds),
				concerns: normalizeStringList(review.concerns).map((concern) => compactText(concern, 240) ?? concern),
				recommendations: normalizeStringList(review.recommendations).map((recommendation) => compactText(recommendation, 240) ?? recommendation),
				requiredFollowups: normalizeStringList(review.requiredFollowups).map((followup) => compactText(followup, 240) ?? followup),
				createdAt: typeof review.createdAt === "string" ? review.createdAt : now,
				updatedAt: typeof review.updatedAt === "string" ? review.updatedAt : now,
			};
		})
		.filter((review): review is AuditorReview => review !== null);
}

export function migrateAdvisoryHandoffs(value: unknown): AdvisoryHandoff[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((item, index): AdvisoryHandoff | null => {
			if (!item || typeof item !== "object") return null;
			const handoff = item as Partial<AdvisoryHandoff> & Record<string, unknown>;
			const objective = typeof handoff.objective === "string" ? handoff.objective.trim() : "";
			if (!objective) return null;
			const now = new Date().toISOString();
			return {
				id: normalizeId(handoff.id, `ah${index + 1}`),
				role: isAdvisoryHandoffRole(handoff.role) ? handoff.role : "explorer",
				status: isAdvisoryHandoffStatus(handoff.status) ? handoff.status : "draft",
				objective: compactText(objective, 500) ?? objective,
				summary: typeof handoff.summary === "string" && handoff.summary.trim() ? compactText(handoff.summary.trim(), 500) ?? handoff.summary.trim() : compactText(objective, 160) ?? objective,
				criterionIds: normalizeStringList(handoff.criterionIds),
				artifactIds: normalizeStringList(handoff.artifactIds),
				finalReportIds: normalizeStringList(handoff.finalReportIds),
				contextRefs: normalizeStringList(handoff.contextRefs).map((ref) => compactText(ref, 240) ?? ref),
				constraints: normalizeStringList(handoff.constraints).map((constraint) => compactText(constraint, 240) ?? constraint),
				requestedOutput: typeof handoff.requestedOutput === "string" && handoff.requestedOutput.trim() ? compactText(handoff.requestedOutput.trim(), 500) ?? handoff.requestedOutput.trim() : "Return a compact advisory report with evidence, risks, recommendations, and follow-ups.",
				provider: normalizeProviderMetadata(handoff.provider),
				resultSummary: typeof handoff.resultSummary === "string" && handoff.resultSummary.trim() ? compactText(handoff.resultSummary.trim(), 500) ?? handoff.resultSummary.trim() : undefined,
				concerns: normalizeStringList(handoff.concerns).map((concern) => compactText(concern, 240) ?? concern),
				recommendations: normalizeStringList(handoff.recommendations).map((recommendation) => compactText(recommendation, 240) ?? recommendation),
				artifactRefs: normalizeStringList(handoff.artifactRefs).map((ref) => compactText(ref, 240) ?? ref),
				createdAt: typeof handoff.createdAt === "string" ? handoff.createdAt : now,
				updatedAt: typeof handoff.updatedAt === "string" ? handoff.updatedAt : now,
			};
		})
		.filter((handoff): handoff is AdvisoryHandoff => handoff !== null);
}

export function migrateBreakoutPackages(value: unknown): BreakoutPackage[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((item, index): BreakoutPackage | null => {
			if (!item || typeof item !== "object") return null;
			const breakout = item as Partial<BreakoutPackage> & Record<string, unknown>;
			const summary = typeof breakout.summary === "string" ? breakout.summary.trim() : "";
			const requestedDecision = typeof breakout.requestedDecision === "string" ? breakout.requestedDecision.trim() : "";
			if (!summary && !requestedDecision) return null;
			const now = new Date().toISOString();
			return {
				id: normalizeId(breakout.id, `bp${index + 1}`),
				status: isBreakoutPackageStatus(breakout.status) ? breakout.status : "draft",
				summary: summary ? compactText(summary, 500) ?? summary : compactText(requestedDecision, 500) ?? requestedDecision,
				blockedCriterionIds: normalizeStringList(breakout.blockedCriterionIds),
				attemptIds: normalizeStringList(breakout.attemptIds),
				artifactIds: normalizeStringList(breakout.artifactIds),
				finalReportIds: normalizeStringList(breakout.finalReportIds),
				auditorReviewIds: normalizeStringList(breakout.auditorReviewIds),
				advisoryHandoffIds: normalizeStringList(breakout.advisoryHandoffIds),
				outsideRequestIds: normalizeStringList(breakout.outsideRequestIds),
				lastErrors: normalizeStringList(breakout.lastErrors).map((error) => compactText(error, 240) ?? error),
				suspectedRootCauses: normalizeStringList(breakout.suspectedRootCauses).map((cause) => compactText(cause, 240) ?? cause),
				requestedDecision: requestedDecision ? compactText(requestedDecision, 500) ?? requestedDecision : "Decide whether to resume, pivot, narrow scope, request help, or stop.",
				resumeCriteria: normalizeStringList(breakout.resumeCriteria).map((criterion) => compactText(criterion, 240) ?? criterion),
				recommendedNextActions: normalizeStringList(breakout.recommendedNextActions).map((action) => compactText(action, 240) ?? action),
				createdAt: typeof breakout.createdAt === "string" ? breakout.createdAt : now,
				updatedAt: typeof breakout.updatedAt === "string" ? breakout.updatedAt : now,
			};
		})
		.filter((breakout): breakout is BreakoutPackage => breakout !== null);
}

export function migrateWorkerValidationRecords(value: unknown): WorkerValidationRecord[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((item): WorkerValidationRecord | null => {
			if (!item || typeof item !== "object") return null;
			const record = item as Partial<WorkerValidationRecord> & Record<string, unknown>;
			const summary = typeof record.summary === "string" ? record.summary.trim() : "";
			if (!summary) return null;
			return {
				command: typeof record.command === "string" && record.command.trim() ? compactText(record.command.trim(), 240) : undefined,
				result: isValidationResult(record.result) ? record.result : "skipped",
				summary: compactText(summary, 500) ?? summary,
				artifactIds: normalizeIds(record.artifactIds),
			};
		})
		.filter((record): record is WorkerValidationRecord => record !== null);
}

export function migrateChangedFileReports(value: unknown): ChangedFileReport[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((item): ChangedFileReport | null => {
			if (!item || typeof item !== "object") return null;
			const file = item as Partial<ChangedFileReport> & Record<string, unknown>;
			const filePath = typeof file.path === "string" ? file.path.trim() : "";
			if (!filePath) return null;
			const summary = typeof file.summary === "string" && file.summary.trim() ? file.summary.trim() : "Changed file requires parent review if relevant.";
			return {
				path: compactText(filePath, 240) ?? filePath,
				summary: compactText(summary, 240) ?? summary,
				reviewReason: typeof file.reviewReason === "string" && file.reviewReason.trim() ? compactText(file.reviewReason.trim(), 240) ?? file.reviewReason.trim() : undefined,
			};
		})
		.filter((file): file is ChangedFileReport => file !== null);
}

export function migrateWorkerReports(value: unknown): WorkerReport[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((item, index): WorkerReport | null => {
			if (!item || typeof item !== "object") return null;
			const report = item as Partial<WorkerReport> & Record<string, unknown>;
			const objective = typeof report.objective === "string" ? report.objective.trim() : "";
			const summary = typeof report.summary === "string" ? report.summary.trim() : "";
			if (!objective && !summary) return null;
			const now = new Date().toISOString();
			return {
				id: normalizeId(report.id, `wr${index + 1}`),
				status: isWorkerReportStatus(report.status) ? report.status : "submitted",
				role: isAdvisoryHandoffRole(report.role) ? report.role : "reviewer",
				objective: objective ? compactText(objective, 500) ?? objective : compactText(summary, 500) ?? summary,
				summary: summary ? compactText(summary, 500) ?? summary : compactText(objective, 500) ?? objective,
				advisoryHandoffIds: normalizeStringList(report.advisoryHandoffIds),
				evaluatedCriterionIds: normalizeStringList(report.evaluatedCriterionIds),
				artifactIds: normalizeStringList(report.artifactIds),
				changedFiles: migrateChangedFileReports(report.changedFiles),
				validation: migrateWorkerValidationRecords(report.validation),
				risks: normalizeStringList(report.risks).map((risk) => compactText(risk, 240) ?? risk),
				openQuestions: normalizeStringList(report.openQuestions).map((question) => compactText(question, 240) ?? question),
				suggestedNextMove: typeof report.suggestedNextMove === "string" && report.suggestedNextMove.trim() ? compactText(report.suggestedNextMove.trim(), 500) ?? report.suggestedNextMove.trim() : undefined,
				reviewHints: normalizeStringList(report.reviewHints).map((hint) => compactText(hint, 240) ?? hint),
				createdAt: typeof report.createdAt === "string" ? report.createdAt : now,
				updatedAt: typeof report.updatedAt === "string" ? report.updatedAt : now,
			};
		})
		.filter((report): report is WorkerReport => report !== null);
}


export function migrateState(raw: Partial<LoopState> & { name: string } & Record<string, unknown>): LoopState {
	const reflectEvery = numberOrDefault(raw.reflectEvery ?? raw.reflectEveryItems, 0);
	const lastReflectionAt = numberOrDefault(raw.lastReflectionAt ?? raw.lastReflectionAtItems, 0);
	const status = raw.status === "active" || raw.status === "completed" || raw.status === "paused" ? raw.status : raw.active ? "active" : "paused";
	const mode = normalizeMode(raw.mode);
	const name = stringOrDefault(raw.name, "stardock");
	const briefs = migrateBriefs(raw.briefs);
	return {
		schemaVersion: 3,
		name,
		taskFile: stringOrDefault(raw.taskFile, defaultTaskFile(name)),
		mode,
		iteration: numberOrDefault(raw.iteration, 0),
		maxIterations: numberOrDefault(raw.maxIterations, 50),
		itemsPerIteration: numberOrDefault(raw.itemsPerIteration, 0),
		reflectEvery,
		reflectInstructions: stringOrDefault(raw.reflectInstructions, DEFAULT_REFLECT_INSTRUCTIONS),
		active: status === "active",
		status,
		startedAt: stringOrDefault(raw.startedAt, new Date().toISOString()),
		completedAt: typeof raw.completedAt === "string" ? raw.completedAt : undefined,
		lastReflectionAt,
		modeState: migrateModeState(mode, raw.modeState),
		outsideRequests: migrateOutsideRequests(raw.outsideRequests),
		criterionLedger: migrateCriterionLedger(raw.criterionLedger),
		verificationArtifacts: migrateVerificationArtifacts(raw.verificationArtifacts),
		baselineValidations: migrateBaselineValidations(raw.baselineValidations),
		briefs,
		currentBriefId: migrateCurrentBriefId(raw.currentBriefId, briefs),
		finalVerificationReports: migrateFinalVerificationReports(raw.finalVerificationReports),
		auditorReviews: migrateAuditorReviews(raw.auditorReviews),
		advisoryHandoffs: migrateAdvisoryHandoffs(raw.advisoryHandoffs),
		breakoutPackages: migrateBreakoutPackages(raw.breakoutPackages),
		workerReports: migrateWorkerReports(raw.workerReports),
		workerRuns: migrateWorkerRuns(raw.workerRuns),
	};
}
