import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import {
	analyzeCompactionRecovery,
	analyzeRalphBranchForStall,
	assistantRequestsRalphContinuation,
	parseRalphPrompt,
	WATCHDOG_NUDGE_PROMPT,
} from "./index.ts";

const ralphPrompt = `───────────────────────────────────────────────────────────────────────
🔄 RALPH LOOP: native-sql-optimization-sweep | Iteration 6/100 | 🪞 REFLECTION
───────────────────────────────────────────────────────────────────────

REFLECTION CHECKPOINT

Update the task file with your reflection, then continue working.

## Instructions

You are in a Ralph loop (iteration 6 of 100).

1. Continue working on the task
2. Update the task file (.ralph/native-sql-optimization-sweep.md) with your progress
3. When FULLY COMPLETE, respond with: <promise>COMPLETE</promise>
4. Otherwise, call the ralph_done tool to proceed to next iteration`;

function messageEntry(id: string, role: string, content: unknown, extra: Record<string, unknown> = {}): SessionEntry {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp: "2026-04-28T17:31:12.000Z",
		message: {
			role,
			content,
			...extra,
		},
	} as unknown as SessionEntry;
}

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
			assistantRequestsRalphContinuation(
				"Let's execute commands: baseline explain for mixed root to show no_cap currently suppresses cap. Let's do quickly.",
			),
			true,
		);
		assert.equal(assistantRequestsRalphContinuation("I’m blocked waiting for your decision before proceeding."), false);
		assert.equal(assistantRequestsRalphContinuation("<promise>COMPLETE</promise>"), false);
	});

	it("uses an explicit self-checking watchdog nudge", () => {
		assert.match(WATCHDOG_NUDGE_PROMPT, /Automated watchdog nudge/);
		assert.match(WATCHDOG_NUDGE_PROMPT, /not a new user request/);
		assert.match(WATCHDOG_NUDGE_PROMPT, /does not mean more work is required/);
		assert.match(WATCHDOG_NUDGE_PROMPT, /If this is a Ralph loop/);
		assert.match(WATCHDOG_NUDGE_PROMPT, /<promise>COMPLETE<\/promise>/);
		assert.match(WATCHDOG_NUDGE_PROMPT, /If unfinished in-scope work remains, continue/);
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

	it("still recovers context-overflow compactions", () => {
		const entries: SessionEntry[] = [messageEntry("assistant-error", "assistant", [{ type: "text", text: "context_length_exceeded" }])];

		const analysis = analyzeCompactionRecovery(entries, { hasActiveLoop: false, isOverflow: true, timestamp: 123 });
		assert.equal(analysis.shouldRecover, true);
		assert.equal(analysis.kind, "overflow");
		assert.equal(analysis.reason, "context-overflow-compaction");
	});
});
