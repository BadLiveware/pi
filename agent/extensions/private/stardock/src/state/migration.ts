/**
 * Stardock state migration and normalization.
 */

import {
	DEFAULT_REFLECT_INSTRUCTIONS,
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
	type LoopModeState,
	type LoopState,
	type OutsideRequest,
	type RecursiveModeState,
	type ValidationResult,
	type VerificationArtifact,
	type VerificationArtifactKind,
	compactText,
} from "./core.ts";
import { defaultTaskFile } from "./paths.ts";

export function normalizeMode(value: unknown): LoopMode {
	return value === "recursive" || value === "evolve" || value === "checklist" ? value : "checklist";
}

export function defaultRecursiveModeState(objective = "Continue improving the task outcome"): RecursiveModeState {
	return {
		kind: "recursive",
		objective,
		resetPolicy: "manual",
		stopWhen: ["target_reached", "idea_exhaustion", "max_iterations"],
		outsideHelpOnStagnation: false,
		attempts: [],
	};
}

export function defaultModeState(mode: LoopMode): LoopModeState {
	if (mode === "recursive") return defaultRecursiveModeState();
	if (mode === "evolve") return { kind: "evolve" };
	return { kind: "checklist" };
}

export function migrateModeState(mode: LoopMode, rawModeState: unknown): LoopModeState {
	if (rawModeState && typeof rawModeState === "object" && (rawModeState as { kind?: unknown }).kind === mode) {
		if (mode === "recursive") {
			const raw = rawModeState as Partial<RecursiveModeState>;
			return {
				...defaultRecursiveModeState(raw.objective),
				...raw,
				attempts: Array.isArray(raw.attempts) ? raw.attempts : [],
				outsideHelpOnStagnation: raw.outsideHelpOnStagnation === true,
			};
		}
		return rawModeState as LoopModeState;
	}
	return defaultModeState(mode);
}

export function numberOrDefault(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
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
	return ["test", "smoke", "curl", "browser", "screenshot", "walkthrough", "benchmark", "log", "other"].includes(String(value));
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

export function isBriefStatus(value: unknown): value is IterationBriefStatus {
	return ["draft", "active", "completed", "dismissed"].includes(String(value));
}

export function isFinalVerificationStatus(value: unknown): value is FinalVerificationStatus {
	return ["draft", "passed", "failed", "partial"].includes(String(value));
}

export function isValidationResult(value: unknown): value is ValidationResult {
	return ["passed", "failed", "skipped"].includes(String(value));
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
		briefs,
		currentBriefId: migrateCurrentBriefId(raw.currentBriefId, briefs),
		finalVerificationReports: migrateFinalVerificationReports(raw.finalVerificationReports),
	};
}
