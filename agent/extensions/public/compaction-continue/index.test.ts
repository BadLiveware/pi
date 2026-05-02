import assert from "node:assert/strict";
import { describe, it } from "node:test";
import compactionContinue, { WATCHDOG_NUDGE_PROMPT } from "./index.ts";

describe("compaction-continue extension surface", () => {
	it("exports the extension entrypoint", () => {
		assert.equal(typeof compactionContinue, "function");
	});

	it("exposes a watchdog nudge prompt", () => {
		assert.equal(typeof WATCHDOG_NUDGE_PROMPT, "string");
		assert.match(WATCHDOG_NUDGE_PROMPT, /watchdog nudge/i);
	});
});
