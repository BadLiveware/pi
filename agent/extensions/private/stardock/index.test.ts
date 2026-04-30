import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import stardockLoop from "./index.ts";

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

	stardockLoop(pi);
	return { tools, commands, handlers, messages, entries, notifications, statuses, widgets, ctx };
}

function runDir(cwd: string, name: string, archived = false): string {
	return path.join(cwd, ".stardock", archived ? "archive" : "runs", name);
}

function statePath(cwd: string, name: string, archived = false): string {
	return path.join(runDir(cwd, name, archived), "state.json");
}

function taskPath(cwd: string, name: string, archived = false): string {
	return path.join(runDir(cwd, name, archived), "task.md");
}

test("stardock registers tools and commands", () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { tools, commands, handlers } = makeHarness(cwd);
		assert.ok(tools.has("stardock_start"));
		assert.ok(tools.has("stardock_done"));
		assert.ok(tools.has("stardock_state"));
		assert.ok(tools.has("stardock_ledger"));
		assert.ok(tools.has("stardock_brief"));
		assert.ok(tools.has("stardock_attempt_report"));
		assert.ok(tools.has("stardock_govern"));
		assert.ok(tools.has("stardock_outside_payload"));
		assert.ok(tools.has("stardock_outside_requests"));
		assert.ok(tools.has("stardock_outside_answer"));
		assert.ok(commands.has("stardock"));
		assert.ok(commands.has("stardock-stop"));
		assert.ok((handlers.get("before_agent_start") ?? []).length > 0);
		assert.ok((handlers.get("agent_end") ?? []).length > 0);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

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

test("stardock_state lists and inspects loop summaries", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { tools, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const stateTool = tools.get("stardock_state");
		assert.ok(start);
		assert.ok(stateTool);

		await start.execute(
			"tool-state-start",
			{
				name: "State Loop",
				mode: "recursive",
				taskContent: "# State task\n",
				objective: "Inspect loop state without reading files directly",
				maxIterations: 3,
			},
			undefined,
			undefined,
			ctx,
		);

		const listResult = await stateTool.execute("tool-state-list", {}, undefined, undefined, ctx);
		assert.match(listResult.content[0].text, /State_Loop: ▶ active \(iteration 1\/3\)/);
		assert.equal(listResult.details.loops[0].stateFile, path.join(".stardock", "runs", "State_Loop", "state.json"));

		const inspectResult = await stateTool.execute(
			"tool-state-inspect",
			{ loopName: "State_Loop", includeDetails: true },
			undefined,
			undefined,
			ctx,
		);
		assert.match(inspectResult.content[0].text, /Objective: Inspect loop state without reading files directly/);
		assert.equal(inspectResult.details.loop.taskFile, path.join(".stardock", "runs", "State_Loop", "task.md"));
		assert.equal(inspectResult.details.loop.recursive.objective, "Inspect loop state without reading files directly");
		assert.equal(inspectResult.details.loop.modeState.kind, "recursive");
		assert.equal(inspectResult.details.loop.criteria.total, 0);
		assert.equal(inspectResult.details.loop.verificationArtifacts.total, 0);
		assert.equal(inspectResult.details.loop.briefs.total, 0);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("stardock_ledger records criteria and compact artifact refs", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { tools, messages, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const ledger = tools.get("stardock_ledger");
		const stateTool = tools.get("stardock_state");
		const done = tools.get("stardock_done");
		assert.ok(start);
		assert.ok(ledger);
		assert.ok(stateTool);
		assert.ok(done);

		await start.execute(
			"tool-ledger-start",
			{
				name: "Ledger Loop",
				mode: "checklist",
				taskContent: "# Ledger task\n",
				maxIterations: 3,
			},
			undefined,
			undefined,
			ctx,
		);

		const createCriterion = await ledger.execute(
			"tool-ledger-criterion-create",
			{
				action: "upsertCriterion",
				loopName: "Ledger_Loop",
				id: "c-build",
				requirement: "Validation is explicit",
				sourceRef: ".pi/plans/stardock-implementation-framework.md#criterion-ledger",
				description: "Run validation before claiming the loop slice complete.",
				passCondition: "Typecheck and focused tests pass with fresh output.",
				testMethod: "npm run typecheck --prefix agent/extensions && npm test --prefix agent/extensions -- private/stardock/index.test.ts",
				status: "failed",
				evidence: "Initial baseline has no criterion-ledger tests.",
				redEvidence: "No focused test asserted criterion persistence.",
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(createCriterion.content[0].text, /Created criterion c-build/);
		assert.equal(createCriterion.details.criterion.status, "failed");
		assert.deepEqual(createCriterion.details.criterionLedger.requirementTrace, [
			{ requirement: "Validation is explicit", criterionIds: ["c-build"] },
		]);

		const updateCriterion = await ledger.execute(
			"tool-ledger-criterion-update",
			{
				action: "upsertCriterion",
				loopName: "Ledger_Loop",
				id: "c-build",
				status: "passed",
				evidence: "Typecheck and focused tests passed after adding ledger coverage.",
				greenEvidence: "node --test private/stardock/index.test.ts passed.",
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(updateCriterion.content[0].text, /Updated criterion c-build/);
		assert.equal(updateCriterion.details.criterion.description, "Run validation before claiming the loop slice complete.");
		assert.equal(updateCriterion.details.criterion.status, "passed");
		assert.ok(updateCriterion.details.criterion.lastCheckedAt);

		const longSummary = `${"log line ".repeat(90)}final result passed`;
		const artifactResult = await ledger.execute(
			"tool-ledger-artifact",
			{
				action: "recordArtifact",
				loopName: "Ledger_Loop",
				id: "a-test",
				kind: "test",
				command: "npm test --prefix agent/extensions -- private/stardock/index.test.ts",
				path: "artifacts/stardock-ledger-test.txt",
				summary: longSummary,
				criterionIds: ["c-build"],
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(artifactResult.content[0].text, /Recorded artifact a-test/);
		assert.equal(artifactResult.details.artifact.summary.length, 500);
		assert.equal(artifactResult.details.artifact.summary.endsWith("…"), true);
		assert.deepEqual(artifactResult.details.artifact.criterionIds, ["c-build"]);

		const listResult = await ledger.execute("tool-ledger-list", { action: "list", loopName: "Ledger_Loop" }, undefined, undefined, ctx);
		assert.match(listResult.content[0].text, /Criteria: 1 total, 1 passed/);
		assert.match(listResult.content[0].text, /Artifacts: 1 total/);
		assert.match(listResult.content[0].text, /a-test \[test\]/);
		assert.equal(listResult.content[0].text.includes(longSummary), false);

		const summaryResult = await stateTool.execute("tool-ledger-state", { loopName: "Ledger_Loop", includeDetails: true }, undefined, undefined, ctx);
		assert.match(summaryResult.content[0].text, /Criteria: 1 total, 1 passed/);
		assert.match(summaryResult.content[0].text, /Verification artifacts: 1/);
		assert.equal(summaryResult.details.loop.criteria.passed, 1);
		assert.equal(summaryResult.details.loop.verificationArtifacts.total, 1);
		assert.equal(summaryResult.details.loop.criterionLedger.criteria[0].id, "c-build");

		await done.execute("tool-ledger-done", {}, undefined, undefined, ctx);
		assert.equal(messages.length, 2);
		assert.equal(messages[1].content.includes("c-build"), false);
		assert.equal(messages[1].content.includes(longSummary), false);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("stardock_brief routes bounded prompt context from selected criteria", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { tools, messages, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const done = tools.get("stardock_done");
		const ledger = tools.get("stardock_ledger");
		const brief = tools.get("stardock_brief");
		const stateTool = tools.get("stardock_state");
		assert.ok(start);
		assert.ok(done);
		assert.ok(ledger);
		assert.ok(brief);
		assert.ok(stateTool);

		await start.execute(
			"tool-brief-start",
			{
				name: "Brief Loop",
				mode: "checklist",
				taskContent: "# Brief task\n\n## Checklist\n- [ ] Preserve no-brief defaults\n",
				maxIterations: 4,
			},
			undefined,
			undefined,
			ctx,
		);
		assert.equal(messages.length, 1);
		assert.equal(messages[0].content.includes("## Active Iteration Brief"), false);

		await ledger.execute(
			"tool-brief-selected-criterion",
			{
				action: "upsertCriterion",
				loopName: "Brief_Loop",
				id: "c-selected",
				description: "The prompt includes selected criterion details.",
				passCondition: "The next prompt names c-selected and its pass condition.",
				testMethod: "Inspect the queued prompt text.",
			},
			undefined,
			undefined,
			ctx,
		);
		await ledger.execute(
			"tool-brief-unselected-criterion",
			{
				action: "upsertCriterion",
				loopName: "Brief_Loop",
				id: "c-unselected",
				description: "This criterion should not appear in active brief prompts.",
				passCondition: "The active brief prompt omits this criterion.",
			},
			undefined,
			undefined,
			ctx,
		);
		const longArtifactSummary = `${"verbose artifact summary ".repeat(60)}must not be pasted`;
		await ledger.execute(
			"tool-brief-artifact",
			{
				action: "recordArtifact",
				loopName: "Brief_Loop",
				id: "a-selected",
				kind: "log",
				summary: longArtifactSummary,
				criterionIds: ["c-selected"],
			},
			undefined,
			undefined,
			ctx,
		);

		const upsertBrief = await brief.execute(
			"tool-brief-upsert",
			{
				action: "upsert",
				loopName: "Brief_Loop",
				id: "b-implement",
				objective: "Implement the smallest criteria-aware prompt packet.",
				task: "Wire one active brief into the next queued Stardock prompt.",
				criterionIds: ["c-selected"],
				acceptanceCriteria: ["Only selected criteria are included in the brief section."],
				verificationRequired: ["Run the focused Stardock test file."],
				requiredContext: ["agent/extensions/private/stardock/index.ts prompt builders"],
				constraints: ["No automatic plan distillation."],
				avoid: ["Do not paste artifact logs into prompts."],
				outputContract: "Report changed files, validation, risks, and next move.",
				sourceRefs: [".pi/plans/stardock-implementation-framework.md#context-routing"],
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(upsertBrief.content[0].text, /Created brief b-implement/);
		assert.equal(upsertBrief.details.brief.status, "draft");

		const activateBrief = await brief.execute(
			"tool-brief-activate",
			{ action: "activate", loopName: "Brief_Loop", id: "b-implement" },
			undefined,
			undefined,
			ctx,
		);
		assert.match(activateBrief.content[0].text, /Activated brief b-implement/);
		assert.equal(activateBrief.details.currentBriefId, "b-implement");

		const listBriefs = await brief.execute("tool-brief-list", { action: "list", loopName: "Brief_Loop" }, undefined, undefined, ctx);
		assert.match(listBriefs.content[0].text, /Current brief: b-implement/);
		assert.match(listBriefs.content[0].text, /b-implement \[active\]/);

		const inspect = await stateTool.execute("tool-brief-state", { loopName: "Brief_Loop", includeDetails: true }, undefined, undefined, ctx);
		assert.match(inspect.content[0].text, /Briefs: 1 \(current b-implement\)/);
		assert.equal(inspect.details.loop.briefs.currentBriefId, "b-implement");
		assert.equal(inspect.details.loop.briefs.current.task, "Wire one active brief into the next queued Stardock prompt.");
		assert.equal(inspect.details.loop.briefList[0].id, "b-implement");

		await done.execute("tool-brief-done", {}, undefined, undefined, ctx);
		assert.equal(messages.length, 2);
		const prompt = messages[1].content;
		assert.match(prompt, /## Active Iteration Brief/);
		assert.match(prompt, /Brief: b-implement/);
		assert.match(prompt, /c-selected \[pending\]/);
		assert.match(prompt, /Pass: The next prompt names c-selected and its pass condition\./);
		assert.match(prompt, /Verify: Inspect the queued prompt text\./);
		assert.match(prompt, /Only selected criteria are included/);
		assert.match(prompt, /Run the focused Stardock test file/);
		assert.match(prompt, /agent\/extensions\/private\/stardock\/index\.ts prompt builders/);
		assert.match(prompt, /No automatic plan distillation/);
		assert.match(prompt, /Do not paste artifact logs into prompts/);
		assert.match(prompt, /a-selected/);
		assert.match(prompt, /Full task content is omitted from this prompt/);
		assert.equal(prompt.includes("Preserve no-brief defaults"), false);
		assert.equal(prompt.includes("c-unselected"), false);
		assert.equal(prompt.includes(longArtifactSummary), false);

		await brief.execute("tool-brief-clear", { action: "clear", loopName: "Brief_Loop" }, undefined, undefined, ctx);
		await done.execute("tool-brief-done-no-current", {}, undefined, undefined, ctx);
		assert.equal(messages.length, 3);
		assert.equal(messages[2].content.includes("## Active Iteration Brief"), false);
		assert.match(messages[2].content, /Preserve no-brief defaults/);

		const completeBrief = await brief.execute(
			"tool-brief-complete",
			{ action: "complete", loopName: "Brief_Loop", id: "b-implement" },
			undefined,
			undefined,
			ctx,
		);
		assert.match(completeBrief.content[0].text, /Completed brief b-implement/);
		assert.equal(completeBrief.details.brief.status, "completed");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("active widget summarizes recursive run progress and clears on completion", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { tools, handlers, statuses, widgets, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const report = tools.get("stardock_attempt_report");
		const govern = tools.get("stardock_govern");
		const answerOutside = tools.get("stardock_outside_answer");
		assert.ok(start);
		assert.ok(report);
		assert.ok(govern);
		assert.ok(answerOutside);

		await start.execute(
			"tool-widget-start",
			{
				name: "Widget Loop",
				mode: "recursive",
				taskContent: "# Widget task\n",
				objective: "Show a compact live summary of what Stardock is doing",
				maxIterations: 4,
			},
			undefined,
			undefined,
			ctx,
		);

		assert.match(statuses.get("stardock") ?? "", /Widget_Loop · 1\/4/);
		let widget = widgets.get("stardock") ?? [];
		assert.ok(widget.some((line) => line.includes("Widget_Loop")));
		assert.ok(widget.some((line) => line.includes("active · recursive · iteration 1/4")));
		assert.ok(widget.some((line) => line.includes("Attempts: 0/0 reported")));
		assert.ok(widget.some((line) => line.includes("Outside: 0/0 pending")));

		await report.execute(
			"tool-widget-report",
			{
				loopName: "Widget_Loop",
				iteration: 1,
				kind: "other",
				hypothesis: "A compact widget helps users see workflow progress.",
				actionSummary: "Added live widget assertions.",
				validation: "Focused widget checks passed.",
				result: "improved",
				kept: true,
			},
			undefined,
			undefined,
			ctx,
		);
		await govern.execute("tool-widget-govern", { loopName: "Widget_Loop" }, undefined, undefined, ctx);
		await answerOutside.execute(
			"tool-widget-answer",
			{
				loopName: "Widget_Loop",
				requestId: "governor-manual-1",
				answer: "Continue with docs and validation.",
				verdict: "continue",
				rationale: "Widget now shows useful state.",
				requiredNextMove: "Use the widget as an at-a-glance companion and /stardock view for details.",
			},
			undefined,
			undefined,
			ctx,
		);

		widget = widgets.get("stardock") ?? [];
		assert.ok(widget.some((line) => line.includes("Attempts: 1/1 reported")));
		assert.ok(widget.some((line) => line.includes("Last: #1 · other · improved")));
		assert.ok(widget.some((line) => line.includes("Outside: 0/1 pending")));
		assert.ok(widget.some((line) => line.includes("Governor: Use the widget as an at-a-glance companion")));

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
		assert.equal(statuses.get("stardock"), undefined);
		assert.equal(widgets.get("stardock"), undefined);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("stardock view and timeline show operational run flow", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { tools, commands, notifications, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const report = tools.get("stardock_attempt_report");
		const govern = tools.get("stardock_govern");
		const answerOutside = tools.get("stardock_outside_answer");
		const stateTool = tools.get("stardock_state");
		assert.ok(start);
		assert.ok(report);
		assert.ok(govern);
		assert.ok(answerOutside);
		assert.ok(stateTool);

		await start.execute(
			"tool-viz-start",
			{
				name: "Viz Loop",
				mode: "recursive",
				taskContent: "# Visualize task\n",
				objective: "Understand what is happening in a Stardock workflow",
				maxIterations: 3,
			},
			undefined,
			undefined,
			ctx,
		);
		await report.execute(
			"tool-viz-report",
			{
				loopName: "Viz_Loop",
				iteration: 1,
				kind: "other",
				hypothesis: "A timeline makes workflow state understandable.",
				actionSummary: "Recorded one visualization attempt.",
				validation: "Focused visualization assertions passed.",
				result: "improved",
				kept: true,
			},
			undefined,
			undefined,
			ctx,
		);
		await govern.execute("tool-viz-govern", { loopName: "Viz_Loop" }, undefined, undefined, ctx);
		await answerOutside.execute(
			"tool-viz-answer",
			{
				loopName: "Viz_Loop",
				requestId: "governor-manual-1",
				answer: "Continue by checking the timeline output.",
				verdict: "continue",
				rationale: "The run has enough events to display.",
				requiredNextMove: "Review the overview and timeline.",
			},
			undefined,
			undefined,
			ctx,
		);

		const overview = await stateTool.execute("tool-viz-state", { loopName: "Viz_Loop", view: "overview" }, undefined, undefined, ctx);
		assert.match(overview.content[0].text, /Stardock run: Viz_Loop/);
		assert.match(overview.content[0].text, /Progress\n  Attempts: 1\/1 reported/);
		assert.match(overview.content[0].text, /Timeline: Viz_Loop/);
		assert.match(overview.content[0].text, /Attempt 1 · reported · other · improved/);
		assert.match(overview.content[0].text, /Request 1 · governor_review governor-manual-1 · answered · continue/);

		const stardock = commands.get("stardock");
		assert.ok(stardock);
		await stardock.handler("view Viz_Loop", ctx);
		assert.match(notifications.at(-1) ?? "", /Stardock run: Viz_Loop/);
		await stardock.handler("timeline Viz_Loop", ctx);
		assert.match(notifications.at(-1) ?? "", /Timeline: Viz_Loop/);
		assert.match(notifications.at(-1) ?? "", /Review the overview and timeline/);
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
		assert.equal(migrated.reflectEvery, 3);
		assert.equal(migrated.iteration, 2);
		assert.equal(migrated.status, "active");
		assert.equal(migrated.active, true);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("unsupported mode does not create a loop", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { tools, commands, messages, notifications, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
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
		assert.equal(fs.existsSync(statePath(cwd, "Evolve_Loop")), false);

		const stardock = commands.get("stardock");
		assert.ok(stardock);
		await stardock.handler("start cmd-evolve --mode evolve", ctx);
		assert.ok(notifications.some((message) => message.includes('Stardock mode "evolve" is planned but not implemented yet.')));
		assert.equal(fs.existsSync(statePath(cwd, "cmd-evolve")), false);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

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
