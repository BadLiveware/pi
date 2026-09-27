import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { materializeExecutionPlanWave } from "../src/execution-plan/materialize.ts";
import { applyExecutionPlanReview, executeExecutionPlanReview } from "../src/execution-plan/review-tool.ts";
import { loadState } from "../src/state/store.ts";
import { fanoutPlan, seedReviewWave } from "./execution-plan-fixtures.ts";
import { makeHarness } from "./test-harness.ts";

test("governor decisions accept arbitrary node evidence without mandatory integration", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-execution-review-"));
	try {
		const { id: _id, ...input } = fanoutPlan();
		input.nodes = input.nodes.slice(1, 3).map((node) => ({ ...node, dependsOn: [] }));
		const { tools, ctx } = makeHarness(cwd);
		await tools.get("stardock_plan").execute("plan-call", { ...input, name: "review-plan" }, undefined, undefined, ctx);
		await materializeExecutionPlanWave(ctx, "review-plan", undefined, {
			inspectWorktree: async () => ({ worktreePath: cwd, repositoryCommonDir: path.join(cwd, ".git"), headCommit: "a".repeat(40), branchRef: "refs/heads/main", clean: true }),
		} as any);
		const runIds = seedReviewWave(ctx, "review-plan");
		const reviewed = applyExecutionPlanReview(ctx, "review-plan", runIds.map((runId) => ({ runId, decision: "accept", rationale: "Focused report and evidence are useful." })));
		assert.equal(reviewed.plan.nextAction, "complete");
		assert.deepEqual(reviewed.state.executionPlan?.nodes.map((node) => node.status), ["accepted", "accepted"]);
		assert.deepEqual(reviewed.state.workerRuns.map((run) => run.status), ["accepted", "accepted"]);
		assert.deepEqual(reviewed.state.workerReports.map((report) => report.status), ["accepted", "accepted"]);
		assert.deepEqual(reviewed.state.criterionLedger.criteria.map((criterion) => criterion.status), ["passed", "passed"]);
		assert.equal(reviewed.state.verificationArtifacts.length, 2);
		assert.equal(reviewed.state.executionGraph?.stages[0].status, "settled");
		assert.equal(reviewed.state.executionPlan?.waves[0].status, "settled");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("governor may accept warning-bearing evidence without promoting failed validation as green", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-execution-advisory-validation-"));
	try {
		const { id: _id, ...input } = fanoutPlan();
		input.nodes = [{ ...input.nodes[0], validationCommands: ["optional check"] }];
		const { tools, ctx } = makeHarness(cwd);
		await tools.get("stardock_plan").execute("plan-call", { ...input, name: "advisory-validation" }, undefined, undefined, ctx);
		await materializeExecutionPlanWave(ctx, "advisory-validation", undefined, {
			inspectWorktree: async () => ({ worktreePath: cwd, repositoryCommonDir: path.join(cwd, ".git"), headCommit: "b".repeat(40), branchRef: "refs/heads/main", clean: true }),
		} as any);
		const [runId] = seedReviewWave(ctx, "advisory-validation", "failed");
		const reviewed = applyExecutionPlanReview(ctx, "advisory-validation", [{ runId, decision: "accept", rationale: "The report is useful and the environmental failure is accepted." }]);
		assert.equal(reviewed.plan.nextAction, "complete");
		assert.equal(reviewed.state.verificationArtifacts.length, 0, "failed validation must not be promoted as passing evidence");
		assert.match(reviewed.state.criterionLedger.criteria[0].greenEvidence ?? "", /accepted by governor without promoted validation/i);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("governor decision releases settled isolation without mandatory integration", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-execution-decision-release-"));
	try {
		const { id: _id, ...input } = fanoutPlan();
		input.nodes = [{ ...input.nodes[0] }];
		const { tools, ctx } = makeHarness(cwd);
		await tools.get("stardock_plan").execute("plan-call", { ...input, name: "decision-release" }, undefined, undefined, ctx);
		await materializeExecutionPlanWave(ctx, "decision-release", undefined, {
			inspectWorktree: async () => ({ worktreePath: cwd, repositoryCommonDir: path.join(cwd, ".git"), headCommit: "b".repeat(40), branchRef: "refs/heads/main", clean: true }),
		} as any);
		const [runId] = seedReviewWave(ctx, "decision-release");
		const releasedStages: string[] = [];
		const runtime = { ref: { currentLoop: "decision-release" }, updateUI() {} } as any;
		const result = await executeExecutionPlanReview(runtime, { decisions: [{ runId, decision: "accept", rationale: "The concise report satisfies this node." }] }, ctx, undefined, (async (_ctx: any, args: any) => {
			releasedStages.push(args.stageId);
			return { ok: true, graphId: args.graphId, stageId: args.stageId, stateRevision: args.expectedGraphRevision, releasedAttemptIds: ["review-attempt-1"], preserved: [], ownershipReleased: true };
		}) as any);
		assert.equal(result.isError, undefined);
		assert.equal(releasedStages.length, 1);
		assert.equal((result.details as any).plan.nextAction, "complete");
		assert.match(result.content[0].text, /Workspace cleanup: returned 1 lease\(s\); stage ownership released/);
		assert.deepEqual((result.details as any).releasedAttemptIds, ["review-attempt-1"]);
		assert.doesNotMatch(result.content[0].text, /stardock_integrate/);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("attempt budgets advise but do not prevent governor retry", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-execution-budget-"));
	try {
		const { id: _id, ...input } = fanoutPlan();
		input.nodes = [{ ...input.nodes[0], maxAttempts: 1 }];
		const { tools, ctx } = makeHarness(cwd);
		await tools.get("stardock_plan").execute("plan-call", { ...input, name: "budget-plan" }, undefined, undefined, ctx);
		await materializeExecutionPlanWave(ctx, "budget-plan", undefined, {
			inspectWorktree: async () => ({ worktreePath: cwd, repositoryCommonDir: path.join(cwd, ".git"), headCommit: "b".repeat(40), branchRef: "refs/heads/main", clean: true }),
		} as any);
		const [runId] = seedReviewWave(ctx, "budget-plan");
		const reviewed = applyExecutionPlanReview(ctx, "budget-plan", [{ runId, decision: "reject", rationale: "The implementation violates the frozen interface." }]);
		assert.equal(reviewed.plan.nextAction, "run");
		assert.equal(reviewed.state.executionPlan?.nodes[0].status, "retry_ready");
		assert.match(reviewed.state.executionPlan?.nodes[0].lastError ?? "", /attempt budget.*governor may still retry/i);
		assert.equal(reviewed.state.executionPlan?.decisions.length, 0);
		const replan = await tools.get("stardock_plan").execute("replan-call", { ...input, name: "budget-plan-v2", supersedesPlan: "budget-plan", replanReason: "The frozen interface needs a corrected implementation boundary." }, undefined, undefined, ctx);
		assert.equal(replan.isError, undefined);
		assert.equal(loadState(ctx, "budget-plan-v2")?.executionPlan?.supersedesPlan, "budget-plan");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
