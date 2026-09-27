import assert from "node:assert/strict";
import { test } from "node:test";
import { createExecutionPlan, refreshExecutionPlan } from "../src/execution-plan/graph.ts";
import { beginExecutionActivities, renderExecutionPlanWidget, updateExecutionActivity } from "../src/execution-plan/widget.ts";
import { createLoopState } from "../src/state/factory.ts";
import { fanoutPlan } from "./execution-plan-fixtures.ts";

const theme = {
	fg: (_style: string, text: string) => text,
	bold: (text: string) => text,
} as any;

test("execution widget distinguishes bounded queued lanes from running agents", () => {
	const plan = createExecutionPlan(fanoutPlan());
	const [interfaces, api, storage] = plan.nodes;
	interfaces.status = "integrated";
	api.status = "running";
	api.currentExecutionNodeId = "node-api";
	storage.status = "running";
	storage.currentExecutionNodeId = "node-storage";
	refreshExecutionPlan(plan);
	const state = createLoopState({ name: "bounded", taskFile: "task.md", mode: "checklist", modeState: { kind: "checklist" }, executionPlan: plan });
	const activity = new Map();
	beginExecutionActivities(activity, state.name, ["node-api", "node-storage"], 500);
	updateExecutionActivity(activity, state.name, "Subagent run started.", { nodeId: "node-api" }, 1_000);
	const lines = renderExecutionPlanWidget(state, activity, theme, 11_000);
	assert.match(lines[1], /1 agent running · 1 queued/);
	assert.match(lines.find((line) => line.includes("storage")) ?? "", /storage · queued/);
	assert.doesNotMatch(lines.find((line) => line.includes("storage")) ?? "", /10\.5s/);
});

test("execution widget renders compact DAG progress with dependency and live activity detail", () => {
	const plan = createExecutionPlan(fanoutPlan(), "2026-01-01T00:00:00.000Z");
	const [interfaces, api, storage, ui] = plan.nodes;
	interfaces.status = "integrated";
	api.status = "running";
	api.currentExecutionNodeId = "node-api";
	storage.status = "needs_review";
	storage.currentExecutionNodeId = "node-storage";
	ui.status = "pending";
	ui.dependsOn = ["api", "storage"];
	plan.waves.push({ id: "wave-2", stageId: "stage-2", nodeIds: ["api", "storage", "ui"], status: "running", createdAt: "2026-01-01T00:00:00.000Z" });
	refreshExecutionPlan(plan);
	const state = createLoopState({
		name: "auth-redesign",
		taskFile: ".stardock/runs/auth-redesign/task.md",
		mode: "checklist",
		modeState: { kind: "checklist" },
		executionPlan: plan,
		now: "2026-01-01T00:00:00.000Z",
	});
	const activity = new Map();
	beginExecutionActivities(activity, state.name, ["node-api"], 500);
	updateExecutionActivity(activity, state.name, "Subagent run started.", { nodeId: "node-api" }, 1_000);
	updateExecutionActivity(activity, state.name, "Subagent running.", { nodeId: "node-api", update: { currentTool: "edit", toolCount: 4, tokenCount: 19_000 } }, 21_200);

	const lines = renderExecutionPlanWidget(state, activity, theme, 21_200);
	assert.equal(lines[0], "stardock auth-redesign (4)");
	assert.match(lines[1], /DAG · wave 1 · 1 agent running · 1\/4 resolved · 1 review/);
	assert.match(lines[2], /interfaces · integrated/);
	assert.match(lines[3], /api · running · edit · 4 tool uses · 19k token · 20\.2s · ← interfaces/);
	assert.match(lines[4], /storage · needs review · ← interfaces/);
	assert.match(lines[5], /ui · pending · after api, storage/);
	assert.match(lines[6], /\/stardock view for DAG detail/);
});
