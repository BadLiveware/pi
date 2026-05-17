import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { makeHarness } from "./test-harness.ts";

test("session escape input aborts a busy Stardock turn", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-interrupt-input-test-"));
	try {
		const { tools, handlers, setIdle, dispatchTerminalInput, aborts, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		assert.ok(start);

		await start.execute("tool-escape-start", { name: "Escape Loop", taskContent: "# Task\n", maxIterations: 3 }, undefined, undefined, ctx);
		const sessionStart = handlers.get("session_start")?.[0];
		assert.ok(sessionStart);
		await sessionStart({}, ctx);

		setIdle(false);
		const busyResult = dispatchTerminalInput("\x1b");
		assert.equal(busyResult.consumed, true);
		assert.deepEqual(aborts, ["abort"]);

		const kittyEscapeResult = dispatchTerminalInput("\x1b[27u");
		assert.equal(kittyEscapeResult.consumed, true);
		assert.deepEqual(aborts, ["abort", "abort"]);

		setIdle(true);
		const idleResult = dispatchTerminalInput("\x1b");
		assert.equal(idleResult.consumed, false);
		assert.deepEqual(aborts, ["abort", "abort"], "idle ESC should remain available for normal Pi key handling");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
