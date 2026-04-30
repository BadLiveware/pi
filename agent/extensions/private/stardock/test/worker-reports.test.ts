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
		const worker = tools.get("stardock_worker_report");
		assert.ok(start);
		assert.ok(stateTool);
		assert.ok(ledger);
		assert.ok(handoff);
		assert.ok(worker);

		await start.execute("tool-worker-start", { name: "Worker Loop", mode: "checklist", taskContent: "# Worker task\n", maxIterations: 3 }, undefined, undefined, ctx);
		const migratedState = JSON.parse(fs.readFileSync(statePath(cwd, "Worker_Loop"), "utf-8"));
		delete migratedState.workerReports;
		fs.writeFileSync(statePath(cwd, "Worker_Loop"), JSON.stringify(migratedState, null, 2), "utf-8");
		const defaulted = await stateTool.execute("tool-worker-default-state", { loopName: "Worker_Loop", includeDetails: true }, undefined, undefined, ctx);
		assert.deepEqual(defaulted.details.loop.workerReports, []);

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
		assert.equal(recorded.details.loop.workerReports.length, 1);

		const listed = await worker.execute("tool-worker-list", { action: "list", loopName: "Worker_Loop" }, undefined, undefined, ctx);
		assert.match(listed.content[0].text, /Reports: 1 total/);
		assert.match(listed.content[0].text, /wr-review \[needs_review\/reviewer\]/);

		const missingPayload = await worker.execute("tool-worker-missing-payload", { action: "payload", loopName: "Worker_Loop", objective: "bad refs", artifactIds: ["missing-artifact"] }, undefined, undefined, ctx);
		assert.match(missingPayload.content[0].text, /Artifact "missing-artifact" not found/);
		const missingRecord = await worker.execute("tool-worker-missing-record", { action: "record", loopName: "Worker_Loop", summary: "bad refs", advisoryHandoffIds: ["missing-handoff"] }, undefined, undefined, ctx);
		assert.match(missingRecord.content[0].text, /Advisory handoff "missing-handoff" not found/);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
