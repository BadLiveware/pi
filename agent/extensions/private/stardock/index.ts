/**
 * Stardock - private governed implementation loops for Pi.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import {
	COMPLETE_MARKER,
	DEFAULT_REFLECT_INSTRUCTIONS,
	DEFAULT_TEMPLATE,
	type BriefLifecycleAction,
	type Criterion,
	type CriterionLedger,
	type CriterionStatus,
	type FinalVerificationReport,
	type FinalValidationRecord,
	type GovernorDecision,
	type IterationBrief,
	type LoopMode,
	type LoopModeHandler,
	type LoopModeState,
	type LoopState,
	type LoopStatus,
	type OutsideRequest,
	type OutsideRequestKind,
	type OutsideRequestTrigger,
	type PromptReason,
	type RecursiveAttempt,
	type RecursiveAttemptKind,
	type RecursiveAttemptResult,
	type RecursiveModeState,
	type RecursiveResetPolicy,
	type RecursiveStopCriterion,
	type StateView,
	type VerificationArtifact,
	type VerificationArtifactKind,
	STARDOCK_DIR,
	STATUS_ICONS,
	archiveDir,
	compactText,
	defaultCriterionLedger,
	defaultModeState,
	defaultRecursiveModeState,
	defaultTaskFile,
	ensureDir,
	existingStatePath,
	isArtifactKind,
	isBriefSource,
	isBriefStatus,
	isCriterionStatus,
	isFinalVerificationStatus,
	isValidationResult,
	legacyPath,
	listLoops,
	loadState,
	nextSequentialId,
	migrateFinalValidationRecords,
	migrateState,
	normalizeId,
	normalizeIds,
	normalizeMode,
	normalizeStringList,
	numberOrDefault,
	rebuildRequirementTrace,
	runDir,
	safeMtimeMs,
	sanitize,
	saveState,
	statePath,
	stardockDir,
	stringOrDefault,
	taskPath,
	tryDelete,
	tryRead,
	tryRemoveDir,
} from "./src/state.ts";
import { registerAdvisoryHandoffTool } from "./src/advisory-handoffs.ts";
import { registerAttemptReportTool } from "./src/attempt-reports.ts";
import { registerAuditorTool } from "./src/auditor-reviews.ts";
import { applyActiveBriefLifecycle, appendActiveBriefPromptSection, appendTaskSourceSection, currentBrief, registerBriefTool } from "./src/briefs.ts";
import { registerBreakoutTool } from "./src/breakout-packages.ts";
import { registerFinalReportTool } from "./src/final-reports.ts";
import { criterionCounts, formatCriterionCounts, registerLedgerTool } from "./src/ledger.ts";
import { answerOutsideRequest, appendOutsideRequestPromptSections, createManualGovernorPayload, formatOutsideRequests, getOutsideRequestPayload, latestGovernorDecision, maybeCreateRecursiveOutsideRequests, pendingOutsideRequests, registerOutsideRequestTools } from "./src/outside-requests.ts";
import { formatLoop, formatRunOverview, formatRunTimeline, formatStateSummary, summarizeLoopState } from "./src/views.ts";

export default function (pi: ExtensionAPI) {
	let currentLoop: string | null = null;


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

	// --- Prompt preview and optional loop details ---

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


	// --- UI ---

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
				finalVerificationReports: [],
				auditorReviews: [],
				advisoryHandoffs: [],
				breakoutPackages: [],
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
			const result = createManualGovernorPayload(ctx, loopName, updateUI);
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
				const result = answerOutsideRequest(ctx, loopArg, requestId, answerParts.join(" "), updateUI);
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
				finalVerificationReports: [],
				auditorReviews: [],
				advisoryHandoffs: [],
				breakoutPackages: [],
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
					`Final reports: ${state.finalVerificationReports.length}`,
					`Auditor reviews: ${state.auditorReviews.length}`,
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


	registerBriefTool(pi, {
		getCurrentLoop: () => currentLoop,
		updateUI,
		optionalLoopDetails,
	});

	registerAdvisoryHandoffTool(pi, {
		getCurrentLoop: () => currentLoop,
		updateUI,
		optionalLoopDetails,
	});

	registerAuditorTool(pi, {
		getCurrentLoop: () => currentLoop,
		updateUI,
		optionalLoopDetails,
	});

	registerBreakoutTool(pi, {
		getCurrentLoop: () => currentLoop,
		updateUI,
		optionalLoopDetails,
	});

	registerFinalReportTool(
		pi,
		{
			getCurrentLoop: () => currentLoop,
			updateUI,
			optionalLoopDetails,
		},
		formatCriterionCounts,
	);

	registerLedgerTool(pi, {
		getCurrentLoop: () => currentLoop,
		updateUI,
		optionalLoopDetails,
	});


	registerAttemptReportTool(pi, {
		getCurrentLoop: () => currentLoop,
		updateUI,
	});

	registerOutsideRequestTools(pi, {
		getCurrentLoop: () => currentLoop,
		updateUI,
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
