import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { loadState, saveState } from "../src/state/store.ts";
import { summarizeLoopState } from "../src/views.ts";
import { makeHarness } from "./test-harness.ts";

test("stardock_state lists and inspects loop summaries", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { tools, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const stateTool = tools.get("stardock_state");
		assert.ok(start);
		assert.ok(stateTool);
		assert.match(stateTool.description, /Default details are compact counts/);
		assert.ok(stateTool.promptGuidelines.some((guideline: string) => guideline.includes("Do not pass includeDetails")));

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

test("compact loop summaries stay bounded as historical evidence grows", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-summary-size-test-"));
	try {
		const { tools, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		assert.ok(start);
		await start.execute("tool-summary-size-start", { name: "Summary Size", mode: "recursive", taskContent: "# Summary size\n", objective: "Keep recursive summaries compact.", maxIterations: 3 }, undefined, undefined, ctx);
		const state = loadState(ctx, "Summary_Size");
		assert.ok(state);
		const longText = "large historical evidence ".repeat(80);
		assert.equal(state.modeState.kind, "recursive");
		state.modeState.objective = longText;
		state.modeState.attempts = [{ id: "attempt-1", iteration: 1, createdAt: new Date().toISOString(), status: "reported", summary: longText }];
		state.outsideRequests = [{
			id: "governor-1",
			kind: "governor_review",
			status: "answered",
			requestedAt: new Date().toISOString(),
			requestedByIteration: 1,
			trigger: "manual",
			prompt: longText,
			decision: {
				verdict: "continue",
				rationale: longText,
				requiredNextMove: longText,
				forbiddenNextMoves: Array.from({ length: 100 }, () => longText),
				evidenceGaps: Array.from({ length: 100 }, () => longText),
			},
		}];
		state.governorState.completedMilestones = Array.from({ length: 100 }, (_, index) => `${index}: ${longText}`);
		state.workerReports = Array.from({ length: 400 }, (_, index) => ({
			id: index === 0 ? "a-latest" : `wr${index + 1}`,
			status: "accepted",
			role: "implementer",
			objective: longText,
			summary: longText,
			advisoryHandoffIds: [],
			evaluatedCriterionIds: [],
			artifactIds: [],
			changedFiles: Array.from({ length: 20 }, (_, fileIndex) => ({ path: `src/file-${fileIndex}.ts`, summary: longText })),
			validation: [],
			risks: [longText],
			openQuestions: [longText],
			reviewHints: [longText],
			createdAt: index === 0 ? "2030-01-01T00:00:00.000Z" : "2020-01-01T00:00:00.000Z",
			updatedAt: index === 0 ? "2030-01-01T00:00:00.000Z" : "2020-01-01T00:00:00.000Z",
		})) as any;
		state.workerRuns = Array.from({ length: 400 }, (_, index) => ({
			id: `run${index + 1}`,
			role: "implementer",
			status: "accepted",
			scope: "brief",
			requestId: `request-${index + 1}`,
			agentName: "implementer",
			context: "fresh",
			outputMode: "file-only",
			summary: longText,
			outputRefs: Array.from({ length: 10 }, (_, refIndex) => `/tmp/output-${refIndex}.md`),
			changedFiles: Array.from({ length: 20 }, (_, fileIndex) => ({ path: `src/file-${fileIndex}.ts`, summary: longText })),
			allowDirtyWorkspace: false,
			startedAt: new Date().toISOString(),
			completedAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		})) as any;

		const summary = summarizeLoopState(ctx, state);
		const bytes = Buffer.byteLength(JSON.stringify(summary));
		assert.ok(bytes < 30_000, `expected compact summary below 30KB, got ${bytes} bytes`);
		assert.equal((summary.workerReports as any).total, 400);
		assert.equal((summary.workerReports as any).latest.id, "a-latest");
		assert.equal((summary.workerRuns as any).total, 400);
		assert.deepEqual((summary.workerRuns as any).latest.outputRefs.items, ["/tmp/output-0.md", "/tmp/output-1.md", "/tmp/output-2.md", "/tmp/output-3.md"]);
		assert.equal((summary.workerRuns as any).latest.changedFiles.items.length, 5);
		assert.equal((summary.workerReports as any).latest.changedFiles.items.length, 5);
		assert.equal((summary.workerReports as any).latest.reviewHints.items.length, 1);
		assert.equal(Array.isArray(summary.workerReports), false);
		assert.equal(Array.isArray(summary.workerRuns), false);
		assert.equal(((summary.governorState as any).completedMilestones.recent as string[]).length, 5);
		assert.ok(((summary.recursive as any).objective as string).length <= 500);
		assert.ok(((summary.recursive as any).latestAttempt.summary as string).length <= 500);
		assert.ok(((summary.outsideRequests as any).latestGovernorDecision.rationale as string).length <= 500);
		assert.equal((summary.outsideRequests as any).latestGovernorDecision.requiresFullInspection, true);
		assert.equal((summary.governorRouting as any).requiresFullInspection, true);

		const expanded = summarizeLoopState(ctx, state, false, true);
		assert.equal((expanded.governorStateDetails as any).completedMilestones.length, 100);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("compact state preserves current governor constraints or blocks routing on overflow", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-governor-routing-test-"));
	try {
		const { tools, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const governor = tools.get("stardock_governor_state");
		const listOutside = tools.get("stardock_outside_requests");
		const brief = tools.get("stardock_brief");
		const stateTool = tools.get("stardock_state");
		assert.ok(start);
		assert.ok(governor);
		assert.ok(listOutside);
		assert.ok(brief);
		assert.ok(stateTool);
		await start.execute("tool-governor-routing-start", { name: "Governor Routing", mode: "checklist", taskContent: "# Governor routing\n", maxIterations: 3 }, undefined, undefined, ctx);

		const eightConstraints = Array.from({ length: 8 }, (_, index) => `active constraint ${index + 1}`);
		await governor.execute("tool-governor-routing-eight", { action: "upsert", loopName: "Governor_Routing", activeConstraints: eightConstraints }, undefined, undefined, ctx);
		const complete = await stateTool.execute("tool-governor-routing-complete", { loopName: "Governor_Routing" }, undefined, undefined, ctx);
		assert.deepEqual(complete.details.loop.governorState.activeConstraints.items, eightConstraints);
		assert.equal(complete.details.loop.governorRouting.requiresFullInspection, false);
		assert.doesNotMatch(complete.content[0].text, /FULL INSPECTION REQUIRED/);

		const overflowConstraints = Array.from({ length: 11 }, (_, index) => `active constraint ${index + 1}`);
		await governor.execute("tool-governor-routing-overflow", { action: "upsert", loopName: "Governor_Routing", activeConstraints: overflowConstraints }, undefined, undefined, ctx);
		const overflow = await stateTool.execute("tool-governor-routing-overflow-state", { loopName: "Governor_Routing" }, undefined, undefined, ctx);
		assert.equal(overflow.details.loop.governorState.activeConstraints.items.length, 10);
		assert.equal(overflow.details.loop.governorState.activeConstraints.truncated, true);
		assert.equal(overflow.details.loop.governorRouting.requiresFullInspection, true);
		assert.match(overflow.content[0].text, /FULL INSPECTION REQUIRED before choosing the next move/);
		const fullMemory = await governor.execute("tool-governor-routing-full-memory", { action: "list", loopName: "Governor_Routing" }, undefined, undefined, ctx);
		assert.match(fullMemory.content[0].text, /active constraint 11/);
		for (const view of ["overview", "timeline"]) {
			const viewed = await stateTool.execute(`tool-governor-routing-${view}`, { loopName: "Governor_Routing", view }, undefined, undefined, ctx);
			assert.match(viewed.content[0].text, /FULL INSPECTION REQUIRED before choosing the next move/);
		}

		const followup = await brief.execute(
			"tool-governor-routing-followup",
			{
				action: "upsert",
				loopName: "Governor_Routing",
				id: "b-routing-followup",
				objective: "Verify routing warnings.",
				task: "Inspect compact state before routing.",
				followupTool: { name: "stardock_state", args: { loopName: "Governor_Routing", view: "overview" } },
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(followup.details.followupTool.content, /FULL INSPECTION REQUIRED before choosing the next move/);

		await governor.execute("tool-governor-routing-clear-memory", { action: "upsert", loopName: "Governor_Routing", activeConstraints: [] }, undefined, undefined, ctx);
		const requestId = "governor-routing-decision";
		const forbiddenNextMoves = Array.from({ length: 11 }, (_, index) => `forbidden move ${index + 1}`);
		const decisionState = loadState(ctx, "Governor_Routing");
		assert.ok(decisionState);
		decisionState.outsideRequests.push(
			...Array.from({ length: 24 }, (_, index) => ({
				id: `research-routing-${index + 1}`,
				kind: "research" as const,
				status: "requested" as const,
				requestedAt: new Date(2025, 0, 1, 0, 0, index).toISOString(),
				requestedByIteration: decisionState.iteration,
				trigger: "manual" as const,
				prompt: `Research routing question ${index + 1}.`,
			})),
			{
				id: requestId,
				kind: "governor_review",
				status: "answered",
				requestedAt: new Date().toISOString(),
				requestedByIteration: decisionState.iteration,
				trigger: "manual",
				prompt: "Review routing constraints.",
				answer: "Continue with explicit routing constraints.",
				decision: { verdict: "continue", rationale: "Preserve all forbidden moves.", forbiddenNextMoves },
			},
		);
		saveState(ctx, decisionState);
		const decisionOverflow = await stateTool.execute("tool-governor-routing-decision-overflow", { loopName: "Governor_Routing" }, undefined, undefined, ctx);
		assert.equal(decisionOverflow.details.loop.governorRouting.memoryRequiresFullInspection, false);
		assert.equal(decisionOverflow.details.loop.governorRouting.latestDecisionRequiresFullInspection, true);
		assert.equal(decisionOverflow.details.loop.governorRouting.latestDecisionRequestId, requestId);
		assert.match(decisionOverflow.content[0].text, new RegExp(`stardock_outside_requests.*${requestId}`));

		const requestPage = await listOutside.execute("tool-governor-routing-request-page", { loopName: "Governor_Routing" }, undefined, undefined, ctx);
		assert.equal(requestPage.details.outsideRequests.length, 20);
		assert.equal(requestPage.details.page.total, 25);
		assert.equal(requestPage.details.page.nextOffset, 20);

		const fullDecision = await listOutside.execute("tool-governor-routing-full-decision", { loopName: "Governor_Routing", requestId }, undefined, undefined, ctx);
		assert.deepEqual(fullDecision.details.outsideRequests[0].decision.forbiddenNextMoves, forbiddenNextMoves);
		assert.equal(fullDecision.details.page.returned, 1);
		assert.match(fullDecision.content[0].text, /Verdict: continue/);
		assert.match(fullDecision.content[0].text, /forbidden move 11/);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("active widget summarizes recursive run progress and clears on completion", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { tools, statuses, widgets, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const report = tools.get("stardock_attempt_report");
		const govern = tools.get("stardock_govern");
		const answerOutside = tools.get("stardock_outside_answer");
		const complete = tools.get("stardock_complete");
		assert.ok(start);
		assert.ok(report);
		assert.ok(govern);
		assert.ok(answerOutside);
		assert.ok(complete);

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

		await complete.execute("tool-widget-complete", {}, undefined, undefined, ctx);
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
