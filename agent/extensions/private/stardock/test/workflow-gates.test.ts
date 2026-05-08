import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { makeHarness } from "./test-harness.ts";

test("workflow transitions notify once for actionable status changes", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-workflow-test-"));
	try {
		const { tools, notifications, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const worker = tools.get("stardock_worker_report");
		assert.ok(start);
		assert.ok(worker);

		await start.execute("tool-workflow-notify-start", { name: "Workflow Notify", mode: "checklist", taskContent: "# Workflow notify\n", maxIterations: 3 }, undefined, undefined, ctx);
		assert.equal(notifications.length, 0, "initial non-actionable status should not notify");

		await worker.execute("tool-workflow-notify-worker", { action: "record", loopName: "Workflow_Notify", id: "wr-notify", role: "explorer", status: "needs_review", objective: "Map risky files.", summary: "Found a risky path.", risks: ["Parent should inspect reported risk."], reviewHints: ["Inspect src/example.ts"] }, undefined, undefined, ctx);
		assert.equal(notifications.length, 1);
		assert.match(notifications[0], /stardock Workflow_Notify: needs_parent_review/);

		await worker.execute("tool-workflow-notify-worker-repeat", { action: "record", loopName: "Workflow_Notify", id: "wr-notify", role: "explorer", status: "needs_review", objective: "Map risky files.", summary: "Found a risky path.", risks: ["Parent should inspect reported risk."], reviewHints: ["Inspect src/example.ts"] }, undefined, undefined, ctx);
		assert.equal(notifications.length, 1, "same workflow state and reasons should not re-notify");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("workflow status gates appear in subsequent checklist prompts", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-workflow-test-"));
	try {
		const { tools, messages, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const worker = tools.get("stardock_worker_report");
		const done = tools.get("stardock_done");
		assert.ok(start);
		assert.ok(worker);
		assert.ok(done);

		await start.execute("tool-workflow-gate-start", { name: "Workflow Gate", mode: "checklist", taskContent: "# Workflow gate\n", maxIterations: 3 }, undefined, undefined, ctx);
		await worker.execute("tool-workflow-gate-worker", { action: "record", loopName: "Workflow_Gate", id: "wr-gate", role: "explorer", status: "needs_review", objective: "Map risky files.", summary: "Found a risky path.", risks: ["Parent should inspect reported risk."], reviewHints: ["Inspect src/example.ts"] }, undefined, undefined, ctx);
		await done.execute("tool-workflow-gate-done", {}, undefined, undefined, ctx);

		const prompt = messages.at(-1)?.content ?? "";
		assert.match(prompt, /## Workflow Status/);
		assert.match(prompt, /Workflow: needs_parent_review \[blocked\]/);
		assert.match(prompt, /Gate: Do not continue implementation until parent review is addressed or explicitly rejected with rationale\./);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
