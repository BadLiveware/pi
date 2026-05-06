import assert from "node:assert/strict";
import { describe, it } from "node:test";
import compactionContinue, { buildWatchdogNudgePrompt, WATCHDOG_NUDGE_PROMPT } from "./index.ts";

describe("compaction-continue extension surface", () => {
	it("exports the extension entrypoint", () => {
		assert.equal(typeof compactionContinue, "function");
	});

	it("exposes a watchdog nudge prompt", () => {
		assert.equal(typeof WATCHDOG_NUDGE_PROMPT, "string");
		assert.match(WATCHDOG_NUDGE_PROMPT, /watchdog nudge/i);
	});

	it("buildWatchdogNudgePrompt includes COMPLETE marker when in a loop", () => {
		const prompt = buildWatchdogNudgePrompt(true);
		assert.match(prompt, /<promise>COMPLETE<\/promise>/);
		assert.match(prompt, /emit the loop completion marker/);
	});

	it("buildWatchdogNudgePrompt forbids COMPLETE marker when no loop is active", () => {
		const prompt = buildWatchdogNudgePrompt(false);
		assert.match(prompt, /do not emit.*COMPLETE/);
		assert.match(prompt, /no active loop/);
	});
});
