/**
 * Stardock - private governed implementation loops for Pi.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

const STARDOCK_DIR = ".stardock";
const COMPLETE_MARKER = "<promise>COMPLETE</promise>";

const DEFAULT_TEMPLATE = `# Task

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

const DEFAULT_REFLECT_INSTRUCTIONS = `REFLECTION CHECKPOINT

Pause and reflect on your progress:
1. What has been accomplished so far?
2. What's working well?
3. What's not working or blocking progress?
4. Should the approach be adjusted?
5. What are the next priorities?

Update the task file with your reflection, then continue working.`;

type LoopStatus = "active" | "paused" | "completed";
type LoopMode = "checklist" | "recursive" | "evolve";

interface ChecklistModeState {
	kind: "checklist";
}

type RecursiveResetPolicy = "manual" | "revert_failed_attempts" | "keep_best_only";
type RecursiveStopCriterion = "target_reached" | "idea_exhaustion" | "max_failed_attempts" | "max_iterations" | "user_decision";
type RecursiveAttemptStatus = "pending_report" | "reported";
type RecursiveAttemptKind = "candidate_change" | "setup" | "refactor" | "instrumentation" | "benchmark_scaffold" | "research" | "other";
type RecursiveAttemptResult = "improved" | "neutral" | "worse" | "invalid" | "blocked";

interface RecursiveAttempt {
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

interface RecursiveModeState {
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

interface EvolveModeState {
	kind: "evolve";
}

type LoopModeState = ChecklistModeState | RecursiveModeState | EvolveModeState;
type PromptReason = "iteration" | "reflection";
type StateView = "summary" | "overview" | "timeline";
type OutsideRequestKind = "ideas" | "research" | "mutation_suggestions" | "failure_analysis" | "governor_review";
type OutsideRequestStatus = "requested" | "in_progress" | "answered" | "dismissed";
type OutsideRequestTrigger = "every_n_iterations" | "out_of_ideas" | "manual" | "stagnation" | "scaffolding_drift" | "low_value_lane";

interface GovernorDecision {
	verdict: "continue" | "pivot" | "stop" | "measure" | "exploit_scaffold" | "ask_user";
	rationale: string;
	requiredNextMove?: string;
	forbiddenNextMoves?: string[];
	evidenceGaps?: string[];
}

interface OutsideRequest {
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

type CriterionStatus = "pending" | "passed" | "failed" | "skipped" | "blocked";
type VerificationArtifactKind = "test" | "smoke" | "curl" | "browser" | "screenshot" | "walkthrough" | "benchmark" | "log" | "other";

interface Criterion {
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

interface CriterionLedger {
	criteria: Criterion[];
	requirementTrace: Array<{ requirement: string; criterionIds: string[] }>;
}

interface VerificationArtifact {
	id: string;
	kind: VerificationArtifactKind;
	command?: string;
	path?: string;
	summary: string;
	criterionIds?: string[];
	createdAt: string;
}

type IterationBriefStatus = "draft" | "active" | "completed" | "dismissed";
type IterationBriefSource = "manual" | "governor";
type BriefLifecycleAction = "keep" | "complete" | "clear";

interface IterationBrief {
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

interface LoopModeHandler {
	mode: LoopMode;
	buildPrompt(state: LoopState, taskContent: string, reason: PromptReason): string;
	buildSystemInstructions(state: LoopState): string;
	onIterationDone(state: LoopState): void;
	summarize(state: LoopState): string[];
}

interface LoopState {
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
}

const STATUS_ICONS: Record<LoopStatus, string> = { active: "▶", paused: "⏸", completed: "✓" };

export default function (pi: ExtensionAPI) {
	let currentLoop: string | null = null;

	// --- File helpers ---

	const stardockDir = (ctx: ExtensionContext) => path.resolve(ctx.cwd, STARDOCK_DIR);
	const runsDir = (ctx: ExtensionContext) => path.join(stardockDir(ctx), "runs");
	const archiveDir = (ctx: ExtensionContext) => path.join(stardockDir(ctx), "archive");
	const sanitize = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_");

	function runDir(ctx: ExtensionContext, name: string, archived = false): string {
		return path.join(archived ? archiveDir(ctx) : runsDir(ctx), sanitize(name));
	}

	function statePath(ctx: ExtensionContext, name: string, archived = false): string {
		return path.join(runDir(ctx, name, archived), "state.json");
	}

	function taskPath(ctx: ExtensionContext, name: string, archived = false): string {
		return path.join(runDir(ctx, name, archived), "task.md");
	}

	function defaultTaskFile(name: string): string {
		return path.join(STARDOCK_DIR, "runs", sanitize(name), "task.md");
	}

	function legacyPath(ctx: ExtensionContext, name: string, ext: string, archived = false): string {
		const dir = archived ? archiveDir(ctx) : stardockDir(ctx);
		return path.join(dir, `${sanitize(name)}${ext}`);
	}

	function existingStatePath(ctx: ExtensionContext, name: string, archived = false): string {
		const currentPath = statePath(ctx, name, archived);
		return fs.existsSync(currentPath) ? currentPath : legacyPath(ctx, name, ".state.json", archived);
	}

	function ensureDir(filePath: string): void {
		const dir = path.dirname(filePath);
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	}

	function tryDelete(filePath: string): void {
		try {
			if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
		} catch {
			/* ignore */
		}
	}

	function tryRead(filePath: string): string | null {
		try {
			return fs.readFileSync(filePath, "utf-8");
		} catch {
			return null;
		}
	}

	function safeMtimeMs(filePath: string): number {
		try {
			return fs.statSync(filePath).mtimeMs;
		} catch {
			return 0;
		}
	}

	function tryRemoveDir(dirPath: string): boolean {
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

	function normalizeMode(value: unknown): LoopMode {
		return value === "recursive" || value === "evolve" || value === "checklist" ? value : "checklist";
	}

	function defaultRecursiveModeState(objective = "Continue improving the task outcome"): RecursiveModeState {
		return {
			kind: "recursive",
			objective,
			resetPolicy: "manual",
			stopWhen: ["target_reached", "idea_exhaustion", "max_iterations"],
			outsideHelpOnStagnation: false,
			attempts: [],
		};
	}

	function defaultModeState(mode: LoopMode): LoopModeState {
		if (mode === "recursive") return defaultRecursiveModeState();
		if (mode === "evolve") return { kind: "evolve" };
		return { kind: "checklist" };
	}

	function migrateModeState(mode: LoopMode, rawModeState: unknown): LoopModeState {
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

	function numberOrDefault(value: unknown, fallback: number): number {
		return typeof value === "number" && Number.isFinite(value) ? value : fallback;
	}

	function stringOrDefault(value: unknown, fallback: string): string {
		return typeof value === "string" ? value : fallback;
	}

	function migrateOutsideRequests(value: unknown): OutsideRequest[] {
		return Array.isArray(value) ? (value as OutsideRequest[]) : [];
	}

	function defaultCriterionLedger(): CriterionLedger {
		return { criteria: [], requirementTrace: [] };
	}

	function isCriterionStatus(value: unknown): value is CriterionStatus {
		return ["pending", "passed", "failed", "skipped", "blocked"].includes(String(value));
	}

	function isArtifactKind(value: unknown): value is VerificationArtifactKind {
		return ["test", "smoke", "curl", "browser", "screenshot", "walkthrough", "benchmark", "log", "other"].includes(String(value));
	}

	function normalizeStringList(value: unknown): string[] {
		if (!Array.isArray(value)) return [];
		const items = value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
		return [...new Set(items)];
	}

	function normalizeIds(value: unknown): string[] | undefined {
		const ids = normalizeStringList(value);
		return ids.length > 0 ? ids : undefined;
	}

	function normalizeId(value: unknown, fallback: string): string {
		const raw = typeof value === "string" ? value.trim() : "";
		const normalized = raw.replace(/[^a-zA-Z0-9_.:-]/g, "_").replace(/_+/g, "_");
		return normalized || fallback;
	}

	function rebuildRequirementTrace(criteria: Criterion[]): CriterionLedger["requirementTrace"] {
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

	function migrateCriterionLedger(value: unknown): CriterionLedger {
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

	function migrateVerificationArtifacts(value: unknown): VerificationArtifact[] {
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

	function isBriefStatus(value: unknown): value is IterationBriefStatus {
		return ["draft", "active", "completed", "dismissed"].includes(String(value));
	}

	function isBriefSource(value: unknown): value is IterationBriefSource {
		return ["manual", "governor"].includes(String(value));
	}

	function migrateBriefs(value: unknown): IterationBrief[] {
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

	function migrateCurrentBriefId(value: unknown, briefs: IterationBrief[]): string | undefined {
		const id = typeof value === "string" ? value.trim() : "";
		if (id && briefs.some((brief) => brief.id === id && brief.status === "active")) return id;
		return briefs.find((brief) => brief.status === "active")?.id;
	}

	function migrateState(raw: Partial<LoopState> & { name: string } & Record<string, unknown>): LoopState {
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
		};
	}

	function readStateFile(filePath: string): LoopState | null {
		const content = tryRead(filePath);
		return content ? migrateState(JSON.parse(content)) : null;
	}

	function loadState(ctx: ExtensionContext, name: string, archived = false): LoopState | null {
		return readStateFile(existingStatePath(ctx, name, archived));
	}

	function saveState(ctx: ExtensionContext, state: LoopState, archived = false): void {
		state.active = state.status === "active";
		const filePath = statePath(ctx, state.name, archived);
		ensureDir(filePath);
		fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
	}

	function listLoops(ctx: ExtensionContext, archived = false): LoopState[] {
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

	// --- Loop state transitions ---

	function pauseLoop(ctx: ExtensionContext, state: LoopState, message?: string): void {
		state.status = "paused";
		state.active = false;
		saveState(ctx, state);
		currentLoop = null;
		updateUI(ctx);
		if (message && ctx.hasUI) ctx.ui.notify(message, "info");
	}

	function completeLoop(ctx: ExtensionContext, state: LoopState, banner: string): void {
		state.status = "completed";
		state.completedAt = new Date().toISOString();
		state.active = false;
		saveState(ctx, state);
		currentLoop = null;
		updateUI(ctx);
		pi.appendEntry("stardock", {
			kind: "completed",
			name: state.name,
			iteration: state.iteration,
			maxIterations: state.maxIterations,
			completedAt: state.completedAt,
			banner,
		});
		if (ctx.hasUI) ctx.ui.notify(banner, "info");
	}

	function stopLoop(ctx: ExtensionContext, state: LoopState, message?: string): void {
		state.status = "completed";
		state.completedAt = new Date().toISOString();
		state.active = false;
		saveState(ctx, state);
		currentLoop = null;
		updateUI(ctx);
		if (message && ctx.hasUI) ctx.ui.notify(message, "info");
	}

	// --- Outside requests ---

	function pendingOutsideRequests(state: LoopState): OutsideRequest[] {
		return state.outsideRequests.filter((request) => request.status === "requested" || request.status === "in_progress");
	}

	function latestGovernorDecision(state: LoopState): GovernorDecision | undefined {
		return [...state.outsideRequests]
			.reverse()
			.find((request) => request.kind === "governor_review" && request.decision)?.decision;
	}

	function addOutsideRequest(state: LoopState, request: Omit<OutsideRequest, "requestedAt" | "status">): OutsideRequest {
		const existing = state.outsideRequests.find((item) => item.id === request.id);
		if (existing) return existing;
		const next: OutsideRequest = { ...request, status: "requested", requestedAt: new Date().toISOString() };
		state.outsideRequests.push(next);
		return next;
	}

	function findGovernorRequestForIteration(state: LoopState, iteration = state.iteration): OutsideRequest | undefined {
		return state.outsideRequests.find((request) => request.kind === "governor_review" && request.requestedByIteration === iteration);
	}

	function buildRecentAttemptSummary(modeState: RecursiveModeState, count = 3): string {
		const attempts = modeState.attempts.slice(-count);
		return attempts.length > 0 ? attempts.map(formatAttemptForPayload).join("\n") : "- No structured attempt reports yet.";
	}

	function buildGovernorPrompt(state: LoopState, modeState: RecursiveModeState, trigger: OutsideRequestTrigger): string {
		return [
			`Review recursive loop "${state.name}" after attempt ${state.iteration}.`,
			`Objective: ${modeState.objective}`,
			`Attempts recorded: ${modeState.attempts.length}`,
			`Trigger: ${trigger}`,
			"Decide whether the next move should continue, pivot, stop, measure, exploit scaffold, or ask the user.",
			"If useful, provide requiredNextMove, forbiddenNextMoves, and evidenceGaps.",
		].join("\n");
	}

	function createGovernorRequest(state: LoopState, modeState: RecursiveModeState, trigger: OutsideRequestTrigger, idPrefix = "governor"): OutsideRequest {
		const existing = findGovernorRequestForIteration(state);
		if (existing) return existing;
		return addOutsideRequest(state, {
			id: `${idPrefix}-${state.iteration}`,
			kind: "governor_review",
			requestedByIteration: state.iteration,
			trigger,
			prompt: buildGovernorPrompt(state, modeState, trigger),
		});
	}

	function maybeCreateRecursiveOutsideRequests(state: LoopState, modeState: RecursiveModeState): void {
		const governorCadence = modeState.governEvery ?? modeState.outsideHelpEvery;
		if (governorCadence && state.iteration % governorCadence === 0) {
			createGovernorRequest(state, modeState, "every_n_iterations");
		}

		if (!modeState.outsideHelpOnStagnation) return;
		const reported = modeState.attempts.filter((attempt) => attempt.status === "reported");
		const recentTwo = reported.slice(-2);
		if (recentTwo.length === 2 && recentTwo.every((attempt) => attempt.result && ["neutral", "worse", "invalid", "blocked"].includes(attempt.result))) {
			addOutsideRequest(state, {
				id: `research-stagnation-${state.iteration}`,
				kind: "failure_analysis",
				requestedByIteration: state.iteration,
				trigger: "stagnation",
				prompt: [
					`Analyze why recursive loop "${state.name}" appears stagnant after attempt ${state.iteration}.`,
					`Objective: ${modeState.objective}`,
					"Recent attempts:",
					buildRecentAttemptSummary(modeState),
					"Suggest discriminating checks or a different next attempt.",
				].join("\n"),
			});
		}

		const recentThree = reported.slice(-3);
		const scaffoldKinds: Array<RecursiveAttemptKind | undefined> = ["setup", "refactor", "instrumentation", "benchmark_scaffold"];
		if (recentThree.length === 3 && recentThree.every((attempt) => scaffoldKinds.includes(attempt.kind)) && recentThree.every((attempt) => attempt.result !== "improved")) {
			addOutsideRequest(state, {
				id: `research-scaffold-${state.iteration}`,
				kind: "mutation_suggestions",
				requestedByIteration: state.iteration,
				trigger: "scaffolding_drift",
				prompt: [
					`Suggest candidate changes for recursive loop "${state.name}" after repeated scaffold/setup attempts.`,
					`Objective: ${modeState.objective}`,
					"Recent attempts:",
					buildRecentAttemptSummary(modeState),
					"Focus on measured candidate changes that use the scaffold rather than more setup.",
				].join("\n"),
			});
		}
	}

	function formatAttemptForPayload(attempt: RecursiveAttempt): string {
		return [
			`- Attempt ${attempt.iteration} (${attempt.status}${attempt.kind ? `, ${attempt.kind}` : ""}${attempt.result ? `, ${attempt.result}` : ""})`,
			attempt.hypothesis ? `  - Hypothesis: ${attempt.hypothesis}` : undefined,
			attempt.actionSummary ? `  - Action: ${attempt.actionSummary}` : undefined,
			attempt.validation ? `  - Validation: ${attempt.validation}` : undefined,
			attempt.evidence ? `  - Evidence: ${attempt.evidence}` : undefined,
			attempt.followupIdeas?.length ? `  - Follow-up ideas: ${attempt.followupIdeas.join("; ")}` : undefined,
		]
			.filter((line): line is string => Boolean(line))
			.join("\n");
	}

	function buildOutsideRequestPayload(state: LoopState, request: OutsideRequest): string {
		const modeState = state.modeState.kind === "recursive" ? state.modeState : undefined;
		const attempts = modeState?.attempts.slice(-5).map(formatAttemptForPayload).join("\n") || "- No structured attempt reports yet.";
		const common = [
			`Loop: ${state.name}`,
			`Mode: ${state.mode}`,
			`Iteration: ${state.iteration}${state.maxIterations > 0 ? `/${state.maxIterations}` : ""}`,
			modeState ? `Objective: ${modeState.objective}` : undefined,
			modeState?.baseline ? `Baseline/current best: ${modeState.baseline}` : undefined,
			modeState?.validationCommand ? `Validation command/check: ${modeState.validationCommand}` : undefined,
			`Request: ${request.id} (${request.kind}, ${request.trigger})`,
			"",
			"Request prompt:",
			request.prompt,
			"",
			"Recent structured attempts:",
			attempts,
		]
			.filter((line): line is string => line !== undefined)
			.join("\n");

		if (request.kind === "governor_review") {
			return `${common}\n\nGovernor task:\nReview the trajectory and decide the next move. Look for scaffolding drift, low-value lanes, missing measurements, and whether to continue, pivot, stop, measure, exploit existing scaffold, request research, or ask the user.\n\nReturn a concise answer plus structured decision fields:\n- verdict: continue | pivot | stop | measure | exploit_scaffold | ask_user\n- rationale\n- requiredNextMove, if any\n- forbiddenNextMoves, if any\n- evidenceGaps, if any`;
		}

		const researcherTasks: Record<OutsideRequestKind, string> = {
			ideas: "Generate fresh plausible next hypotheses or implementation strategies. Prefer diverse, testable ideas over generic advice.",
			research: "Find relevant prior art, examples, docs, or external evidence that can inform the next bounded attempt.",
			mutation_suggestions: "Suggest concrete mutations to the current approach that can be tested in one bounded attempt.",
			failure_analysis: "Analyze why recent attempts may have failed or stalled and propose discriminating checks.",
			governor_review: "Review the trajectory and decide the next move.",
		};
		return `${common}\n\nResearcher task:\n${researcherTasks[request.kind]}\n\nReturn concise, actionable findings with suggested next attempts and any evidence or sources used.`;
	}

	function formatOutsideRequest(request: OutsideRequest): string {
		return `${request.id} [${request.status}] ${request.kind} from iteration ${request.requestedByIteration}: ${request.prompt}`;
	}

	function formatOutsideRequests(state: LoopState): string {
		if (state.outsideRequests.length === 0) return `No outside requests for ${state.name}.`;
		return state.outsideRequests
			.map((request) => `${formatOutsideRequest(request)}\nPayload: run stardock_outside_payload for a ready-to-copy task.`)
			.join("\n\n");
	}

	function getOutsideRequestPayload(ctx: ExtensionContext, loopName: string, requestId: string): { ok: true; payload: string; request: OutsideRequest } | { ok: false; error: string } {
		const state = loadState(ctx, loopName);
		if (!state) return { ok: false, error: `Loop "${loopName}" not found.` };
		const request = state.outsideRequests.find((item) => item.id === requestId);
		if (!request) return { ok: false, error: `Outside request "${requestId}" not found in loop "${loopName}".` };
		return { ok: true, payload: buildOutsideRequestPayload(state, request), request };
	}

	function answerOutsideRequest(
		ctx: ExtensionContext,
		loopName: string,
		requestId: string,
		answer: string,
		decision?: GovernorDecision,
	): { ok: true; state: LoopState; request: OutsideRequest } | { ok: false; error: string } {
		const state = loadState(ctx, loopName);
		if (!state) return { ok: false, error: `Loop "${loopName}" not found.` };
		const request = state.outsideRequests.find((item) => item.id === requestId);
		if (!request) return { ok: false, error: `Outside request "${requestId}" not found in loop "${loopName}".` };
		request.status = "answered";
		request.answer = answer;
		request.decision = decision;
		request.consumedAt = new Date().toISOString();
		saveState(ctx, state);
		updateUI(ctx);
		return { ok: true, state, request };
	}

	function createManualGovernorPayload(ctx: ExtensionContext, loopName: string): { ok: true; state: LoopState; request: OutsideRequest; payload: string } | { ok: false; error: string } {
		const state = loadState(ctx, loopName);
		if (!state) return { ok: false, error: `Loop "${loopName}" not found.` };
		if (state.mode !== "recursive" || state.modeState.kind !== "recursive") {
			return { ok: false, error: `Loop "${loopName}" is not a recursive loop.` };
		}
		const request = createGovernorRequest(state, state.modeState, "manual", "governor-manual");
		saveState(ctx, state);
		updateUI(ctx);
		return { ok: true, state, request, payload: buildOutsideRequestPayload(state, request) };
	}

	// --- Attempt reports ---

	function summarizeAttemptReport(input: {
		hypothesis?: string;
		actionSummary?: string;
		validation?: string;
		result?: RecursiveAttemptResult;
	}): string {
		return [input.result ? `Result: ${input.result}.` : undefined, input.hypothesis, input.actionSummary, input.validation]
			.filter((part): part is string => Boolean(part && part.trim()))
			.join(" ");
	}

	function recordAttemptReport(
		ctx: ExtensionContext,
		loopName: string,
		input: {
			iteration?: number;
			kind?: RecursiveAttemptKind;
			hypothesis?: string;
			actionSummary?: string;
			validation?: string;
			result?: RecursiveAttemptResult;
			kept?: boolean;
			evidence?: string;
			followupIdeas?: string[];
		},
	): { ok: true; state: LoopState; attempt: RecursiveAttempt } | { ok: false; error: string } {
		const state = loadState(ctx, loopName);
		if (!state) return { ok: false, error: `Loop "${loopName}" not found.` };
		if (state.mode !== "recursive" || state.modeState.kind !== "recursive") {
			return { ok: false, error: `Loop "${loopName}" is not a recursive loop.` };
		}
		const iteration = input.iteration ?? Math.max(1, state.iteration - 1);
		const modeState = state.modeState;
		let attempt = modeState.attempts.find((item) => item.iteration === iteration);
		if (!attempt) {
			attempt = {
				id: `attempt-${iteration}`,
				iteration,
				createdAt: new Date().toISOString(),
				status: "pending_report",
				summary: "",
			};
			modeState.attempts.push(attempt);
		}
		attempt.status = "reported";
		attempt.updatedAt = new Date().toISOString();
		attempt.kind = input.kind;
		attempt.hypothesis = input.hypothesis;
		attempt.actionSummary = input.actionSummary;
		attempt.validation = input.validation;
		attempt.result = input.result;
		attempt.kept = input.kept;
		attempt.evidence = input.evidence;
		attempt.followupIdeas = input.followupIdeas;
		attempt.summary = summarizeAttemptReport(input) || attempt.summary || `Attempt ${iteration} reported.`;
		modeState.attempts.sort((a, b) => a.iteration - b.iteration);
		state.modeState = modeState;
		saveState(ctx, state);
		updateUI(ctx);
		return { ok: true, state, attempt };
	}

	// --- Criterion ledger, verification artifacts, and iteration briefs ---

	function nextSequentialId(prefix: string, existing: Array<{ id: string }>): string {
		let index = existing.length + 1;
		const ids = new Set(existing.map((item) => item.id));
		while (ids.has(`${prefix}${index}`)) index++;
		return `${prefix}${index}`;
	}

	function criterionCounts(ledger: CriterionLedger): Record<CriterionStatus, number> & { total: number } {
		const counts = { total: ledger.criteria.length, pending: 0, passed: 0, failed: 0, skipped: 0, blocked: 0 };
		for (const criterion of ledger.criteria) counts[criterion.status]++;
		return counts;
	}

	function upsertCriterion(
		ctx: ExtensionContext,
		loopName: string,
		input: Partial<Criterion> & { id?: string; description?: string; passCondition?: string },
	): { ok: true; state: LoopState; criterion: Criterion; created: boolean } | { ok: false; error: string } {
		const state = loadState(ctx, loopName);
		if (!state) return { ok: false, error: `Loop "${loopName}" not found.` };

		const id = normalizeId(input.id, nextSequentialId("c", state.criterionLedger.criteria));
		const existingIndex = state.criterionLedger.criteria.findIndex((criterion) => criterion.id === id);
		const existing = existingIndex >= 0 ? state.criterionLedger.criteria[existingIndex] : undefined;
		const description = typeof input.description === "string" && input.description.trim() ? input.description.trim() : existing?.description;
		const passCondition = typeof input.passCondition === "string" && input.passCondition.trim() ? input.passCondition.trim() : existing?.passCondition;
		if (!description || !passCondition) return { ok: false, error: "Criterion requires description and passCondition." };

		const evidenceChanged = input.status !== undefined || input.evidence !== undefined || input.redEvidence !== undefined || input.greenEvidence !== undefined;
		const criterion: Criterion = {
			id,
			taskId: typeof input.taskId === "string" && input.taskId.trim() ? input.taskId.trim() : existing?.taskId,
			sourceRef: typeof input.sourceRef === "string" && input.sourceRef.trim() ? input.sourceRef.trim() : existing?.sourceRef,
			requirement: typeof input.requirement === "string" && input.requirement.trim() ? input.requirement.trim() : existing?.requirement,
			description,
			passCondition,
			testMethod: typeof input.testMethod === "string" && input.testMethod.trim() ? input.testMethod.trim() : existing?.testMethod,
			status: isCriterionStatus(input.status) ? input.status : existing?.status ?? "pending",
			evidence: typeof input.evidence === "string" && input.evidence.trim() ? compactText(input.evidence, 500) : existing?.evidence,
			redEvidence: typeof input.redEvidence === "string" && input.redEvidence.trim() ? compactText(input.redEvidence, 500) : existing?.redEvidence,
			greenEvidence: typeof input.greenEvidence === "string" && input.greenEvidence.trim() ? compactText(input.greenEvidence, 500) : existing?.greenEvidence,
			lastCheckedAt: evidenceChanged ? new Date().toISOString() : existing?.lastCheckedAt,
		};

		if (existingIndex >= 0) state.criterionLedger.criteria[existingIndex] = criterion;
		else state.criterionLedger.criteria.push(criterion);
		state.criterionLedger.criteria.sort((a, b) => a.id.localeCompare(b.id));
		state.criterionLedger.requirementTrace = rebuildRequirementTrace(state.criterionLedger.criteria);
		saveState(ctx, state);
		updateUI(ctx);
		return { ok: true, state, criterion, created: existingIndex < 0 };
	}

	function recordVerificationArtifact(
		ctx: ExtensionContext,
		loopName: string,
		input: Partial<VerificationArtifact> & { summary?: string },
	): { ok: true; state: LoopState; artifact: VerificationArtifact; created: boolean } | { ok: false; error: string } {
		const state = loadState(ctx, loopName);
		if (!state) return { ok: false, error: `Loop "${loopName}" not found.` };

		const id = normalizeId(input.id, nextSequentialId("a", state.verificationArtifacts));
		const existingIndex = state.verificationArtifacts.findIndex((artifact) => artifact.id === id);
		const existing = existingIndex >= 0 ? state.verificationArtifacts[existingIndex] : undefined;
		const summary = typeof input.summary === "string" && input.summary.trim() ? compactText(input.summary, 500) : existing?.summary;
		if (!summary) return { ok: false, error: "Verification artifact requires summary." };

		const artifact: VerificationArtifact = {
			id,
			kind: isArtifactKind(input.kind) ? input.kind : existing?.kind ?? "other",
			command: typeof input.command === "string" && input.command.trim() ? input.command.trim() : existing?.command,
			path: typeof input.path === "string" && input.path.trim() ? input.path.trim() : existing?.path,
			summary,
			criterionIds: normalizeIds(input.criterionIds) ?? existing?.criterionIds,
			createdAt: existing?.createdAt ?? new Date().toISOString(),
		};

		if (existingIndex >= 0) state.verificationArtifacts[existingIndex] = artifact;
		else state.verificationArtifacts.push(artifact);
		state.verificationArtifacts.sort((a, b) => a.id.localeCompare(b.id));
		saveState(ctx, state);
		updateUI(ctx);
		return { ok: true, state, artifact, created: existingIndex < 0 };
	}

	function currentBrief(state: LoopState): IterationBrief | undefined {
		return state.briefs.find((brief) => brief.id === state.currentBriefId && brief.status === "active");
	}

	function upsertBrief(
		ctx: ExtensionContext,
		loopName: string,
		input: Partial<IterationBrief> & { id?: string; objective?: string; task?: string },
	): { ok: true; state: LoopState; brief: IterationBrief; created: boolean } | { ok: false; error: string } {
		const state = loadState(ctx, loopName);
		if (!state) return { ok: false, error: `Loop "${loopName}" not found.` };

		const id = normalizeId(input.id, nextSequentialId("b", state.briefs));
		const existingIndex = state.briefs.findIndex((brief) => brief.id === id);
		const existing = existingIndex >= 0 ? state.briefs[existingIndex] : undefined;
		const objective = typeof input.objective === "string" && input.objective.trim() ? input.objective.trim() : existing?.objective;
		const task = typeof input.task === "string" && input.task.trim() ? input.task.trim() : existing?.task;
		if (!objective || !task) return { ok: false, error: "Iteration brief requires objective and task." };

		const source = isBriefSource(input.source) ? input.source : existing?.source ?? "manual";
		const requestId = typeof input.requestId === "string" && input.requestId.trim() ? input.requestId.trim() : existing?.requestId;
		if (source === "governor" && requestId) {
			const request = state.outsideRequests.find((item) => item.id === requestId);
			if (!request) return { ok: false, error: `Outside request "${requestId}" not found in loop "${loopName}".` };
			if (request.kind !== "governor_review") return { ok: false, error: `Outside request "${requestId}" is not a governor review.` };
		}

		const now = new Date().toISOString();
		const brief: IterationBrief = {
			id,
			status: existing?.status ?? "draft",
			source,
			requestId: source === "governor" ? requestId : undefined,
			objective,
			task,
			criterionIds: input.criterionIds !== undefined ? normalizeStringList(input.criterionIds) : existing?.criterionIds ?? [],
			acceptanceCriteria: input.acceptanceCriteria !== undefined ? normalizeStringList(input.acceptanceCriteria) : existing?.acceptanceCriteria ?? [],
			verificationRequired: input.verificationRequired !== undefined ? normalizeStringList(input.verificationRequired) : existing?.verificationRequired ?? [],
			requiredContext: input.requiredContext !== undefined ? normalizeStringList(input.requiredContext) : existing?.requiredContext ?? [],
			constraints: input.constraints !== undefined ? normalizeStringList(input.constraints) : existing?.constraints ?? [],
			avoid: input.avoid !== undefined ? normalizeStringList(input.avoid) : existing?.avoid ?? [],
			outputContract: typeof input.outputContract === "string" && input.outputContract.trim() ? input.outputContract.trim() : existing?.outputContract ?? "Record changed files, validation evidence, risks, and the suggested next move.",
			sourceRefs: input.sourceRefs !== undefined ? normalizeStringList(input.sourceRefs) : existing?.sourceRefs ?? [],
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
			completedAt: existing?.completedAt,
		};

		if (existingIndex >= 0) state.briefs[existingIndex] = brief;
		else state.briefs.push(brief);
		state.briefs.sort((a, b) => a.id.localeCompare(b.id));
		saveState(ctx, state);
		updateUI(ctx);
		return { ok: true, state, brief, created: existingIndex < 0 };
	}

	function setCurrentBrief(ctx: ExtensionContext, loopName: string, briefId: string): { ok: true; state: LoopState; brief: IterationBrief } | { ok: false; error: string } {
		const state = loadState(ctx, loopName);
		if (!state) return { ok: false, error: `Loop "${loopName}" not found.` };
		const brief = state.briefs.find((item) => item.id === briefId);
		if (!brief) return { ok: false, error: `Brief "${briefId}" not found in loop "${loopName}".` };
		const now = new Date().toISOString();
		for (const item of state.briefs) {
			if (item.status === "active" && item.id !== brief.id) {
				item.status = "draft";
				item.updatedAt = now;
			}
		}
		brief.status = "active";
		brief.completedAt = undefined;
		brief.updatedAt = now;
		state.currentBriefId = brief.id;
		saveState(ctx, state);
		updateUI(ctx);
		return { ok: true, state, brief };
	}

	function clearCurrentBrief(ctx: ExtensionContext, loopName: string): { ok: true; state: LoopState; brief?: IterationBrief } | { ok: false; error: string } {
		const state = loadState(ctx, loopName);
		if (!state) return { ok: false, error: `Loop "${loopName}" not found.` };
		const brief = currentBrief(state);
		if (brief) {
			brief.status = "draft";
			brief.updatedAt = new Date().toISOString();
		}
		state.currentBriefId = undefined;
		saveState(ctx, state);
		updateUI(ctx);
		return { ok: true, state, brief };
	}

	function completeBrief(ctx: ExtensionContext, loopName: string, briefId?: string): { ok: true; state: LoopState; brief: IterationBrief } | { ok: false; error: string } {
		const state = loadState(ctx, loopName);
		if (!state) return { ok: false, error: `Loop "${loopName}" not found.` };
		const id = briefId ?? state.currentBriefId;
		if (!id) return { ok: false, error: "No current brief to complete." };
		const brief = state.briefs.find((item) => item.id === id);
		if (!brief) return { ok: false, error: `Brief "${id}" not found in loop "${loopName}".` };
		const now = new Date().toISOString();
		brief.status = "completed";
		brief.updatedAt = now;
		brief.completedAt = now;
		if (state.currentBriefId === brief.id) state.currentBriefId = undefined;
		saveState(ctx, state);
		updateUI(ctx);
		return { ok: true, state, brief };
	}

	function applyActiveBriefLifecycle(state: LoopState, action: BriefLifecycleAction): IterationBrief | undefined {
		if (action === "keep") return undefined;
		const brief = currentBrief(state);
		if (!brief) return undefined;
		const now = new Date().toISOString();
		brief.updatedAt = now;
		if (action === "complete") {
			brief.status = "completed";
			brief.completedAt = now;
		} else {
			brief.status = "draft";
			brief.completedAt = undefined;
		}
		state.currentBriefId = undefined;
		return brief;
	}

	function formatBriefOverview(state: LoopState): string {
		const active = currentBrief(state);
		const lines = [`Briefs for ${state.name}`, `Current brief: ${active?.id ?? "none"}`, `Briefs: ${state.briefs.length} total`];
		if (state.briefs.length > 0) {
			lines.push("");
			for (const brief of state.briefs.slice(0, 12)) {
				const current = active?.id === brief.id ? " · current" : "";
				const source = brief.source === "governor" ? ` · governor${brief.requestId ? `:${brief.requestId}` : ""}` : "";
				lines.push(`- ${brief.id} [${brief.status}]${current}${source} ${compactText(brief.objective, 120)}`);
				lines.push(`  Task: ${compactText(brief.task, 120)}`);
				if (brief.criterionIds.length) lines.push(`  Criteria: ${brief.criterionIds.join(",")}`);
			}
			if (state.briefs.length > 12) lines.push(`... ${state.briefs.length - 12} more briefs`);
		}
		return lines.join("\n");
	}

	function selectedCriteria(state: LoopState, brief: IterationBrief): Criterion[] {
		const ids = new Set(brief.criterionIds);
		return state.criterionLedger.criteria.filter((criterion) => ids.has(criterion.id));
	}

	function linkedArtifactIds(state: LoopState, brief: IterationBrief): string[] {
		const ids = new Set(brief.criterionIds);
		return state.verificationArtifacts
			.filter((artifact) => artifact.criterionIds?.some((criterionId) => ids.has(criterionId)))
			.map((artifact) => artifact.id)
			.slice(0, 8);
	}

	function appendBriefList(parts: string[], title: string, items: string[], maxItems = 8, maxLength = 180): void {
		if (items.length === 0) return;
		parts.push(title);
		for (const item of items.slice(0, maxItems)) parts.push(`- ${compactText(item, maxLength)}`);
		if (items.length > maxItems) parts.push(`- ... ${items.length - maxItems} more`);
	}

	function appendActiveBriefPromptSection(parts: string[], state: LoopState): void {
		const brief = currentBrief(state);
		if (!brief) return;

		parts.push("## Active Iteration Brief");
		parts.push(`- Brief: ${brief.id}`);
		parts.push(`- Source: ${brief.source}${brief.requestId ? ` (${brief.requestId})` : ""}`);
		parts.push(`- Objective: ${compactText(brief.objective, 220)}`);
		parts.push(`- Task: ${compactText(brief.task, 260)}`);

		const criteria = selectedCriteria(state, brief);
		if (brief.criterionIds.length > 0) {
			parts.push("", "### Selected Criteria");
			for (const criterionId of brief.criterionIds.slice(0, 8)) {
				const criterion = criteria.find((item) => item.id === criterionId);
				if (!criterion) {
					parts.push(`- ${criterionId}: not found in criterion ledger`);
					continue;
				}
				parts.push(`- ${criterion.id} [${criterion.status}]: ${compactText(criterion.description, 160)}`);
				parts.push(`  Pass: ${compactText(criterion.passCondition, 180)}`);
				if (criterion.testMethod) parts.push(`  Verify: ${compactText(criterion.testMethod, 160)}`);
			}
			if (brief.criterionIds.length > 8) parts.push(`- ... ${brief.criterionIds.length - 8} more selected criteria`);
		}

		appendBriefList(parts, "### Acceptance Criteria", brief.acceptanceCriteria);
		appendBriefList(parts, "### Verification Required", brief.verificationRequired);
		appendBriefList(parts, "### Required Context", brief.requiredContext);
		appendBriefList(parts, "### Constraints", brief.constraints);
		appendBriefList(parts, "### Avoid", brief.avoid);
		appendBriefList(parts, "### Source Refs", brief.sourceRefs, 8, 160);
		const artifacts = linkedArtifactIds(state, brief);
		if (artifacts.length > 0) parts.push("### Linked Artifact Refs", `- ${artifacts.join(", ")}`);
		parts.push("### Output Contract", compactText(brief.outputContract, 240) ?? "Record changed files, validation evidence, risks, and the suggested next move.", "");
	}

	function appendTaskSourceSection(parts: string[], state: LoopState, taskContent: string): void {
		const brief = currentBrief(state);
		if (!brief) {
			parts.push(`## Current Task (from ${state.taskFile})\n\n${taskContent}\n\n---`);
			return;
		}
		parts.push(
			"## Task Source",
			`Active brief ${brief.id} is the selected context for this iteration.`,
			`Task file: ${state.taskFile}`,
			"Full task content is omitted from this prompt; read the task file if additional source context is needed.",
			"---",
		);
	}

	function promptPreview(ctx: ExtensionContext, state: LoopState): string | undefined {
		const content = tryRead(path.resolve(ctx.cwd, state.taskFile));
		if (!content) return undefined;
		return compactText(buildPrompt(state, content, "iteration"), 4000);
	}

	function optionalLoopDetails(ctx: ExtensionContext, state: LoopState, options: { includeState?: boolean; includeOverview?: boolean; includePromptPreview?: boolean }): Record<string, unknown> {
		return {
			...(options.includeState ? { loop: summarizeLoopState(ctx, state, false, false) } : {}),
			...(options.includeOverview ? { overview: formatRunOverview(ctx, state, false) } : {}),
			...(options.includePromptPreview ? { promptPreview: promptPreview(ctx, state) } : {}),
		};
	}

	function formatCriterionCounts(ledger: CriterionLedger): string {
		const counts = criterionCounts(ledger);
		return `Criteria: ${counts.total} total, ${counts.passed} passed, ${counts.failed} failed, ${counts.blocked} blocked, ${counts.skipped} skipped, ${counts.pending} pending`;
	}

	function formatLedgerOverview(state: LoopState): string {
		const lines = [`Ledger for ${state.name}`, formatCriterionCounts(state.criterionLedger), `Artifacts: ${state.verificationArtifacts.length} total`];
		if (state.criterionLedger.criteria.length > 0) {
			lines.push("", "Criteria");
			for (const criterion of state.criterionLedger.criteria.slice(0, 12)) {
				lines.push(`- ${criterion.id} [${criterion.status}] ${compactText(criterion.description, 120)}`);
				lines.push(`  Pass: ${compactText(criterion.passCondition, 120)}`);
				if (criterion.evidence) lines.push(`  Evidence: ${compactText(criterion.evidence, 120)}`);
			}
			if (state.criterionLedger.criteria.length > 12) lines.push(`... ${state.criterionLedger.criteria.length - 12} more criteria`);
		}
		if (state.verificationArtifacts.length > 0) {
			lines.push("", "Artifacts");
			for (const artifact of state.verificationArtifacts.slice(0, 12)) {
				const criteria = artifact.criterionIds?.length ? ` · criteria ${artifact.criterionIds.join(",")}` : "";
				lines.push(`- ${artifact.id} [${artifact.kind}] ${compactText(artifact.summary, 120)}${criteria}`);
				if (artifact.path) lines.push(`  Path: ${artifact.path}`);
				if (artifact.command) lines.push(`  Command: ${compactText(artifact.command, 120)}`);
			}
			if (state.verificationArtifacts.length > 12) lines.push(`... ${state.verificationArtifacts.length - 12} more artifacts`);
		}
		return lines.join("\n");
	}

	// --- UI ---

	function formatLoop(l: LoopState): string {
		const status = `${STATUS_ICONS[l.status]} ${l.status}`;
		const iter = l.maxIterations > 0 ? `${l.iteration}/${l.maxIterations}` : `${l.iteration}`;
		return `${l.name}: ${status} (iteration ${iter})`;
	}

	function summarizeLoopState(ctx: ExtensionContext, state: LoopState, archived = false, includeDetails = false): Record<string, unknown> {
		const attempts = state.modeState.kind === "recursive" ? state.modeState.attempts : [];
		const outsideRequests = state.outsideRequests;
		const pendingRequests = pendingOutsideRequests(state);
		const latestAttempt = attempts.at(-1);
		const activeBrief = currentBrief(state);
		const criteria = criterionCounts(state.criterionLedger);
		const artifactsByKind = state.verificationArtifacts.reduce<Record<string, number>>((counts, artifact) => {
			counts[artifact.kind] = (counts[artifact.kind] ?? 0) + 1;
			return counts;
		}, {});
		return {
			name: state.name,
			mode: state.mode,
			status: state.status,
			active: state.active,
			iteration: state.iteration,
			maxIterations: state.maxIterations,
			taskFile: state.taskFile,
			stateFile: path.relative(ctx.cwd, existingStatePath(ctx, state.name, archived)),
			startedAt: state.startedAt,
			completedAt: state.completedAt,
			recursive:
				state.modeState.kind === "recursive"
					? {
							objective: state.modeState.objective,
							attempts: attempts.length,
							reportedAttempts: attempts.filter((attempt) => attempt.status === "reported").length,
							latestAttempt: latestAttempt
								? {
										id: latestAttempt.id,
										iteration: latestAttempt.iteration,
										status: latestAttempt.status,
										kind: latestAttempt.kind,
										result: latestAttempt.result,
										summary: latestAttempt.summary,
									}
								: undefined,
						}
					: undefined,
			outsideRequests: {
				total: outsideRequests.length,
				pending: pendingRequests.length,
				answered: outsideRequests.filter((request) => request.status === "answered").length,
				latestGovernorDecision: latestGovernorDecision(state),
			},
			criteria: {
				...criteria,
				requirementTrace: state.criterionLedger.requirementTrace.length,
			},
			verificationArtifacts: {
				total: state.verificationArtifacts.length,
				byKind: artifactsByKind,
			},
			briefs: {
				total: state.briefs.length,
				currentBriefId: state.currentBriefId,
				current: activeBrief
					? {
							id: activeBrief.id,
							status: activeBrief.status,
							source: activeBrief.source,
							requestId: activeBrief.requestId,
							objective: activeBrief.objective,
							task: activeBrief.task,
							criterionIds: activeBrief.criterionIds,
						}
					: undefined,
			},
			...(includeDetails
				? { modeState: state.modeState, requests: state.outsideRequests, criterionLedger: state.criterionLedger, artifacts: state.verificationArtifacts, briefList: state.briefs }
				: {}),
		};
	}

	function formatStateSummary(state: LoopState): string {
		const attempts = state.modeState.kind === "recursive" ? state.modeState.attempts : [];
		const reported = attempts.filter((attempt) => attempt.status === "reported").length;
		const requestText = state.outsideRequests.length > 0 ? `, outside ${pendingOutsideRequests(state).length}/${state.outsideRequests.length} pending` : "";
		const attemptText = attempts.length > 0 ? `, attempts ${reported}/${attempts.length} reported` : "";
		const criteriaText = state.criterionLedger.criteria.length > 0 ? `, criteria ${criterionCounts(state.criterionLedger).passed}/${state.criterionLedger.criteria.length} passed` : "";
		const artifactsText = state.verificationArtifacts.length > 0 ? `, artifacts ${state.verificationArtifacts.length}` : "";
		const briefText = state.currentBriefId ? `, brief ${state.currentBriefId}` : "";
		return `${formatLoop(state)}${attemptText}${requestText}${criteriaText}${artifactsText}${briefText}`;
	}

	function compactText(value: string | undefined, maxLength = 160): string | undefined {
		if (!value) return undefined;
		const compact = value.replace(/\s+/g, " ").trim();
		return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact;
	}

	function formatRequestTitle(request: OutsideRequest): string {
		const decision = request.decision ? ` · ${request.decision.verdict}` : "";
		return `${request.kind} ${request.id} · ${request.status}${decision}`;
	}

	function formatRunTimeline(state: LoopState): string {
		type TimelineItem = { time: number; order: number; lines: string[] };
		const items: TimelineItem[] = [
			{
				time: Date.parse(state.startedAt) || 0,
				order: 0,
				lines: [`Start · ${state.startedAt}`, `  Mode: ${state.mode}`],
			},
		];

		if (state.modeState.kind === "recursive") {
			for (const attempt of state.modeState.attempts) {
				const result = attempt.result ? ` · ${attempt.result}` : "";
				const kind = attempt.kind ? ` · ${attempt.kind}` : "";
				const summary = compactText(attempt.summary || attempt.hypothesis || attempt.actionSummary);
				items.push({
					time: Date.parse(attempt.updatedAt ?? attempt.createdAt) || 0,
					order: attempt.iteration * 10 + 1,
					lines: [`Attempt ${attempt.iteration} · ${attempt.status}${kind}${result}`, summary ? `  ${summary}` : "  No summary recorded."],
				});
			}
		}

		for (const request of state.outsideRequests) {
			const nextMove = compactText(request.decision?.requiredNextMove);
			const answer = compactText(request.answer);
			items.push({
				time: Date.parse(request.consumedAt ?? request.requestedAt) || 0,
				order: request.requestedByIteration * 10 + 2,
				lines: [
					`Request ${request.requestedByIteration} · ${formatRequestTitle(request)}`,
					nextMove ? `  Next: ${nextMove}` : answer ? `  Answer: ${answer}` : `  Trigger: ${request.trigger}`,
				],
			});
		}

		if (state.completedAt) {
			items.push({
				time: Date.parse(state.completedAt) || Number.MAX_SAFE_INTEGER,
				order: Number.MAX_SAFE_INTEGER,
				lines: [`Complete · ${state.completedAt}`, `  Final status: ${state.status}`],
			});
		}

		const lines = [`Timeline: ${state.name}`];
		items
			.sort((a, b) => a.time - b.time || a.order - b.order)
			.forEach((item, index) => {
				lines.push(`${index + 1}. ${item.lines[0]}`);
				lines.push(...item.lines.slice(1));
			});
		return lines.join("\n");
	}

	function formatRunOverview(ctx: ExtensionContext, state: LoopState, archived = false): string {
		const attempts = state.modeState.kind === "recursive" ? state.modeState.attempts : [];
		const reported = attempts.filter((attempt) => attempt.status === "reported").length;
		const pending = pendingOutsideRequests(state).length;
		const latestDecision = latestGovernorDecision(state);
		const activeBrief = currentBrief(state);
		const lines = [
			`Stardock run: ${state.name}`,
			`Status: ${STATUS_ICONS[state.status]} ${state.status} · ${state.mode} · iteration ${state.iteration}${state.maxIterations > 0 ? `/${state.maxIterations}` : ""}`,
			`Task: ${state.taskFile}`,
			`State: ${path.relative(ctx.cwd, existingStatePath(ctx, state.name, archived))}`,
		];

		if (state.modeState.kind === "recursive") {
			lines.push("", "Objective", `  ${state.modeState.objective}`);
			if (state.modeState.baseline) lines.push(`  Baseline: ${state.modeState.baseline}`);
			if (state.modeState.validationCommand) lines.push(`  Validation: ${state.modeState.validationCommand}`);
		}

		lines.push("", "Progress", `  Attempts: ${reported}/${attempts.length} reported`, `  Outside requests: ${pending}/${state.outsideRequests.length} pending`);
		lines.push(`  ${formatCriterionCounts(state.criterionLedger)}`, `  Verification artifacts: ${state.verificationArtifacts.length}`, `  Briefs: ${state.briefs.length}${activeBrief ? ` (current ${activeBrief.id})` : ""}`);
		if (activeBrief) {
			lines.push("", "Active brief", `  ${activeBrief.id}: ${compactText(activeBrief.objective, 180)}`, `  Task: ${compactText(activeBrief.task, 180)}`);
			if (activeBrief.criterionIds.length) lines.push(`  Criteria: ${activeBrief.criterionIds.join(", ")}`);
		}
		if (latestDecision) {
			lines.push("", "Latest governor decision", `  Verdict: ${latestDecision.verdict}`, `  Rationale: ${compactText(latestDecision.rationale, 220) ?? "none"}`);
			if (latestDecision.requiredNextMove) lines.push(`  Required next move: ${latestDecision.requiredNextMove}`);
		}
		lines.push("", formatRunTimeline(state));
		return lines.join("\n");
	}

	function updateUI(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;

		const state = currentLoop ? loadState(ctx, currentLoop) : null;
		if (!state || state.status !== "active") {
			ctx.ui.setStatus("stardock", undefined);
			ctx.ui.setWidget("stardock", undefined);
			return;
		}

		const { theme } = ctx.ui;
		const maxStr = state.maxIterations > 0 ? `/${state.maxIterations}` : "";
		const attempts = state.modeState.kind === "recursive" ? state.modeState.attempts : [];
		const reportedAttempts = attempts.filter((attempt) => attempt.status === "reported").length;
		const latestAttempt = attempts.at(-1);
		const pendingRequests = pendingOutsideRequests(state).length;
		const latestDecision = latestGovernorDecision(state);

		ctx.ui.setStatus("stardock", theme.fg("accent", `🔄 ${state.name} · ${state.iteration}${maxStr}`));

		const lines = [
			theme.fg("accent", theme.bold("Stardock")),
			theme.fg("muted", `Loop: ${state.name}`),
			theme.fg("dim", `${STATUS_ICONS[state.status]} ${state.status} · ${state.mode} · iteration ${state.iteration}${maxStr}`),
		];

		if (state.modeState.kind === "recursive") {
			lines.push(theme.fg("dim", `Objective: ${compactText(state.modeState.objective, 72)}`));
			lines.push(theme.fg("dim", `Attempts: ${reportedAttempts}/${attempts.length} reported`));
			if (latestAttempt) {
				const attemptKind = latestAttempt.kind ? ` · ${latestAttempt.kind}` : "";
				const attemptResult = latestAttempt.result ? ` · ${latestAttempt.result}` : "";
				lines.push(theme.fg("dim", `Last: #${latestAttempt.iteration}${attemptKind}${attemptResult}`));
			}
		}

		lines.push(theme.fg("dim", `Outside: ${pendingRequests}/${state.outsideRequests.length} pending`));
		if (latestDecision?.requiredNextMove) {
			lines.push(theme.fg("warning", `Governor: ${compactText(latestDecision.requiredNextMove, 88)}`));
		} else if (latestDecision?.verdict) {
			lines.push(theme.fg("dim", `Governor: ${latestDecision.verdict}`));
		}
		if (state.reflectEvery > 0) {
			const next = state.reflectEvery - ((state.iteration - 1) % state.reflectEvery);
			lines.push(theme.fg("dim", `Next reflection in: ${next} iterations`));
		}
		lines.push("");
		lines.push(theme.fg("warning", "ESC pauses · /stardock view for details · /stardock-stop ends"));
		ctx.ui.setWidget("stardock", lines);
	}

	// --- Prompt building ---

	function buildChecklistPrompt(state: LoopState, taskContent: string, reason: PromptReason): string {
		const isReflection = reason === "reflection";
		const maxStr = state.maxIterations > 0 ? `/${state.maxIterations}` : "";
		const header = `───────────────────────────────────────────────────────────────────────
🔄 STARDOCK LOOP: ${state.name} | Iteration ${state.iteration}${maxStr}${isReflection ? " | 🪞 REFLECTION" : ""}
───────────────────────────────────────────────────────────────────────`;

		const parts = [header, ""];
		if (isReflection) parts.push(state.reflectInstructions, "\n---\n");

		appendActiveBriefPromptSection(parts, state);
		appendTaskSourceSection(parts, state, taskContent);
		parts.push(`\n## Instructions\n`);
		parts.push("User controls: ESC pauses the assistant. Send a message to resume. Run /stardock-stop when idle to stop the loop.\n");
		parts.push(
			`You are in a Stardock loop (iteration ${state.iteration}${state.maxIterations > 0 ? ` of ${state.maxIterations}` : ""}).\n`,
		);

		if (state.itemsPerIteration > 0) {
			parts.push(`**THIS ITERATION: Process approximately ${state.itemsPerIteration} items, then call stardock_done.**\n`);
			parts.push(`1. Work on the next ~${state.itemsPerIteration} items from your checklist`);
		} else {
			parts.push(`1. Continue working on the task`);
		}
		parts.push(`2. Update the task file (${state.taskFile}) with your progress`);
		parts.push(`3. When FULLY COMPLETE, respond with: ${COMPLETE_MARKER}`);
		parts.push(`4. Otherwise, call the stardock_done tool to proceed to next iteration`);

		return parts.join("\n");
	}

	function requireRecursiveState(state: LoopState): RecursiveModeState {
		return state.modeState.kind === "recursive" ? state.modeState : defaultRecursiveModeState();
	}

	function formatRecursiveSetup(modeState: RecursiveModeState): string[] {
		const lines = [`- Objective: ${modeState.objective}`];
		if (modeState.baseline) lines.push(`- Baseline/current best: ${modeState.baseline}`);
		if (modeState.validationCommand) lines.push(`- Validation command/check: ${modeState.validationCommand}`);
		lines.push(`- Reset policy: ${modeState.resetPolicy}`);
		lines.push(`- Stop when: ${modeState.stopWhen.join(", ")}`);
		if (modeState.maxFailedAttempts) lines.push(`- Max failed attempts: ${modeState.maxFailedAttempts}`);
		if (modeState.governEvery) lines.push(`- Governor review cue: every ${modeState.governEvery} iterations`);
		if (modeState.outsideHelpEvery) lines.push(`- Outside help cue: every ${modeState.outsideHelpEvery} iterations`);
		if (modeState.outsideHelpOnStagnation) lines.push("- Outside help cue: stagnation or repeated low-value attempts");
		return lines;
	}

	function formatRecentAttemptReports(modeState: RecursiveModeState): string[] {
		return modeState.attempts
			.filter((attempt) => attempt.status === "reported")
			.slice(-3)
			.map((attempt) => {
				const label = [`attempt ${attempt.iteration}`, attempt.kind, attempt.result].filter(Boolean).join(" · ");
				return `- ${label}: ${attempt.summary}`;
			});
	}

	function appendOutsideRequestPromptSections(parts: string[], state: LoopState): void {
		const pending = pendingOutsideRequests(state);
		if (pending.length > 0) {
			parts.push("## Pending Outside Requests");
			for (const request of pending.slice(0, 5)) {
				parts.push(`- ${request.id} (${request.kind}, ${request.trigger}): ${request.prompt}`);
			}
			parts.push("Use parent/orchestrator help if needed, then record answers with stardock_outside_answer or /stardock outside answer.", "");
		}

		const decision = latestGovernorDecision(state);
		if (decision) {
			parts.push("## Latest Governor Steer", `- Verdict: ${decision.verdict}`, `- Rationale: ${decision.rationale}`);
			if (decision.requiredNextMove) parts.push(`- Required next move: ${decision.requiredNextMove}`);
			if (decision.forbiddenNextMoves?.length) parts.push(`- Forbidden next moves: ${decision.forbiddenNextMoves.join(", ")}`);
			if (decision.evidenceGaps?.length) parts.push(`- Evidence gaps: ${decision.evidenceGaps.join(", ")}`);
			parts.push("Follow the steer or record a concrete reason for rejecting it in the task file.", "");
		}
	}

	const checklistModeHandler: LoopModeHandler = {
		mode: "checklist",
		buildPrompt: buildChecklistPrompt,
		buildSystemInstructions(state) {
			let instructions = `You are in a Stardock loop working on: ${state.taskFile}\n`;
			if (state.itemsPerIteration > 0) {
				instructions += `- Work on ~${state.itemsPerIteration} items this iteration\n`;
			}
			instructions += `- Update the task file as you progress\n`;
			instructions += `- When FULLY COMPLETE: ${COMPLETE_MARKER}\n`;
			instructions += `- Otherwise, call stardock_done tool to proceed to next iteration`;
			return instructions;
		},
		onIterationDone() {},
		summarize(state) {
			const maxStr = state.maxIterations > 0 ? `/${state.maxIterations}` : "";
			return [`Iteration ${state.iteration}${maxStr}`, `Task: ${state.taskFile}`];
		},
	};

	const recursiveModeHandler: LoopModeHandler = {
		mode: "recursive",
		buildPrompt(state, taskContent, reason) {
			const modeState = requireRecursiveState(state);
			const isReflection = reason === "reflection";
			const maxStr = state.maxIterations > 0 ? `/${state.maxIterations}` : "";
			const header = `───────────────────────────────────────────────────────────────────────
🔁 STARDOCK RECURSIVE LOOP: ${state.name} | Attempt ${state.iteration}${maxStr}${isReflection ? " | 🪞 REFLECTION" : ""}
───────────────────────────────────────────────────────────────────────`;
			const parts = [header, ""];
			if (isReflection) parts.push(state.reflectInstructions, "\n---\n");
			parts.push("## Recursive Objective", ...formatRecursiveSetup(modeState), "");
			const recentAttempts = formatRecentAttemptReports(modeState);
			if (recentAttempts.length > 0) parts.push("## Recent Attempt Reports", ...recentAttempts, "");
			appendOutsideRequestPromptSections(parts, state);
			appendActiveBriefPromptSection(parts, state);
			appendTaskSourceSection(parts, state, taskContent);
			parts.push("\n## Attempt Instructions\n");
			parts.push("Treat this iteration as one bounded implementer attempt, not an open-ended lane.");
			parts.push("1. Choose or state one concrete hypothesis for improving the objective.");
			parts.push("2. Make one bounded attempt that tests that hypothesis.");
			if (modeState.validationCommand) {
				parts.push(`3. Run or explain the validation check: ${modeState.validationCommand}`);
			} else {
				parts.push("3. Run or describe the most relevant validation available for this attempt.");
			}
			parts.push("4. Record the hypothesis, action summary, validation, result, and keep/reset decision in the task file; use stardock_attempt_report when available.");
			parts.push(`5. Apply reset policy: ${modeState.resetPolicy}.`);
			parts.push(`6. When the objective is met or stop criteria apply, respond with: ${COMPLETE_MARKER}`);
			parts.push("7. Otherwise, call the stardock_done tool to proceed to the next bounded attempt.");
			if (modeState.governEvery || modeState.outsideHelpEvery || modeState.outsideHelpOnStagnation) {
				parts.push("\nOutside-help cues are configured. If this attempt is blocked, stagnant, or out of ideas, record the needed help in the task file before calling stardock_done.");
			}
			return parts.join("\n");
		},
		buildSystemInstructions(state) {
			const modeState = requireRecursiveState(state);
			const pending = pendingOutsideRequests(state).length;
			const decision = latestGovernorDecision(state);
			return [
				"You are in a Stardock recursive loop.",
				`- Objective: ${modeState.objective}`,
				"- Work on one bounded hypothesis/attempt this iteration.",
				modeState.validationCommand
					? `- Validate with or explain: ${modeState.validationCommand}`
					: "- Run or describe relevant validation for the attempt.",
				pending > 0 ? `- There are ${pending} pending outside request(s); include or record answers when relevant.` : undefined,
				decision?.requiredNextMove ? `- Governor required next move: ${decision.requiredNextMove}` : undefined,
				"- Record hypothesis, actions, validation, result, and keep/reset decision in the task file; use stardock_attempt_report when available.",
				`- When FULLY COMPLETE or stop criteria apply: ${COMPLETE_MARKER}`,
				"- Otherwise, call stardock_done tool to proceed to next iteration.",
			]
				.filter((line): line is string => Boolean(line))
				.join("\n");
		},
		onIterationDone(state) {
			const modeState = requireRecursiveState(state);
			if (!modeState.attempts.some((attempt) => attempt.iteration === state.iteration)) {
				modeState.attempts.push({
					id: `attempt-${state.iteration}`,
					iteration: state.iteration,
					createdAt: new Date().toISOString(),
					status: "pending_report",
					summary: "Agent should record hypothesis, actions, validation, result, and keep/reset decision in the task file.",
				});
			}
			maybeCreateRecursiveOutsideRequests(state, modeState);
			state.modeState = modeState;
		},
		summarize(state) {
			const modeState = requireRecursiveState(state);
			const maxStr = state.maxIterations > 0 ? `/${state.maxIterations}` : "";
			const reportedCount = modeState.attempts.filter((attempt) => attempt.status === "reported").length;
			const summary = [
				`Attempt ${state.iteration}${maxStr}`,
				`Objective: ${modeState.objective}`,
				`Recorded attempts: ${modeState.attempts.length} (${reportedCount} reported)`,
				`Pending outside requests: ${pendingOutsideRequests(state).length}`,
			];
			const decision = latestGovernorDecision(state);
			if (decision?.requiredNextMove) summary.push(`Governor steer: ${decision.requiredNextMove}`);
			return summary;
		},
	};

	function getModeHandler(mode: LoopMode): LoopModeHandler {
		if (mode === "recursive") return recursiveModeHandler;
		return checklistModeHandler;
	}

	function buildPrompt(state: LoopState, taskContent: string, reason: PromptReason): string {
		return getModeHandler(state.mode).buildPrompt(state, taskContent, reason);
	}

	// --- Arg parsing ---

	function isImplementedMode(mode: string): mode is "checklist" | "recursive" {
		return mode === "checklist" || mode === "recursive";
	}

	function unsupportedModeMessage(mode: string): string {
		if (mode === "evolve") return `Stardock mode "${mode}" is planned but not implemented yet.`;
		return `Unsupported Stardock mode "${mode}". Supported modes: checklist, recursive.`;
	}

	function isResetPolicy(value: unknown): value is RecursiveResetPolicy {
		return value === "manual" || value === "revert_failed_attempts" || value === "keep_best_only";
	}

	function isStopCriterion(value: string): value is RecursiveStopCriterion {
		return ["target_reached", "idea_exhaustion", "max_failed_attempts", "max_iterations", "user_decision"].includes(value);
	}

	function parseStopWhen(value: unknown): RecursiveStopCriterion[] {
		const rawValues = Array.isArray(value)
			? value
			: typeof value === "string"
				? value.split(",").map((part) => part.trim())
				: [];
		const parsed = rawValues.filter((part): part is RecursiveStopCriterion => typeof part === "string" && isStopCriterion(part));
		return parsed.length > 0 ? parsed : ["target_reached", "idea_exhaustion", "max_iterations"];
	}

	function isAttemptKind(value: unknown): value is RecursiveAttemptKind {
		return ["candidate_change", "setup", "refactor", "instrumentation", "benchmark_scaffold", "research", "other"].includes(String(value));
	}

	function isAttemptResult(value: unknown): value is RecursiveAttemptResult {
		return ["improved", "neutral", "worse", "invalid", "blocked"].includes(String(value));
	}

	function createModeState(mode: "checklist" | "recursive", input: Record<string, unknown>): { modeState?: LoopModeState; error?: string } {
		if (mode === "checklist") return { modeState: defaultModeState("checklist") };

		const objective = typeof input.objective === "string" ? input.objective.trim() : "";
		if (!objective) return { error: 'Recursive Stardock mode requires an "objective".' };

		const resetPolicy = isResetPolicy(input.resetPolicy) ? input.resetPolicy : "manual";
		const state: RecursiveModeState = {
			...defaultRecursiveModeState(objective),
			baseline: typeof input.baseline === "string" && input.baseline.trim() ? input.baseline.trim() : undefined,
			validationCommand:
				typeof input.validationCommand === "string" && input.validationCommand.trim() ? input.validationCommand.trim() : undefined,
			resetPolicy,
			stopWhen: parseStopWhen(input.stopWhen),
			maxFailedAttempts: numberOrDefault(input.maxFailedAttempts, 0) > 0 ? numberOrDefault(input.maxFailedAttempts, 0) : undefined,
			outsideHelpEvery: numberOrDefault(input.outsideHelpEvery, 0) > 0 ? numberOrDefault(input.outsideHelpEvery, 0) : undefined,
			governEvery: numberOrDefault(input.governEvery, 0) > 0 ? numberOrDefault(input.governEvery, 0) : undefined,
			outsideHelpOnStagnation: input.outsideHelpOnStagnation === true,
		};
		return { modeState: state };
	}

	function parseLoopViewArgs(rest: string): { loopName?: string; archived: boolean } {
		const tokens = rest.trim().split(/\s+/).filter(Boolean);
		const archived = tokens.includes("--archived");
		const loopName = tokens.find((token) => token !== "--archived");
		return { loopName, archived };
	}

	function selectLoopForView(ctx: ExtensionContext, loopName: string | undefined, archived: boolean): LoopState | null {
		if (loopName) return loadState(ctx, loopName, archived);
		if (currentLoop) {
			const current = loadState(ctx, currentLoop, archived);
			if (current) return current;
		}
		const loops = listLoops(ctx, archived);
		if (loops.length === 0) return null;
		return loops.reduce((best, candidate) => {
			const bestMtime = safeMtimeMs(existingStatePath(ctx, best.name, archived));
			const candidateMtime = safeMtimeMs(existingStatePath(ctx, candidate.name, archived));
			return candidateMtime > bestMtime ? candidate : best;
		});
	}

	function parseArgs(argsStr: string) {
		const tokens = argsStr.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
		const result = {
			name: "",
			mode: "checklist",
			objective: "",
			baseline: undefined as string | undefined,
			validationCommand: undefined as string | undefined,
			resetPolicy: "manual",
			stopWhen: undefined as string | undefined,
			maxFailedAttempts: undefined as number | undefined,
			outsideHelpEvery: undefined as number | undefined,
			governEvery: undefined as number | undefined,
			outsideHelpOnStagnation: false,
			maxIterations: 50,
			itemsPerIteration: 0,
			reflectEvery: 0,
			reflectInstructions: DEFAULT_REFLECT_INSTRUCTIONS,
		};

		for (let i = 0; i < tokens.length; i++) {
			const tok = tokens[i];
			const next = tokens[i + 1];
			if (tok === "--max-iterations" && next) {
				result.maxIterations = parseInt(next, 10) || 0;
				i++;
			} else if (tok === "--mode" && next) {
				result.mode = next.replace(/^"|"$/g, "");
				i++;
			} else if (tok === "--objective" && next) {
				result.objective = next.replace(/^"|"$/g, "");
				i++;
			} else if (tok === "--baseline" && next) {
				result.baseline = next.replace(/^"|"$/g, "");
				i++;
			} else if (tok === "--validation-command" && next) {
				result.validationCommand = next.replace(/^"|"$/g, "");
				i++;
			} else if (tok === "--reset-policy" && next) {
				result.resetPolicy = next.replace(/^"|"$/g, "");
				i++;
			} else if (tok === "--stop-when" && next) {
				result.stopWhen = next.replace(/^"|"$/g, "");
				i++;
			} else if (tok === "--max-failed-attempts" && next) {
				result.maxFailedAttempts = parseInt(next, 10) || undefined;
				i++;
			} else if (tok === "--outside-help-every" && next) {
				result.outsideHelpEvery = parseInt(next, 10) || undefined;
				i++;
			} else if (tok === "--govern-every" && next) {
				result.governEvery = parseInt(next, 10) || undefined;
				i++;
			} else if (tok === "--outside-help-on-stagnation") {
				result.outsideHelpOnStagnation = true;
			} else if (tok === "--items-per-iteration" && next) {
				result.itemsPerIteration = parseInt(next, 10) || 0;
				i++;
			} else if (tok === "--reflect-every" && next) {
				result.reflectEvery = parseInt(next, 10) || 0;
				i++;
			} else if (tok === "--reflect-instructions" && next) {
				result.reflectInstructions = next.replace(/^"|"$/g, "");
				i++;
			} else if (!tok.startsWith("--")) {
				result.name = tok;
			}
		}
		return result;
	}

	// --- Commands ---

	const commands: Record<string, (rest: string, ctx: ExtensionContext) => void> = {
		start(rest, ctx) {
			const args = parseArgs(rest);
			if (!args.name) {
				ctx.ui.notify(
					"Usage: /stardock start <name|path> [--mode checklist|recursive] [--objective TEXT] [--items-per-iteration N] [--reflect-every N] [--max-iterations N]",
					"warning",
				);
				return;
			}

			if (!isImplementedMode(args.mode)) {
				ctx.ui.notify(unsupportedModeMessage(args.mode), "warning");
				return;
			}
			const mode = args.mode;
			const modeResult = createModeState(mode, args);
			if (modeResult.error || !modeResult.modeState) {
				ctx.ui.notify(modeResult.error ?? "Could not create Stardock mode state.", "warning");
				return;
			}

			const isPath = args.name.includes("/") || args.name.includes("\\");
			const loopName = isPath ? sanitize(path.basename(args.name, path.extname(args.name))) : args.name;
			const taskFile = isPath ? args.name : defaultTaskFile(loopName);

			const existing = loadState(ctx, loopName);
			if (existing?.status === "active") {
				ctx.ui.notify(`Loop "${loopName}" is already active. Use /stardock resume ${loopName}`, "warning");
				return;
			}

			const fullPath = path.resolve(ctx.cwd, taskFile);
			if (!fs.existsSync(fullPath)) {
				ensureDir(fullPath);
				fs.writeFileSync(fullPath, DEFAULT_TEMPLATE, "utf-8");
				ctx.ui.notify(`Created task file: ${taskFile}`, "info");
			}

			const state: LoopState = {
				schemaVersion: 3,
				name: loopName,
				taskFile,
				mode,
				iteration: 1,
				maxIterations: args.maxIterations,
				itemsPerIteration: args.itemsPerIteration,
				reflectEvery: args.reflectEvery,
				reflectInstructions: args.reflectInstructions,
				active: true,
				status: "active",
				startedAt: existing?.startedAt || new Date().toISOString(),
				lastReflectionAt: 0,
				modeState: modeResult.modeState,
				outsideRequests: [],
				criterionLedger: defaultCriterionLedger(),
				verificationArtifacts: [],
				briefs: [],
			};

			saveState(ctx, state);
			currentLoop = loopName;
			updateUI(ctx);

			const content = tryRead(fullPath);
			if (!content) {
				ctx.ui.notify(`Could not read task file: ${taskFile}`, "error");
				return;
			}
			pi.sendUserMessage(buildPrompt(state, content, "iteration"));
		},

		stop(_rest, ctx) {
			if (!currentLoop) {
				// Check persisted state for any active loop
				const active = listLoops(ctx).find((l) => l.status === "active");
				if (active) {
					pauseLoop(ctx, active, `Paused Stardock loop: ${active.name} (iteration ${active.iteration})`);
				} else {
					ctx.ui.notify("No active Stardock loop", "warning");
				}
				return;
			}
			const state = loadState(ctx, currentLoop);
			if (state) {
				pauseLoop(ctx, state, `Paused Stardock loop: ${currentLoop} (iteration ${state.iteration})`);
			}
		},

		resume(rest, ctx) {
			const loopName = rest.trim();
			if (!loopName) {
				ctx.ui.notify("Usage: /stardock resume <name>", "warning");
				return;
			}

			const state = loadState(ctx, loopName);
			if (!state) {
				ctx.ui.notify(`Loop "${loopName}" not found`, "error");
				return;
			}
			if (state.status === "completed") {
				ctx.ui.notify(`Loop "${loopName}" is completed. Use /stardock start ${loopName} to restart`, "warning");
				return;
			}

			// Pause current loop if different
			if (currentLoop && currentLoop !== loopName) {
				const curr = loadState(ctx, currentLoop);
				if (curr) pauseLoop(ctx, curr);
			}

			state.status = "active";
			state.active = true;
			state.iteration++;
			saveState(ctx, state);
			currentLoop = loopName;
			updateUI(ctx);

			ctx.ui.notify(`Resumed: ${loopName} (iteration ${state.iteration})`, "info");

			const content = tryRead(path.resolve(ctx.cwd, state.taskFile));
			if (!content) {
				ctx.ui.notify(`Could not read task file: ${state.taskFile}`, "error");
				return;
			}

			const needsReflection =
				state.reflectEvery > 0 && state.iteration > 1 && (state.iteration - 1) % state.reflectEvery === 0;
			pi.sendUserMessage(buildPrompt(state, content, needsReflection ? "reflection" : "iteration"));
		},

		status(_rest, ctx) {
			const loops = listLoops(ctx);
			if (loops.length === 0) {
				ctx.ui.notify("No Stardock loops found.", "info");
				return;
			}
			ctx.ui.notify(`Stardock loops:\n${loops.map((l) => formatLoop(l)).join("\n")}`, "info");
		},

		view(rest, ctx) {
			const args = parseLoopViewArgs(rest);
			const state = selectLoopForView(ctx, args.loopName, args.archived);
			if (!state) {
				ctx.ui.notify(args.loopName ? `Loop "${args.loopName}" not found.` : "No Stardock loops found.", "warning");
				return;
			}
			ctx.ui.notify(formatRunOverview(ctx, state, args.archived), "info");
		},

		timeline(rest, ctx) {
			const args = parseLoopViewArgs(rest);
			const state = selectLoopForView(ctx, args.loopName, args.archived);
			if (!state) {
				ctx.ui.notify(args.loopName ? `Loop "${args.loopName}" not found.` : "No Stardock loops found.", "warning");
				return;
			}
			ctx.ui.notify(formatRunTimeline(state), "info");
		},

		cancel(rest, ctx) {
			const loopName = rest.trim();
			if (!loopName) {
				ctx.ui.notify("Usage: /stardock cancel <name>", "warning");
				return;
			}
			if (!loadState(ctx, loopName)) {
				ctx.ui.notify(`Loop "${loopName}" not found`, "error");
				return;
			}
			if (currentLoop === loopName) currentLoop = null;
			tryDelete(statePath(ctx, loopName));
			tryDelete(legacyPath(ctx, loopName, ".state.json"));
			ctx.ui.notify(`Cancelled: ${loopName}`, "info");
			updateUI(ctx);
		},

		archive(rest, ctx) {
			const loopName = rest.trim();
			if (!loopName) {
				ctx.ui.notify("Usage: /stardock archive <name>", "warning");
				return;
			}
			const state = loadState(ctx, loopName);
			if (!state) {
				ctx.ui.notify(`Loop "${loopName}" not found`, "error");
				return;
			}
			if (state.status === "active") {
				ctx.ui.notify("Cannot archive active loop. Stop it first.", "warning");
				return;
			}

			if (currentLoop === loopName) currentLoop = null;

			const sourceRunDir = runDir(ctx, loopName);
			const sourceTask = path.resolve(ctx.cwd, state.taskFile);
			const taskIsManaged = sourceTask.startsWith(stardockDir(ctx)) && !sourceTask.startsWith(archiveDir(ctx));
			if (taskIsManaged) state.taskFile = path.relative(ctx.cwd, taskPath(ctx, loopName, true));
			saveState(ctx, state, true);

			if (taskIsManaged && fs.existsSync(sourceTask)) {
				const destinationTask = taskPath(ctx, loopName, true);
				ensureDir(destinationTask);
				tryDelete(destinationTask);
				fs.renameSync(sourceTask, destinationTask);
			}

			tryRemoveDir(sourceRunDir);
			tryDelete(legacyPath(ctx, loopName, ".state.json"));
			if (taskIsManaged) tryDelete(legacyPath(ctx, loopName, ".md"));

			ctx.ui.notify(`Archived: ${loopName}`, "info");
			updateUI(ctx);
		},

		clean(rest, ctx) {
			const all = rest.trim() === "--all";
			const completed = listLoops(ctx).filter((l) => l.status === "completed");

			if (completed.length === 0) {
				ctx.ui.notify("No completed loops to clean", "info");
				return;
			}

			for (const loop of completed) {
				tryDelete(statePath(ctx, loop.name));
				tryDelete(legacyPath(ctx, loop.name, ".state.json"));
				if (all) {
					tryRemoveDir(runDir(ctx, loop.name));
					tryDelete(legacyPath(ctx, loop.name, ".md"));
				}
				if (currentLoop === loop.name) currentLoop = null;
			}

			const suffix = all ? " (all files)" : " (state only)";
			ctx.ui.notify(
				`Cleaned ${completed.length} loop(s)${suffix}:\n${completed.map((l) => `  • ${l.name}`).join("\n")}`,
				"info",
			);
			updateUI(ctx);
		},

		list(rest, ctx) {
			const archived = rest.trim() === "--archived";
			const loops = listLoops(ctx, archived);

			if (loops.length === 0) {
				ctx.ui.notify(
					archived ? "No archived loops" : "No loops found. Use /stardock list --archived for archived.",
					"info",
				);
				return;
			}

			const label = archived ? "Archived loops" : "Stardock loops";
			ctx.ui.notify(`${label}:\n${loops.map((l) => formatLoop(l)).join("\n")}`, "info");
		},

		govern(rest, ctx) {
			const loopName = rest.trim() || currentLoop;
			if (!loopName) {
				ctx.ui.notify("Usage: /stardock govern [loop]", "warning");
				return;
			}
			const result = createManualGovernorPayload(ctx, loopName);
			ctx.ui.notify(result.ok ? result.payload : result.error, result.ok ? "info" : "error");
		},

		outside(rest, ctx) {
			const [action, loopArg, requestId, ...answerParts] = rest.trim().split(/\s+/).filter(Boolean);
			if (action === "payload") {
				if (!loopArg || !requestId) {
					ctx.ui.notify("Usage: /stardock outside payload <loop> <request-id>", "warning");
					return;
				}
				const result = getOutsideRequestPayload(ctx, loopArg, requestId);
				ctx.ui.notify(result.ok ? result.payload : result.error, result.ok ? "info" : "error");
				return;
			}
			if (action === "answer") {
				if (!loopArg || !requestId || answerParts.length === 0) {
					ctx.ui.notify("Usage: /stardock outside answer <loop> <request-id> <answer>", "warning");
					return;
				}
				const result = answerOutsideRequest(ctx, loopArg, requestId, answerParts.join(" "));
				ctx.ui.notify(result.ok ? `Recorded answer for ${requestId}.` : result.error, result.ok ? "info" : "error");
				return;
			}

			const loopName = action || currentLoop;
			if (!loopName) {
				ctx.ui.notify("Usage: /stardock outside [loop]", "warning");
				return;
			}
			const state = loadState(ctx, loopName);
			ctx.ui.notify(state ? `Outside requests for ${loopName}:\n${formatOutsideRequests(state)}` : `Loop "${loopName}" not found.`, state ? "info" : "error");
		},

		nuke(rest, ctx) {
			const force = rest.trim() === "--yes";
			const warning =
				"This deletes all .stardock state, task, and archive files. External task files are not removed.";

			const run = () => {
				const dir = stardockDir(ctx);
				if (!fs.existsSync(dir)) {
					if (ctx.hasUI) ctx.ui.notify("No .stardock directory found.", "info");
					return;
				}

				currentLoop = null;
				const ok = tryRemoveDir(dir);
				if (ctx.hasUI) {
					ctx.ui.notify(ok ? "Removed .stardock directory." : "Failed to remove .stardock directory.", ok ? "info" : "error");
				}
				updateUI(ctx);
			};

			if (!force) {
				if (ctx.hasUI) {
					void ctx.ui.confirm("Delete all Stardock loop files?", warning).then((confirmed) => {
						if (confirmed) run();
					});
				} else {
					ctx.ui.notify(`Run /stardock nuke --yes to confirm. ${warning}`, "warning");
				}
				return;
			}

			if (ctx.hasUI) ctx.ui.notify(warning, "warning");
			run();
		},
	};

	const HELP = `Stardock - Governed implementation loops

Commands:
  /stardock start <name|path> [options]  Start a new loop
  /stardock stop                         Pause current loop
  /stardock resume <name>                Resume a paused loop
  /stardock status                       Show all loops
  /stardock view [loop] [--archived]     Show run overview and timeline
  /stardock timeline [loop] [--archived] Show run timeline only
  /stardock cancel <name>                Delete loop state
  /stardock archive <name>               Move loop to archive
  /stardock clean [--all]                Clean completed loops
  /stardock list --archived              Show archived loops
  /stardock govern [loop]                Create governor request payload
  /stardock outside [loop]               Show outside requests
  /stardock outside payload <loop> <id>  Show ready-to-copy request payload
  /stardock outside answer <loop> <id> <answer>
                                      Record outside request answer
  /stardock nuke [--yes]                 Delete all .stardock data
  /stardock-stop                         Stop active loop (idle only)

Options:
  --items-per-iteration N  Suggest N items per turn (prompt hint)
  --reflect-every N        Reflect every N iterations
  --max-iterations N       Stop after N iterations (default 50)
  --mode checklist|recursive
                            Select loop mode
  --objective TEXT         Required for recursive mode

To stop: press ESC to interrupt, then run /stardock-stop when idle

Examples:
  /stardock start my-feature
  /stardock start review --items-per-iteration 5 --reflect-every 10`;

	pi.registerCommand("stardock", {
		description: "Stardock - governed implementation loops",
		handler: async (args, ctx) => {
			const [cmd] = args.trim().split(/\s+/);
			const handler = commands[cmd];
			if (handler) {
				handler(args.slice(cmd.length).trim(), ctx);
			} else {
				ctx.ui.notify(HELP, "info");
			}
		},
	});

	pi.registerCommand("stardock-stop", {
		description: "Stop active Stardock loop (idle only)",
		handler: async (_args, ctx) => {
			if (!ctx.isIdle()) {
				if (ctx.hasUI) {
					ctx.ui.notify("Agent is busy. Press ESC to interrupt, then run /stardock-stop.", "warning");
				}
				return;
			}

			let state = currentLoop ? loadState(ctx, currentLoop) : null;
			if (!state) {
				const active = listLoops(ctx).find((l) => l.status === "active");
				if (!active) {
					if (ctx.hasUI) ctx.ui.notify("No active Stardock loop", "warning");
					return;
				}
				state = active;
			}

			if (state.status !== "active") {
				if (ctx.hasUI) ctx.ui.notify(`Loop "${state.name}" is not active`, "warning");
				return;
			}

			stopLoop(ctx, state, `Stopped Stardock loop: ${state.name} (iteration ${state.iteration})`);
		},
	});

	// --- Tool for agent self-invocation ---

	pi.registerTool({
		name: "stardock_start",
		label: "Start Stardock Loop",
		description: "Start a long-running development loop. Use for complex multi-iteration tasks.",
		promptSnippet: "Start a persistent multi-iteration development loop with pacing and reflection controls.",
		promptGuidelines: [
			"Use this tool when the user explicitly wants an iterative loop, autonomous repeated passes, or paced multi-step execution.",
			"After starting a loop, continue each finished iteration with stardock_done unless the completion marker has already been emitted.",
		],
		parameters: Type.Object({
			name: Type.String({ description: "Loop name (e.g., 'refactor-auth')" }),
			mode: Type.Optional(
				Type.Union([Type.Literal("checklist"), Type.Literal("recursive"), Type.Literal("evolve")], {
					description: "Loop mode. checklist and recursive are implemented; evolve is planned.",
				}),
			),
			taskContent: Type.String({ description: "Task in markdown with goals and checklist" }),
			objective: Type.Optional(Type.String({ description: "Recursive mode objective. Required when mode is recursive." })),
			baseline: Type.Optional(Type.String({ description: "Recursive mode starting point or current best evidence." })),
			validationCommand: Type.Optional(Type.String({ description: "Command or check the agent should run/describe for each recursive attempt." })),
			resetPolicy: Type.Optional(
				Type.Union([Type.Literal("manual"), Type.Literal("revert_failed_attempts"), Type.Literal("keep_best_only")], {
					description: "Recursive mode reset policy. Default: manual.",
				}),
			),
			stopWhen: Type.Optional(
				Type.Array(
					Type.Union([
						Type.Literal("target_reached"),
						Type.Literal("idea_exhaustion"),
						Type.Literal("max_failed_attempts"),
						Type.Literal("max_iterations"),
						Type.Literal("user_decision"),
					]),
					{ description: "Recursive mode stop criteria." },
				),
			),
			maxFailedAttempts: Type.Optional(Type.Number({ description: "Stop criterion budget for failed recursive attempts." })),
			outsideHelpEvery: Type.Optional(Type.Number({ description: "Recursive mode prompt cue interval for outside help." })),
			governEvery: Type.Optional(Type.Number({ description: "Recursive mode interval for governor review requests. Defaults to outsideHelpEvery when omitted." })),
			outsideHelpOnStagnation: Type.Optional(Type.Boolean({ description: "Cue outside help when recursive attempts stagnate." })),
			itemsPerIteration: Type.Optional(Type.Number({ description: "Suggest N items per turn (0 = no limit)" })),
			reflectEvery: Type.Optional(Type.Number({ description: "Reflect every N iterations" })),
			maxIterations: Type.Optional(Type.Number({ description: "Max iterations (default: 50)", default: 50 })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const mode = params.mode ?? "checklist";
			if (!isImplementedMode(mode)) {
				return { content: [{ type: "text", text: unsupportedModeMessage(mode) }], details: { mode } };
			}
			const modeResult = createModeState(mode, params);
			if (modeResult.error || !modeResult.modeState) {
				return { content: [{ type: "text", text: modeResult.error ?? "Could not create Stardock mode state." }], details: { mode } };
			}

			const loopName = sanitize(params.name);
			const taskFile = defaultTaskFile(loopName);

			if (loadState(ctx, loopName)?.status === "active") {
				return { content: [{ type: "text", text: `Loop "${loopName}" already active.` }], details: {} };
			}

			const fullPath = path.resolve(ctx.cwd, taskFile);
			ensureDir(fullPath);
			fs.writeFileSync(fullPath, params.taskContent, "utf-8");

			const state: LoopState = {
				schemaVersion: 3,
				name: loopName,
				taskFile,
				mode,
				iteration: 1,
				maxIterations: params.maxIterations ?? 50,
				itemsPerIteration: params.itemsPerIteration ?? 0,
				reflectEvery: params.reflectEvery ?? 0,
				reflectInstructions: DEFAULT_REFLECT_INSTRUCTIONS,
				active: true,
				status: "active",
				startedAt: new Date().toISOString(),
				lastReflectionAt: 0,
				modeState: modeResult.modeState,
				outsideRequests: [],
				criterionLedger: defaultCriterionLedger(),
				verificationArtifacts: [],
				briefs: [],
			};

			saveState(ctx, state);
			currentLoop = loopName;
			updateUI(ctx);

			pi.sendUserMessage(buildPrompt(state, params.taskContent, "iteration"), { deliverAs: "followUp" });

			return {
				content: [{ type: "text", text: `Started loop "${loopName}" (max ${state.maxIterations} iterations).` }],
				details: {},
			};
		},
	});

	// Tool for agent to signal iteration complete and request next
	pi.registerTool({
		name: "stardock_done",
		label: "Stardock Iteration Done",
		description: "Signal that you've completed this iteration of the Stardock loop. Call this after making progress to get the next iteration prompt. Do NOT call this if you've output the completion marker.",
		promptSnippet: "Advance an active Stardock loop after completing the current iteration.",
		promptGuidelines: [
			"Call this after making real iteration progress so Stardock can queue the next prompt.",
			"Do not call this if there is no active loop, if pending messages are already queued, or if the completion marker has already been emitted.",
		],
		parameters: Type.Object({
			briefLifecycle: Type.Optional(
				Type.Union([Type.Literal("keep"), Type.Literal("complete"), Type.Literal("clear")], {
					description: "Opt-in active brief lifecycle action after the completed iteration. Default keep preserves existing behavior.",
				}),
			),
			includeState: Type.Optional(Type.Boolean({ description: "Include compact loop summary in details after mutation." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!currentLoop) {
				return { content: [{ type: "text", text: "No active Stardock loop." }], details: {} };
			}

			const state = loadState(ctx, currentLoop);
			if (!state || state.status !== "active") {
				return { content: [{ type: "text", text: "Stardock loop is not active." }], details: {} };
			}

			if (ctx.hasPendingMessages()) {
				return {
					content: [{ type: "text", text: "Pending messages already queued. Skipping stardock_done." }],
					details: {},
				};
			}

			getModeHandler(state.mode).onIterationDone(state);
			const briefLifecycle = (params.briefLifecycle ?? "keep") as BriefLifecycleAction;
			const lifecycleBrief = applyActiveBriefLifecycle(state, briefLifecycle);

			// Increment iteration
			state.iteration++;

			// Check max iterations
			if (state.maxIterations > 0 && state.iteration > state.maxIterations) {
				completeLoop(
					ctx,
					state,
					`───────────────────────────────────────────────────────────────────────
⚠️ STARDOCK LOOP STOPPED: ${state.name} | Max iterations (${state.maxIterations}) reached
───────────────────────────────────────────────────────────────────────`,
				);
				return { content: [{ type: "text", text: "Max iterations reached. Loop stopped." }], details: {} };
			}

			const needsReflection = state.reflectEvery > 0 && (state.iteration - 1) % state.reflectEvery === 0;
			if (needsReflection) state.lastReflectionAt = state.iteration;

			saveState(ctx, state);
			updateUI(ctx);

			const content = tryRead(path.resolve(ctx.cwd, state.taskFile));
			if (!content) {
				pauseLoop(ctx, state);
				return { content: [{ type: "text", text: `Error: Could not read task file: ${state.taskFile}` }], details: {} };
			}

			// Queue next iteration - use followUp so user can still interrupt
			pi.sendUserMessage(buildPrompt(state, content, needsReflection ? "reflection" : "iteration"), { deliverAs: "followUp" });

			const lifecycleText = lifecycleBrief ? ` ${briefLifecycle === "complete" ? "Completed" : "Cleared"} brief ${lifecycleBrief.id}.` : "";
			return {
				content: [{ type: "text", text: `Iteration ${state.iteration - 1} complete. Next iteration queued.${lifecycleText}` }],
				details: { briefLifecycle, brief: lifecycleBrief, ...(params.includeState ? { loop: summarizeLoopState(ctx, state, false, false) } : {}) },
			};
		},
	});

	pi.registerTool({
		name: "stardock_state",
		label: "Inspect Stardock State",
		description: "Inspect Stardock loop state or list loops without reading .stardock files directly.",
		parameters: Type.Object({
			loopName: Type.Optional(Type.String({ description: "Loop name to inspect. Omit to list loops." })),
			archived: Type.Optional(Type.Boolean({ description: "Inspect archived loops instead of current runs. Default false." })),
			includeDetails: Type.Optional(Type.Boolean({ description: "Include full mode state and outside requests in details. Default false." })),
			view: Type.Optional(
				Type.Union([Type.Literal("summary"), Type.Literal("overview"), Type.Literal("timeline")], {
					description: "Text view to return for one loop. summary is compact; overview includes timeline; timeline returns only timeline.",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const archived = params.archived === true;
			const includeDetails = params.includeDetails === true;
			const view = (params.view ?? "summary") as StateView;
			if (params.loopName) {
				const state = loadState(ctx, params.loopName, archived);
				if (!state) return { content: [{ type: "text", text: `Loop "${params.loopName}" not found.` }], details: { loopName: params.loopName, archived } };
				const attempts = state.modeState.kind === "recursive" ? state.modeState.attempts : [];
				const latestDecision = latestGovernorDecision(state);
				const activeBrief = currentBrief(state);
				const lines = [
					`Loop: ${state.name}`,
					`Status: ${state.status}`,
					`Mode: ${state.mode}`,
					`Iteration: ${state.iteration}${state.maxIterations > 0 ? `/${state.maxIterations}` : ""}`,
					`Task file: ${state.taskFile}`,
					`State file: ${path.relative(ctx.cwd, existingStatePath(ctx, state.name, archived))}`,
					state.modeState.kind === "recursive" ? `Objective: ${state.modeState.objective}` : undefined,
					attempts.length > 0 ? `Attempts: ${attempts.filter((attempt) => attempt.status === "reported").length}/${attempts.length} reported` : undefined,
					`Outside requests: ${pendingOutsideRequests(state).length}/${state.outsideRequests.length} pending`,
					formatCriterionCounts(state.criterionLedger),
					`Verification artifacts: ${state.verificationArtifacts.length}`,
					`Briefs: ${state.briefs.length}${activeBrief ? ` (current ${activeBrief.id})` : ""}`,
					activeBrief ? `Current brief task: ${activeBrief.task}` : undefined,
					latestDecision?.requiredNextMove ? `Latest governor required next move: ${latestDecision.requiredNextMove}` : undefined,
				].filter((line): line is string => Boolean(line));
				const text = view === "overview" ? formatRunOverview(ctx, state, archived) : view === "timeline" ? formatRunTimeline(state) : lines.join("\n");
				return {
					content: [{ type: "text", text }],
					details: { loopName: state.name, archived, view, loop: summarizeLoopState(ctx, state, archived, includeDetails) },
				};
			}

			const loops = listLoops(ctx, archived).sort((a, b) => a.name.localeCompare(b.name));
			const label = archived ? "Archived Stardock loops" : "Stardock loops";
			return {
				content: [{ type: "text", text: loops.length > 0 ? `${label}:\n${loops.map(formatStateSummary).join("\n")}` : `No ${archived ? "archived " : ""}Stardock loops found.` }],
				details: {
					archived,
					currentLoop,
					loops: loops.map((state) => summarizeLoopState(ctx, state, archived, includeDetails)),
				},
			};
		},
	});

	pi.registerTool({
		name: "stardock_brief",
		label: "Manage Stardock Iteration Brief",
		description: "Inspect or update the current Stardock IterationBrief context packet.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("list"), Type.Literal("upsert"), Type.Literal("activate"), Type.Literal("clear"), Type.Literal("complete")], {
				description: "list returns briefs; upsert creates/updates a brief; activate selects one; clear removes the active brief; complete marks one complete.",
			}),
			loopName: Type.Optional(Type.String({ description: "Loop name. Defaults to the active loop." })),
			id: Type.Optional(Type.String({ description: "Brief id. Generated for upsert when omitted; required for activate." })),
			objective: Type.Optional(Type.String({ description: "Brief objective. Required for new briefs." })),
			task: Type.Optional(Type.String({ description: "Bounded task text. Required for new briefs." })),
			source: Type.Optional(Type.Union([Type.Literal("manual"), Type.Literal("governor")], { description: "Brief source. Defaults to manual; governor records a governor-selected brief." })),
			requestId: Type.Optional(Type.String({ description: "Optional governor_review outside request id that selected this brief." })),
			criterionIds: Type.Optional(Type.Array(Type.String(), { description: "Criterion ids selected for this brief." })),
			acceptanceCriteria: Type.Optional(Type.Array(Type.String(), { description: "Brief-specific acceptance criteria." })),
			verificationRequired: Type.Optional(Type.Array(Type.String(), { description: "Validation or verification required for this brief." })),
			requiredContext: Type.Optional(Type.Array(Type.String(), { description: "Relevant plan excerpts, files, decisions, or constraints." })),
			constraints: Type.Optional(Type.Array(Type.String(), { description: "Constraints the worker should preserve." })),
			avoid: Type.Optional(Type.Array(Type.String(), { description: "Moves or scopes to avoid for this brief." })),
			outputContract: Type.Optional(Type.String({ description: "Expected report/evidence from the worker." })),
			sourceRefs: Type.Optional(Type.Array(Type.String(), { description: "Source refs for this brief." })),
			activate: Type.Optional(Type.Boolean({ description: "For upsert, activate the brief in the same call." })),
			includeState: Type.Optional(Type.Boolean({ description: "Include compact loop summary in details after mutation." })),
			includeOverview: Type.Optional(Type.Boolean({ description: "Include text overview in details after mutation." })),
			includePromptPreview: Type.Optional(Type.Boolean({ description: "Include a capped next-prompt preview in details after mutation." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const loopName = params.loopName ?? currentLoop;
			if (!loopName) return { content: [{ type: "text", text: "No active Stardock loop." }], details: {} };
			const state = loadState(ctx, loopName);
			if (!state) return { content: [{ type: "text", text: `Loop "${loopName}" not found.` }], details: { loopName } };

			if (params.action === "list") {
				return {
					content: [{ type: "text", text: formatBriefOverview(state) }],
					details: { loopName, currentBriefId: state.currentBriefId, currentBrief: currentBrief(state), briefs: state.briefs },
				};
			}

			if (params.action === "upsert") {
				const result = upsertBrief(ctx, loopName, {
					id: params.id,
					objective: params.objective,
					task: params.task,
					source: params.source,
					requestId: params.requestId,
					criterionIds: params.criterionIds,
					acceptanceCriteria: params.acceptanceCriteria,
					verificationRequired: params.verificationRequired,
					requiredContext: params.requiredContext,
					constraints: params.constraints,
					avoid: params.avoid,
					outputContract: params.outputContract,
					sourceRefs: params.sourceRefs,
				});
				if (!result.ok) return { content: [{ type: "text", text: result.error }], details: { loopName } };
				let state = result.state;
				let brief = result.brief;
				if (params.activate === true) {
					const activateResult = setCurrentBrief(ctx, loopName, result.brief.id);
					if (!activateResult.ok) return { content: [{ type: "text", text: activateResult.error }], details: { loopName, brief: result.brief } };
					state = activateResult.state;
					brief = activateResult.brief;
				}
				const actionText = `${result.created ? "Created" : "Updated"} brief ${brief.id}${params.activate === true ? " and activated it" : ""} in loop "${loopName}".`;
				return {
					content: [{ type: "text", text: actionText }],
					details: { loopName, brief, briefs: state.briefs, currentBriefId: state.currentBriefId, ...optionalLoopDetails(ctx, state, params) },
				};
			}

			if (params.action === "activate") {
				if (!params.id) return { content: [{ type: "text", text: "Brief id is required for activate." }], details: { loopName } };
				const result = setCurrentBrief(ctx, loopName, params.id);
				if (!result.ok) return { content: [{ type: "text", text: result.error }], details: { loopName, id: params.id } };
				return {
					content: [{ type: "text", text: `Activated brief ${result.brief.id} in loop "${loopName}".` }],
					details: { loopName, brief: result.brief, currentBriefId: result.state.currentBriefId, ...optionalLoopDetails(ctx, result.state, params) },
				};
			}

			if (params.action === "clear") {
				const result = clearCurrentBrief(ctx, loopName);
				if (!result.ok) return { content: [{ type: "text", text: result.error }], details: { loopName } };
				return {
					content: [{ type: "text", text: result.brief ? `Cleared current brief ${result.brief.id} in loop "${loopName}".` : `No current brief in loop "${loopName}".` }],
					details: { loopName, brief: result.brief, currentBriefId: result.state.currentBriefId, ...optionalLoopDetails(ctx, result.state, params) },
				};
			}

			const result = completeBrief(ctx, loopName, params.id);
			if (!result.ok) return { content: [{ type: "text", text: result.error }], details: { loopName, id: params.id } };
			return {
				content: [{ type: "text", text: `Completed brief ${result.brief.id} in loop "${loopName}".` }],
				details: { loopName, brief: result.brief, currentBriefId: result.state.currentBriefId, ...optionalLoopDetails(ctx, result.state, params) },
			};
		},
	});

	const criterionInputSchema = Type.Object({
		id: Type.Optional(Type.String()),
		taskId: Type.Optional(Type.String()),
		sourceRef: Type.Optional(Type.String()),
		requirement: Type.Optional(Type.String()),
		description: Type.Optional(Type.String()),
		passCondition: Type.Optional(Type.String()),
		testMethod: Type.Optional(Type.String()),
		status: Type.Optional(Type.Union([Type.Literal("pending"), Type.Literal("passed"), Type.Literal("failed"), Type.Literal("skipped"), Type.Literal("blocked")])),
		evidence: Type.Optional(Type.String()),
		redEvidence: Type.Optional(Type.String()),
		greenEvidence: Type.Optional(Type.String()),
	});
	const artifactInputSchema = Type.Object({
		id: Type.Optional(Type.String()),
		kind: Type.Optional(Type.Union([Type.Literal("test"), Type.Literal("smoke"), Type.Literal("curl"), Type.Literal("browser"), Type.Literal("screenshot"), Type.Literal("walkthrough"), Type.Literal("benchmark"), Type.Literal("log"), Type.Literal("other")])),
		command: Type.Optional(Type.String()),
		path: Type.Optional(Type.String()),
		summary: Type.Optional(Type.String()),
		criterionIds: Type.Optional(Type.Array(Type.String())),
	});

	pi.registerTool({
		name: "stardock_ledger",
		label: "Manage Stardock Ledger",
		description: "Inspect or update a Stardock criterion ledger and compact verification artifact refs.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("list"), Type.Literal("upsertCriterion"), Type.Literal("upsertCriteria"), Type.Literal("recordArtifact"), Type.Literal("recordArtifacts")], {
				description: "list returns the ledger; upsertCriterion/upsertCriteria create or update criteria; recordArtifact/recordArtifacts record compact verification artifact refs.",
			}),
			loopName: Type.Optional(Type.String({ description: "Loop name. Defaults to the active loop." })),
			id: Type.Optional(Type.String({ description: "Criterion or artifact id. Generated when omitted." })),
			taskId: Type.Optional(Type.String({ description: "Optional task/work item id for a criterion." })),
			sourceRef: Type.Optional(Type.String({ description: "Optional source reference such as a plan heading or file path." })),
			requirement: Type.Optional(Type.String({ description: "Original requirement text this criterion traces to." })),
			description: Type.Optional(Type.String({ description: "Criterion description. Required for new criteria." })),
			passCondition: Type.Optional(Type.String({ description: "Observable condition that makes the criterion pass. Required for new criteria." })),
			testMethod: Type.Optional(Type.String({ description: "How to verify this criterion." })),
			status: Type.Optional(
				Type.Union([Type.Literal("pending"), Type.Literal("passed"), Type.Literal("failed"), Type.Literal("skipped"), Type.Literal("blocked")], {
					description: "Criterion status.",
				}),
			),
			evidence: Type.Optional(Type.String({ description: "Compact criterion evidence summary or path." })),
			redEvidence: Type.Optional(Type.String({ description: "Compact failing/baseline evidence summary or path." })),
			greenEvidence: Type.Optional(Type.String({ description: "Compact passing evidence summary or path." })),
			kind: Type.Optional(
				Type.Union(
					[
						Type.Literal("test"),
						Type.Literal("smoke"),
						Type.Literal("curl"),
						Type.Literal("browser"),
						Type.Literal("screenshot"),
						Type.Literal("walkthrough"),
						Type.Literal("benchmark"),
						Type.Literal("log"),
						Type.Literal("other"),
					],
					{ description: "Verification artifact kind." },
				),
			),
			command: Type.Optional(Type.String({ description: "Command associated with an artifact." })),
			path: Type.Optional(Type.String({ description: "Path or URL for an artifact." })),
			summary: Type.Optional(Type.String({ description: "Compact artifact summary. Required for recordArtifact." })),
			criterionIds: Type.Optional(Type.Array(Type.String(), { description: "Criterion ids linked to an artifact." })),
			criteria: Type.Optional(Type.Array(criterionInputSchema, { description: "Batch criteria for upsertCriteria." })),
			artifacts: Type.Optional(Type.Array(artifactInputSchema, { description: "Batch artifacts for recordArtifacts." })),
			includeState: Type.Optional(Type.Boolean({ description: "Include compact loop summary in details after mutation." })),
			includeOverview: Type.Optional(Type.Boolean({ description: "Include text overview in details after mutation." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const loopName = params.loopName ?? currentLoop;
			if (!loopName) return { content: [{ type: "text", text: "No active Stardock loop." }], details: {} };
			const state = loadState(ctx, loopName);
			if (!state) return { content: [{ type: "text", text: `Loop "${loopName}" not found.` }], details: { loopName } };

			if (params.action === "list") {
				return {
					content: [{ type: "text", text: formatLedgerOverview(state) }],
					details: { loopName, criterionLedger: state.criterionLedger, verificationArtifacts: state.verificationArtifacts },
				};
			}

			if (params.action === "upsertCriterion" || params.action === "upsertCriteria") {
				const inputs = params.action === "upsertCriteria" ? params.criteria ?? [] : [{
					id: params.id,
					taskId: params.taskId,
					sourceRef: params.sourceRef,
					requirement: params.requirement,
					description: params.description,
					passCondition: params.passCondition,
					testMethod: params.testMethod,
					status: params.status,
					evidence: params.evidence,
					redEvidence: params.redEvidence,
					greenEvidence: params.greenEvidence,
				}];
				if (inputs.length === 0) return { content: [{ type: "text", text: "No criteria provided." }], details: { loopName } };
				const criteria: Criterion[] = [];
				let created = 0;
				let stateAfter: LoopState | undefined;
				for (const input of inputs) {
					const result = upsertCriterion(ctx, loopName, input);
					if (!result.ok) return { content: [{ type: "text", text: result.error }], details: { loopName, criteria } };
					criteria.push(result.criterion);
					if (result.created) created++;
					stateAfter = result.state;
				}
				const updatedState = stateAfter ?? loadState(ctx, loopName) ?? undefined;
				return {
					content: [{ type: "text", text: inputs.length === 1 ? `${created === 1 ? "Created" : "Updated"} criterion ${criteria[0].id} in loop "${loopName}".` : `Upserted ${criteria.length} criteria in loop "${loopName}" (${created} created, ${criteria.length - created} updated).` }],
					details: { loopName, criteria, criterion: criteria[0], criterionLedger: updatedState?.criterionLedger, ...(updatedState ? optionalLoopDetails(ctx, updatedState, params) : {}) },
				};
			}

			const inputs = params.action === "recordArtifacts" ? params.artifacts ?? [] : [{
				id: params.id,
				kind: params.kind,
				command: params.command,
				path: params.path,
				summary: params.summary,
				criterionIds: params.criterionIds,
			}];
			if (inputs.length === 0) return { content: [{ type: "text", text: "No artifacts provided." }], details: { loopName } };
			const artifacts: VerificationArtifact[] = [];
			let created = 0;
			let stateAfter: LoopState | undefined;
			for (const input of inputs) {
				const result = recordVerificationArtifact(ctx, loopName, input);
				if (!result.ok) return { content: [{ type: "text", text: result.error }], details: { loopName, artifacts } };
				artifacts.push(result.artifact);
				if (result.created) created++;
				stateAfter = result.state;
			}
			const updatedState = stateAfter ?? loadState(ctx, loopName) ?? undefined;
			return {
				content: [{ type: "text", text: inputs.length === 1 ? `${created === 1 ? "Recorded" : "Updated"} artifact ${artifacts[0].id} in loop "${loopName}".` : `Recorded ${artifacts.length} artifacts in loop "${loopName}" (${created} created, ${artifacts.length - created} updated).` }],
				details: { loopName, artifacts, artifact: artifacts[0], verificationArtifacts: updatedState?.verificationArtifacts, ...(updatedState ? optionalLoopDetails(ctx, updatedState, params) : {}) },
			};
		},
	});

	pi.registerTool({
		name: "stardock_attempt_report",
		label: "Record Stardock Attempt Report",
		description: "Record a structured report for one bounded recursive Stardock attempt.",
		parameters: Type.Object({
			loopName: Type.Optional(Type.String({ description: "Loop name. Defaults to the active loop." })),
			iteration: Type.Optional(Type.Number({ description: "Attempt iteration. Defaults to the most recently completed attempt." })),
			kind: Type.Optional(
				Type.Union([
					Type.Literal("candidate_change"),
					Type.Literal("setup"),
					Type.Literal("refactor"),
					Type.Literal("instrumentation"),
					Type.Literal("benchmark_scaffold"),
					Type.Literal("research"),
					Type.Literal("other"),
				]),
			),
			hypothesis: Type.Optional(Type.String({ description: "Hypothesis tested by this bounded attempt." })),
			actionSummary: Type.Optional(Type.String({ description: "What changed or was tried." })),
			validation: Type.Optional(Type.String({ description: "Validation command/check and result summary." })),
			result: Type.Optional(
				Type.Union([
					Type.Literal("improved"),
					Type.Literal("neutral"),
					Type.Literal("worse"),
					Type.Literal("invalid"),
					Type.Literal("blocked"),
				]),
			),
			kept: Type.Optional(Type.Boolean({ description: "Whether this attempt's changes/evidence should be kept." })),
			evidence: Type.Optional(Type.String({ description: "Evidence path, output, or concise result details." })),
			followupIdeas: Type.Optional(Type.Array(Type.String(), { description: "Follow-up ideas discovered by this attempt." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const loopName = params.loopName ?? currentLoop;
			if (!loopName) return { content: [{ type: "text", text: "No active Stardock loop." }], details: {} };
			const result = recordAttemptReport(ctx, loopName, {
				iteration: params.iteration,
				kind: isAttemptKind(params.kind) ? params.kind : undefined,
				hypothesis: params.hypothesis,
				actionSummary: params.actionSummary,
				validation: params.validation,
				result: isAttemptResult(params.result) ? params.result : undefined,
				kept: params.kept,
				evidence: params.evidence,
				followupIdeas: params.followupIdeas,
			});
			if (!result.ok) return { content: [{ type: "text", text: result.error }], details: { loopName } };
			return {
				content: [{ type: "text", text: `Recorded report for attempt ${result.attempt.iteration} in loop "${loopName}".` }],
				details: { loopName, attempt: result.attempt },
			};
		},
	});

	pi.registerTool({
		name: "stardock_govern",
		label: "Create Stardock Governor Payload",
		description: "Create or reuse a manual governor review request and return a ready-to-copy payload. Does not spawn subagents or call a model.",
		parameters: Type.Object({
			loopName: Type.Optional(Type.String({ description: "Loop name. Defaults to the active loop." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const loopName = params.loopName ?? currentLoop;
			if (!loopName) return { content: [{ type: "text", text: "No active Stardock loop." }], details: {} };
			const result = createManualGovernorPayload(ctx, loopName);
			if (!result.ok) return { content: [{ type: "text", text: result.error }], details: { loopName } };
			return {
				content: [{ type: "text", text: result.payload }],
				details: { loopName, request: result.request, payload: result.payload },
			};
		},
	});

	pi.registerTool({
		name: "stardock_outside_payload",
		label: "Build Stardock Outside Request Payload",
		description: "Return a ready-to-copy governor or researcher task payload for a pending Stardock outside request.",
		parameters: Type.Object({
			loopName: Type.Optional(Type.String({ description: "Loop name. Defaults to the active loop." })),
			requestId: Type.String({ description: "Outside request id." }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const loopName = params.loopName ?? currentLoop;
			if (!loopName) return { content: [{ type: "text", text: "No active Stardock loop." }], details: {} };
			const result = getOutsideRequestPayload(ctx, loopName, params.requestId);
			if (!result.ok) return { content: [{ type: "text", text: result.error }], details: { loopName, requestId: params.requestId } };
			return {
				content: [{ type: "text", text: result.payload }],
				details: { loopName, request: result.request, payload: result.payload },
			};
		},
	});

	pi.registerTool({
		name: "stardock_outside_requests",
		label: "List Stardock Outside Requests",
		description: "List pending or answered outside help/governor requests for a Stardock loop.",
		parameters: Type.Object({
			loopName: Type.Optional(Type.String({ description: "Loop name. Defaults to the active loop." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const loopName = params.loopName ?? currentLoop;
			if (!loopName) return { content: [{ type: "text", text: "No active Stardock loop." }], details: {} };
			const state = loadState(ctx, loopName);
			if (!state) return { content: [{ type: "text", text: `Loop "${loopName}" not found.` }], details: { loopName } };
			return {
				content: [{ type: "text", text: formatOutsideRequests(state) }],
				details: { loopName, outsideRequests: state.outsideRequests },
			};
		},
	});

	pi.registerTool({
		name: "stardock_outside_answer",
		label: "Answer Stardock Outside Request",
		description: "Record an answer or governor decision for a Stardock outside request without editing state files manually.",
		parameters: Type.Object({
			loopName: Type.Optional(Type.String({ description: "Loop name. Defaults to the active loop." })),
			requestId: Type.String({ description: "Outside request id to answer." }),
			answer: Type.String({ description: "Answer text from governor, researcher, or manual review." }),
			verdict: Type.Optional(
				Type.Union([
					Type.Literal("continue"),
					Type.Literal("pivot"),
					Type.Literal("stop"),
					Type.Literal("measure"),
					Type.Literal("exploit_scaffold"),
					Type.Literal("ask_user"),
				]),
			),
			rationale: Type.Optional(Type.String({ description: "Governor rationale. Required to store a structured decision." })),
			requiredNextMove: Type.Optional(Type.String({ description: "Governor-required next move." })),
			forbiddenNextMoves: Type.Optional(Type.Array(Type.String(), { description: "Moves the next iteration should avoid." })),
			evidenceGaps: Type.Optional(Type.Array(Type.String(), { description: "Evidence gaps the next iteration should address." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const loopName = params.loopName ?? currentLoop;
			if (!loopName) return { content: [{ type: "text", text: "No active Stardock loop." }], details: {} };
			const decision = params.verdict
				? {
						verdict: params.verdict,
						rationale: params.rationale ?? params.answer,
						requiredNextMove: params.requiredNextMove,
						forbiddenNextMoves: params.forbiddenNextMoves,
						evidenceGaps: params.evidenceGaps,
					}
				: undefined;
			const result = answerOutsideRequest(ctx, loopName, params.requestId, params.answer, decision);
			if (!result.ok) return { content: [{ type: "text", text: result.error }], details: { loopName, requestId: params.requestId } };
			return {
				content: [{ type: "text", text: `Recorded answer for ${params.requestId} in loop "${loopName}".` }],
				details: { loopName, request: result.request },
			};
		},
	});

	// --- Event handlers ---

	pi.on("before_agent_start", async (event, ctx) => {
		if (!currentLoop) return;
		const state = loadState(ctx, currentLoop);
		if (!state || state.status !== "active") return;

		const iterStr = `${state.iteration}${state.maxIterations > 0 ? `/${state.maxIterations}` : ""}`;

		const instructions = getModeHandler(state.mode).buildSystemInstructions(state);

		return {
			systemPrompt: event.systemPrompt + `\n[STARDOCK LOOP - ${state.name} - Iteration ${iterStr}]\n\n${instructions}`,
		};
	});

	pi.on("agent_end", async (event, ctx) => {
		if (!currentLoop) return;
		const state = loadState(ctx, currentLoop);
		if (!state || state.status !== "active") return;

		// Check for completion marker
		const lastAssistant = [...event.messages].reverse().find((m) => m.role === "assistant");
		const text =
			lastAssistant && Array.isArray(lastAssistant.content)
				? lastAssistant.content
						.filter((c): c is { type: "text"; text: string } => c.type === "text")
						.map((c) => c.text)
						.join("\n")
				: "";

		if (text.includes(COMPLETE_MARKER)) {
			completeLoop(
				ctx,
				state,
				`───────────────────────────────────────────────────────────────────────
✅ STARDOCK LOOP COMPLETE: ${state.name} | ${state.iteration} iterations
───────────────────────────────────────────────────────────────────────`,
			);
			return;
		}

		// Check max iterations
		if (state.maxIterations > 0 && state.iteration >= state.maxIterations) {
			completeLoop(
				ctx,
				state,
				`───────────────────────────────────────────────────────────────────────
⚠️ STARDOCK LOOP STOPPED: ${state.name} | Max iterations (${state.maxIterations}) reached
───────────────────────────────────────────────────────────────────────`,
			);
			return;
		}

		// Don't auto-continue - let the agent call stardock_done to proceed
		// This allows user's "stop" message to be processed first
	});

	pi.on("session_start", async (_event, ctx) => {
		const active = listLoops(ctx).filter((l) => l.status === "active");

		// Rehydrate currentLoop from disk. The module is re-initialized on
		// session reload (including auto-compaction and /compact), which would
		// otherwise leave `currentLoop` null and silently break stardock_done,
		// agent_end, and before_agent_start. Pick the most-recently-updated
		// active loop when there are multiple, using the state file mtime.
		if (!currentLoop && active.length > 0) {
			const mostRecent = active.reduce((best, candidate) => {
				const bestMtime = safeMtimeMs(existingStatePath(ctx, best.name));
				const candidateMtime = safeMtimeMs(existingStatePath(ctx, candidate.name));
				return candidateMtime > bestMtime ? candidate : best;
			});
			currentLoop = mostRecent.name;
		}

		if (active.length > 0 && ctx.hasUI) {
			const lines = active.map(
				(l) => `  • ${l.name} (iteration ${l.iteration}${l.maxIterations > 0 ? `/${l.maxIterations}` : ""})`,
			);
			ctx.ui.notify(`Active Stardock loops:\n${lines.join("\n")}\n\nUse /stardock resume <name> to continue`, "info");
		}
		updateUI(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (currentLoop) {
			const state = loadState(ctx, currentLoop);
			if (state) saveState(ctx, state);
		}
	});
}
