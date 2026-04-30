import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import ralphLoop from "./index.ts";

function makeHarness(cwd: string) {
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const handlers = new Map<string, any[]>();
	const messages: Array<{ content: string; options?: unknown }> = [];
	const entries: Array<{ customType: string; data?: unknown }> = [];
	const notifications: string[] = [];
	const statuses = new Map<string, string | undefined>();
	const widgets = new Map<string, string[] | undefined>();

	const pi = {
		registerTool(tool: any) {
			tools.set(tool.name, tool);
		},
		registerCommand(name: string, options: any) {
			commands.set(name, options);
		},
		on(event: string, handler: any) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
		sendUserMessage(content: string, options?: unknown) {
			messages.push({ content, options });
		},
		appendEntry(customType: string, data?: unknown) {
			entries.push({ customType, data });
		},
	} as any;

	const ctx = {
		cwd,
		hasUI: true,
		hasPendingMessages: () => false,
		isIdle: () => true,
		ui: {
			notify(message: string) {
				notifications.push(message);
			},
			setStatus(key: string, value: string | undefined) {
				statuses.set(key, value);
			},
			setWidget(key: string, value: string[] | undefined) {
				widgets.set(key, value);
			},
			confirm: async () => false,
			theme: {
				fg: (_style: string, text: string) => text,
				bold: (text: string) => text,
			},
		},
		sessionManager: {
			getBranch: () => [],
		},
	} as any;

	ralphLoop(pi);
	return { tools, commands, handlers, messages, entries, notifications, statuses, widgets, ctx };
}

test("ralph_loop registers current-compatible tools and commands", () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ralph-loop-test-"));
	try {
		const { tools, commands, handlers } = makeHarness(cwd);
		assert.ok(tools.has("ralph_start"));
		assert.ok(tools.has("ralph_done"));
		assert.ok(tools.has("ralph_attempt_report"));
		assert.ok(tools.has("ralph_outside_requests"));
		assert.ok(tools.has("ralph_outside_answer"));
		assert.ok(commands.has("ralph"));
		assert.ok(commands.has("ralph-stop"));
		assert.ok((handlers.get("before_agent_start") ?? []).length > 0);
		assert.ok((handlers.get("agent_end") ?? []).length > 0);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("ralph_start writes task state and ralph_done queues next iteration", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ralph-loop-test-"));
	try {
		const { tools, messages, ctx } = makeHarness(cwd);
		const start = tools.get("ralph_start");
		const done = tools.get("ralph_done");
		assert.ok(start);
		assert.ok(done);

		const startResult = await start.execute(
			"tool-1",
			{
				name: "Demo Loop",
				mode: "checklist",
				taskContent: "# Task\n\n## Checklist\n- [ ] First item\n",
				maxIterations: 3,
				itemsPerIteration: 1,
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(startResult.content[0].text, /Started loop "Demo_Loop"/);
		assert.equal(messages.length, 1);
		assert.match(messages[0].content, /RALPH LOOP: Demo_Loop \| Iteration 1\/3/);
		assert.deepEqual(messages[0].options, { deliverAs: "followUp" });

		const statePath = path.join(cwd, ".ralph", "Demo_Loop.state.json");
		const taskPath = path.join(cwd, ".ralph", "Demo_Loop.md");
		assert.equal(fs.readFileSync(taskPath, "utf-8"), "# Task\n\n## Checklist\n- [ ] First item\n");
		const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
		assert.equal(state.status, "active");
		assert.equal(state.mode, "checklist");
		assert.deepEqual(state.modeState, { kind: "checklist" });
		assert.equal(state.iteration, 1);
		assert.equal(state.itemsPerIteration, 1);

		const doneResult = await done.execute("tool-2", {}, undefined, undefined, ctx);
		assert.match(doneResult.content[0].text, /Iteration 1 complete/);
		assert.equal(messages.length, 2);
		assert.match(messages[1].content, /RALPH LOOP: Demo_Loop \| Iteration 2\/3/);
		const nextState = JSON.parse(fs.readFileSync(statePath, "utf-8"));
		assert.equal(nextState.iteration, 2);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("completion marker completes loop without queuing a user message", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ralph-loop-test-"));
	try {
		const { tools, handlers, messages, entries, notifications, ctx } = makeHarness(cwd);
		const start = tools.get("ralph_start");
		assert.ok(start);

		await start.execute(
			"tool-1",
			{
				name: "Complete Loop",
				taskContent: "# Task\n\n## Checklist\n- [x] Done\n",
				maxIterations: 3,
			},
			undefined,
			undefined,
			ctx,
		);
		assert.equal(messages.length, 1);

		const agentEnd = handlers.get("agent_end")?.[0];
		assert.ok(agentEnd);
		await agentEnd(
			{
				messages: [
					{
						role: "assistant",
						content: [{ type: "text", text: "<promise>COMPLETE</promise>" }],
					},
				],
			},
			ctx,
		);

		assert.equal(messages.length, 1, "completion should not send a user message while agent_end is running");
		assert.equal(entries.at(-1)?.customType, "ralph-loop");
		assert.match(String((entries.at(-1)?.data as any).banner), /RALPH LOOP COMPLETE: Complete_Loop/);
		assert.ok(notifications.some((message) => message.includes("RALPH LOOP COMPLETE: Complete_Loop")));

		const state = JSON.parse(fs.readFileSync(path.join(cwd, ".ralph", "Complete_Loop.state.json"), "utf-8"));
		assert.equal(state.status, "completed");
		assert.equal(state.active, false);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("v1 state without mode migrates to checklist mode on resume", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ralph-loop-test-"));
	try {
		const { commands, messages, ctx } = makeHarness(cwd);
		const loopDir = path.join(cwd, ".ralph");
		fs.mkdirSync(loopDir, { recursive: true });
		fs.writeFileSync(path.join(loopDir, "legacy.md"), "# Legacy task\n", "utf-8");
		fs.writeFileSync(
			path.join(loopDir, "legacy.state.json"),
			JSON.stringify(
				{
					name: "legacy",
					taskFile: ".ralph/legacy.md",
					iteration: 1,
					maxIterations: 5,
					itemsPerIteration: 2,
					reflectEveryItems: 3,
					reflectInstructions: "Reflect",
					active: false,
					startedAt: "2026-01-01T00:00:00.000Z",
					lastReflectionAtItems: 0,
				},
				null,
				2,
			),
			"utf-8",
		);

		const ralph = commands.get("ralph");
		assert.ok(ralph);
		await ralph.handler("resume legacy", ctx);

		assert.equal(messages.length, 1);
		assert.match(messages[0].content, /RALPH LOOP: legacy \| Iteration 2\/5/);
		const migrated = JSON.parse(fs.readFileSync(path.join(loopDir, "legacy.state.json"), "utf-8"));
		assert.equal(migrated.schemaVersion, 2);
		assert.equal(migrated.mode, "checklist");
		assert.deepEqual(migrated.modeState, { kind: "checklist" });
		assert.equal(migrated.reflectEvery, 3);
		assert.equal(migrated.iteration, 2);
		assert.equal(migrated.status, "active");
		assert.equal(migrated.active, true);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("unsupported mode does not create a loop", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ralph-loop-test-"));
	try {
		const { tools, commands, messages, notifications, ctx } = makeHarness(cwd);
		const start = tools.get("ralph_start");
		assert.ok(start);

		const toolResult = await start.execute(
			"tool-unsupported",
			{
				name: "Evolve Loop",
				mode: "evolve",
				taskContent: "# Task\n",
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(toolResult.content[0].text, /planned but not implemented/);
		assert.equal(messages.length, 0);
		assert.equal(fs.existsSync(path.join(cwd, ".ralph", "Evolve_Loop.state.json")), false);

		const ralph = commands.get("ralph");
		assert.ok(ralph);
		await ralph.handler("start cmd-evolve --mode evolve", ctx);
		assert.ok(notifications.some((message) => message.includes('Ralph mode "evolve" is planned but not implemented yet.')));
		assert.equal(fs.existsSync(path.join(cwd, ".ralph", "cmd-evolve.state.json")), false);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("recursive mode start persists setup and queues bounded attempt prompt", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ralph-loop-test-"));
	try {
		const { tools, messages, ctx } = makeHarness(cwd);
		const start = tools.get("ralph_start");
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
		assert.match(messages[0].content, /RALPH RECURSIVE LOOP: Search_Loop \| Attempt 1\/4/);
		assert.match(messages[0].content, /Reduce query latency without hurting recall/);
		assert.match(messages[0].content, /npm run bench:search/);
		assert.match(messages[0].content, /one bounded implementer attempt/);
		const state = JSON.parse(fs.readFileSync(path.join(cwd, ".ralph", "Search_Loop.state.json"), "utf-8"));
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

test("ralph_done records recursive attempt placeholder before next prompt", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ralph-loop-test-"));
	try {
		const { tools, messages, ctx } = makeHarness(cwd);
		const start = tools.get("ralph_start");
		const done = tools.get("ralph_done");
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
		const state = JSON.parse(fs.readFileSync(path.join(cwd, ".ralph", "Attempt_Loop.state.json"), "utf-8"));
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
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ralph-loop-test-"));
	try {
		const { tools, messages, ctx } = makeHarness(cwd);
		const start = tools.get("ralph_start");
		const done = tools.get("ralph_done");
		const listOutside = tools.get("ralph_outside_requests");
		const answerOutside = tools.get("ralph_outside_answer");
		assert.ok(start);
		assert.ok(done);
		assert.ok(listOutside);
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
		let state = JSON.parse(fs.readFileSync(path.join(cwd, ".ralph", "Governor_Loop.state.json"), "utf-8"));
		assert.equal(state.outsideRequests.length, 1);
		assert.equal(state.outsideRequests[0].kind, "governor_review");
		assert.equal(state.outsideRequests[0].status, "requested");

		const listResult = await listOutside.execute("tool-list", { loopName: "Governor_Loop" }, undefined, undefined, ctx);
		assert.match(listResult.content[0].text, /governor-1/);

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
		state = JSON.parse(fs.readFileSync(path.join(cwd, ".ralph", "Governor_Loop.state.json"), "utf-8"));
		assert.equal(state.outsideRequests[0].status, "answered");
		assert.equal(state.outsideRequests[0].decision.verdict, "measure");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("ralph_attempt_report records structured recursive attempt data", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ralph-loop-test-"));
	try {
		const { tools, messages, ctx } = makeHarness(cwd);
		const start = tools.get("ralph_start");
		const done = tools.get("ralph_done");
		const report = tools.get("ralph_attempt_report");
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
		const state = JSON.parse(fs.readFileSync(path.join(cwd, ".ralph", "Report_Loop.state.json"), "utf-8"));
		assert.equal(state.modeState.attempts[0].status, "reported");
		assert.equal(state.modeState.attempts[0].kind, "candidate_change");
		assert.equal(state.modeState.attempts[0].result, "improved");
		assert.equal(state.modeState.attempts[0].kept, true);
		assert.deepEqual(state.modeState.attempts[0].followupIdeas, ["Use attempt kinds for drift detection"]);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
