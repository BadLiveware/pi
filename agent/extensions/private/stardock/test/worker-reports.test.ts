import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { makeHarness,statePath } from "./test-harness.ts";

test("stardock_worker_report builds payloads and records compact worker results", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { tools, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const stateTool = tools.get("stardock_state");
		const ledger = tools.get("stardock_ledger");
		const handoff = tools.get("stardock_handoff");
		const brief = tools.get("stardock_brief");
		const worker = tools.get("stardock_worker_report");
		assert.ok(start);
		assert.ok(stateTool);
		assert.ok(ledger);
		assert.ok(handoff);
		assert.ok(brief);
		assert.ok(worker);

		await start.execute("tool-worker-start", { name: "Worker Loop", mode: "checklist", taskContent: "# Worker task\n", maxIterations: 3 }, undefined, undefined, ctx);
		const migratedState = JSON.parse(fs.readFileSync(statePath(cwd, "Worker_Loop"), "utf-8"));
		delete migratedState.workerReports;
		fs.writeFileSync(statePath(cwd, "Worker_Loop"), JSON.stringify(migratedState, null, 2), "utf-8");
		const defaulted = await stateTool.execute("tool-worker-default-state", { loopName: "Worker_Loop", includeDetails: true }, undefined, undefined, ctx);
		assert.equal(defaulted.details.loop.workerReports.total, 0);
		assert.deepEqual(defaulted.details.loop.workerReportList, []);

		await ledger.execute("tool-worker-criteria", { action: "upsertCriterion", loopName: "Worker_Loop", id: "c-eval", description: "Evaluate the risky change.", passCondition: "Worker identifies changed files and validation.", status: "pending" }, undefined, undefined, ctx);
		await ledger.execute("tool-worker-artifact", { action: "recordArtifact", loopName: "Worker_Loop", id: "a-worker-log", kind: "log", summary: `${"large worker log ".repeat(80)}done`, criterionIds: ["c-eval"] }, undefined, undefined, ctx);
		await handoff.execute("tool-worker-handoff", { action: "record", loopName: "Worker_Loop", id: "ah-worker", role: "reviewer", status: "answered", objective: "Review a risky change.", summary: "Worker should inspect files and validation.", criterionIds: ["c-eval"], artifactIds: ["a-worker-log"], resultSummary: "Worker report requested." }, undefined, undefined, ctx);

		const payload = await worker.execute(
			"tool-worker-payload",
			{
				action: "payload",
				loopName: "Worker_Loop",
				role: "reviewer",
				objective: "Summarize changed files, validation, risks, and review hints.",
				advisoryHandoffIds: ["ah-worker"],
				evaluatedCriterionIds: ["c-eval"],
				artifactIds: ["a-worker-log"],
				changedFiles: [{ path: "agent/extensions/private/stardock/src/worker-reports.ts", summary: `${"changed file summary ".repeat(40)}done`, reviewReason: "New workflow slice." }],
				reviewHints: ["Read changed file before relying on worker output."],
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(payload.content[0].text, /WorkerReport payload/);
		assert.match(payload.content[0].text, /Do not apply edits, call tools, spawn agents/);
		assert.match(payload.content[0].text, /provider-specific output format/);
		assert.match(payload.content[0].text, /c-eval \[pending\]/);
		assert.match(payload.content[0].text, /a-worker-log \[log\]/);
		assert.match(payload.content[0].text, /ah-worker \[answered\/reviewer\]/);
		assert.equal(payload.content[0].text.includes("large worker log ".repeat(20)), false);
		assert.equal(payload.content[0].text.includes("changed file summary ".repeat(20)), false);

		const recorded = await worker.execute(
			"tool-worker-record",
			{
				action: "record",
				loopName: "Worker_Loop",
				id: "wr-review",
				status: "needs_review",
				role: "reviewer",
				objective: "Summarize changed files, validation, risks, and review hints.",
				summary: `${"worker found risk ".repeat(80)}done`,
				advisoryHandoffIds: ["ah-worker"],
				evaluatedCriterionIds: ["c-eval"],
				artifactIds: ["a-worker-log"],
				changedFiles: [{ path: "agent/extensions/private/stardock/src/worker-reports.ts", summary: "New report tool.", reviewReason: "Review API boundaries." }],
				validation: [{ command: "npm test -- worker", result: "skipped", summary: "Worker did not run tests.", artifactIds: ["a-worker-log"] }],
				risks: ["Worker output is advisory only."],
				openQuestions: ["Should parent inspect changed files?"],
				suggestedNextMove: "Parent should inspect changed files and run validation.",
				reviewHints: ["Read worker-reports.ts before accepting."],
				includeState: true,
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(recorded.content[0].text, /Recorded worker report wr-review/);
		assert.equal(recorded.details.report.summary.length, 500);
		assert.equal(recorded.details.report.changedFiles[0].reviewReason, "Review API boundaries.");
		assert.equal(recorded.details.loop.workerReports.total, 1);
		assert.equal(recorded.details.workerReports.total, 1);

		const pagedState = JSON.parse(fs.readFileSync(statePath(cwd, "Worker_Loop"), "utf-8"));
		const reportTemplate = pagedState.workerReports[0];
		pagedState.workerReports = Array.from({ length: 45 }, (_, index) => ({
			...reportTemplate,
			id: `wr-page-${String(index + 1).padStart(2, "0")}`,
			createdAt: new Date(2026, 0, 1, 0, 0, index).toISOString(),
			updatedAt: new Date(2026, 0, 1, 0, 0, index).toISOString(),
		}));
		fs.writeFileSync(statePath(cwd, "Worker_Loop"), JSON.stringify(pagedState, null, 2), "utf-8");

		const listed = await worker.execute("tool-worker-list", { action: "list", loopName: "Worker_Loop" }, undefined, undefined, ctx);
		assert.match(listed.content[0].text, /Reports: 45 total/);
		assert.equal(listed.details.workerReports.length, 20);
		assert.equal(listed.details.page.nextOffset, 20);
		assert.match(listed.content[0].text, /wr-page-20/);
		assert.doesNotMatch(listed.content[0].text, /wr-page-21/);

		const finalPage = await worker.execute("tool-worker-list-final", { action: "list", loopName: "Worker_Loop", limit: 7, offset: 42 }, undefined, undefined, ctx);
		assert.equal(finalPage.details.workerReports.length, 3);
		assert.equal(finalPage.details.page.total, 45);
		assert.match(finalPage.content[0].text, /wr-page-43/);
		assert.match(finalPage.content[0].text, /wr-page-45/);
		assert.equal(finalPage.details.page.nextOffset, undefined);

		const followup = await brief.execute(
			"tool-worker-list-followup",
			{
				action: "upsert",
				loopName: "Worker_Loop",
				id: "b-paged-worker-list",
				objective: "Inspect a bounded worker-report page.",
				task: "Use pagination instead of attaching full report history.",
				followupTool: { name: "stardock_worker_report", args: { action: "list", loopName: "Worker_Loop", limit: 5, offset: 40 } },
			},
			undefined,
			undefined,
			ctx,
		);
		assert.equal(followup.details.followupTool.details.workerReports.length, 5);
		assert.equal(followup.details.followupTool.details.page.total, 45);
		assert.equal(followup.details.followupTool.details.page.nextOffset, undefined);

		const missingPayload = await worker.execute("tool-worker-missing-payload", { action: "payload", loopName: "Worker_Loop", objective: "bad refs", artifactIds: ["missing-artifact"] }, undefined, undefined, ctx);
		assert.match(missingPayload.content[0].text, /Artifact "missing-artifact" not found/);
		const missingRecord = await worker.execute("tool-worker-missing-record", { action: "record", loopName: "Worker_Loop", summary: "bad refs", advisoryHandoffIds: ["missing-handoff"] }, undefined, undefined, ctx);
		assert.match(missingRecord.content[0].text, /Advisory handoff "missing-handoff" not found/);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
