import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { makeHarness, runDir, statePath, taskPath } from "./test-harness.ts";

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
