import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { makeHarness } from "./test-harness.ts";

test("checklist prompt recommends one-call brief lifecycle only for active briefs", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-finalization-test-"));
	try {
		const { tools, messages, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const brief = tools.get("stardock_brief");
		const done = tools.get("stardock_done");
		assert.ok(start);
		assert.ok(brief);
		assert.ok(done);

		await start.execute("start", { name: "Finalization Hint", mode: "checklist", taskContent: "# Task\n", maxIterations: 3 }, undefined, undefined, ctx);
		assert.match(messages[0].content, /No active brief/);
		assert.doesNotMatch(messages[0].content, /briefLifecycle: "complete"/);

		await brief.execute("brief", { action: "upsert", loopName: "Finalization_Hint", id: "b-one", objective: "Finish one bounded task.", task: "Do the task.", activate: true }, undefined, undefined, ctx);
		await done.execute("done", {}, undefined, undefined, ctx);

		assert.match(messages[1].content, /Active Iteration Brief/);
		assert.match(messages[1].content, /briefLifecycle: "complete"/);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
