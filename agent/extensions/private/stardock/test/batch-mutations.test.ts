import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { makeHarness,statePath } from "./test-harness.ts";

test("Stardock evidence tools accept batch mutation inputs", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-batch-test-"));
	try {
		const { tools, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const ledger = tools.get("stardock_ledger");
		const brief = tools.get("stardock_brief");
		const finalReport = tools.get("stardock_final_report");
		const auditor = tools.get("stardock_auditor");
		const handoff = tools.get("stardock_handoff");
		const worker = tools.get("stardock_worker_report");
		const breakout = tools.get("stardock_breakout");
		const attemptReport = tools.get("stardock_attempt_report");
		assert.ok(start);
		assert.ok(ledger);
		assert.ok(brief);
		assert.ok(finalReport);
		assert.ok(auditor);
		assert.ok(handoff);
		assert.ok(worker);
		assert.ok(breakout);
		assert.ok(attemptReport);

		await start.execute("batch-start", { name: "Batch Loop", mode: "recursive", taskContent: "# Batch task\n", objective: "Verify batch tools", maxIterations: 3 }, undefined, undefined, ctx);
		await ledger.execute(
			"batch-criteria",
			{
				action: "upsertCriteria",
				loopName: "Batch_Loop",
				criteria: [
					{ id: "c-one", description: "First batched criterion.", passCondition: "Recorded with evidence.", status: "passed", evidence: "Batch criteria passed." },
					{ id: "c-two", description: "Second batched criterion.", passCondition: "Referenced by batch outputs.", status: "passed", evidence: "Batch references passed." },
				],
			},
			undefined,
			undefined,
			ctx,
		);
		await ledger.execute(
			"batch-artifacts",
			{
				action: "recordArtifacts",
				loopName: "Batch_Loop",
				artifacts: [
					{ id: "a-one", kind: "test", summary: "First batch artifact.", criterionIds: ["c-one"] },
					{ id: "a-two", kind: "smoke", summary: "Second batch artifact.", criterionIds: ["c-two"] },
				],
			},
			undefined,
			undefined,
			ctx,
		);

		const briefBatch = await brief.execute(
			"batch-briefs",
			{
				action: "upsert",
				loopName: "Batch_Loop",
				briefs: [
					{ id: "b-one", objective: "Batch first brief", task: "Work criterion one.", criterionIds: ["c-one"] },
					{ id: "b-two", objective: "Batch second brief", task: "Work criterion two.", criterionIds: ["c-two"] },
				],
				activate: true,
				includeState: true,
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(briefBatch.content[0].text, /Upserted 2 briefs and activated b-two/);
		assert.equal(briefBatch.details.upsertedBriefs.length, 2);
		assert.equal(briefBatch.details.currentBriefId, "b-two");

		const completeBriefs = await brief.execute("batch-complete-briefs", { action: "complete", loopName: "Batch_Loop", ids: ["b-one", "b-two"] }, undefined, undefined, ctx);
		assert.match(completeBriefs.content[0].text, /Completed 2 briefs/);
		assert.equal(completeBriefs.details.completedBriefs.length, 2);

		const failedReports = await finalReport.execute(
			"batch-final-reports-failure",
			{
				action: "record",
				loopName: "Batch_Loop",
				reports: [
					{ id: "fr-missing", status: "failed", summary: "Bad report refs.", criterionIds: ["missing-criterion"] },
					{ id: "fr-should-not-run", status: "passed", summary: "This report should not be recorded." },
				],
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(failedReports.content[0].text, /Criterion "missing-criterion" not found/);
		assert.equal(failedReports.details.failedIndex, 0);
		assert.equal(failedReports.details.failedInput.id, "fr-missing");

		const reports = await finalReport.execute(
			"batch-final-reports",
			{
				action: "record",
				loopName: "Batch_Loop",
				reports: [
					{ id: "fr-one", status: "passed", summary: "First final report.", criterionIds: ["c-one"], artifactIds: ["a-one"], validation: [{ result: "passed", summary: "First validation passed.", artifactIds: ["a-one"] }] },
					{ id: "fr-two", status: "passed", summary: "Second final report.", criterionIds: ["c-two"], artifactIds: ["a-two"], validation: [{ result: "passed", summary: "Second validation passed.", artifactIds: ["a-two"] }] },
				],
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(reports.content[0].text, /Recorded 2 final reports/);
		assert.equal(reports.details.reports.length, 2);

		const reviews = await auditor.execute(
			"batch-auditor-reviews",
			{
				action: "record",
				loopName: "Batch_Loop",
				reviews: [
					{ id: "ar-one", status: "passed", summary: "First auditor review.", focus: "Criterion one", criterionIds: ["c-one"], artifactIds: ["a-one"], finalReportIds: ["fr-one"] },
					{ id: "ar-two", status: "passed", summary: "Second auditor review.", focus: "Criterion two", criterionIds: ["c-two"], artifactIds: ["a-two"], finalReportIds: ["fr-two"] },
				],
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(reviews.content[0].text, /Recorded 2 auditor reviews/);
		assert.equal(reviews.details.reviews.length, 2);

		const handoffs = await handoff.execute(
			"batch-handoffs",
			{
				action: "record",
				loopName: "Batch_Loop",
				handoffs: [
					{ id: "ah-one", role: "reviewer", status: "answered", objective: "Review first criterion.", summary: "First handoff.", criterionIds: ["c-one"], artifactIds: ["a-one"], finalReportIds: ["fr-one"], resultSummary: "Looks good." },
					{ id: "ah-two", role: "reviewer", status: "answered", objective: "Review second criterion.", summary: "Second handoff.", criterionIds: ["c-two"], artifactIds: ["a-two"], finalReportIds: ["fr-two"], resultSummary: "Looks good." },
				],
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(handoffs.content[0].text, /Recorded 2 advisory handoffs/);
		assert.equal(handoffs.details.handoffs.length, 2);

		const workers = await worker.execute(
			"batch-worker-reports",
			{
				action: "record",
				loopName: "Batch_Loop",
				reports: [
					{ id: "wr-one", status: "accepted", role: "reviewer", objective: "Worker one", summary: "Worker one report.", advisoryHandoffIds: ["ah-one"], evaluatedCriterionIds: ["c-one"], artifactIds: ["a-one"], validation: [{ result: "passed", summary: "Worker one validation.", artifactIds: ["a-one"] }] },
					{ id: "wr-two", status: "accepted", role: "reviewer", objective: "Worker two", summary: "Worker two report.", advisoryHandoffIds: ["ah-two"], evaluatedCriterionIds: ["c-two"], artifactIds: ["a-two"], validation: [{ result: "passed", summary: "Worker two validation.", artifactIds: ["a-two"] }] },
				],
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(workers.content[0].text, /Recorded 2 worker reports/);
		assert.equal(workers.details.reports.length, 2);

		const attempts = await attemptReport.execute(
			"batch-attempts",
			{
				loopName: "Batch_Loop",
				reports: [
					{ iteration: 1, kind: "setup", hypothesis: "Setup establishes fixtures.", actionSummary: "Created fixtures.", validation: "Fixture smoke passed.", result: "neutral", kept: true },
					{ iteration: 2, kind: "candidate_change", hypothesis: "Batch inputs reduce calls.", actionSummary: "Recorded batch reports.", validation: "Batch test passed.", result: "improved", kept: true },
				],
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(attempts.content[0].text, /Recorded 2 attempt reports/);
		assert.equal(attempts.details.attempts.length, 2);

		const breakouts = await breakout.execute(
			"batch-breakouts",
			{
				action: "record",
				loopName: "Batch_Loop",
				packages: [
					{ id: "bp-one", status: "resolved", summary: "First breakout package.", blockedCriterionIds: ["c-one"], attemptIds: ["attempt-1"], artifactIds: ["a-one"], finalReportIds: ["fr-one"], auditorReviewIds: ["ar-one"], advisoryHandoffIds: ["ah-one"], requestedDecision: "Resume first slice." },
					{ id: "bp-two", status: "resolved", summary: "Second breakout package.", blockedCriterionIds: ["c-two"], attemptIds: ["attempt-2"], artifactIds: ["a-two"], finalReportIds: ["fr-two"], auditorReviewIds: ["ar-two"], advisoryHandoffIds: ["ah-two"], requestedDecision: "Resume second slice." },
				],
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(breakouts.content[0].text, /Recorded 2 breakout packages/);
		assert.equal(breakouts.details.packages.length, 2);

		const state = JSON.parse(fs.readFileSync(statePath(cwd, "Batch_Loop"), "utf-8"));
		assert.equal(state.briefs.length, 2);
		assert.equal(state.finalVerificationReports.length, 2);
		assert.equal(state.finalVerificationReports.some((report: { id: string }) => report.id === "fr-should-not-run"), false);
		assert.equal(state.auditorReviews.length, 2);
		assert.equal(state.advisoryHandoffs.length, 2);
		assert.equal(state.workerReports.length, 2);
		assert.equal(state.breakoutPackages.length, 2);
		assert.equal(state.modeState.attempts.length, 2);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
