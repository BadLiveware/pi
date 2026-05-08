import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { makeHarness } from "./test-harness.ts";

test("stardock_state reports confident task checklist and ledger drift", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-drift-test-"));
	try {
		const { tools, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const ledger = tools.get("stardock_ledger");
		const stateTool = tools.get("stardock_state");
		const breakout = tools.get("stardock_breakout");
		assert.ok(start);
		assert.ok(ledger);
		assert.ok(stateTool);
		assert.ok(breakout);

		await start.execute(
			"start",
			{
				name: "Drift Loop",
				mode: "checklist",
				taskContent: "# Drift\n\n## Checklist\n- [ ] Passed item\n- [x] Pending item\n- [ ] Blocked item\n- [ ] Accepted blocked item\n- [ ] Unmatched item\n",
				maxIterations: 3,
			},
			undefined,
			undefined,
			ctx,
		);
		await ledger.execute("distill", { action: "distillTaskCriteria", loopName: "Drift_Loop" }, undefined, undefined, ctx);
		await ledger.execute("update", { action: "upsertCriteria", loopName: "Drift_Loop", criteria: [{ id: "c-task-01", status: "passed", evidence: "Done." }, { id: "c-task-03", status: "blocked", evidence: "Decision missing." }, { id: "c-task-04", status: "blocked", evidence: "Accepted." }] }, undefined, undefined, ctx);
		await breakout.execute("accepted", { action: "record", loopName: "Drift_Loop", id: "bp-accepted", status: "resolved", summary: "Accepted blocked item is deferred.", blockedCriterionIds: ["c-task-04"], requestedDecision: "Accept deferral." }, undefined, undefined, ctx);

		const summary = await stateTool.execute("summary", { loopName: "Drift_Loop" }, undefined, undefined, ctx);
		assert.match(summary.content[0].text, /Checklist\/ledger drift: 3/);
		assert.equal(summary.details.loop.checklistLedgerDrift.total, 3);
		assert.deepEqual(summary.details.loop.checklistLedgerDrift.items.map((item: any) => item.kind), ["criterion_passed_task_unchecked", "task_checked_criterion_pending", "criterion_blocked_task_unchecked"]);

		const overview = await stateTool.execute("overview", { loopName: "Drift_Loop", view: "overview", includeDetails: true }, undefined, undefined, ctx);
		assert.match(overview.content[0].text, /Checklist \/ ledger drift/);
		assert.match(overview.content[0].text, /c-task-01/);
		assert.match(overview.content[0].text, /c-task-02/);
		assert.match(overview.content[0].text, /c-task-03/);
		assert.equal(overview.content[0].text.includes("c-task-04"), false, "accepted blocked criteria should not report drift");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
