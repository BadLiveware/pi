import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { makeHarness, runDir, statePath, taskPath } from "./test-harness.ts";

test("stardock_final_report records bounded final verification evidence", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { tools, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const ledger = tools.get("stardock_ledger");
		const finalReport = tools.get("stardock_final_report");
		const stateTool = tools.get("stardock_state");
		assert.ok(start);
		assert.ok(ledger);
		assert.ok(finalReport);
		assert.ok(stateTool);

		await start.execute("tool-final-start", { name: "Final Report Loop", mode: "checklist", taskContent: "# Final report task\n", maxIterations: 3 }, undefined, undefined, ctx);
		await ledger.execute(
			"tool-final-criteria",
			{
				action: "upsertCriteria",
				loopName: "Final_Report_Loop",
				criteria: [
					{ id: "c-pass", description: "Validated behavior is covered.", passCondition: "Report links the passed criterion.", status: "passed", evidence: "Focused test passed." },
					{ id: "c-gap", description: "Known gap is disclosed.", passCondition: "Report names the unresolved gap.", status: "skipped", evidence: "Deferred external smoke." },
				],
			},
			undefined,
			undefined,
			ctx,
		);
		const longSummary = `${"verbose log output ".repeat(80)}end`;
		await ledger.execute(
			"tool-final-artifact",
			{
				action: "recordArtifact",
				loopName: "Final_Report_Loop",
				id: "a-final-test",
				kind: "test",
				summary: longSummary,
				criterionIds: ["c-pass"],
			},
			undefined,
			undefined,
			ctx,
		);

		const recorded = await finalReport.execute(
			"tool-final-record",
			{
				action: "record",
				loopName: "Final_Report_Loop",
				id: "fr-ready",
				status: "partial",
				summary: `${"final summary ".repeat(80)}done`,
				criterionIds: ["c-pass", "c-gap"],
				artifactIds: ["a-final-test"],
				validation: [{ command: "npm test --prefix agent/extensions -- private/stardock/index.test.ts", result: "passed", summary: "Focused Stardock tests passed.", artifactIds: ["a-final-test"] }],
				unresolvedGaps: ["External service smoke was not run because no credentials were available."],
				compatibilityNotes: ["Completion marker behavior remains unchanged."],
				securityNotes: ["No new external side effects."],
				performanceNotes: ["Report summaries are capped before persistence."],
				includeState: true,
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(recorded.content[0].text, /Recorded final report fr-ready/);
		assert.equal(recorded.details.report.summary.length, 500);
		assert.equal(recorded.details.report.summary.endsWith("…"), true);
		assert.deepEqual(recorded.details.report.criterionIds, ["c-pass", "c-gap"]);
		assert.deepEqual(recorded.details.report.artifactIds, ["a-final-test"]);
		assert.equal(recorded.details.loop.finalVerificationReports.total, 1);

		const listed = await finalReport.execute("tool-final-list", { action: "list", loopName: "Final_Report_Loop" }, undefined, undefined, ctx);
		assert.match(listed.content[0].text, /Reports: 1 total/);
		assert.match(listed.content[0].text, /fr-ready \[partial\]/);
		assert.match(listed.content[0].text, /Artifacts: a-final-test/);
		assert.equal(listed.content[0].text.includes(longSummary), false);

		const inspect = await stateTool.execute("tool-final-state", { loopName: "Final_Report_Loop", includeDetails: true }, undefined, undefined, ctx);
		assert.equal(inspect.details.loop.finalVerificationReports.total, 1);
		assert.equal(inspect.details.loop.finalVerificationReportList[0].id, "fr-ready");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
