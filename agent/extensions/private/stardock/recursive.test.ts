import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { makeHarness, runDir, statePath, taskPath } from "./test-harness.ts";

test("recursive mode start persists setup and queues bounded attempt prompt", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { tools, messages, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		assert.ok(start);

		await start.execute(
			"tool-recursive",
			{
				name: "Search Loop",
				mode: "recursive",
				taskContent: "# Improve search\n",
				objective: "Reduce query latency without hurting recall",
				baseline: "p95 120ms",
				validationCommand: "npm run bench:search",
				resetPolicy: "keep_best_only",
				stopWhen: ["target_reached", "max_iterations", "user_decision"],
				maxIterations: 4,
				maxFailedAttempts: 2,
				outsideHelpEvery: 2,
				outsideHelpOnStagnation: true,
			},
			undefined,
			undefined,
			ctx,
		);

		assert.equal(messages.length, 1);
		assert.match(messages[0].content, /STARDOCK RECURSIVE LOOP: Search_Loop \| Attempt 1\/4/);
		assert.match(messages[0].content, /Reduce query latency without hurting recall/);
		assert.match(messages[0].content, /npm run bench:search/);
		assert.match(messages[0].content, /one bounded implementer attempt/);
		const state = JSON.parse(fs.readFileSync(statePath(cwd, "Search_Loop"), "utf-8"));
		assert.equal(state.mode, "recursive");
		assert.equal(state.modeState.kind, "recursive");
		assert.equal(state.modeState.objective, "Reduce query latency without hurting recall");
		assert.equal(state.modeState.baseline, "p95 120ms");
		assert.equal(state.modeState.validationCommand, "npm run bench:search");
		assert.equal(state.modeState.resetPolicy, "keep_best_only");
		assert.deepEqual(state.modeState.stopWhen, ["target_reached", "max_iterations", "user_decision"]);
		assert.equal(state.modeState.maxFailedAttempts, 2);
		assert.equal(state.modeState.outsideHelpEvery, 2);
		assert.equal(state.modeState.outsideHelpOnStagnation, true);
		assert.deepEqual(state.modeState.attempts, []);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
test("stardock_done records recursive attempt placeholder before next prompt", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { tools, messages, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const done = tools.get("stardock_done");
		assert.ok(start);
		assert.ok(done);

		await start.execute(
			"tool-recursive",
			{
				name: "Attempt Loop",
				mode: "recursive",
				taskContent: "# Attempt task\n",
				objective: "Find a passing fix",
				validationCommand: "npm test",
				maxIterations: 3,
			},
			undefined,
			undefined,
			ctx,
		);
		await done.execute("tool-done", {}, undefined, undefined, ctx);

		assert.equal(messages.length, 2);
		assert.match(messages[1].content, /Attempt 2\/3/);
		const state = JSON.parse(fs.readFileSync(statePath(cwd, "Attempt_Loop"), "utf-8"));
		assert.equal(state.iteration, 2);
		assert.equal(state.modeState.attempts.length, 1);
		assert.equal(state.modeState.attempts[0].id, "attempt-1");
		assert.equal(state.modeState.attempts[0].iteration, 1);
		assert.equal(state.modeState.attempts[0].status, "pending_report");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
test("recursive outside requests can be listed, answered, and included as governor steer", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { tools, messages, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const done = tools.get("stardock_done");
		const listOutside = tools.get("stardock_outside_requests");
		const payloadOutside = tools.get("stardock_outside_payload");
		const answerOutside = tools.get("stardock_outside_answer");
		assert.ok(start);
		assert.ok(done);
		assert.ok(listOutside);
		assert.ok(payloadOutside);
		assert.ok(answerOutside);

		await start.execute(
			"tool-recursive",
			{
				name: "Governor Loop",
				mode: "recursive",
				taskContent: "# Governed task\n",
				objective: "Find a better route",
				maxIterations: 4,
				outsideHelpEvery: 1,
			},
			undefined,
			undefined,
			ctx,
		);
		await done.execute("tool-done-1", {}, undefined, undefined, ctx);

		assert.match(messages[1].content, /Pending Outside Requests/);
		assert.match(messages[1].content, /governor-1/);
		let state = JSON.parse(fs.readFileSync(statePath(cwd, "Governor_Loop"), "utf-8"));
		assert.equal(state.outsideRequests.length, 1);
		assert.equal(state.outsideRequests[0].kind, "governor_review");
		assert.equal(state.outsideRequests[0].status, "requested");

		const listResult = await listOutside.execute("tool-list", { loopName: "Governor_Loop" }, undefined, undefined, ctx);
		assert.match(listResult.content[0].text, /governor-1/);
		assert.match(listResult.content[0].text, /stardock_outside_payload/);

		const payloadResult = await payloadOutside.execute(
			"tool-payload",
			{ loopName: "Governor_Loop", requestId: "governor-1" },
			undefined,
			undefined,
			ctx,
		);
		assert.match(payloadResult.content[0].text, /Governor task/);
		assert.match(payloadResult.content[0].text, /verdict: continue \| pivot \| stop \| measure \| exploit_scaffold \| ask_user/);
		assert.match(payloadResult.content[0].text, /Recent structured attempts/);

		await answerOutside.execute(
			"tool-answer",
			{
				loopName: "Governor_Loop",
				requestId: "governor-1",
				answer: "Measure before changing more code.",
				verdict: "measure",
				rationale: "No evidence yet.",
				requiredNextMove: "Run the benchmark before another implementation attempt.",
				forbiddenNextMoves: ["large refactor"],
				evidenceGaps: ["benchmark output"],
			},
			undefined,
			undefined,
			ctx,
		);
		await done.execute("tool-done-2", {}, undefined, undefined, ctx);

		assert.match(messages[2].content, /Latest Governor Steer/);
		assert.match(messages[2].content, /Run the benchmark before another implementation attempt/);
		state = JSON.parse(fs.readFileSync(statePath(cwd, "Governor_Loop"), "utf-8"));
		assert.equal(state.outsideRequests[0].status, "answered");
		assert.equal(state.outsideRequests[0].decision.verdict, "measure");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
test("stardock_attempt_report records structured recursive attempt data", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { tools, messages, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const done = tools.get("stardock_done");
		const report = tools.get("stardock_attempt_report");
		assert.ok(start);
		assert.ok(done);
		assert.ok(report);

		await start.execute(
			"tool-recursive",
			{
				name: "Report Loop",
				mode: "recursive",
				taskContent: "# Report task\n",
				objective: "Find a better result",
				maxIterations: 3,
			},
			undefined,
			undefined,
			ctx,
		);
		await done.execute("tool-done", {}, undefined, undefined, ctx);
		await report.execute(
			"tool-report",
			{
				loopName: "Report_Loop",
				iteration: 1,
				kind: "candidate_change",
				hypothesis: "Changing the prompt improves behavior.",
				actionSummary: "Added structured attempt reporting.",
				validation: "Focused tests passed.",
				result: "improved",
				kept: true,
				evidence: "index.test.ts",
				followupIdeas: ["Use attempt kinds for drift detection"],
			},
			undefined,
			undefined,
			ctx,
		);
		await done.execute("tool-done-2", {}, undefined, undefined, ctx);

		assert.match(messages[2].content, /Recent Attempt Reports/);
		assert.match(messages[2].content, /candidate_change · improved/);
		const state = JSON.parse(fs.readFileSync(statePath(cwd, "Report_Loop"), "utf-8"));
		assert.equal(state.modeState.attempts[0].status, "reported");
		assert.equal(state.modeState.attempts[0].kind, "candidate_change");
		assert.equal(state.modeState.attempts[0].result, "improved");
		assert.equal(state.modeState.attempts[0].kept, true);
		assert.deepEqual(state.modeState.attempts[0].followupIdeas, ["Use attempt kinds for drift detection"]);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
test("governor cadence does not duplicate a same-iteration manual governor request", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { tools, messages, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const done = tools.get("stardock_done");
		const govern = tools.get("stardock_govern");
		const answerOutside = tools.get("stardock_outside_answer");
		assert.ok(start);
		assert.ok(done);
		assert.ok(govern);
		assert.ok(answerOutside);

		await start.execute(
			"tool-dedupe-start",
			{
				name: "Dedupe Loop",
				mode: "recursive",
				taskContent: "# Dedupe task\n",
				objective: "Avoid duplicate governor requests",
				maxIterations: 3,
				governEvery: 1,
			},
			undefined,
			undefined,
			ctx,
		);

		const governResult = await govern.execute("tool-govern", { loopName: "Dedupe_Loop" }, undefined, undefined, ctx);
		assert.equal(governResult.details.request.id, "governor-manual-1");
		await answerOutside.execute(
			"tool-answer",
			{
				loopName: "Dedupe_Loop",
				requestId: "governor-manual-1",
				answer: "Continue once to confirm state propagation.",
				verdict: "continue",
				rationale: "Manual governor review covers this iteration.",
				requiredNextMove: "Confirm there is no duplicate cadence request.",
			},
			undefined,
			undefined,
			ctx,
		);
		await done.execute("tool-done", {}, undefined, undefined, ctx);

		const state = JSON.parse(fs.readFileSync(statePath(cwd, "Dedupe_Loop"), "utf-8"));
		assert.equal(state.outsideRequests.length, 1);
		assert.equal(state.outsideRequests[0].id, "governor-manual-1");
		assert.doesNotMatch(messages[1].content, /Pending Outside Requests/);
		assert.match(messages[1].content, /Latest Governor Steer/);
		assert.match(messages[1].content, /Confirm there is no duplicate cadence request/);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
test("recursive triggers create governor and stagnation requests from structured attempts", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { tools, messages, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const done = tools.get("stardock_done");
		const report = tools.get("stardock_attempt_report");
		assert.ok(start);
		assert.ok(done);
		assert.ok(report);

		await start.execute(
			"tool-recursive",
			{
				name: "Trigger Loop",
				mode: "recursive",
				taskContent: "# Trigger task\n",
				objective: "Escape stagnation",
				maxIterations: 5,
				governEvery: 2,
				outsideHelpOnStagnation: true,
			},
			undefined,
			undefined,
			ctx,
		);
		await report.execute(
			"tool-report-1",
			{
				loopName: "Trigger_Loop",
				iteration: 1,
				kind: "setup",
				hypothesis: "Setup may reveal the issue.",
				actionSummary: "Added more scaffolding.",
				validation: "No improvement measured.",
				result: "neutral",
				kept: true,
			},
			undefined,
			undefined,
			ctx,
		);
		await done.execute("tool-done-1", {}, undefined, undefined, ctx);
		await report.execute(
			"tool-report-2",
			{
				loopName: "Trigger_Loop",
				iteration: 2,
				kind: "instrumentation",
				hypothesis: "More instrumentation may help.",
				actionSummary: "Added another measurement hook.",
				validation: "Still no improvement.",
				result: "blocked",
				kept: true,
			},
			undefined,
			undefined,
			ctx,
		);
		await done.execute("tool-done-2", {}, undefined, undefined, ctx);

		assert.match(messages[2].content, /governor-2/);
		assert.match(messages[2].content, /research-stagnation-2/);
		const state = JSON.parse(fs.readFileSync(statePath(cwd, "Trigger_Loop"), "utf-8"));
		assert.ok(state.outsideRequests.some((request: any) => request.id === "governor-2" && request.kind === "governor_review"));
		assert.ok(state.outsideRequests.some((request: any) => request.id === "research-stagnation-2" && request.kind === "failure_analysis"));
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
test("stardock_govern creates a manual governor request payload", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { tools, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const govern = tools.get("stardock_govern");
		assert.ok(start);
		assert.ok(govern);

		await start.execute(
			"tool-recursive",
			{
				name: "Govern Loop",
				mode: "recursive",
				taskContent: "# Govern task\n",
				objective: "Choose next move",
				maxIterations: 3,
			},
			undefined,
			undefined,
			ctx,
		);
		const result = await govern.execute("tool-govern", { loopName: "Govern_Loop" }, undefined, undefined, ctx);

		assert.match(result.content[0].text, /Governor task/);
		assert.match(result.content[0].text, /Trigger: manual/);
		assert.equal(result.details.request.id, "governor-manual-1");
		const state = JSON.parse(fs.readFileSync(statePath(cwd, "Govern_Loop"), "utf-8"));
		assert.equal(state.outsideRequests[0].id, "governor-manual-1");
		assert.equal(state.outsideRequests[0].trigger, "manual");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
