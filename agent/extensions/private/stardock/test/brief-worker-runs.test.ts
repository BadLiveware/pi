import * as assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { makeHarness } from "./test-harness.ts";

function git(cwd: string, args: string[]): void {
	execFileSync("git", args, { cwd, stdio: "ignore" });
}

function commitCleanGit(cwd: string): void {
	git(cwd, ["init"]);
	git(cwd, ["config", "user.email", "stardock-test@example.invalid"]);
	git(cwd, ["config", "user.name", "Stardock Test"]);
	git(cwd, ["add", "."]);
	git(cwd, ["commit", "--allow-empty", "-m", "baseline"]);
}

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

		const result = await workerRun.execute("tool-brief-worker-run", { action: "run", loopName: "Brief_Worker", role: "explorer", model: "test/worker-model" }, undefined, undefined, ctx);
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
		assert.equal(capturedRequest.params.model, "test/worker-model");
		assert.equal(capturedRequest.params.context, "fresh");
		assert.equal(capturedRequest.params.async, false);
		assert.equal(capturedRequest.params.clarify, false);
		assert.equal(capturedRequest.params.outputMode, "file-only");
		assert.match(capturedRequest.params.output, /^\.stardock\/runs\/Brief_Worker\/workers\//);
		assert.match(capturedRequest.params.task, /Adapter role: explorer/);
		assert.match(capturedRequest.params.task, /Stardock advisory worker payload/);
		assert.match(capturedRequest.params.task, /c-brief-worker \[pending\]/);
		assert.equal(result.details.workerRun.model, "test/worker-model");

		const listed = await workerReport.execute("tool-brief-worker-list", { action: "list", loopName: "Brief_Worker" }, undefined, undefined, ctx);
		assert.match(listed.content[0].text, /Reports: 1 total/);
		assert.match(listed.content[0].text, /wr1 \[submitted\/explorer\]/);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("stardock_worker runs brief and request scoped Stardock roles", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-worker-tool-test-"));
	try {
		const { tools, events, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const ledger = tools.get("stardock_ledger");
		const brief = tools.get("stardock_brief");
		const worker = tools.get("stardock_worker");
		const govern = tools.get("stardock_govern");
		const outside = tools.get("stardock_outside_requests");
		assert.ok(start);
		assert.ok(ledger);
		assert.ok(brief);
		assert.ok(worker);
		assert.ok(govern);
		assert.ok(outside);

		await start.execute("tool-worker-tool-start", { name: "Worker Tool", mode: "recursive", taskContent: "# Worker tool task\n", objective: "Exercise Stardock worker routing.", baseline: "No workers run yet.", validationCommand: "npm test --prefix agent/extensions -- private/stardock/brief-worker-runs.test.ts", maxIterations: 3 }, undefined, undefined, ctx);
		await ledger.execute("tool-worker-tool-criterion", { action: "upsertCriterion", loopName: "Worker_Tool", id: "c-worker-tool", description: "Stardock worker role runs.", passCondition: "WorkerRun records the role output.", status: "pending" }, undefined, undefined, ctx);
		await brief.execute("tool-worker-tool-brief", { action: "upsert", loopName: "Worker_Tool", id: "b-worker-tool", objective: "Map files.", task: "Find likely files and validation commands.", criterionIds: ["c-worker-tool"], activate: true }, undefined, undefined, ctx);

		const responses = [
			"Explorer WorkerReport: likelyFiles=brief-worker-runs.ts; validationPlan=focused tests.",
			"Governor Decision: verdict=continue; rationale=brief remains valid; requiredNextMove=run validation.",
		];
		const capturedRequests: any[] = [];
		events.on("subagent:slash:request", (data) => {
			capturedRequests.push(data);
			const request = data as { requestId: string; params: Record<string, unknown> };
			const output = responses.shift() ?? "ok";
			events.emit("subagent:slash:started", { requestId: request.requestId });
			events.emit("subagent:slash:response", {
				requestId: request.requestId,
				isError: false,
				result: { content: [{ type: "text", text: output }], details: { results: [{ agent: request.params.agent, exitCode: 0, finalOutput: output }] } },
			});
		});

		const explorer = await worker.execute("tool-worker-tool-explorer", { action: "run", loopName: "Worker_Tool", role: "explorer", output: false }, undefined, undefined, ctx);
		assert.match(explorer.content[0].text, /WorkerRun run1 is succeeded/);
		assert.equal(explorer.details.workerRun.scope, "brief");
		assert.equal(explorer.details.workerRun.expectedMutation, false);
		assert.equal(capturedRequests[0].params.agent, "scout");
		assert.match(capturedRequests[0].params.task, /Do not edit files/);

		const governorRequest = await govern.execute("tool-worker-tool-govern", { loopName: "Worker_Tool" }, undefined, undefined, ctx);
		const governorRequestId = governorRequest.details.request.id;
		const governed = await worker.execute("tool-worker-tool-governor", { action: "run", loopName: "Worker_Tool", requestId: governorRequestId, output: false }, undefined, undefined, ctx);
		assert.match(governed.content[0].text, /WorkerRun run2 is succeeded/);
		assert.equal(governed.details.workerRun.scope, "outside_request");
		assert.equal(governed.details.workerRun.outsideRequestId, governorRequestId);
		assert.equal(capturedRequests[1].params.agent, "oracle");
		assert.match(capturedRequests[1].params.task, /Adapter role: governor/);
		assert.match(capturedRequests[1].params.task, /Do not edit files/);

		const requests = await outside.execute("tool-worker-tool-outside", { loopName: "Worker_Tool" }, undefined, undefined, ctx);
		assert.match(requests.content[0].text, new RegExp(governorRequestId));
		assert.match(requests.content[0].text, /answered/);
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

test("stardock_brief_worker runs serial implementer workers and requires review", async () => {
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

		await start.execute("tool-brief-worker-start", { name: "Implementer Worker", mode: "checklist", taskContent: "# Implementer worker task\n", maxIterations: 3 }, undefined, undefined, ctx);
		await ledger.execute("tool-brief-worker-criterion", { action: "upsertCriterion", loopName: "Implementer_Worker", id: "c-impl", description: "Implementer edits one file.", passCondition: "Parent reviews the changed file.", status: "pending" }, undefined, undefined, ctx);
		await brief.execute("tool-brief-worker-brief", { action: "upsert", loopName: "Implementer_Worker", id: "b-impl", objective: "Implement a tiny change.", task: "Create src/implemented.ts with a marker export.", criterionIds: ["c-impl"], constraints: ["One file only."], activate: true }, undefined, undefined, ctx);
		commitCleanGit(cwd);

		const outputPath = path.join(cwd, ".stardock", "implementer-output.md");
		let capturedRequest: any;
		events.on("subagent:slash:request", (data) => {
			capturedRequest = data;
			fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
			fs.mkdirSync(path.dirname(outputPath), { recursive: true });
			fs.writeFileSync(path.join(cwd, "src", "implemented.ts"), "export const implemented = true;\n", "utf-8");
			fs.writeFileSync(outputPath, "Implemented src/implemented.ts. Validation not run in harness.", "utf-8");
			const request = data as { requestId: string };
			events.emit("subagent:slash:started", { requestId: request.requestId });
			events.emit("subagent:slash:response", {
				requestId: request.requestId,
				isError: false,
				result: {
					content: [{ type: "text", text: `Output saved to: ${outputPath}` }],
					details: { results: [{ agent: "implementer", exitCode: 0, finalOutput: `Output saved to: ${outputPath}`, savedOutputPath: outputPath }] },
				},
			});
		});

		const result = await workerRun.execute("tool-brief-worker-run", { action: "run", loopName: "Implementer_Worker", role: "implementer" }, undefined, undefined, ctx);
		assert.match(result.content[0].text, /WorkerRun run1 is needs_review/);
		assert.match(result.content[0].text, /src\/implemented\.ts/);
		assert.equal(result.details.workerRun.status, "needs_review");
		assert.equal(result.details.workerRun.role, "implementer");
		assert.deepEqual(result.details.workerRun.changedFiles.map((file: any) => file.path), ["src/implemented.ts"]);
		assert.equal(result.details.report.status, "needs_review");
		assert.equal(result.details.report.role, "implementer");
		assert.deepEqual(result.details.report.changedFiles.map((file: any) => file.path), ["src/implemented.ts"]);
		assert.equal(capturedRequest.params.agent, "implementer");
		assert.match(capturedRequest.params.task, /Adapter role: implementer/);
		assert.match(capturedRequest.params.task, /no isolation/);

		const blocked = await workerRun.execute("tool-brief-worker-blocked", { action: "run", loopName: "Implementer_Worker", role: "implementer", allowDirtyWorkspace: true }, undefined, undefined, ctx);
		assert.equal(blocked.isError, true);
		assert.match(blocked.content[0].text, /Cannot start implementer worker: WorkerRun run1 is needs_review/);

		const reviewed = await workerRun.execute("tool-brief-worker-review", { action: "review", loopName: "Implementer_Worker", runId: "run1", reviewStatus: "accepted", reviewRationale: "Parent inspected src/implemented.ts." }, undefined, undefined, ctx);
		assert.match(reviewed.content[0].text, /WorkerRun run1 marked accepted/);
		assert.equal(reviewed.details.run.status, "accepted");

		const reports = await workerReport.execute("tool-brief-worker-reports", { action: "list", loopName: "Implementer_Worker" }, undefined, undefined, ctx);
		assert.match(reports.content[0].text, /wr1 \[accepted\/implementer\]/);

		const dirtyGuard = await workerRun.execute("tool-brief-worker-dirty", { action: "run", loopName: "Implementer_Worker", role: "implementer" }, undefined, undefined, ctx);
		assert.equal(dirtyGuard.isError, true);
		assert.match(dirtyGuard.content[0].text, /Workspace has uncommitted changes/);
		assert.doesNotMatch(dirtyGuard.content[0].text, /Cannot start implementer worker/);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
