import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { createExecutionPlan } from "../src/execution-plan/graph.ts";
import { materializeExecutionPlanWave } from "../src/execution-plan/materialize.ts";
import { executeExecutionPlanRun } from "../src/execution-plan/run-tool.ts";
import { loadState } from "../src/state/store.ts";
import { fanoutPlan } from "./execution-plan-fixtures.ts";
import { makeHarness } from "./test-harness.ts";

test("execution nodes require observable acceptance criteria but may omit command validation", () => {
	const input = fanoutPlan();
	input.nodes[0].acceptanceCriteria = [];
	assert.throws(() => createExecutionPlan(input), /acceptance criterion/);
	input.nodes[0].acceptanceCriteria = ["Governor can inspect a concise report."];
	input.nodes[0].validationCommands = [];
	assert.equal(createExecutionPlan(input).nodes[0].validationCommands.length, 0);
});

test("status recovers pending review run IDs and bounded evidence", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-status-evidence-"));
	try {
		const { id: _id, ...input } = fanoutPlan();
		input.nodes = input.nodes.slice(1, 2).map((node) => ({ ...node, dependsOn: [] }));
		const { pi, tools, ctx } = makeHarness(cwd);
		await tools.get("stardock_plan").execute("plan-call", { ...input, name: "status-evidence" }, undefined, undefined, ctx);
		const runtime = { ref: { currentLoop: "status-evidence", sessionId: "test" }, updateUI() {} } as any;
		await executeExecutionPlanRun(pi, runtime, {}, undefined, undefined, ctx, {
			gitAdapter: { inspectWorktree: async () => ({ worktreePath: cwd, repositoryCommonDir: path.join(cwd, ".git"), headCommit: "c".repeat(40), branchRef: "refs/heads/main", clean: true }) } as any,
			runReady: (async (_pi: any, _ctx: any, request: any) => ({ ok: true, graphId: request.graphId, stageId: request.stageId, stateRevision: request.expectedGraphRevision, selectedNodeIds: request.nodeIds, lanes: [{ nodeId: request.nodeIds[0], attemptId: "attempt-1", workerRunId: "review-run-1", status: "needs_review", violations: [] }], counts: { needs_review: 1 }, setupFailed: false, cancelled: false, timedOut: false })) as any,
		});
		const status = await tools.get("stardock_status").execute("status-call", {}, undefined, undefined, ctx);
		assert.match(status.content[0].text, /Pending review evidence:[\s\S]*runId review-run-1/);
		assert.equal((status.details as any).reviewLanes[0].workerRunId, "review-run-1");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("failed wave dispatch settles transient widget activity", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-wave-activity-"));
	try {
		const { id: _id, ...input } = fanoutPlan();
		input.nodes = input.nodes.slice(1, 3).map((node) => ({ ...node, dependsOn: [] }));
		const { pi, tools, ctx } = makeHarness(cwd);
		await tools.get("stardock_plan").execute("plan-call", { ...input, name: "failed-activity" }, undefined, undefined, ctx);
		const activity = new Map();
		const runtime = { ref: { currentLoop: "failed-activity", sessionId: "test" }, executionActivity: activity, updateUI() {} } as any;
		const result = await executeExecutionPlanRun(pi, runtime, {}, undefined, undefined, ctx, {
			gitAdapter: { inspectWorktree: async () => ({ worktreePath: cwd, repositoryCommonDir: path.join(cwd, ".git"), headCommit: "b".repeat(40), branchRef: "refs/heads/main", clean: true }) } as any,
			runReady: (async () => { throw new Error("dispatch failed"); }) as any,
		});
		assert.equal(result.isError, true);
		assert.equal([...activity.values()].every((item: any) => item.status === "settled"), true);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("intermediate prerequisite waves defer whole-result validation", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-wave-validation-"));
	try {
		const { id: _id, ...input } = fanoutPlan();
		const { tools, ctx } = makeHarness(cwd);
		await tools.get("stardock_plan").execute("plan-call", { ...input, name: "wave-validation" }, undefined, undefined, ctx);
		await materializeExecutionPlanWave(ctx, "wave-validation", undefined, {
			inspectWorktree: async () => ({ worktreePath: cwd, repositoryCommonDir: path.join(cwd, ".git"), headCommit: "a".repeat(40), branchRef: "refs/heads/main", clean: true }),
		} as any);
		const state = loadState(ctx, "wave-validation")!;
		const stage = state.executionGraph!.stages[0];
		const fanIn = state.executionGraph!.nodes.find((node) => node.id === stage.fanInNodeId)!;
		assert.deepEqual(stage.implementationNodeIds.length, 1);
		assert.deepEqual(fanIn.validationCommands, [], "whole-result validation must wait for the final DAG wave");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
