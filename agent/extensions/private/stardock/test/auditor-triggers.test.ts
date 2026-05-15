import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { makeHarness, statePath } from "./test-harness.ts";

test("completion marker creates auditor request when auditor gate is active", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-auditor-trigger-test-"));
	try {
		const { tools, handlers, messages, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const ledger = tools.get("stardock_ledger");
		assert.ok(start);
		assert.ok(ledger);

		await start.execute("tool-complete-audit-start", { name: "Complete Audit Loop", taskContent: "# Task\n", maxIterations: 3 }, undefined, undefined, ctx);
		await ledger.execute("tool-complete-audit-criterion", { action: "upsertCriterion", loopName: "Complete_Audit_Loop", id: "c-skipped", description: "Skipped criterion", passCondition: "Auditor accepts the gap.", status: "skipped" }, undefined, undefined, ctx);

		const agentEnd = handlers.get("agent_end")?.[0];
		assert.ok(agentEnd);
		const beforeMessages = messages.length;
		await agentEnd({ messages: [{ role: "assistant", content: [{ type: "text", text: "<promise>COMPLETE</promise>" }] }] }, ctx);

		assert.equal(messages.length, beforeMessages + 1);
		assert.match(messages.at(-1)?.content ?? "", /completion blocked: auditor request auditor-1/);
		const state = JSON.parse(fs.readFileSync(statePath(cwd, "Complete_Audit_Loop"), "utf-8"));
		assert.equal(state.status, "active");
		assert.equal(state.outsideRequests[0].kind, "auditor_review");
		assert.equal(state.outsideRequests[0].status, "requested");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("recording an auditor review answers pending auditor requests", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-auditor-trigger-test-"));
	try {
		const { tools, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const ledger = tools.get("stardock_ledger");
		const done = tools.get("stardock_done");
		const auditor = tools.get("stardock_auditor");
		assert.ok(start);
		assert.ok(ledger);
		assert.ok(done);
		assert.ok(auditor);

		await start.execute("tool-audit-answer-start", { name: "Audit Answer Loop", taskContent: "# Task\n", maxIterations: 3 }, undefined, undefined, ctx);
		await ledger.execute("tool-audit-answer-criterion", { action: "upsertCriterion", loopName: "Audit_Answer_Loop", id: "c-skipped", description: "Skipped criterion", passCondition: "Auditor accepts the gap.", status: "skipped" }, undefined, undefined, ctx);
		await done.execute("tool-audit-answer-done", {}, undefined, undefined, ctx);
		await auditor.execute("tool-audit-answer-record", { action: "record", loopName: "Audit_Answer_Loop", id: "ar-pass", status: "passed", summary: "Auditor accepts the explicit skipped check for this bounded scope.", criterionIds: ["c-skipped"] }, undefined, undefined, ctx);

		const state = JSON.parse(fs.readFileSync(statePath(cwd, "Audit_Answer_Loop"), "utf-8"));
		assert.equal(state.outsideRequests[0].kind, "auditor_review");
		assert.equal(state.outsideRequests[0].status, "answered");
		assert.match(state.outsideRequests[0].answer, /Recorded auditor review ar-pass/);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
