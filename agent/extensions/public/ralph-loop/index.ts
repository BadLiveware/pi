/**
 * Ralph Loop - local long-running agent loops for iterative development.
 * First-pass compatibility implementation based on the Ralph Wiggum behavior.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

const RALPH_DIR = ".ralph";
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

interface LoopModeHandler {
	mode: LoopMode;
	buildPrompt(state: LoopState, taskContent: string, reason: PromptReason): string;
	buildSystemInstructions(state: LoopState): string;
	onIterationDone(state: LoopState): void;
	summarize(state: LoopState): string[];
}

interface LoopState {
	schemaVersion: 2;
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
}

const STATUS_ICONS: Record<LoopStatus, string> = { active: "▶", paused: "⏸", completed: "✓" };

export default function (pi: ExtensionAPI) {
	let currentLoop: string | null = null;

	// --- File helpers ---

	const ralphDir = (ctx: ExtensionContext) => path.resolve(ctx.cwd, RALPH_DIR);
	const archiveDir = (ctx: ExtensionContext) => path.join(ralphDir(ctx), "archive");
	const sanitize = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_");

	function getPath(ctx: ExtensionContext, name: string, ext: string, archived = false): string {
		const dir = archived ? archiveDir(ctx) : ralphDir(ctx);
		return path.join(dir, `${sanitize(name)}${ext}`);
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

	function migrateState(raw: Partial<LoopState> & { name: string } & Record<string, unknown>): LoopState {
		const reflectEvery = numberOrDefault(raw.reflectEvery ?? raw.reflectEveryItems, 0);
		const lastReflectionAt = numberOrDefault(raw.lastReflectionAt ?? raw.lastReflectionAtItems, 0);
		const status = raw.status === "active" || raw.status === "completed" || raw.status === "paused" ? raw.status : raw.active ? "active" : "paused";
		const mode = normalizeMode(raw.mode);
		const name = stringOrDefault(raw.name, "ralph-loop");
		return {
			schemaVersion: 2,
			name,
			taskFile: stringOrDefault(raw.taskFile, path.join(RALPH_DIR, `${sanitize(name)}.md`)),
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
		};
	}

	function loadState(ctx: ExtensionContext, name: string, archived = false): LoopState | null {
		const content = tryRead(getPath(ctx, name, ".state.json", archived));
		return content ? migrateState(JSON.parse(content)) : null;
	}

	function saveState(ctx: ExtensionContext, state: LoopState, archived = false): void {
		state.active = state.status === "active";
		const filePath = getPath(ctx, state.name, ".state.json", archived);
		ensureDir(filePath);
		fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
	}

	function listLoops(ctx: ExtensionContext, archived = false): LoopState[] {
		const dir = archived ? archiveDir(ctx) : ralphDir(ctx);
		if (!fs.existsSync(dir)) return [];
		return fs
			.readdirSync(dir)
			.filter((f) => f.endsWith(".state.json"))
			.map((f) => {
				const content = tryRead(path.join(dir, f));
				return content ? migrateState(JSON.parse(content)) : null;
			})
			.filter((s): s is LoopState => s !== null);
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
		pi.appendEntry("ralph-loop", {
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
			.map((request) => `${formatOutsideRequest(request)}\nPayload: run ralph_outside_payload for a ready-to-copy task.`)
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

	// --- UI ---

	function formatLoop(l: LoopState): string {
		const status = `${STATUS_ICONS[l.status]} ${l.status}`;
		const iter = l.maxIterations > 0 ? `${l.iteration}/${l.maxIterations}` : `${l.iteration}`;
		return `${l.name}: ${status} (iteration ${iter})`;
	}

	function updateUI(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;

		const state = currentLoop ? loadState(ctx, currentLoop) : null;
		if (!state) {
			ctx.ui.setStatus("ralph", undefined);
			ctx.ui.setWidget("ralph", undefined);
			return;
		}

		const { theme } = ctx.ui;
		const maxStr = state.maxIterations > 0 ? `/${state.maxIterations}` : "";

		ctx.ui.setStatus("ralph", theme.fg("accent", `🔄 ${state.name} (${state.iteration}${maxStr})`));

		const lines = [
			theme.fg("accent", theme.bold("Ralph Wiggum")),
			theme.fg("muted", `Loop: ${state.name}`),
			theme.fg("dim", `Mode: ${state.mode}`),
			theme.fg("dim", `Status: ${STATUS_ICONS[state.status]} ${state.status}`),
			...getModeHandler(state.mode).summarize(state).map((line) => theme.fg("dim", line)),
		];
		if (state.reflectEvery > 0) {
			const next = state.reflectEvery - ((state.iteration - 1) % state.reflectEvery);
			lines.push(theme.fg("dim", `Next reflection in: ${next} iterations`));
		}
		// Warning about stopping
		lines.push("");
		lines.push(theme.fg("warning", "ESC pauses the assistant"));
		lines.push(theme.fg("warning", "Send a message to resume; /ralph-stop ends the loop"));
		ctx.ui.setWidget("ralph", lines);
	}

	// --- Prompt building ---

	function buildChecklistPrompt(state: LoopState, taskContent: string, reason: PromptReason): string {
		const isReflection = reason === "reflection";
		const maxStr = state.maxIterations > 0 ? `/${state.maxIterations}` : "";
		const header = `───────────────────────────────────────────────────────────────────────
🔄 RALPH LOOP: ${state.name} | Iteration ${state.iteration}${maxStr}${isReflection ? " | 🪞 REFLECTION" : ""}
───────────────────────────────────────────────────────────────────────`;

		const parts = [header, ""];
		if (isReflection) parts.push(state.reflectInstructions, "\n---\n");

		parts.push(`## Current Task (from ${state.taskFile})\n\n${taskContent}\n\n---`);
		parts.push(`\n## Instructions\n`);
		parts.push("User controls: ESC pauses the assistant. Send a message to resume. Run /ralph-stop when idle to stop the loop.\n");
		parts.push(
			`You are in a Ralph loop (iteration ${state.iteration}${state.maxIterations > 0 ? ` of ${state.maxIterations}` : ""}).\n`,
		);

		if (state.itemsPerIteration > 0) {
			parts.push(`**THIS ITERATION: Process approximately ${state.itemsPerIteration} items, then call ralph_done.**\n`);
			parts.push(`1. Work on the next ~${state.itemsPerIteration} items from your checklist`);
		} else {
			parts.push(`1. Continue working on the task`);
		}
		parts.push(`2. Update the task file (${state.taskFile}) with your progress`);
		parts.push(`3. When FULLY COMPLETE, respond with: ${COMPLETE_MARKER}`);
		parts.push(`4. Otherwise, call the ralph_done tool to proceed to next iteration`);

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
			parts.push("Use parent/orchestrator help if needed, then record answers with ralph_outside_answer or /ralph outside answer.", "");
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
			let instructions = `You are in a Ralph loop working on: ${state.taskFile}\n`;
			if (state.itemsPerIteration > 0) {
				instructions += `- Work on ~${state.itemsPerIteration} items this iteration\n`;
			}
			instructions += `- Update the task file as you progress\n`;
			instructions += `- When FULLY COMPLETE: ${COMPLETE_MARKER}\n`;
			instructions += `- Otherwise, call ralph_done tool to proceed to next iteration`;
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
🔁 RALPH RECURSIVE LOOP: ${state.name} | Attempt ${state.iteration}${maxStr}${isReflection ? " | 🪞 REFLECTION" : ""}
───────────────────────────────────────────────────────────────────────`;
			const parts = [header, ""];
			if (isReflection) parts.push(state.reflectInstructions, "\n---\n");
			parts.push("## Recursive Objective", ...formatRecursiveSetup(modeState), "");
			const recentAttempts = formatRecentAttemptReports(modeState);
			if (recentAttempts.length > 0) parts.push("## Recent Attempt Reports", ...recentAttempts, "");
			appendOutsideRequestPromptSections(parts, state);
			parts.push(`## Current Task (from ${state.taskFile})\n\n${taskContent}\n\n---`);
			parts.push("\n## Attempt Instructions\n");
			parts.push("Treat this iteration as one bounded implementer attempt, not an open-ended lane.");
			parts.push("1. Choose or state one concrete hypothesis for improving the objective.");
			parts.push("2. Make one bounded attempt that tests that hypothesis.");
			if (modeState.validationCommand) {
				parts.push(`3. Run or explain the validation check: ${modeState.validationCommand}`);
			} else {
				parts.push("3. Run or describe the most relevant validation available for this attempt.");
			}
			parts.push("4. Record the hypothesis, action summary, validation, result, and keep/reset decision in the task file; use ralph_attempt_report when available.");
			parts.push(`5. Apply reset policy: ${modeState.resetPolicy}.`);
			parts.push(`6. When the objective is met or stop criteria apply, respond with: ${COMPLETE_MARKER}`);
			parts.push("7. Otherwise, call the ralph_done tool to proceed to the next bounded attempt.");
			if (modeState.governEvery || modeState.outsideHelpEvery || modeState.outsideHelpOnStagnation) {
				parts.push("\nOutside-help cues are configured. If this attempt is blocked, stagnant, or out of ideas, record the needed help in the task file before calling ralph_done.");
			}
			return parts.join("\n");
		},
		buildSystemInstructions(state) {
			const modeState = requireRecursiveState(state);
			const pending = pendingOutsideRequests(state).length;
			const decision = latestGovernorDecision(state);
			return [
				"You are in a Ralph recursive loop.",
				`- Objective: ${modeState.objective}`,
				"- Work on one bounded hypothesis/attempt this iteration.",
				modeState.validationCommand
					? `- Validate with or explain: ${modeState.validationCommand}`
					: "- Run or describe relevant validation for the attempt.",
				pending > 0 ? `- There are ${pending} pending outside request(s); include or record answers when relevant.` : undefined,
				decision?.requiredNextMove ? `- Governor required next move: ${decision.requiredNextMove}` : undefined,
				"- Record hypothesis, actions, validation, result, and keep/reset decision in the task file; use ralph_attempt_report when available.",
				`- When FULLY COMPLETE or stop criteria apply: ${COMPLETE_MARKER}`,
				"- Otherwise, call ralph_done tool to proceed to next iteration.",
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
		if (mode === "evolve") return `Ralph mode "${mode}" is planned but not implemented yet.`;
		return `Unsupported Ralph mode "${mode}". Supported modes: checklist, recursive.`;
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
		if (!objective) return { error: 'Recursive Ralph mode requires an "objective".' };

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
					"Usage: /ralph start <name|path> [--mode checklist|recursive] [--objective TEXT] [--items-per-iteration N] [--reflect-every N] [--max-iterations N]",
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
				ctx.ui.notify(modeResult.error ?? "Could not create Ralph mode state.", "warning");
				return;
			}

			const isPath = args.name.includes("/") || args.name.includes("\\");
			const loopName = isPath ? sanitize(path.basename(args.name, path.extname(args.name))) : args.name;
			const taskFile = isPath ? args.name : path.join(RALPH_DIR, `${loopName}.md`);

			const existing = loadState(ctx, loopName);
			if (existing?.status === "active") {
				ctx.ui.notify(`Loop "${loopName}" is already active. Use /ralph resume ${loopName}`, "warning");
				return;
			}

			const fullPath = path.resolve(ctx.cwd, taskFile);
			if (!fs.existsSync(fullPath)) {
				ensureDir(fullPath);
				fs.writeFileSync(fullPath, DEFAULT_TEMPLATE, "utf-8");
				ctx.ui.notify(`Created task file: ${taskFile}`, "info");
			}

			const state: LoopState = {
				schemaVersion: 2,
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
					pauseLoop(ctx, active, `Paused Ralph loop: ${active.name} (iteration ${active.iteration})`);
				} else {
					ctx.ui.notify("No active Ralph loop", "warning");
				}
				return;
			}
			const state = loadState(ctx, currentLoop);
			if (state) {
				pauseLoop(ctx, state, `Paused Ralph loop: ${currentLoop} (iteration ${state.iteration})`);
			}
		},

		resume(rest, ctx) {
			const loopName = rest.trim();
			if (!loopName) {
				ctx.ui.notify("Usage: /ralph resume <name>", "warning");
				return;
			}

			const state = loadState(ctx, loopName);
			if (!state) {
				ctx.ui.notify(`Loop "${loopName}" not found`, "error");
				return;
			}
			if (state.status === "completed") {
				ctx.ui.notify(`Loop "${loopName}" is completed. Use /ralph start ${loopName} to restart`, "warning");
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
				ctx.ui.notify("No Ralph loops found.", "info");
				return;
			}
			ctx.ui.notify(`Ralph loops:\n${loops.map((l) => formatLoop(l)).join("\n")}`, "info");
		},

		cancel(rest, ctx) {
			const loopName = rest.trim();
			if (!loopName) {
				ctx.ui.notify("Usage: /ralph cancel <name>", "warning");
				return;
			}
			if (!loadState(ctx, loopName)) {
				ctx.ui.notify(`Loop "${loopName}" not found`, "error");
				return;
			}
			if (currentLoop === loopName) currentLoop = null;
			tryDelete(getPath(ctx, loopName, ".state.json"));
			ctx.ui.notify(`Cancelled: ${loopName}`, "info");
			updateUI(ctx);
		},

		archive(rest, ctx) {
			const loopName = rest.trim();
			if (!loopName) {
				ctx.ui.notify("Usage: /ralph archive <name>", "warning");
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

			const srcState = getPath(ctx, loopName, ".state.json");
			const dstState = getPath(ctx, loopName, ".state.json", true);
			ensureDir(dstState);
			if (fs.existsSync(srcState)) fs.renameSync(srcState, dstState);

			const srcTask = path.resolve(ctx.cwd, state.taskFile);
			if (srcTask.startsWith(ralphDir(ctx)) && !srcTask.startsWith(archiveDir(ctx))) {
				const dstTask = getPath(ctx, loopName, ".md", true);
				if (fs.existsSync(srcTask)) fs.renameSync(srcTask, dstTask);
			}

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
				tryDelete(getPath(ctx, loop.name, ".state.json"));
				if (all) tryDelete(getPath(ctx, loop.name, ".md"));
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
					archived ? "No archived loops" : "No loops found. Use /ralph list --archived for archived.",
					"info",
				);
				return;
			}

			const label = archived ? "Archived loops" : "Ralph loops";
			ctx.ui.notify(`${label}:\n${loops.map((l) => formatLoop(l)).join("\n")}`, "info");
		},

		govern(rest, ctx) {
			const loopName = rest.trim() || currentLoop;
			if (!loopName) {
				ctx.ui.notify("Usage: /ralph govern [loop]", "warning");
				return;
			}
			const result = createManualGovernorPayload(ctx, loopName);
			ctx.ui.notify(result.ok ? result.payload : result.error, result.ok ? "info" : "error");
		},

		outside(rest, ctx) {
			const [action, loopArg, requestId, ...answerParts] = rest.trim().split(/\s+/).filter(Boolean);
			if (action === "payload") {
				if (!loopArg || !requestId) {
					ctx.ui.notify("Usage: /ralph outside payload <loop> <request-id>", "warning");
					return;
				}
				const result = getOutsideRequestPayload(ctx, loopArg, requestId);
				ctx.ui.notify(result.ok ? result.payload : result.error, result.ok ? "info" : "error");
				return;
			}
			if (action === "answer") {
				if (!loopArg || !requestId || answerParts.length === 0) {
					ctx.ui.notify("Usage: /ralph outside answer <loop> <request-id> <answer>", "warning");
					return;
				}
				const result = answerOutsideRequest(ctx, loopArg, requestId, answerParts.join(" "));
				ctx.ui.notify(result.ok ? `Recorded answer for ${requestId}.` : result.error, result.ok ? "info" : "error");
				return;
			}

			const loopName = action || currentLoop;
			if (!loopName) {
				ctx.ui.notify("Usage: /ralph outside [loop]", "warning");
				return;
			}
			const state = loadState(ctx, loopName);
			ctx.ui.notify(state ? `Outside requests for ${loopName}:\n${formatOutsideRequests(state)}` : `Loop "${loopName}" not found.`, state ? "info" : "error");
		},

		nuke(rest, ctx) {
			const force = rest.trim() === "--yes";
			const warning =
				"This deletes all .ralph state, task, and archive files. External task files are not removed.";

			const run = () => {
				const dir = ralphDir(ctx);
				if (!fs.existsSync(dir)) {
					if (ctx.hasUI) ctx.ui.notify("No .ralph directory found.", "info");
					return;
				}

				currentLoop = null;
				const ok = tryRemoveDir(dir);
				if (ctx.hasUI) {
					ctx.ui.notify(ok ? "Removed .ralph directory." : "Failed to remove .ralph directory.", ok ? "info" : "error");
				}
				updateUI(ctx);
			};

			if (!force) {
				if (ctx.hasUI) {
					void ctx.ui.confirm("Delete all Ralph loop files?", warning).then((confirmed) => {
						if (confirmed) run();
					});
				} else {
					ctx.ui.notify(`Run /ralph nuke --yes to confirm. ${warning}`, "warning");
				}
				return;
			}

			if (ctx.hasUI) ctx.ui.notify(warning, "warning");
			run();
		},
	};

	const HELP = `Ralph Wiggum - Long-running development loops

Commands:
  /ralph start <name|path> [options]  Start a new loop
  /ralph stop                         Pause current loop
  /ralph resume <name>                Resume a paused loop
  /ralph status                       Show all loops
  /ralph cancel <name>                Delete loop state
  /ralph archive <name>               Move loop to archive
  /ralph clean [--all]                Clean completed loops
  /ralph list --archived              Show archived loops
  /ralph govern [loop]                Create governor request payload
  /ralph outside [loop]               Show outside requests
  /ralph outside payload <loop> <id>  Show ready-to-copy request payload
  /ralph outside answer <loop> <id> <answer>
                                      Record outside request answer
  /ralph nuke [--yes]                 Delete all .ralph data
  /ralph-stop                         Stop active loop (idle only)

Options:
  --items-per-iteration N  Suggest N items per turn (prompt hint)
  --reflect-every N        Reflect every N iterations
  --max-iterations N       Stop after N iterations (default 50)
  --mode checklist|recursive
                            Select loop mode
  --objective TEXT         Required for recursive mode

To stop: press ESC to interrupt, then run /ralph-stop when idle

Examples:
  /ralph start my-feature
  /ralph start review --items-per-iteration 5 --reflect-every 10`;

	pi.registerCommand("ralph", {
		description: "Ralph Wiggum - long-running development loops",
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

	pi.registerCommand("ralph-stop", {
		description: "Stop active Ralph loop (idle only)",
		handler: async (_args, ctx) => {
			if (!ctx.isIdle()) {
				if (ctx.hasUI) {
					ctx.ui.notify("Agent is busy. Press ESC to interrupt, then run /ralph-stop.", "warning");
				}
				return;
			}

			let state = currentLoop ? loadState(ctx, currentLoop) : null;
			if (!state) {
				const active = listLoops(ctx).find((l) => l.status === "active");
				if (!active) {
					if (ctx.hasUI) ctx.ui.notify("No active Ralph loop", "warning");
					return;
				}
				state = active;
			}

			if (state.status !== "active") {
				if (ctx.hasUI) ctx.ui.notify(`Loop "${state.name}" is not active`, "warning");
				return;
			}

			stopLoop(ctx, state, `Stopped Ralph loop: ${state.name} (iteration ${state.iteration})`);
		},
	});

	// --- Tool for agent self-invocation ---

	pi.registerTool({
		name: "ralph_start",
		label: "Start Ralph Loop",
		description: "Start a long-running development loop. Use for complex multi-iteration tasks.",
		promptSnippet: "Start a persistent multi-iteration development loop with pacing and reflection controls.",
		promptGuidelines: [
			"Use this tool when the user explicitly wants an iterative loop, autonomous repeated passes, or paced multi-step execution.",
			"After starting a loop, continue each finished iteration with ralph_done unless the completion marker has already been emitted.",
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
				return { content: [{ type: "text", text: modeResult.error ?? "Could not create Ralph mode state." }], details: { mode } };
			}

			const loopName = sanitize(params.name);
			const taskFile = path.join(RALPH_DIR, `${loopName}.md`);

			if (loadState(ctx, loopName)?.status === "active") {
				return { content: [{ type: "text", text: `Loop "${loopName}" already active.` }], details: {} };
			}

			const fullPath = path.resolve(ctx.cwd, taskFile);
			ensureDir(fullPath);
			fs.writeFileSync(fullPath, params.taskContent, "utf-8");

			const state: LoopState = {
				schemaVersion: 2,
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
		name: "ralph_done",
		label: "Ralph Iteration Done",
		description: "Signal that you've completed this iteration of the Ralph loop. Call this after making progress to get the next iteration prompt. Do NOT call this if you've output the completion marker.",
		promptSnippet: "Advance an active Ralph loop after completing the current iteration.",
		promptGuidelines: [
			"Call this after making real iteration progress so Ralph can queue the next prompt.",
			"Do not call this if there is no active loop, if pending messages are already queued, or if the completion marker has already been emitted.",
		],
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			if (!currentLoop) {
				return { content: [{ type: "text", text: "No active Ralph loop." }], details: {} };
			}

			const state = loadState(ctx, currentLoop);
			if (!state || state.status !== "active") {
				return { content: [{ type: "text", text: "Ralph loop is not active." }], details: {} };
			}

			if (ctx.hasPendingMessages()) {
				return {
					content: [{ type: "text", text: "Pending messages already queued. Skipping ralph_done." }],
					details: {},
				};
			}

			getModeHandler(state.mode).onIterationDone(state);

			// Increment iteration
			state.iteration++;

			// Check max iterations
			if (state.maxIterations > 0 && state.iteration > state.maxIterations) {
				completeLoop(
					ctx,
					state,
					`───────────────────────────────────────────────────────────────────────
⚠️ RALPH LOOP STOPPED: ${state.name} | Max iterations (${state.maxIterations}) reached
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

			return {
				content: [{ type: "text", text: `Iteration ${state.iteration - 1} complete. Next iteration queued.` }],
				details: {},
			};
		},
	});

	pi.registerTool({
		name: "ralph_attempt_report",
		label: "Record Ralph Attempt Report",
		description: "Record a structured report for one bounded recursive Ralph attempt.",
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
			if (!loopName) return { content: [{ type: "text", text: "No active Ralph loop." }], details: {} };
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
		name: "ralph_govern",
		label: "Create Ralph Governor Payload",
		description: "Create or reuse a manual governor review request and return a ready-to-copy payload. Does not spawn subagents or call a model.",
		parameters: Type.Object({
			loopName: Type.Optional(Type.String({ description: "Loop name. Defaults to the active loop." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const loopName = params.loopName ?? currentLoop;
			if (!loopName) return { content: [{ type: "text", text: "No active Ralph loop." }], details: {} };
			const result = createManualGovernorPayload(ctx, loopName);
			if (!result.ok) return { content: [{ type: "text", text: result.error }], details: { loopName } };
			return {
				content: [{ type: "text", text: result.payload }],
				details: { loopName, request: result.request, payload: result.payload },
			};
		},
	});

	pi.registerTool({
		name: "ralph_outside_payload",
		label: "Build Ralph Outside Request Payload",
		description: "Return a ready-to-copy governor or researcher task payload for a pending Ralph outside request.",
		parameters: Type.Object({
			loopName: Type.Optional(Type.String({ description: "Loop name. Defaults to the active loop." })),
			requestId: Type.String({ description: "Outside request id." }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const loopName = params.loopName ?? currentLoop;
			if (!loopName) return { content: [{ type: "text", text: "No active Ralph loop." }], details: {} };
			const result = getOutsideRequestPayload(ctx, loopName, params.requestId);
			if (!result.ok) return { content: [{ type: "text", text: result.error }], details: { loopName, requestId: params.requestId } };
			return {
				content: [{ type: "text", text: result.payload }],
				details: { loopName, request: result.request, payload: result.payload },
			};
		},
	});

	pi.registerTool({
		name: "ralph_outside_requests",
		label: "List Ralph Outside Requests",
		description: "List pending or answered outside help/governor requests for a Ralph loop.",
		parameters: Type.Object({
			loopName: Type.Optional(Type.String({ description: "Loop name. Defaults to the active loop." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const loopName = params.loopName ?? currentLoop;
			if (!loopName) return { content: [{ type: "text", text: "No active Ralph loop." }], details: {} };
			const state = loadState(ctx, loopName);
			if (!state) return { content: [{ type: "text", text: `Loop "${loopName}" not found.` }], details: { loopName } };
			return {
				content: [{ type: "text", text: formatOutsideRequests(state) }],
				details: { loopName, outsideRequests: state.outsideRequests },
			};
		},
	});

	pi.registerTool({
		name: "ralph_outside_answer",
		label: "Answer Ralph Outside Request",
		description: "Record an answer or governor decision for a Ralph outside request without editing state files manually.",
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
			if (!loopName) return { content: [{ type: "text", text: "No active Ralph loop." }], details: {} };
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
			systemPrompt: event.systemPrompt + `\n[RALPH LOOP - ${state.name} - Iteration ${iterStr}]\n\n${instructions}`,
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
✅ RALPH LOOP COMPLETE: ${state.name} | ${state.iteration} iterations
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
⚠️ RALPH LOOP STOPPED: ${state.name} | Max iterations (${state.maxIterations}) reached
───────────────────────────────────────────────────────────────────────`,
			);
			return;
		}

		// Don't auto-continue - let the agent call ralph_done to proceed
		// This allows user's "stop" message to be processed first
	});

	pi.on("session_start", async (_event, ctx) => {
		const active = listLoops(ctx).filter((l) => l.status === "active");

		// Rehydrate currentLoop from disk. The module is re-initialized on
		// session reload (including auto-compaction and /compact), which would
		// otherwise leave `currentLoop` null and silently break ralph_done,
		// agent_end, and before_agent_start. Pick the most-recently-updated
		// active loop when there are multiple, using the state file mtime.
		if (!currentLoop && active.length > 0) {
			const mostRecent = active.reduce((best, candidate) => {
				const bestMtime = safeMtimeMs(getPath(ctx, best.name, ".state.json"));
				const candidateMtime = safeMtimeMs(getPath(ctx, candidate.name, ".state.json"));
				return candidateMtime > bestMtime ? candidate : best;
			});
			currentLoop = mostRecent.name;
		}

		if (active.length > 0 && ctx.hasUI) {
			const lines = active.map(
				(l) => `  • ${l.name} (iteration ${l.iteration}${l.maxIterations > 0 ? `/${l.maxIterations}` : ""})`,
			);
			ctx.ui.notify(`Active Ralph loops:\n${lines.join("\n")}\n\nUse /ralph resume <name> to continue`, "info");
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
