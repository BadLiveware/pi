import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { makeHarness, statePath } from "./test-harness.ts";

test("stardock_auditor builds payloads and records compact manual reviews", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { tools, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const ledger = tools.get("stardock_ledger");
		const finalReport = tools.get("stardock_final_report");
		const auditor = tools.get("stardock_auditor");
		const stateTool = tools.get("stardock_state");
		assert.ok(start);
		assert.ok(ledger);
		assert.ok(finalReport);
		assert.ok(auditor);
		assert.ok(stateTool);

		await start.execute("tool-auditor-start", { name: "Auditor Loop", mode: "checklist", taskContent: "# Auditor task\n", maxIterations: 3 }, undefined, undefined, ctx);
		const migratedState = JSON.parse(fs.readFileSync(statePath(cwd, "Auditor_Loop"), "utf-8"));
		delete migratedState.auditorReviews;
		fs.writeFileSync(statePath(cwd, "Auditor_Loop"), JSON.stringify(migratedState, null, 2), "utf-8");
		const defaulted = await stateTool.execute("tool-auditor-default-state", { loopName: "Auditor_Loop", includeDetails: true }, undefined, undefined, ctx);
		assert.deepEqual(defaulted.details.loop.auditorReviews, []);

		await ledger.execute(
			"tool-auditor-criteria",
			{
				action: "upsertCriteria",
				loopName: "Auditor_Loop",
				criteria: [
					{ id: "c-ready", description: "Ready behavior is validated.", passCondition: "Evidence supports readiness.", status: "passed", evidence: "Unit and integration tests passed." },
					{ id: "c-gap", description: "Known audit gap is visible.", passCondition: "Auditor sees the gap.", status: "blocked", evidence: "Manual smoke not run." },
				],
			},
			undefined,
			undefined,
			ctx,
		);
		await ledger.execute("tool-auditor-artifact", { action: "recordArtifact", loopName: "Auditor_Loop", id: "a-tests", kind: "test", summary: `${"large test log ".repeat(80)}done`, criterionIds: ["c-ready"] }, undefined, undefined, ctx);
		await finalReport.execute("tool-auditor-final", { action: "record", loopName: "Auditor_Loop", id: "fr-partial", status: "partial", summary: "Final report notes one blocked smoke test.", criterionIds: ["c-ready", "c-gap"], artifactIds: ["a-tests"], unresolvedGaps: ["Manual smoke remains blocked."], includeState: true }, undefined, undefined, ctx);

		const payload = await auditor.execute("tool-auditor-payload", { action: "payload", loopName: "Auditor_Loop", focus: "Check readiness and blocked smoke gap." }, undefined, undefined, ctx);
		assert.match(payload.content[0].text, /Auditor review payload for loop "Auditor_Loop"/);
		assert.match(payload.content[0].text, /c-ready \[passed\]/);
		assert.match(payload.content[0].text, /c-gap \[blocked\]/);
		assert.match(payload.content[0].text, /a-tests \[test\]/);
		assert.match(payload.content[0].text, /fr-partial \[partial\]/);
		assert.match(payload.content[0].text, /Manual smoke remains blocked/);
		assert.equal(payload.content[0].text.includes("large test log ".repeat(20)), false);

		const recorded = await auditor.execute(
			"tool-auditor-record",
			{
				action: "record",
				loopName: "Auditor_Loop",
				id: "ar-readiness",
				status: "concerns",
				summary: `${"auditor summary ".repeat(80)}done`,
				focus: "Readiness review",
				criterionIds: ["c-ready", "c-gap"],
				artifactIds: ["a-tests"],
				finalReportIds: ["fr-partial"],
				concerns: ["Blocked manual smoke still matters."],
				recommendations: ["Run manual smoke before claiming broad readiness."],
				requiredFollowups: ["Complete the smoke test or record why it is skipped."],
				includeState: true,
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(recorded.content[0].text, /Recorded auditor review ar-readiness/);
		assert.equal(recorded.details.review.summary.length, 500);
		assert.equal(recorded.details.review.status, "concerns");
		assert.deepEqual(recorded.details.review.finalReportIds, ["fr-partial"]);
		assert.equal(recorded.details.loop.auditorReviews.length, 1);

		const listed = await auditor.execute("tool-auditor-list", { action: "list", loopName: "Auditor_Loop" }, undefined, undefined, ctx);
		assert.match(listed.content[0].text, /Reviews: 1 total/);
		assert.match(listed.content[0].text, /ar-readiness \[concerns\]/);
		assert.match(listed.content[0].text, /Blocked manual smoke/);

		const missing = await auditor.execute("tool-auditor-missing", { action: "record", loopName: "Auditor_Loop", summary: "bad refs", criterionIds: ["missing"] }, undefined, undefined, ctx);
		assert.match(missing.content[0].text, /Criterion "missing" not found/);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
