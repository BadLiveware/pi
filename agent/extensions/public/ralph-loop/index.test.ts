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
				name: "Recursive Loop",
				mode: "recursive",
				taskContent: "# Task\n",
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(toolResult.content[0].text, /planned but not implemented/);
		assert.equal(messages.length, 0);
		assert.equal(fs.existsSync(path.join(cwd, ".ralph", "Recursive_Loop.state.json")), false);

		const ralph = commands.get("ralph");
		assert.ok(ralph);
		await ralph.handler("start cmd-recursive --mode recursive", ctx);
		assert.ok(notifications.some((message) => message.includes('Ralph mode "recursive" is planned but not implemented yet.')));
		assert.equal(fs.existsSync(path.join(cwd, ".ralph", "cmd-recursive.state.json")), false);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
