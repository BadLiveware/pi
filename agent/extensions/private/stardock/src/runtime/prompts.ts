/**
 * Stardock prompt and mode helpers.
 */

import { appendActiveBriefPromptSection, appendLedgerSummarySection, appendRecordedWorkerContextSection, appendTaskSourceSection, currentBrief } from "../briefs.ts";
import { appendGovernorMemoryPromptSection } from "../governor-state.ts";
import { latestGovernorDecision, maybeCreateRecursiveOutsideRequests, pendingOutsideRequests } from "../outside-requests.ts";
import { compactText, type IterationBrief, type LoopMode, type LoopModeHandler, type LoopModeState, type LoopState, type PromptReason, type RecursiveModeState, type RecursiveResetPolicy, type RecursiveStopCriterion, DEFAULT_REFLECT_INSTRUCTIONS, EVOLVE_IMPLEMENTATION_GATES } from "../state/core.ts";
import { formatWorkerEvidencePromotionLines, WORKER_EVIDENCE_PROMOTION_NOTE } from "../worker-evidence-guidance.ts";
import { defaultModeState, defaultRecursiveModeState, numberOrDefault } from "../state/modes.ts";
import { evaluateWorkflowStatus, formatWorkflowStatus, type WorkflowStatus } from "../workflow-status.ts";

function compactBriefTask(brief: IterationBrief): string {
	return compactText(brief.task, 120) ?? "(no task text)";
}

function workflowGateInstruction(status: WorkflowStatus): string | undefined {
	if (status.state === "needs_parent_review") return "Do not continue implementation until parent review is addressed or explicitly rejected with rationale.";
	if (status.state === "needs_auditor_review") return "Do not continue gated work until auditor review/follow-up is addressed or escalated to the user.";
	if (status.state === "needs_breakout_decision") return "Do not continue as if unblocked until the breakout decision/gap is packaged, resolved, or explicitly accepted.";
	if (status.state === "blocked") return "Do not continue implementation until the blocked/paused state is resolved.";
	if (status.state === "ready_for_final_verification") return "Prioritize final verification/reporting before starting new implementation work.";
	if (status.state === "ready_to_complete") return "Do not start new implementation work; finish by calling stardock_complete unless you find a concrete readiness gap.";
	return undefined;
}

function appendWorkflowStatusPromptSection(parts: string[], state: LoopState): void {
	const status = evaluateWorkflowStatus(state);
	parts.push("## Workflow Status", formatWorkflowStatus(status));
	const gate = workflowGateInstruction(status);
	if (gate) parts.push("", `Gate: ${gate}`);
	parts.push("");
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

	appendWorkflowStatusPromptSection(parts, state);
	appendGovernorMemoryPromptSection(parts, state);
	appendActiveBriefPromptSection(parts, state);
	appendLedgerSummarySection(parts, state);
	appendRecordedWorkerContextSection(parts, state);
	parts.push("## Worker Evidence Promotion", ...formatWorkerEvidencePromotionLines(), "");
	appendTaskSourceSection(parts, state, _taskContent);
	parts.push(`\n## Instructions\n`);
	parts.push("User controls: ESC pauses the assistant. Send a message to resume. Run /stardock-stop when idle to stop the loop.\n");
	parts.push(`You are in a Stardock loop (iteration ${state.iteration}${state.maxIterations > 0 ? ` of ${state.maxIterations}` : ""}).\n`);
	parts.push(`1. If no active brief is shown above, create one with stardock_brief to scope this iteration.`);
	parts.push(`2. Work on the active brief's bounded task. Update criterion statuses with stardock_ledger as you make progress.`);
	parts.push(`3. For non-trivial active-brief implementation, default to stardock_worker({ action: "run", role: "implementer", briefId }) before parent edit/write so the governor preserves context and Stardock owns mutability, result classification, WorkerRun, and WorkerReport evidence. Use explorer/test_runner/reviewer/auditor for mapping, validation, or review only; those roles do not satisfy implementation delegation.`);
	parts.push(`4. Direct parent edits are exceptions: before the first edit/write for non-trivial brief work, either run the implementer worker or record why parent edits are allowed (trivial/surgical change, unavailable or unsafe worker bridge, or explicit gate/user decision). Trivial/surgical means single-file, at most two localized hunks, no new files, no public contract/schema/config/runtime behavior changes, and obvious validation; multi-file or new-file slices are non-trivial. Unavailable/unsafe bridge means a concrete current blocker such as bridge failure, an unreviewed implementer run, or a policy/user prohibition; latency, time pressure, or a parent-created dirty workspace do not count. Explicit gate/user decision means a current loop instruction to use parent edits; generic "continue" does not count. Decide before editing.`);
	parts.push(`5. Use list_pi_models before setting a non-default worker model. Implementer workers are serial mutable workers: start one only for scoped edits, then review/accept or dismiss the WorkerRun before another implementer or completion.`);
	parts.push(`6. After any worker returns, inspect the WorkerReport or saved output and explicitly record useful validation/artifact/criterion/final-report/auditor/breakout/governor facts with the matching Stardock tools before relying on them as lifecycle evidence.`);
	parts.push(`7. Update the task file (${state.taskFile}) with brief status changes only. Log detailed progress and reflections to progress-log.md.`);
	if (activeBrief) {
		parts.push(`8. When the active brief's criteria are satisfied and more work remains, call stardock_done({ briefLifecycle: "complete", includeState: true }) to complete the brief and queue the next iteration in one step.`);
		parts.push(`9. If the active brief should stop routing but remain draft, call stardock_done({ briefLifecycle: "clear" }).`);
		parts.push("10. Create the next brief for remaining work, or call stardock_complete when ALL briefs are done.");
		parts.push(`11. Otherwise, call stardock_done to proceed to the next iteration.`);
	} else {
		parts.push("8. Create the next brief for remaining work, or call stardock_complete when ALL work is done.");
		parts.push(`9. Otherwise, call stardock_done to proceed to the next iteration.`);
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
		if (state.governorState.currentStrategy) instructions += `- Governor strategy: ${state.governorState.currentStrategy}\n`;
		if (state.governorState.activeConstraints.length) instructions += `- Governor constraints: ${state.governorState.activeConstraints.slice(0, 3).join("; ")}\n`;
		if (!brief) {
			instructions += `- No active brief — create one with stardock_brief to scope this iteration\n`;
		} else {
			instructions += `- Active brief: ${brief.id} — "${compactBriefTask(brief)}"\n`;
			instructions += `- Work on the brief's bounded task; update criteria with stardock_ledger\n`;
			instructions += `- For non-trivial scoped implementation, default to stardock_worker({ action: "run", role: "implementer", briefId }) before parent edit/write; explorer/test_runner/reviewer/auditor runs are mapping/validation/review only and do not satisfy implementation delegation\n`;
			instructions += `- Direct parent edits require an explicit pre-edit exception: trivial/surgical change, unavailable or unsafe worker bridge, or explicit gate/user decision; trivial/surgical means single-file, at most two localized hunks, no new files, no public contract/schema/config/runtime behavior changes, and obvious validation; unavailable/unsafe bridge requires a concrete current blocker, and generic continue/time pressure/parent-created dirty workspace do not count; decide before editing\n`;
			instructions += `- Use list_pi_models before a non-default worker model override and choose cheaper/faster or stronger enabled models according to scope complexity\n`;
			instructions += `- ${WORKER_EVIDENCE_PROMOTION_NOTE}\n`;
			instructions += `- Implementer runs are serial mutable workers and must be reviewed and accepted/dismissed before another mutable worker or completion\n`;
			instructions += `- When criteria are satisfied and more work remains, prefer stardock_done({ briefLifecycle: "complete", includeState: true }) instead of separate brief-complete and done calls\n`;
		}
		instructions += `- Update task file with brief status only; log details to progress-log.md\n`;
		instructions += "- When FULLY COMPLETE: call stardock_complete\n";
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
		appendWorkflowStatusPromptSection(parts, state);
		appendGovernorMemoryPromptSection(parts, state);
		appendActiveBriefPromptSection(parts, state);
		appendRecordedWorkerContextSection(parts, state);
		parts.push("## Worker Evidence Promotion", ...formatWorkerEvidencePromotionLines(), "");
		appendTaskSourceSection(parts, state, taskContent);
		parts.push("\n## Attempt Instructions\n");
		parts.push("Treat this iteration as one bounded implementer attempt, not an open-ended lane.");
		parts.push("1. Choose or state one concrete hypothesis for improving the objective.");
		parts.push("2. Make one bounded attempt that tests that hypothesis.");
		parts.push("For non-trivial scoped implementation, default to stardock_worker({ action: \"run\", role: \"implementer\", briefId }) before parent edit/write. Explorer/test_runner/reviewer/auditor workers are mapping, validation, or review only; they do not satisfy implementation delegation.");
		parts.push("Direct parent edits are exceptions: before the first edit/write for non-trivial attempt work, either run the implementer worker or record why parent edits are allowed (trivial/surgical change, unavailable or unsafe worker bridge, or explicit gate/user decision). Trivial/surgical means single-file, at most two localized hunks, no new files, no public contract/schema/config/runtime behavior changes, and obvious validation; multi-file or new-file attempts are non-trivial. Unavailable/unsafe bridge means a concrete current blocker such as bridge failure, an unreviewed implementer run, or a policy/user prohibition; latency, time pressure, or a parent-created dirty workspace do not count. Explicit gate/user decision means a current loop instruction to use parent edits; generic \"continue\" does not count. Decide before editing. Use list_pi_models before setting a non-default worker model; implementer runs are serial and must be reviewed before another implementer or completion.");
		parts.push("After any worker returns, inspect the WorkerReport or saved output and explicitly record useful validation/artifact/criterion/final-report/auditor/breakout/governor facts with the matching Stardock tools before relying on them as lifecycle evidence.");
		if (modeState.validationCommand) {
			parts.push(`3. Run or explain the validation check: ${modeState.validationCommand}`);
		} else {
			parts.push("3. Run or describe the most relevant validation available for this attempt.");
		}
		parts.push("4. Record the hypothesis, action summary, validation, result, and keep/reset decision in the task file; use stardock_attempt_report when available.");
		parts.push(`5. Apply reset policy: ${modeState.resetPolicy}.`);
		parts.push("6. When the objective is met or stop criteria apply, call stardock_complete.");
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
			state.governorState.currentStrategy ? `- Governor strategy: ${state.governorState.currentStrategy}` : undefined,
			state.governorState.activeConstraints.length ? `- Governor constraints: ${state.governorState.activeConstraints.slice(0, 3).join("; ")}` : undefined,
			"- Work on one bounded hypothesis/attempt this iteration.",
			modeState.validationCommand ? `- Validate with or explain: ${modeState.validationCommand}` : "- Run or describe relevant validation for the attempt.",
			pending > 0 ? `- There are ${pending} pending outside request(s); include or record answers when relevant.` : undefined,
			decision?.requiredNextMove ? `- Governor required next move: ${decision.requiredNextMove}` : undefined,
			"- For non-trivial scoped implementation, default to stardock_worker({ action: \"run\", role: \"implementer\", briefId }) before parent edit/write; explorer/test_runner/reviewer/auditor workers do not satisfy implementation delegation.",
			"- Direct parent edits require an explicit pre-edit exception: trivial/surgical change, unavailable or unsafe worker bridge, or explicit gate/user decision; trivial/surgical means single-file, at most two localized hunks, no new files, no public contract/schema/config/runtime behavior changes, and obvious validation; unavailable/unsafe bridge requires a concrete current blocker, and generic continue/time pressure/parent-created dirty workspace do not count; use list_pi_models before a non-default worker model and keep implementer runs serial/reviewed.",
			`- ${WORKER_EVIDENCE_PROMOTION_NOTE}`,
			"- Record hypothesis, actions, validation, result, and keep/reset decision in the task file; use stardock_attempt_report when available.",
			"- When FULLY COMPLETE or stop criteria apply: call stardock_complete",
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
	if (mode === "evolve") return `Stardock mode "${mode}" is planned but not implemented yet. Required gates: ${EVOLVE_IMPLEMENTATION_GATES.join(", ")}.`;
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
