import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { buildPrompt } from "../src/runtime/prompts.ts";
import { loadState } from "../src/state/store.ts";
import { makeHarness } from "./test-harness.ts";

test("workflow status gates appear in queued prompts when a gate already exists", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-workflow-test-"));
	try {
		const { tools, messages, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const worker = tools.get("stardock_worker_report");
		assert.ok(start);
		assert.ok(worker);

		await start.execute("tool-workflow-prompt-start", { name: "Workflow Prompt", mode: "checklist", taskContent: "# Workflow prompt\n", maxIterations: 3 }, undefined, undefined, ctx);
		await worker.execute("tool-workflow-prompt-worker", { action: "record", loopName: "Workflow_Prompt", id: "wr-prompt", role: "explorer", status: "needs_review", objective: "Map risky files.", summary: "Found a risky path.", risks: ["Parent should inspect reported risk."], reviewHints: ["Inspect src/example.ts"] }, undefined, undefined, ctx);
		const state = loadState(ctx, "Workflow_Prompt");
		assert.ok(state);

		const prompt = buildPrompt(state, "# Workflow prompt\n", "iteration");
		assert.match(prompt, /## Workflow Status/);
		assert.match(prompt, /Workflow: needs_parent_review \[blocked\]/);
		assert.match(prompt, /Gate: Do not continue implementation until parent review is addressed or explicitly rejected with rationale\./);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

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

test("stardock_done does not queue checklist prompts for ready-to-complete workflow", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-workflow-test-"));
	try {
		const { tools, messages, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const ledger = tools.get("stardock_ledger");
		const report = tools.get("stardock_final_report");
		const done = tools.get("stardock_done");
		assert.ok(start);
		assert.ok(ledger);
		assert.ok(report);
		assert.ok(done);

		await start.execute("tool-workflow-complete-start", { name: "Workflow Complete", mode: "checklist", taskContent: "# Workflow complete\n", maxIterations: 3 }, undefined, undefined, ctx);
		await ledger.execute("tool-workflow-complete-criterion", { action: "upsertCriterion", loopName: "Workflow_Complete", id: "c-ready", description: "Ready criterion", passCondition: "Passed", status: "passed" }, undefined, undefined, ctx);
		await report.execute("tool-workflow-complete-report", { action: "record", loopName: "Workflow_Complete", id: "fr-ready", status: "passed", summary: "Ready to complete.", criterionIds: ["c-ready"], validation: [{ result: "passed", summary: "Manual verification passed." }] }, undefined, undefined, ctx);
		const beforeDoneMessages = messages.length;
		const doneResult = await done.execute("tool-workflow-complete-done", {}, undefined, undefined, ctx);

		assert.equal(messages.length, beforeDoneMessages);
		assert.match(doneResult.content[0].text, /No next checklist prompt queued because workflow is ready_to_complete/);
		assert.equal(doneResult.details.workflowStatus.state, "ready_to_complete");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("stardock_done does not queue checklist prompts for gated workflow states", async () => {
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
		const beforeDoneMessages = messages.length;
		const doneResult = await done.execute("tool-workflow-gate-done", {}, undefined, undefined, ctx);

		assert.equal(messages.length, beforeDoneMessages);
		assert.match(doneResult.content[0].text, /No next checklist prompt queued because workflow is needs_parent_review/);
		assert.equal(doneResult.details.workflowStatus.state, "needs_parent_review");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
