import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { executeExecutionPlanRun } from "../src/execution-plan/run-tool.ts";
import { applyExecutionPlanReview, executeExecutionPlanReview } from "../src/execution-plan/review-tool.ts";
import { runReadyStage } from "../src/stages/run-ready.ts";
import { releaseStage } from "../src/stages/reconcile.ts";
import { bindOwnershipContext, removeOwnershipToken } from "../src/stages/ownership-records.ts";
import { loadState } from "../src/state/store.ts";
import { makeHarness } from "./test-harness.ts";
import { FakeAdapter } from "./stage-run-ready-test-support.ts";

class IdentityAdapter extends FakeAdapter {
	override async inspectLaneCompletion(lease: Parameters<FakeAdapter["inspectLaneCompletion"]>[0]) {
		return super.inspectLaneCompletion(this.leases.find((candidate) => candidate.leaseHolder === lease.leaseHolder)!);
	}
}

async function reviewedPair(firstDecision: "accept" | "abandon", releaseCustody = true) {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "stardock-retry-lifecycle-"));
	const harness = makeHarness(cwd);
	const name = "retry-pair";
	const sessionId = "retry-test-session";
	const runtime = { ref: { currentLoop: name, sessionId }, updateUI() {} } as any;
	const adapter = new IdentityAdapter();
	const dependencies = {
		gitAdapter: { inspectWorktree: async () => ({ worktreePath: cwd, repositoryCommonDir: path.join(cwd, ".git"), headCommit: "a".repeat(40), branchRef: "refs/heads/main", clean: true }) } as any,
		runReadyDependencies: {
			adapter,
			invokeWorker: async ({ node }: any) => ({ response: { requestId: node.id, result: { details: { results: [{ finalOutput: "settled" }] } }, isError: false } }),
		},
	};
	const cleanup = () => {
		removeOwnershipToken(harness.ctx, name, sessionId);
		fs.rmSync(cwd, { recursive: true, force: true });
	};
	try {
		await harness.tools.get("stardock_plan").execute("plan", {
			name, objective: "Two independent evidence jobs", nodes: ["first", "second"].map((id) => ({ id, objective: id, task: `Inspect ${id}`, acceptanceCriteria: ["Return evidence"] })),
		}, undefined, undefined, harness.ctx);
		bindOwnershipContext(harness.ctx, sessionId);
		const initial = await executeExecutionPlanRun(harness.pi, runtime, {}, undefined, undefined, harness.ctx, dependencies);
		assert.equal(initial.isError, undefined, initial.content[0].text);
		const runIds = initial.details.plan!.reviewRunIds;
		const decisions = [
			{ runId: runIds[0], decision: firstDecision, rationale: "This job is decided" },
			{ runId: runIds[1], decision: "retry" as const, rationale: "Try again" },
		];
		if (releaseCustody) {
			const reviewed = await executeExecutionPlanReview(runtime, { decisions }, harness.ctx, undefined,
				(ctx, input, signal) => releaseStage(ctx, input, signal, adapter));
			assert.equal(reviewed.isError, undefined);
			assert.ok("ownershipReleased" in reviewed.details);
			assert.equal(reviewed.details.ownershipReleased, true, reviewed.content[0].text);
		} else applyExecutionPlanReview(harness.ctx, name, decisions);
		return { ...harness, name, runtime, dependencies, cleanup };
	} catch (error) {
		cleanup();
		throw error;
	}
}

for (const decision of ["accept", "abandon"] as const) {
	test(`subset retry reacquires custody without rerunning an ${decision}ed sibling`, async () => {
		const h = await reviewedPair(decision);
		try {
			const result = await executeExecutionPlanRun(h.pi, h.runtime, {}, undefined, undefined, h.ctx, h.dependencies);
			assert.equal(result.isError, undefined, result.content[0].text);
			assert.equal(result.details.lanes!.length, 1);
			assert.equal(result.details.lanes![0].planNodeId, "second");
			assert.deepEqual(loadState(h.ctx, h.name)!.executionPlan!.nodes.map((node) => node.status), [decision === "accept" ? "accepted" : "abandoned", "needs_review"]);
		} finally { h.cleanup(); }
	});
}

test("failed retry acquisition remains resumable as the same unresolved subset", async () => {
	const h = await reviewedPair("accept");
	try {
		const failed = await executeExecutionPlanRun(h.pi, h.runtime, {}, undefined, undefined, h.ctx, {
			...h.dependencies, runReady: async () => { throw new Error("transient acquisition failure"); },
		});
		assert.equal(failed.isError, true);
		const resumed = await executeExecutionPlanRun(h.pi, h.runtime, {}, undefined, undefined, h.ctx, h.dependencies);
		assert.equal(resumed.isError, undefined, resumed.content[0].text);
		assert.equal(resumed.details.lanes!.length, 1);
		assert.equal(loadState(h.ctx, h.name)!.executionPlan!.waves.length, 1);
	} finally { h.cleanup(); }
});

for (const decision of ["accept", "abandon"] as const) {
	test(`interrupted subset retry restores only new review evidence beside ${decision}ed sibling`, async () => {
		const h = await reviewedPair(decision, false);
		try {
			const interrupted = await executeExecutionPlanRun(h.pi, h.runtime, {}, undefined, undefined, h.ctx, {
				...h.dependencies,
				runReady: async (pi, ctx, request, signal, update, dependencies) => {
					await runReadyStage(pi, ctx, request, signal, update, dependencies);
					throw new Error("interrupted after durable stage settlement");
				},
			});
			assert.equal(interrupted.isError, true);
			const resumed = await executeExecutionPlanRun(h.pi, h.runtime, {}, undefined, undefined, h.ctx);
			assert.equal(resumed.isError, undefined, resumed.content[0].text);
			assert.equal(resumed.details.recovered, true);
			assert.equal(resumed.details.lanes!.length, 1);
			const state = loadState(h.ctx, h.name)!;
			assert.equal(state.executionPlan!.nodes[0].status, decision === "accept" ? "accepted" : "abandoned");
			assert.equal(state.executionPlan!.nodes[1].status, "needs_review");
			assert.equal(state.executionPlan!.nodes[1].attemptsUsed, 2);
			assert.equal(state.executionPlan!.nodes[1].currentWorkerRunId, state.workerRuns.at(-1)!.id);
		} finally { h.cleanup(); }
	});
}
