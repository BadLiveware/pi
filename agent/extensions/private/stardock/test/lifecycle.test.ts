import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { makeHarness,runDir,statePath,taskPath } from "./test-harness.ts";

test("stardock_start writes task state and stardock_done queues next iteration", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { tools, messages, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const done = tools.get("stardock_done");
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
		assert.match(messages[0].content, /STARDOCK LOOP: Demo_Loop \| Iteration 1\/3/);
		assert.deepEqual(messages[0].options, { deliverAs: "followUp" });

		const demoStatePath = statePath(cwd, "Demo_Loop");
		const demoTaskPath = taskPath(cwd, "Demo_Loop");
		assert.equal(fs.readFileSync(demoTaskPath, "utf-8"), "# Task\n\n## Checklist\n- [ ] First item\n");
		const state = JSON.parse(fs.readFileSync(demoStatePath, "utf-8"));
		assert.equal(state.schemaVersion, 3);
		assert.equal(state.status, "active");
		assert.equal(state.taskFile, path.join(".stardock", "runs", "Demo_Loop", "task.md"));
		assert.equal(state.mode, "checklist");
		assert.deepEqual(state.modeState, { kind: "checklist" });
		assert.deepEqual(state.criterionLedger, { criteria: [], requirementTrace: [] });
		assert.deepEqual(state.verificationArtifacts, []);
		assert.deepEqual(state.briefs, []);
		assert.equal(state.currentBriefId, undefined);
		assert.deepEqual(state.finalVerificationReports, []);
		assert.equal(state.iteration, 1);
		assert.equal(state.itemsPerIteration, 1);

		const doneResult = await done.execute("tool-2", {}, undefined, undefined, ctx);
		assert.match(doneResult.content[0].text, /Iteration 1 complete/);
		assert.equal(messages.length, 2);
		assert.match(messages[1].content, /STARDOCK LOOP: Demo_Loop \| Iteration 2\/3/);
		const nextState = JSON.parse(fs.readFileSync(demoStatePath, "utf-8"));
		assert.equal(nextState.iteration, 2);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
test("stardock_done supports explicit active brief lifecycle actions", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { tools, messages, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const ledger = tools.get("stardock_ledger");
		const brief = tools.get("stardock_brief");
		const done = tools.get("stardock_done");
		assert.ok(start);
		assert.ok(ledger);
		assert.ok(brief);
		assert.ok(done);

		await start.execute(
			"tool-lifecycle-start",
			{
				name: "Lifecycle Loop",
				mode: "checklist",
				taskContent: "# Lifecycle task\n\n## Checklist\n- [ ] Default task text returns after brief completion\n",
				maxIterations: 5,
			},
			undefined,
			undefined,
			ctx,
		);
		await ledger.execute(
			"tool-lifecycle-criterion",
			{
				action: "upsertCriterion",
				loopName: "Lifecycle_Loop",
				id: "c-lifecycle",
				description: "Active brief can be completed after an iteration.",
				passCondition: "stardock_done completes and clears the current brief when requested.",
			},
			undefined,
			undefined,
			ctx,
		);
		await brief.execute(
			"tool-lifecycle-brief",
			{
				action: "upsert",
				loopName: "Lifecycle_Loop",
				id: "b-lifecycle",
				objective: "Avoid stale active briefs.",
				task: "Complete this brief when the bounded iteration is done.",
				criterionIds: ["c-lifecycle"],
				activate: true,
			},
			undefined,
			undefined,
			ctx,
		);

		const completed = await done.execute("tool-lifecycle-done-complete", { briefLifecycle: "complete", includeState: true }, undefined, undefined, ctx);
		assert.match(completed.content[0].text, /Completed brief b-lifecycle/);
		assert.equal(completed.details.brief.status, "completed");
		assert.equal(completed.details.loop.briefs.currentBriefId, undefined);
		assert.equal(messages.at(-1)?.content.includes("## Active Iteration Brief"), false);
		assert.match(messages.at(-1)?.content ?? "", /No active brief/);

		await brief.execute(
			"tool-lifecycle-brief-clear",
			{
				action: "upsert",
				loopName: "Lifecycle_Loop",
				id: "b-lifecycle-clear",
				objective: "Clear stale active briefs.",
				task: "Clear this brief without marking it complete.",
				criterionIds: ["c-lifecycle"],
				activate: true,
			},
			undefined,
			undefined,
			ctx,
		);
		const cleared = await done.execute("tool-lifecycle-done-clear", { briefLifecycle: "clear", includeState: true }, undefined, undefined, ctx);
		assert.match(cleared.content[0].text, /Cleared brief b-lifecycle-clear/);
		assert.equal(cleared.details.brief.status, "draft");
		assert.equal(cleared.details.loop.briefs.currentBriefId, undefined);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
test("completion marker completes active brief and clears current brief", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { tools, handlers, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const brief = tools.get("stardock_brief");
		assert.ok(start);
		assert.ok(brief);

		await start.execute(
			"tool-complete-brief-start",
			{
				name: "Complete Brief Loop",
				taskContent: "# Task\n\n## Checklist\n- [x] Done\n",
				maxIterations: 3,
			},
			undefined,
			undefined,
			ctx,
		);
		await brief.execute(
			"tool-complete-brief-upsert",
			{
				action: "upsert",
				loopName: "Complete_Brief_Loop",
				id: "b-complete",
				objective: "Finish the active brief with the loop.",
				task: "Complete this brief when the loop completes normally.",
				activate: true,
			},
			undefined,
			undefined,
			ctx,
		);

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

		const state = JSON.parse(fs.readFileSync(statePath(cwd, "Complete_Brief_Loop"), "utf-8"));
		assert.equal(state.status, "completed");
		assert.equal(state.currentBriefId, undefined);
		assert.equal(state.briefs[0].status, "completed");
		assert.ok(state.briefs[0].completedAt);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("max iteration stop clears active brief back to draft", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { tools, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const brief = tools.get("stardock_brief");
		const done = tools.get("stardock_done");
		assert.ok(start);
		assert.ok(brief);
		assert.ok(done);

		await start.execute(
			"tool-max-brief-start",
			{
				name: "Max Brief Loop",
				taskContent: "# Task\n",
				maxIterations: 1,
			},
			undefined,
			undefined,
			ctx,
		);
		await brief.execute(
			"tool-max-brief-upsert",
			{
				action: "upsert",
				loopName: "Max_Brief_Loop",
				id: "b-max",
				objective: "Do not leave active brief after max iteration stop.",
				task: "Clear this brief if the loop stops at max iterations.",
				activate: true,
			},
			undefined,
			undefined,
			ctx,
		);
		await done.execute("tool-max-done", {}, undefined, undefined, ctx);

		const state = JSON.parse(fs.readFileSync(statePath(cwd, "Max_Brief_Loop"), "utf-8"));
		assert.equal(state.status, "completed");
		assert.equal(state.currentBriefId, undefined);
		assert.equal(state.briefs[0].status, "draft");
		assert.equal(state.briefs[0].completedAt, undefined);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("task read failure pause clears active brief back to draft", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { tools, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const brief = tools.get("stardock_brief");
		const done = tools.get("stardock_done");
		assert.ok(start);
		assert.ok(brief);
		assert.ok(done);

		await start.execute(
			"tool-pause-brief-start",
			{
				name: "Pause Brief Loop",
				taskContent: "# Task\n",
				maxIterations: 3,
			},
			undefined,
			undefined,
			ctx,
		);
		await brief.execute(
			"tool-pause-brief-upsert",
			{
				action: "upsert",
				loopName: "Pause_Brief_Loop",
				id: "b-pause",
				objective: "Do not leave active brief after pause.",
				task: "Clear this brief if the task file cannot be read.",
				activate: true,
			},
			undefined,
			undefined,
			ctx,
		);
		fs.rmSync(taskPath(cwd, "Pause_Brief_Loop"));
		await done.execute("tool-pause-done", {}, undefined, undefined, ctx);

		const state = JSON.parse(fs.readFileSync(statePath(cwd, "Pause_Brief_Loop"), "utf-8"));
		assert.equal(state.status, "paused");
		assert.equal(state.currentBriefId, undefined);
		assert.equal(state.briefs[0].status, "draft");
		assert.equal(state.briefs[0].completedAt, undefined);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("manual stop clears active brief back to draft", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { tools, commands, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const brief = tools.get("stardock_brief");
		const stop = commands.get("stardock-stop");
		assert.ok(start);
		assert.ok(brief);
		assert.ok(stop);

		await start.execute(
			"tool-stop-brief-start",
			{
				name: "Stop Brief Loop",
				taskContent: "# Task\n",
				maxIterations: 3,
			},
			undefined,
			undefined,
			ctx,
		);
		await brief.execute(
			"tool-stop-brief-upsert",
			{
				action: "upsert",
				loopName: "Stop_Brief_Loop",
				id: "b-stop",
				objective: "Do not leave active brief after manual stop.",
				task: "Clear this brief if the loop is stopped manually.",
				activate: true,
			},
			undefined,
			undefined,
			ctx,
		);
		await stop.handler("", ctx);

		const state = JSON.parse(fs.readFileSync(statePath(cwd, "Stop_Brief_Loop"), "utf-8"));
		assert.equal(state.status, "completed");
		assert.equal(state.currentBriefId, undefined);
		assert.equal(state.briefs[0].status, "draft");
		assert.equal(state.briefs[0].completedAt, undefined);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("completion marker completes loop without queuing a user message", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { tools, handlers, messages, entries, notifications, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
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
		assert.equal(entries.at(-1)?.customType, "stardock");
		assert.match(String((entries.at(-1)?.data as any).banner), /STARDOCK LOOP COMPLETE: Complete_Loop/);
		assert.ok(notifications.some((message) => message.includes("STARDOCK LOOP COMPLETE: Complete_Loop")));

		const state = JSON.parse(fs.readFileSync(statePath(cwd, "Complete_Loop"), "utf-8"));
		assert.equal(state.status, "completed");
		assert.equal(state.active, false);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
test("archive moves managed run folders under archive", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { tools, commands, handlers, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		assert.ok(start);

		await start.execute(
			"tool-archive",
			{
				name: "Archive Loop",
				taskContent: "# Archive task\n",
				maxIterations: 3,
			},
			undefined,
			undefined,
			ctx,
		);

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

		const stardock = commands.get("stardock");
		assert.ok(stardock);
		await stardock.handler("archive Archive_Loop", ctx);

		assert.equal(fs.existsSync(runDir(cwd, "Archive_Loop")), false);
		assert.equal(fs.readFileSync(taskPath(cwd, "Archive_Loop", true), "utf-8"), "# Archive task\n");
		const archivedState = JSON.parse(fs.readFileSync(statePath(cwd, "Archive_Loop", true), "utf-8"));
		assert.equal(archivedState.status, "completed");
		assert.equal(archivedState.taskFile, path.join(".stardock", "archive", "Archive_Loop", "task.md"));
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
test("v1 state without mode migrates to checklist mode on resume", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { commands, messages, ctx } = makeHarness(cwd);
		const loopDir = path.join(cwd, ".stardock");
		fs.mkdirSync(loopDir, { recursive: true });
		fs.writeFileSync(path.join(loopDir, "legacy.md"), "# Legacy task\n", "utf-8");
		fs.writeFileSync(
			path.join(loopDir, "legacy.state.json"),
			JSON.stringify(
				{
					name: "legacy",
					taskFile: ".stardock/legacy.md",
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

		const stardock = commands.get("stardock");
		assert.ok(stardock);
		await stardock.handler("resume legacy", ctx);

		assert.equal(messages.length, 1);
		assert.match(messages[0].content, /STARDOCK LOOP: legacy \| Iteration 2\/5/);
		const migrated = JSON.parse(fs.readFileSync(statePath(cwd, "legacy"), "utf-8"));
		assert.equal(migrated.schemaVersion, 3);
		assert.equal(migrated.mode, "checklist");
		assert.deepEqual(migrated.modeState, { kind: "checklist" });
		assert.deepEqual(migrated.criterionLedger, { criteria: [], requirementTrace: [] });
		assert.deepEqual(migrated.verificationArtifacts, []);
		assert.deepEqual(migrated.briefs, []);
		assert.equal(migrated.currentBriefId, undefined);
		assert.deepEqual(migrated.finalVerificationReports, []);
		assert.equal(migrated.reflectEvery, 3);
		assert.equal(migrated.iteration, 2);
		assert.equal(migrated.status, "active");
		assert.equal(migrated.active, true);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
