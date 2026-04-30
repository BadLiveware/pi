/**
 * Shared Stardock state, migration, and file helpers.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

export const STARDOCK_DIR = ".stardock";
export const COMPLETE_MARKER = "<promise>COMPLETE</promise>";

export const DEFAULT_TEMPLATE = `# Task

Describe your task here.

## Goals
- Goal 1
- Goal 2

## Checklist
- [ ] Item 1
- [ ] Item 2

## Notes
(Update this as you work)
`;

export const DEFAULT_REFLECT_INSTRUCTIONS = `REFLECTION CHECKPOINT

Pause and reflect on your progress:
1. What has been accomplished so far?
2. What's working well?
3. What's not working or blocking progress?
4. Should the approach be adjusted?
5. What are the next priorities?

Update the task file with your reflection, then continue working.`;

export type LoopStatus = "active" | "paused" | "completed";
export type LoopMode = "checklist" | "recursive" | "evolve";

export interface ChecklistModeState {
	kind: "checklist";
}

export type RecursiveResetPolicy = "manual" | "revert_failed_attempts" | "keep_best_only";
export type RecursiveStopCriterion = "target_reached" | "idea_exhaustion" | "max_failed_attempts" | "max_iterations" | "user_decision";
export type RecursiveAttemptStatus = "pending_report" | "reported";
export type RecursiveAttemptKind = "candidate_change" | "setup" | "refactor" | "instrumentation" | "benchmark_scaffold" | "research" | "other";
export type RecursiveAttemptResult = "improved" | "neutral" | "worse" | "invalid" | "blocked";

export interface RecursiveAttempt {
	id: string;
	iteration: number;
	createdAt: string;
	updatedAt?: string;
	status: RecursiveAttemptStatus;
	kind?: RecursiveAttemptKind;
	hypothesis?: string;
	actionSummary?: string;
	validation?: string;
	result?: RecursiveAttemptResult;
	kept?: boolean;
	evidence?: string;
	followupIdeas?: string[];
	summary: string;
}

export interface RecursiveModeState {
	kind: "recursive";
	objective: string;
	baseline?: string;
	validationCommand?: string;
	resetPolicy: RecursiveResetPolicy;
	stopWhen: RecursiveStopCriterion[];
	maxFailedAttempts?: number;
	outsideHelpEvery?: number;
	governEvery?: number;
	outsideHelpOnStagnation: boolean;
	attempts: RecursiveAttempt[];
}

export interface EvolveModeState {
	kind: "evolve";
}

export type LoopModeState = ChecklistModeState | RecursiveModeState | EvolveModeState;
export type PromptReason = "iteration" | "reflection";
export type StateView = "summary" | "overview" | "timeline";
export type OutsideRequestKind = "ideas" | "research" | "mutation_suggestions" | "failure_analysis" | "governor_review";
export type OutsideRequestStatus = "requested" | "in_progress" | "answered" | "dismissed";
export type OutsideRequestTrigger = "every_n_iterations" | "out_of_ideas" | "manual" | "stagnation" | "scaffolding_drift" | "low_value_lane";

export interface GovernorDecision {
	verdict: "continue" | "pivot" | "stop" | "measure" | "exploit_scaffold" | "ask_user";
	rationale: string;
	requiredNextMove?: string;
	forbiddenNextMoves?: string[];
	evidenceGaps?: string[];
}

export interface OutsideRequest {
	id: string;
	kind: OutsideRequestKind;
	status: OutsideRequestStatus;
	requestedAt: string;
	requestedByIteration: number;
	trigger: OutsideRequestTrigger;
	prompt: string;
	answer?: string;
	decision?: GovernorDecision;
	consumedAt?: string;
}

export type CriterionStatus = "pending" | "passed" | "failed" | "skipped" | "blocked";
export type VerificationArtifactKind = "test" | "smoke" | "curl" | "browser" | "screenshot" | "walkthrough" | "benchmark" | "log" | "other";

export interface Criterion {
	id: string;
	taskId?: string;
	sourceRef?: string;
	requirement?: string;
	description: string;
	passCondition: string;
	testMethod?: string;
	status: CriterionStatus;
	evidence?: string;
	redEvidence?: string;
	greenEvidence?: string;
	lastCheckedAt?: string;
}

export interface CriterionLedger {
	criteria: Criterion[];
	requirementTrace: Array<{ requirement: string; criterionIds: string[] }>;
}

export interface VerificationArtifact {
	id: string;
	kind: VerificationArtifactKind;
	command?: string;
	path?: string;
	summary: string;
	criterionIds?: string[];
	createdAt: string;
}

export type IterationBriefStatus = "draft" | "active" | "completed" | "dismissed";
export type IterationBriefSource = "manual" | "governor";
export type BriefLifecycleAction = "keep" | "complete" | "clear";
export type FinalVerificationStatus = "draft" | "passed" | "failed" | "partial";
export type ValidationResult = "passed" | "failed" | "skipped";

export interface FinalValidationRecord {
	command?: string;
	result: ValidationResult;
	summary: string;
	artifactIds?: string[];
}

export interface FinalVerificationReport {
	id: string;
	status: FinalVerificationStatus;
	summary: string;
	criterionIds: string[];
	artifactIds: string[];
	validation: FinalValidationRecord[];
	unresolvedGaps: string[];
	compatibilityNotes: string[];
	securityNotes: string[];
	performanceNotes: string[];
	createdAt: string;
	updatedAt: string;
}

export interface IterationBrief {
	id: string;
	status: IterationBriefStatus;
	source: IterationBriefSource;
	requestId?: string;
	objective: string;
	task: string;
	criterionIds: string[];
	acceptanceCriteria: string[];
	verificationRequired: string[];
	requiredContext: string[];
	constraints: string[];
	avoid: string[];
	outputContract: string;
	sourceRefs: string[];
	createdAt: string;
	updatedAt: string;
	completedAt?: string;
}

export interface LoopModeHandler {
	mode: LoopMode;
	buildPrompt(state: LoopState, taskContent: string, reason: PromptReason): string;
	buildSystemInstructions(state: LoopState): string;
	onIterationDone(state: LoopState): void;
	summarize(state: LoopState): string[];
}

export interface LoopState {
	schemaVersion: 3;
	name: string;
	taskFile: string;
	mode: LoopMode;
	iteration: number;
	maxIterations: number;
	itemsPerIteration: number; // Prompt hint only - "process N items per turn"
	reflectEvery: number; // Reflect every N iterations
	reflectInstructions: string;
	active: boolean; // Backwards compat
	status: LoopStatus;
	startedAt: string;
	completedAt?: string;
	lastReflectionAt: number; // Last iteration we reflected at
	modeState: LoopModeState;
	outsideRequests: OutsideRequest[];
	criterionLedger: CriterionLedger;
	verificationArtifacts: VerificationArtifact[];
	briefs: IterationBrief[];
	currentBriefId?: string;
	finalVerificationReports: FinalVerificationReport[];
}

export const STATUS_ICONS: Record<LoopStatus, string> = { active: "▶", paused: "⏸", completed: "✓" };

export function compactText(value: string | undefined, maxLength = 160): string | undefined {
	if (!value) return undefined;
	if (value.length <= maxLength) return value;
	return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

// --- File helpers ---

export const stardockDir = (ctx: ExtensionContext) => path.resolve(ctx.cwd, STARDOCK_DIR);
export const runsDir = (ctx: ExtensionContext) => path.join(stardockDir(ctx), "runs");
export const archiveDir = (ctx: ExtensionContext) => path.join(stardockDir(ctx), "archive");
export const sanitize = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_");

export function runDir(ctx: ExtensionContext, name: string, archived = false): string {
	return path.join(archived ? archiveDir(ctx) : runsDir(ctx), sanitize(name));
}

export function statePath(ctx: ExtensionContext, name: string, archived = false): string {
	return path.join(runDir(ctx, name, archived), "state.json");
}

export function taskPath(ctx: ExtensionContext, name: string, archived = false): string {
	return path.join(runDir(ctx, name, archived), "task.md");
}

export function defaultTaskFile(name: string): string {
	return path.join(STARDOCK_DIR, "runs", sanitize(name), "task.md");
}

export function legacyPath(ctx: ExtensionContext, name: string, ext: string, archived = false): string {
	const dir = archived ? archiveDir(ctx) : stardockDir(ctx);
	return path.join(dir, `${sanitize(name)}${ext}`);
}

export function existingStatePath(ctx: ExtensionContext, name: string, archived = false): string {
	const currentPath = statePath(ctx, name, archived);
	return fs.existsSync(currentPath) ? currentPath : legacyPath(ctx, name, ".state.json", archived);
}

export function ensureDir(filePath: string): void {
	const dir = path.dirname(filePath);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function tryDelete(filePath: string): void {
	try {
		if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
	} catch {
		/* ignore */
	}
}

export function tryRead(filePath: string): string | null {
	try {
		return fs.readFileSync(filePath, "utf-8");
	} catch {
		return null;
	}
}

export function safeMtimeMs(filePath: string): number {
	try {
		return fs.statSync(filePath).mtimeMs;
	} catch {
		return 0;
	}
}

export function tryRemoveDir(dirPath: string): boolean {
	try {
		if (fs.existsSync(dirPath)) {
			fs.rmSync(dirPath, { recursive: true, force: true });
		}
		return true;
	} catch {
		return false;
	}
}

// --- State management ---

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

export function readStateFile(filePath: string): LoopState | null {
	const content = tryRead(filePath);
	return content ? migrateState(JSON.parse(content)) : null;
}

export function loadState(ctx: ExtensionContext, name: string, archived = false): LoopState | null {
	return readStateFile(existingStatePath(ctx, name, archived));
}

export function saveState(ctx: ExtensionContext, state: LoopState, archived = false): void {
	state.active = state.status === "active";
	const filePath = statePath(ctx, state.name, archived);
	ensureDir(filePath);
	fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
}

export function listLoops(ctx: ExtensionContext, archived = false): LoopState[] {
	const currentDir = archived ? archiveDir(ctx) : runsDir(ctx);
	const legacyDir = archived ? archiveDir(ctx) : stardockDir(ctx);
	const byName = new Map<string, LoopState>();

	if (fs.existsSync(currentDir)) {
		for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const state = readStateFile(path.join(currentDir, entry.name, "state.json"));
			if (state) byName.set(state.name, state);
		}
	}

	if (fs.existsSync(legacyDir)) {
		for (const entry of fs.readdirSync(legacyDir, { withFileTypes: true })) {
			if (!entry.isFile() || !entry.name.endsWith(".state.json")) continue;
			const state = readStateFile(path.join(legacyDir, entry.name));
			if (state && !byName.has(state.name)) byName.set(state.name, state);
		}
	}

	return [...byName.values()];
}
