import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { makeHarness, statePath } from "./test-harness.ts";

test("stardock_complete completes active brief only after readiness evidence is recorded", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-completion-test-"));
	try {
		const { tools, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const brief = tools.get("stardock_brief");
		const ledger = tools.get("stardock_ledger");
		const report = tools.get("stardock_final_report");
		const complete = tools.get("stardock_complete");
		assert.ok(start);
		assert.ok(brief);
		assert.ok(ledger);
		assert.ok(report);
		assert.ok(complete);

		await start.execute(
			"tool-complete-brief-start",
			{
				name: "Complete Brief Loop",
				taskContent: "# Task\n\n## Checklist\n- [x] Done\n",
				maxIterations: 3,
			},
			undefined,
			undefined,
			ctx,
		);
		await brief.execute(
			"tool-complete-brief-upsert",
			{
				action: "upsert",
				loopName: "Complete_Brief_Loop",
				id: "b-complete",
				objective: "Finish the active brief with the loop.",
				task: "Complete this brief when the loop completes normally.",
				criterionIds: ["c-complete"],
				activate: true,
			},
			undefined,
			undefined,
			ctx,
		);
		await ledger.execute(
			"tool-complete-brief-criterion",
			{ action: "upsertCriterion", loopName: "Complete_Brief_Loop", id: "c-complete", description: "Brief work is complete.", passCondition: "Completion evidence is recorded.", status: "passed" },
			undefined,
			undefined,
			ctx,
		);
		await report.execute(
			"tool-complete-brief-report",
			{ action: "record", loopName: "Complete_Brief_Loop", id: "fr-complete", status: "passed", summary: "Completion evidence recorded.", criterionIds: ["c-complete"], validation: [{ result: "passed", summary: "Focused completion check passed." }] },
			undefined,
			undefined,
			ctx,
		);

		await complete.execute("tool-complete-brief-loop", {}, undefined, undefined, ctx);

		const state = JSON.parse(fs.readFileSync(statePath(cwd, "Complete_Brief_Loop"), "utf-8"));
		assert.equal(state.status, "completed");
		assert.equal(state.currentBriefId, undefined);
		assert.equal(state.briefs[0].status, "completed");
		assert.ok(state.briefs[0].completedAt);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
