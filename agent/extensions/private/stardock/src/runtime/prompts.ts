/**
 * Stardock prompt and mode helpers.
 */

import { appendActiveBriefPromptSection, appendLedgerSummarySection, appendTaskSourceSection, currentBrief } from "../briefs.ts";
import { latestGovernorDecision, maybeCreateRecursiveOutsideRequests, pendingOutsideRequests } from "../outside-requests.ts";
import { compactText, type IterationBrief, type LoopMode, type LoopModeHandler, type LoopModeState, type LoopState, type PromptReason, type RecursiveModeState, type RecursiveResetPolicy, type RecursiveStopCriterion, COMPLETE_MARKER, DEFAULT_REFLECT_INSTRUCTIONS } from "../state/core.ts";
import { defaultModeState, defaultRecursiveModeState, numberOrDefault } from "../state/migration.ts";

function compactBriefTask(brief: IterationBrief): string {
	return compactText(brief.task, 120) ?? "(no task text)";
}

// taskContent is accepted for interface compatibility with recursive mode's buildPrompt,
// but the task file is never injected into checklist iteration prompts.
export function buildChecklistPrompt(state: LoopState, _taskContent: string, reason: PromptReason): string {
	const isReflection = reason === "reflection";
	const activeBrief = currentBrief(state);
	const maxStr = state.maxIterations > 0 ? `/${state.maxIterations}` : "";
	const header = `───────────────────────────────────────────────────────────────────────
🔄 STARDOCK LOOP: ${state.name} | Iteration ${state.iteration}${maxStr}${isReflection ? " | 🪞 REFLECTION" : ""}
───────────────────────────────────────────────────────────────────────`;

	const parts = [header, ""];
	if (isReflection) parts.push(state.reflectInstructions, "\n---\n");

	appendActiveBriefPromptSection(parts, state);
	appendLedgerSummarySection(parts, state);
	appendTaskSourceSection(parts, state, _taskContent);
	parts.push(`\n## Instructions\n`);
	parts.push("User controls: ESC pauses the assistant. Send a message to resume. Run /stardock-stop when idle to stop the loop.\n");
	parts.push(`You are in a Stardock loop (iteration ${state.iteration}${state.maxIterations > 0 ? ` of ${state.maxIterations}` : ""}).\n`);
	parts.push(`1. If no active brief is shown above, create one with stardock_brief to scope this iteration.`);
	parts.push(`2. Work on the active brief's bounded task. Update criterion statuses with stardock_ledger as you make progress.`);
	parts.push(`3. Update the task file (${state.taskFile}) with brief status changes only. Log detailed progress and reflections to progress-log.md.`);
	if (activeBrief) {
		parts.push(`4. When the active brief's criteria are satisfied and more work remains, call stardock_done({ briefLifecycle: "complete", includeState: true }) to complete the brief and queue the next iteration in one step.`);
		parts.push(`5. If the active brief should stop routing but remain draft, call stardock_done({ briefLifecycle: "clear" }).`);
		parts.push(`6. Create the next brief for remaining work, or respond with ${COMPLETE_MARKER} when ALL briefs are done.`);
		parts.push(`7. Otherwise, call stardock_done to proceed to the next iteration.`);
	} else {
		parts.push(`4. Create the next brief for remaining work, or respond with ${COMPLETE_MARKER} when ALL work is done.`);
		parts.push(`5. Otherwise, call stardock_done to proceed to the next iteration.`);
	}
	if (state.itemsPerIteration > 0) parts.push(`\nAim to make measurable progress on the brief this iteration.`);

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
		const brief = currentBrief(state);
		let instructions = `You are in a Stardock loop. Task file: ${state.taskFile}\n`;
		if (!brief) {
			instructions += `- No active brief — create one with stardock_brief to scope this iteration\n`;
		} else {
			instructions += `- Active brief: ${brief.id} — "${compactBriefTask(brief)}"\n`;
			instructions += `- Work on the brief's bounded task; update criteria with stardock_ledger\n`;
			instructions += `- When criteria are satisfied and more work remains, prefer stardock_done({ briefLifecycle: "complete", includeState: true }) instead of separate brief-complete and done calls\n`;
		}
		instructions += `- Update task file with brief status only; log details to progress-log.md\n`;
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
			modeState.validationCommand ? `- Validate with or explain: ${modeState.validationCommand}` : "- Run or describe relevant validation for the attempt.",
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

export function getModeHandler(mode: LoopMode): LoopModeHandler {
	if (mode === "recursive") return recursiveModeHandler;
	return checklistModeHandler;
}

export function buildPrompt(state: LoopState, taskContent: string, reason: PromptReason): string {
	return getModeHandler(state.mode).buildPrompt(state, taskContent, reason);
}

export function isImplementedMode(mode: string): mode is "checklist" | "recursive" {
	return mode === "checklist" || mode === "recursive";
}

export function unsupportedModeMessage(mode: string): string {
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
	const rawValues = Array.isArray(value) ? value : typeof value === "string" ? value.split(",").map((part) => part.trim()) : [];
	const parsed = rawValues.filter((part): part is RecursiveStopCriterion => typeof part === "string" && isStopCriterion(part));
	return parsed.length > 0 ? parsed : ["target_reached", "idea_exhaustion", "max_iterations"];
}

export function createModeState(mode: "checklist" | "recursive", input: Record<string, unknown>): { modeState?: LoopModeState; error?: string } {
	if (mode === "checklist") return { modeState: defaultModeState("checklist") };

	const objective = typeof input.objective === "string" ? input.objective.trim() : "";
	if (!objective) return { error: 'Recursive Stardock mode requires an "objective".' };

	const resetPolicy = isResetPolicy(input.resetPolicy) ? input.resetPolicy : "manual";
	const state: RecursiveModeState = {
		...defaultRecursiveModeState(objective),
		baseline: typeof input.baseline === "string" && input.baseline.trim() ? input.baseline.trim() : undefined,
		validationCommand: typeof input.validationCommand === "string" && input.validationCommand.trim() ? input.validationCommand.trim() : undefined,
		resetPolicy,
		stopWhen: parseStopWhen(input.stopWhen),
		maxFailedAttempts: numberOrDefault(input.maxFailedAttempts, 0) > 0 ? numberOrDefault(input.maxFailedAttempts, 0) : undefined,
		outsideHelpEvery: numberOrDefault(input.outsideHelpEvery, 0) > 0 ? numberOrDefault(input.outsideHelpEvery, 0) : undefined,
		governEvery: numberOrDefault(input.governEvery, 0) > 0 ? numberOrDefault(input.governEvery, 0) : undefined,
		outsideHelpOnStagnation: input.outsideHelpOnStagnation === true,
	};
	return { modeState: state };
}

export function defaultReflectInstructions(): string {
	return DEFAULT_REFLECT_INSTRUCTIONS;
}
