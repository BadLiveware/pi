import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { materializeExecutionPlanWave } from "../src/execution-plan/materialize.ts";
import { applyExecutionPlanReview, executeExecutionPlanReview } from "../src/execution-plan/review-tool.ts";
import { releaseStage } from "../src/stages/reconcile.ts";
import { inspectStageOwnership } from "../src/stages/ownership.ts";
import { loadState, mutateState } from "../src/state/store.ts";
import { fanoutPlan, seedReviewWave } from "./execution-plan-fixtures.ts";
import { makeHarness, runDir } from "./test-harness.ts";

test("recovery cannot return a clean lease before the governor decides its run", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-undecided-lease-"));
	try {
		const { id: _id, ...input } = fanoutPlan();
		input.nodes = [input.nodes[0]];
		const { tools, ctx } = makeHarness(cwd);
		await tools.get("stardock_plan").execute("plan", { ...input, name: "undecided-lease" }, undefined, undefined, ctx);
		const wave = await materializeExecutionPlanWave(ctx, "undecided-lease", undefined, {
			inspectWorktree: async () => ({ worktreePath: cwd, repositoryCommonDir: path.join(cwd, ".git"), headCommit: "b".repeat(40), branchRef: "refs/heads/main", clean: true }),
		} as any);
		const [runId] = seedReviewWave(ctx, "undecided-lease");
		mutateState(ctx, "undecided-lease", (state) => {
			state.executionGraph!.stages[0].status = "contracts_ready";
			const attempt = state.executionGraph!.nodes.find((node) => node.id === wave.nodeIds[0])!.attempts[0];
			attempt.leaseDisposition = "held";
			attempt.worktreePath = path.join(cwd, "lease");
			attempt.repositoryCommonDir = path.join(cwd, ".git");
			attempt.leaseHolder = "stardock:undecided";
		});
		const inspection = await tools.get("stardock_recover").execute("inspect", { action: "inspect", name: "undecided-lease" }, undefined, undefined, ctx);
		assert.equal(inspection.details.actions.some((action: string) => action.startsWith("releaseLeases")), false);
		assert.match(inspection.details.leaseReleaseBlock, /undecided plan lane/);
		const blocked = await tools.get("stardock_recover").execute("premature-release", {
			action: "releaseLeases", name: "undecided-lease", graphId: wave.graphId,
			stageId: wave.stageId, expectedGraphRevision: inspection.details.graphRevision,
		}, undefined, undefined, ctx);
		assert.equal(blocked.details.code, "review_pending");
		let returns = 0;
		const adapter = { inspectLeaseReservation: async () => ({ state: "held" }), inspectLaneCompletion: async () => ({ clean: true, branchRef: "refs/heads/lane-1", headCommit: "b".repeat(40) }), returnLease: async () => { returns++; } } as any;
		await assert.rejects(releaseStage(ctx, { loopName: "undecided-lease", graphId: wave.graphId, stageId: wave.stageId, expectedGraphRevision: inspection.details.graphRevision }, undefined, adapter), /undecided plan lane/);
		assert.equal(returns, 0);
		applyExecutionPlanReview(ctx, "undecided-lease", [{ runId, decision: "accept", rationale: "The result is accepted." }]);
		const after = await tools.get("stardock_recover").execute("inspect-decided", { action: "inspect", name: "undecided-lease" }, undefined, undefined, ctx);
		assert.ok(after.details.actions.some((action: string) => action.startsWith("releaseLeases")));
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("recovery inspection identifies each pending lease stage after multiple waves", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-multi-lease-"));
	try {
		const { id: _id, ...input } = fanoutPlan();
		input.nodes = input.nodes.slice(0, 2);
		const { tools, ctx } = makeHarness(cwd);
		await tools.get("stardock_plan").execute("plan", { ...input, name: "multi-lease" }, undefined, undefined, ctx);
		const git = { inspectWorktree: async () => ({ worktreePath: cwd, repositoryCommonDir: path.join(cwd, ".git"), headCommit: "b".repeat(40), branchRef: "refs/heads/main", clean: true }) } as any;
		const first = await materializeExecutionPlanWave(ctx, "multi-lease", undefined, git);
		const [runId] = seedReviewWave(ctx, "multi-lease");
		applyExecutionPlanReview(ctx, "multi-lease", [{ runId, decision: "accept", rationale: "Prerequisite accepted." }]);
		const second = await materializeExecutionPlanWave(ctx, "multi-lease", undefined, git);
		mutateState(ctx, "multi-lease", (state) => {
			for (const [stageId, attemptId] of [[first.stageId, "lease-first"], [second.stageId, "lease-second"]]) {
				const stage = state.executionGraph!.stages.find((item) => item.id === stageId)!;
				state.executionGraph!.nodes.find((node) => node.id === stage.implementationNodeIds[0])!.attempts.push({
					id: attemptId, baseCommit: stage.contractCommit, branchRef: attemptId,
					laneCommits: [], validation: [], status: "failed", startedAt: new Date().toISOString(),
					worktreePath: path.join(cwd, attemptId), repositoryCommonDir: path.join(cwd, ".git"),
					leaseHolder: `stardock:${attemptId}`, leaseDisposition: "preserved",
				});
			}
		});
		const initial = await tools.get("stardock_recover").execute("inspect", { action: "inspect", name: "multi-lease" }, undefined, undefined, ctx);
		assert.equal(initial.details.stageId, undefined);
		assert.deepEqual(initial.details.pendingLeaseStageIds, [first.stageId, second.stageId]);
		assert.match(initial.content[0].text, /inspect one using stageId/);
		const selected = await tools.get("stardock_recover").execute("inspect-stage", { action: "inspect", name: "multi-lease", stageId: first.stageId }, undefined, undefined, ctx);
		assert.deepEqual(selected.details.pendingLeaseAttemptIds, ["lease-first"]);
		assert.ok(selected.details.actions.some((action: string) => action.startsWith("releaseLeases")));
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("governor completion survives preserved lease cleanup without discarding custody evidence", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-plan-preserved-"));
	try {
		const { id: _id, ...input } = fanoutPlan();
		input.nodes = [input.nodes[0]];
		const { tools, ctx } = makeHarness(cwd);
		await tools.get("stardock_plan").execute("plan", { ...input, name: "preserved-lease" }, undefined, undefined, ctx);
		const wave = await materializeExecutionPlanWave(ctx, "preserved-lease", undefined, {
			inspectWorktree: async () => ({ worktreePath: cwd, repositoryCommonDir: path.join(cwd, ".git"), headCommit: "b".repeat(40), branchRef: "refs/heads/main", clean: true }),
		} as any);
		const acquisition = await tools.get("stardock_stage").execute("acquire", {
			action: "acquire", loopName: "preserved-lease", graphId: wave.graphId, stageId: wave.stageId, expectedGraphRevision: wave.graphRevision,
		}, undefined, undefined, ctx);
		assert.equal(acquisition.details.ok, true);
		await assert.rejects(tools.get("stardock_complete").execute("too-early", {}, undefined, undefined, ctx), /retains active ownership/);
		const [runId] = seedReviewWave(ctx, "preserved-lease");
		mutateState(ctx, "preserved-lease", (state) => {
			const attempt = state.executionGraph!.nodes.find((node) => node.id === state.executionPlan!.nodes[0].currentExecutionNodeId)!.attempts[0];
			attempt.leaseDisposition = "held";
			attempt.worktreePath = path.join(cwd, "leased-worktree");
			attempt.repositoryCommonDir = path.join(cwd, ".git");
			attempt.leaseHolder = "stardock:preserved-lease";
		});
		const runtime = { ref: { currentLoop: "preserved-lease" }, updateUI() {} } as any;
		const reviewed = await executeExecutionPlanReview(runtime, { decisions: [{ runId, decision: "accept", rationale: "The report is sufficient." }] }, ctx, undefined, (async () => ({
			ok: false, graphId: wave.graphId, stageId: wave.stageId, stateRevision: 0, releasedAttemptIds: [],
			preserved: [{ attemptId: "review-attempt-1", reason: "Treehouse status stdout included unrecognized nonempty lines" }], ownershipReleased: false,
		})) as any);
		assert.equal(reviewed.isError, undefined);
		assert.equal((reviewed.details as any).plan.status, "completed");
		assert.match(reviewed.content[0].text, /Lease review-attempt-1 was preserved/);
		assert.match(reviewed.content[0].text, /Cleanup still pending: stardock_recover/);
		const before = await tools.get("stardock_status").execute("status-before", {}, undefined, undefined, ctx);
		assert.match(before.content[0].text, /Resource cleanup pending: stage "plan-wave-1" retains ownership; 1 worktree lease/);

		const completed = await tools.get("stardock_complete").execute("complete", {}, undefined, undefined, ctx);
		assert.match(completed.content[0].text, /Completed Stardock loop/);
		assert.match(completed.content[0].text, /lease|ownership/i);
		const state = loadState(ctx, "preserved-lease")!;
		assert.equal(state.status, "completed");
		assert.equal(state.executionPlan?.status, "completed");
		assert.equal(state.executionGraph?.ownership, undefined, "settled ownership is relinquished without returning an unverified lease");
		assert.equal(state.executionGraph?.stages[0].terminalOwnershipCleanup?.stageId, wave.stageId);
		assert.equal(state.executionGraph?.nodes.find((node) => node.id === state.executionPlan?.nodes[0].currentExecutionNodeId)?.attempts[0].leaseDisposition, "preserved");
		assert.equal(fs.existsSync(path.join(runDir(cwd, "preserved-lease"), "stage-owner.json")), false);
		assert.equal(inspectStageOwnership(ctx, "preserved-lease").owner, null);
		const after = await tools.get("stardock_status").execute("status-after", { name: "preserved-lease" }, undefined, undefined, ctx);
		assert.match(after.content[0].text, /Resource cleanup pending: 1 worktree lease/);
		assert.deepEqual((after.details as any).resourceCleanup.attemptIds, ["review-attempt-1"]);
		assert.deepEqual((after.details as any).resourceCleanup.stageIds, [wave.stageId]);
		assert.match(after.content[0].text, /Suggested action: stardock_recover\(\{ action: "inspect"/);
		const inspection = await tools.get("stardock_recover").execute("inspect-after-complete", { action: "inspect", name: "preserved-lease" }, undefined, undefined, ctx);
		assert.equal(inspection.details.stageId, wave.stageId);
		assert.ok(inspection.details.actions.some((action: string) => action.startsWith("releaseLeases")));
		assert.deepEqual(inspection.details.pendingLeaseStageIds, [wave.stageId]);

		const recovered = await releaseStage(ctx, { loopName: "preserved-lease", graphId: wave.graphId, stageId: wave.stageId, expectedGraphRevision: state.executionGraph!.revision }, undefined, {
			inspectLeaseReservation: async () => ({ state: "held", reason: "Exact lease still held." }),
			inspectLaneCompletion: async () => ({ clean: true, branchRef: "refs/heads/lane-1", headCommit: "b".repeat(40) }),
			returnLease: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
		} as any);
		assert.equal(recovered.ok, true, JSON.stringify(recovered));
		const cleaned = loadState(ctx, "preserved-lease")!;
		assert.equal(cleaned.executionGraph?.nodes.find((node) => node.id === state.executionPlan?.nodes[0].currentExecutionNodeId)?.attempts[0].leaseDisposition, "released");
		assert.equal(cleaned.executionGraph?.status, "completed");
		const afterCleanup = await tools.get("stardock_status").execute("status-cleaned", { name: "preserved-lease" }, undefined, undefined, ctx);
		assert.doesNotMatch(afterCleanup.content[0].text, /Resource cleanup pending/);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
