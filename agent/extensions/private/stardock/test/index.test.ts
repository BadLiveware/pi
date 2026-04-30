import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { makeHarness, runDir, statePath, taskPath } from "./test-harness.ts";

test("stardock registers tools and commands", () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { tools, commands, handlers } = makeHarness(cwd);
		assert.ok(tools.has("stardock_start"));
		assert.ok(tools.has("stardock_done"));
		assert.ok(tools.has("stardock_state"));
		assert.ok(tools.has("stardock_ledger"));
		assert.ok(tools.has("stardock_brief"));
		assert.ok(tools.has("stardock_final_report"));
		assert.ok(tools.has("stardock_handoff"));
		assert.ok(tools.has("stardock_auditor"));
		assert.ok(tools.has("stardock_breakout"));
		assert.ok(tools.has("stardock_attempt_report"));
		assert.ok(tools.has("stardock_govern"));
		assert.ok(tools.has("stardock_outside_payload"));
		assert.ok(tools.has("stardock_outside_requests"));
		assert.ok(tools.has("stardock_outside_answer"));
		assert.ok(commands.has("stardock"));
		assert.ok(commands.has("stardock-stop"));
		assert.ok((handlers.get("before_agent_start") ?? []).length > 0);
		assert.ok((handlers.get("agent_end") ?? []).length > 0);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
