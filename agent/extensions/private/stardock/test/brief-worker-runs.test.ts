import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { makeHarness } from "./test-harness.ts";

test("stardock_brief_worker runs a brief-scoped subagent and records a WorkerReport", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-brief-worker-test-"));
	try {
		const { tools, events, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const ledger = tools.get("stardock_ledger");
		const brief = tools.get("stardock_brief");
		const workerRun = tools.get("stardock_brief_worker");
		const workerReport = tools.get("stardock_worker_report");
		assert.ok(start);
		assert.ok(ledger);
		assert.ok(brief);
		assert.ok(workerRun);
		assert.ok(workerReport);

		await start.execute("tool-brief-worker-start", { name: "Brief Worker", mode: "checklist", taskContent: "# Brief worker task\n", maxIterations: 3 }, undefined, undefined, ctx);
		await ledger.execute("tool-brief-worker-criterion", { action: "upsertCriterion", loopName: "Brief_Worker", id: "c-brief-worker", description: "Brief worker runs through a subagent.", passCondition: "A WorkerReport records the subagent result.", status: "pending" }, undefined, undefined, ctx);
		await brief.execute("tool-brief-worker-brief", { action: "upsert", loopName: "Brief_Worker", id: "b-worker", objective: "Map next files.", task: "Find likely implementation files and validation commands.", criterionIds: ["c-brief-worker"], constraints: ["Advisory only."], activate: true }, undefined, undefined, ctx);

		const outputPath = path.join(cwd, "stardock-worker-output.md");
		let capturedRequest: any;
		events.on("subagent:slash:request", (data) => {
			capturedRequest = data;
			fs.writeFileSync(outputPath, "Explorer mapped briefs.ts and worker-reports.ts from saved output. Run focused Stardock tests.", "utf-8");
			const request = data as { requestId: string; params: Record<string, unknown> };
			events.emit("subagent:slash:started", { requestId: request.requestId });
			events.emit("subagent:slash:response", {
				requestId: request.requestId,
				isError: false,
				result: {
					content: [{ type: "text", text: `Output saved to: ${outputPath} (1.0 KB, 12 lines).` }],
					details: {
						runId: "sub-123",
						results: [{ agent: "scout", exitCode: 0, finalOutput: `Output saved to: ${outputPath} (1.0 KB, 12 lines).`, savedOutputPath: outputPath, sessionFile: "/tmp/subagent-session.jsonl" }],
					},
				},
			});
		});

		const result = await workerRun.execute("tool-brief-worker-run", { action: "run", loopName: "Brief_Worker", role: "explorer" }, undefined, undefined, ctx);
		assert.match(result.content[0].text, /Subagent completed\./);
		assert.match(result.content[0].text, /Recorded WorkerReport wr1/);
		assert.match(result.content[0].text, /Explorer mapped briefs\.ts/);
		assert.equal(result.details.report.id, "wr1");
		assert.equal(result.details.report.role, "explorer");
		assert.match(result.details.report.summary, /from saved output/);
		assert.deepEqual(result.details.report.evaluatedCriterionIds, ["c-brief-worker"]);
		assert.match(result.details.report.reviewHints[0], /Worker output refs:/);
		assert.equal(result.details.subagent.requestId, capturedRequest.requestId);
		assert.equal(capturedRequest.params.agent, "scout");
		assert.equal(capturedRequest.params.context, "fresh");
		assert.equal(capturedRequest.params.async, false);
		assert.equal(capturedRequest.params.clarify, false);
		assert.equal(capturedRequest.params.outputMode, "file-only");
		assert.match(capturedRequest.params.output, /^\.stardock\/runs\/Brief_Worker\/workers\//);
		assert.match(capturedRequest.params.task, /Adapter role: explorer/);
		assert.match(capturedRequest.params.task, /Stardock advisory worker payload/);
		assert.match(capturedRequest.params.task, /c-brief-worker \[pending\]/);

		const listed = await workerReport.execute("tool-brief-worker-list", { action: "list", loopName: "Brief_Worker" }, undefined, undefined, ctx);
		assert.match(listed.content[0].text, /Reports: 1 total/);
		assert.match(listed.content[0].text, /wr1 \[submitted\/explorer\]/);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("stardock_brief_worker reports missing pi-subagents bridge", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-brief-worker-test-"));
	try {
		const { tools, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const brief = tools.get("stardock_brief");
		const workerRun = tools.get("stardock_brief_worker");
		assert.ok(start);
		assert.ok(brief);
		assert.ok(workerRun);
		await start.execute("tool-brief-worker-start", { name: "No Bridge", mode: "checklist", taskContent: "# No bridge\n", maxIterations: 3 }, undefined, undefined, ctx);
		await brief.execute("tool-brief-worker-brief", { action: "upsert", loopName: "No_Bridge", id: "b-worker", objective: "Need bridge.", task: "Run worker.", activate: true }, undefined, undefined, ctx);
		const result = await workerRun.execute("tool-brief-worker-run", { action: "run", loopName: "No_Bridge", role: "explorer" }, undefined, undefined, ctx);
		assert.match(result.content[0].text, /No subagent bridge responded/);
		assert.equal(result.isError, true);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
