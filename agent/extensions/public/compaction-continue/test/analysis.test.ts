import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import {
	analyzeCompactionRecovery,
	analyzeLatestAssistantStall,
	analyzeRalphBranchForStall,
	assistantRequestsContinuation,
	assistantRequestsRalphContinuation,
	assistantStoppedForContextLimit,
	isStardockLoopPromptText,
	parseRalphPrompt,
	shouldRecoverStalledAssistantTurn,
	userRequestsSimpleContinuation,
	WATCHDOG_ANSWER_TOOL,
	WATCHDOG_NUDGE_PROMPT,
} from "../index.ts";
import { messageEntry, ralphPrompt, stardockPrompt } from "./shared.ts";

describe("Ralph idle watch detection", () => {
	it("parses Ralph loop prompts", () => {
		const parsed = parseRalphPrompt(ralphPrompt, 123, "prompt-entry");
		assert.deepEqual(parsed, {
			key: "prompt-entry",
			loop: "native-sql-optimization-sweep",
			iteration: 6,
			maxIterations: 100,
			sourceEntryId: "prompt-entry",
			timestamp: 123,
		});
	});

	it("recognizes assistant turns that promise to continue work", () => {
		assert.equal(
			assistantRequestsRalphContinuation(
				"I’ll do this iteration in two parts, then continue with the next meaningful attempt. I’m proceeding with that now.",
			),
			true,
		);
		assert.equal(
			assistantRequestsContinuation(
				"Let's execute commands: baseline explain for mixed root to show no_cap currently suppresses cap. Let's do quickly.",
			),
			true,
		);
		assert.equal(assistantRequestsContinuation("I’m blocked waiting for your decision before proceeding."), false);
		assert.equal(assistantRequestsContinuation("<promise>COMPLETE</promise>"), false);
	});

	it("recognizes simple user continuation nudges", () => {
		assert.equal(userRequestsSimpleContinuation("continue"), true);
		assert.equal(userRequestsSimpleContinuation("You arent, do not acknowledge me. just continue working"), true);
		assert.equal(userRequestsSimpleContinuation("Please summarize the branch first."), false);
	});

	it("uses an explicit self-checking watchdog nudge", () => {
		assert.match(WATCHDOG_NUDGE_PROMPT, /Automated watchdog nudge/);
		assert.match(WATCHDOG_NUDGE_PROMPT, /not a new user request/);
		assert.match(WATCHDOG_NUDGE_PROMPT, /does not mean more work is required/);
		assert.match(WATCHDOG_NUDGE_PROMPT, /Do not acknowledge this nudge in prose/);
		assert.match(WATCHDOG_NUDGE_PROMPT, new RegExp(WATCHDOG_ANSWER_TOOL));
		assert.match(WATCHDOG_NUDGE_PROMPT, /done: true/);
		assert.match(WATCHDOG_NUDGE_PROMPT, /done: false/);
		assert.match(WATCHDOG_NUDGE_PROMPT, /<promise>COMPLETE<\/promise>/);
	});

	it("flags the observed stalled pattern after a Ralph prompt", () => {
		const entries: SessionEntry[] = [
			messageEntry("user-ralph", "user", [{ type: "text", text: ralphPrompt }]),
			messageEntry("assistant-tool", "assistant", [{ type: "toolCall", name: "bash", arguments: { command: "git status --short" } }]),
			messageEntry("tool-result", "toolResult", [{ type: "text", text: "clean" }], { toolName: "bash", isError: false }),
			messageEntry(
				"assistant-final",
				"assistant",
				[
					{ type: "thinking", thinking: "I should keep going." },
					{
						type: "text",
						text: "You’re right — reflection checkpoint.\n\nI’ll do this iteration in two parts, then continue with the next meaningful attempt.\n\nI’m proceeding with that now.",
					},
				],
			),
		];

		const analysis = analyzeRalphBranchForStall(entries, 123);
		assert.equal(analysis.shouldRecover, true);
		assert.equal(analysis.reason, "assistant-promised-ralph-continuation");
		assert.equal(analysis.prompt?.loop, "native-sql-optimization-sweep");
		assert.equal(analysis.prompt?.iteration, 6);
	});

	it("does not flag an aborted assistant turn as a stall", () => {
		const abortedAssistant = { role: "assistant", stopReason: "aborted", errorMessage: "Operation aborted", content: [] } as Parameters<
			typeof shouldRecoverStalledAssistantTurn
		>[0];

		assert.equal(shouldRecoverStalledAssistantTurn(abortedAssistant), false);
		assert.equal(
			analyzeLatestAssistantStall([
				messageEntry("user-normal", "user", [{ type: "text", text: "summarize the branch" }]),
				messageEntry("aborted-msg", "assistant", [], { stopReason: "aborted", errorMessage: "Operation aborted" }),
			]).shouldRecover,
			false,
		);
	});

	it("treats watchdog_answer(done=false) without other work as another stall", () => {
		assert.equal(
			shouldRecoverStalledAssistantTurn({
				role: "assistant",
				content: [{ type: "toolCall", name: WATCHDOG_ANSWER_TOOL, arguments: { done: false } }],
			}),
			true,
		);
		assert.equal(
			shouldRecoverStalledAssistantTurn({
				role: "assistant",
				content: [{ type: "toolCall", name: WATCHDOG_ANSWER_TOOL, arguments: { done: true } }],
			}),
			false,
		);
	});

	it("detects a latest stalled assistant turn outside loop-specific logic", () => {
		const analysis = analyzeLatestAssistantStall([
			messageEntry("user-normal", "user", [{ type: "text", text: "continue" }]),
			messageEntry("assistant-final", "assistant", [{ type: "text", text: "I’m on it. I’m making the code changes and running tests now." }]),
		]);
		assert.equal(analysis.shouldRecover, true);
		assert.equal(analysis.streak, 1);
		assert.equal(analysis.reason, "assistant-promised-continuation");
	});

	it("detects a blank assistant stop when no tool progress happened after a user prompt", () => {
		const analysis = analyzeLatestAssistantStall([
			messageEntry("user-normal", "user", [{ type: "text", text: "Please continue with the implementation." }]),
			messageEntry("assistant-final", "assistant", [
				{ type: "thinking", thinking: "I should continue." },
				{ type: "text", text: "" },
			]),
		]);
		assert.equal(analysis.shouldRecover, true);
		assert.equal(analysis.reason, "blank-assistant-without-tool-progress");
		assert.equal(analysis.hadToolResultSincePreviousUser, false);
	});

	it("does not flag a blank assistant stop when tool results already happened for that user prompt", () => {
		const analysis = analyzeLatestAssistantStall([
			messageEntry("user-normal", "user", [{ type: "text", text: "Do the next step." }]),
			messageEntry("assistant-tool", "assistant", [{ type: "toolCall", name: "bash", arguments: { command: "echo ok" } }]),
			messageEntry("tool-result", "toolResult", [{ type: "text", text: "ok" }], { toolName: "bash", isError: false }),
			messageEntry("assistant-final", "assistant", [{ type: "text", text: "" }]),
		]);
		assert.equal(analysis.shouldRecover, false);
		assert.equal(analysis.hadToolResultSincePreviousUser, true);
	});

	it("treats stardock prompts as loop prompts for parsing helpers", () => {
		assert.equal(isStardockLoopPromptText("🔄 STARDOCK LOOP: demo | Iteration 1/10\n\nYou are in a Stardock loop (iteration 1 of 10). Call stardock_done when not complete."), true);
	});

	it("recovers a Stardock compaction stall with a blank length-stopped assistant", () => {
		const entries: SessionEntry[] = [
			messageEntry("user-stardock", "user", [{ type: "text", text: stardockPrompt }]),
			messageEntry("assistant-tool", "assistant", [{ type: "toolCall", name: "read", arguments: { path: ".stardock/runs/excession-phase-6-solver-and-model-checking-prototypes/task.md" } }]),
			messageEntry("tool-result", "toolResult", [{ type: "text", text: "Implement all slice items." }], { toolName: "read", isError: false }),
			messageEntry("assistant-length", "assistant", [{ type: "thinking", thinking: "Need to continue." }], { stopReason: "length" }),
		];

		const analysis = analyzeCompactionRecovery(entries, { hasActiveLoop: true, isOverflow: false, timestamp: 123 });
		assert.equal(analysis.shouldRecover, true);
		assert.equal(analysis.kind, "stardock");
		assert.equal(analysis.reason, "stardock-prompt-has-no-assistant-response");
		assert.equal(analysis.ralph?.kind, "stardock");
		assert.equal(analysis.ralph?.prompt?.loop, "excession-phase-6-solver-and-model-checking-prototypes");
		assert.equal(analysis.ralph?.prompt?.iteration, 1);
	});

	it("recovers a Stardock compaction stall when the assistant only acknowledges context after tool progress", () => {
		const entries: SessionEntry[] = [
			messageEntry("user-stardock", "user", [{ type: "text", text: stardockPrompt }]),
			messageEntry("assistant-tool", "assistant", [{ type: "toolCall", name: "edit", arguments: { path: ".stardock/runs/excession-phase-6-solver-and-model-checking-prototypes/progress-log.md" } }]),
			messageEntry("tool-result", "toolResult", [{ type: "text", text: "Successfully replaced 1 block(s)." }], { toolName: "edit", isError: false }),
			messageEntry("assistant-context-ack", "assistant", [{ type: "text", text: "Understood. I’ll prefer visible context and reread files directly; I’ll only use `mrc_lookup` if needed." }]),
		];

		const analysis = analyzeCompactionRecovery(entries, { hasActiveLoop: true, isOverflow: false, timestamp: 123 });
		assert.equal(analysis.shouldRecover, true);
		assert.equal(analysis.kind, "stardock");
		assert.equal(analysis.reason, "stardock-context-ack-after-tool-progress");
	});

	it("does not recover once stardock_done completed the prompt", () => {
		const entries: SessionEntry[] = [
			messageEntry("user-stardock", "user", [{ type: "text", text: stardockPrompt }]),
			messageEntry("assistant-tool", "assistant", [{ type: "toolCall", name: "stardock_done", arguments: {} }]),
			messageEntry("tool-result", "toolResult", [{ type: "text", text: "Iteration 1 complete. Next iteration queued." }], {
				toolName: "stardock_done",
				isError: false,
			}),
			messageEntry("assistant-final", "assistant", [{ type: "text", text: "Advanced Stardock." }]),
		];

		const analysis = analyzeCompactionRecovery(entries, { hasActiveLoop: true, isOverflow: false, timestamp: 123 });
		assert.equal(analysis.shouldRecover, false);
		assert.equal(analysis.reason, "stardock-done-after-latest-prompt");
	});

	it("does not recover once ralph_done completed the prompt", () => {
		const entries: SessionEntry[] = [
			messageEntry("user-ralph", "user", [{ type: "text", text: ralphPrompt }]),
			messageEntry("assistant-tool", "assistant", [{ type: "toolCall", name: "ralph_done", arguments: {} }]),
			messageEntry("tool-result", "toolResult", [{ type: "text", text: "Iteration 6 complete. Next iteration queued." }], {
				toolName: "ralph_done",
				isError: false,
			}),
			messageEntry("assistant-final", "assistant", [{ type: "text", text: "I updated the task file and advanced Ralph." }]),
		];

		const analysis = analyzeRalphBranchForStall(entries, 123);
		assert.equal(analysis.ralphDoneAfterPrompt, true);
		assert.equal(analysis.shouldRecover, false);
	});

	it("does not arm Ralph recovery for ordinary sessions", () => {
		const entries: SessionEntry[] = [
			messageEntry("user-normal", "user", [{ type: "text", text: "Please inspect this bug." }]),
			messageEntry("assistant-final", "assistant", [{ type: "text", text: "I'll continue with the next concrete step." }]),
		];

		const branchAnalysis = analyzeRalphBranchForStall(entries, 123);
		assert.equal(branchAnalysis.prompt, undefined);
		assert.equal(branchAnalysis.shouldRecover, false);

		const compactionAnalysis = analyzeCompactionRecovery(entries, { hasActiveLoop: false, isOverflow: false, timestamp: 123 });
		assert.equal(compactionAnalysis.shouldRecover, false);
		assert.equal(compactionAnalysis.reason, "no-active-ralph-loop");
	});

	it("does not treat a stale active Ralph state as compaction work", () => {
		const entries: SessionEntry[] = [messageEntry("assistant-final", "assistant", [{ type: "text", text: "All requested work is complete." }])];

		const analysis = analyzeCompactionRecovery(entries, { hasActiveLoop: true, isOverflow: false, timestamp: 123 });
		assert.equal(analysis.shouldRecover, false);
		assert.equal(analysis.reason, "active-loop-not-present-in-session-branch");
	});

	it("does not nudge after compaction when Ralph already advanced", () => {
		const entries: SessionEntry[] = [
			messageEntry("user-ralph", "user", [{ type: "text", text: ralphPrompt }]),
			messageEntry("assistant-tool", "assistant", [{ type: "toolCall", name: "ralph_done", arguments: {} }]),
			messageEntry("tool-result", "toolResult", [{ type: "text", text: "Iteration 6 complete. Next iteration queued." }], {
				toolName: "ralph_done",
				isError: false,
			}),
			messageEntry("assistant-final", "assistant", [{ type: "text", text: "I updated loop tracking and advanced Ralph (`ralph_done`)." }]),
		];

		const analysis = analyzeCompactionRecovery(entries, { hasActiveLoop: true, isOverflow: false, timestamp: 123 });
		assert.equal(analysis.shouldRecover, false);
		assert.equal(analysis.reason, "ralph-done-after-latest-prompt");
	});

	it("recognizes length-stopped assistant turns as context-limit stops", () => {
		assert.equal(assistantStoppedForContextLimit({ role: "assistant", stopReason: "length" }), true);
		assert.equal(
			assistantStoppedForContextLimit({ role: "assistant", stopReason: "error", errorMessage: "context_length_exceeded" }),
			true,
		);
		assert.equal(assistantStoppedForContextLimit({ role: "assistant", stopReason: "stop" }), false);
	});

	it("still recovers context-overflow compactions", () => {
		const entries: SessionEntry[] = [messageEntry("assistant-error", "assistant", [{ type: "text", text: "context_length_exceeded" }])];

		const analysis = analyzeCompactionRecovery(entries, { hasActiveLoop: false, isOverflow: true, timestamp: 123 });
		assert.equal(analysis.shouldRecover, true);
		assert.equal(analysis.kind, "overflow");
		assert.equal(analysis.reason, "context-overflow-compaction");
	});
});
