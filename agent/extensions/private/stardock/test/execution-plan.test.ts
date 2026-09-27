import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import {
	createExecutionPlan,
	readyExecutionPlanNodeIds,
	refreshExecutionPlan,
	summarizeExecutionPlan,
	validateExecutionPlanInput,
} from "../src/execution-plan/graph.ts";
import { executeExecutionPlanIntegrate } from "../src/execution-plan/integrate-tool.ts";
import { materializeExecutionPlanWave } from "../src/execution-plan/materialize.ts";
import { readPersistedExecutionPlan } from "../src/execution-plan/persistence.ts";
import { applyExecutionPlanReview } from "../src/execution-plan/review-tool.ts";
import { executeExecutionPlanRun } from "../src/execution-plan/run-tool.ts";
import { loadState, mutateState } from "../src/state/store.ts";
import { fanoutPlan, seedReviewWave } from "./execution-plan-fixtures.ts";
import { makeHarness, taskPath } from "./test-harness.ts";

function markAcceptedWaveForOptionalPromotion(ctx: any, loopName: string): void {
	mutateState(ctx, loopName, (state) => {
		const plan = state.executionPlan!;
		const graph = state.executionGraph!;
		const wave = plan.waves.at(-1)!;
		const stage = graph.stages.find((candidate) => candidate.id === wave.stageId)!;
		wave.status = "integrating";
		stage.status = "awaiting_integration";
		const fanIn = graph.nodes.find((node) => node.id === stage.fanInNodeId);
		if (fanIn) fanIn.status = "ready";
		plan.status = "integrating";
	});
}

test("execution plan exposes a prerequisite wave followed by the full independent fan-out", () => {
	const plan = createExecutionPlan(fanoutPlan(), "2026-01-01T00:00:00.000Z");
	assert.deepEqual(readyExecutionPlanNodeIds(plan), ["interfaces"]);
	plan.nodes.find((node) => node.id === "interfaces")!.status = "integrated";
	refreshExecutionPlan(plan);
	assert.deepEqual(readyExecutionPlanNodeIds(plan), ["api", "storage", "ui"]);
	assert.equal(plan.maxConcurrency, 3);
	assert.equal(plan.nodes.find((node) => node.id === "api")?.maxAttempts, 2);
	assert.equal(plan.nodes.find((node) => node.id === "api")?.kind, "work");
});

test("synthetic critical-path model improves when independent leaves fan out", () => {
	const prerequisiteMinutes = 4;
	const independentLeafMinutes = [9, 6, 3];
	const serialMinutes = prerequisiteMinutes + independentLeafMinutes.reduce((sum, duration) => sum + duration, 0);
	const stardockMinutes = prerequisiteMinutes + Math.max(...independentLeafMinutes);
	assert.equal(serialMinutes, 22);
	assert.equal(stardockMinutes, 13);
	assert.ok(stardockMinutes < serialMinutes);
});

test("execution plan rejects missing dependencies and cycles with actionable diagnostics", () => {
	const missing = fanoutPlan();
	missing.nodes[1].dependsOn = ["missing"];
	assert.match(validateExecutionPlanInput(missing).errors.join("\n"), /depends on missing node "missing"/);

	const cyclic = fanoutPlan();
	cyclic.nodes[0].dependsOn = ["api"];
	assert.match(validateExecutionPlanInput(cyclic).errors.join("\n"), /dependency cycle/);

	const whitespaceDuplicate = fanoutPlan();
	whitespaceDuplicate.nodes[1].id = ` ${whitespaceDuplicate.nodes[0].id} `;
	assert.match(validateExecutionPlanInput(whitespaceDuplicate).errors.join("\n"), /surrounding whitespace|Duplicate execution plan node id/);
});

test("execution plan requires conflicting independent ownership to become an explicit dependency", () => {
	const overlapping = fanoutPlan();
	overlapping.nodes[2].writes = ["src/api/models"];
	assert.match(validateExecutionPlanInput(overlapping).errors.join("\n"), /overlapping writes.*add a dependency/);

	overlapping.nodes[2].dependsOn = ["api"];
	assert.equal(validateExecutionPlanInput(overlapping).ok, true);
});

test("execution plan rejects independent resource conflicts but permits explicit allocation", () => {
	const conflicting = fanoutPlan();
	conflicting.nodes[1].resourceClaims = [{ key: "db:test", mode: "exclusive" }];
	conflicting.nodes[2].resourceClaims = [{ key: "db:test", mode: "exclusive" }];
	assert.match(validateExecutionPlanInput(conflicting).errors.join("\n"), /conflicting resource claim "db:test"/);

	conflicting.nodes[1].resourceClaims = [{ key: "port", mode: "shared", value: "4101" }];
	conflicting.nodes[2].resourceClaims = [{ key: "port", mode: "shared", value: "4102" }];
	assert.equal(validateExecutionPlanInput(conflicting).ok, true);
});

test("materialization keeps lossy-looking plan node ids distinct", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-execution-identities-"));
	try {
		const input = fanoutPlan();
		input.nodes = [
			{ ...input.nodes[1], id: "api/models", dependsOn: [], writes: ["src/api"] },
			{ ...input.nodes[2], id: "api-models", dependsOn: [], writes: ["src/storage"] },
		];
		const { id: _id, ...toolInput } = input;
		const { tools, ctx } = makeHarness(cwd);
		await tools.get("stardock_plan").execute("plan-call", { ...toolInput, name: "identity-plan" }, undefined, undefined, ctx);
		const wave = await materializeExecutionPlanWave(ctx, "identity-plan", undefined, {
			inspectWorktree: async () => ({ worktreePath: cwd, repositoryCommonDir: path.join(cwd, ".git"), headCommit: "d".repeat(40), branchRef: "refs/heads/main", clean: true }),
		} as any);
		assert.equal(new Set(wave.nodeIds).size, 2);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("execution plan snapshot returns advisory governor options without internal graph protocol", () => {
	const plan = createExecutionPlan(fanoutPlan());
	const snapshot = summarizeExecutionPlan(plan);
	assert.equal(snapshot.nextAction, "run");
	assert.deepEqual(snapshot.availableActions, ["run", "plan", "complete"]);
	assert.deepEqual(snapshot.readyNodeIds, ["interfaces"]);
	assert.equal(snapshot.counts.ready, 1);
	assert.equal("contractDigest" in snapshot, false);
	assert.equal("expectedGraphRevision" in snapshot, false);
});

test("persisted execution plans round-trip and malformed nested state is rejected", () => {
	const plan = createExecutionPlan(fanoutPlan());
	assert.deepEqual(readPersistedExecutionPlan(plan), plan);
	const malformed = structuredClone(plan) as unknown as { nodes: Array<Record<string, unknown>> };
	malformed.nodes[0].resourceClaims = [{ key: "db", mode: "invalid" }];
	assert.equal(readPersistedExecutionPlan(malformed), undefined);
	const cyclic = structuredClone(plan);
	cyclic.nodes[0].dependsOn = [cyclic.nodes[1].id];
	assert.equal(readPersistedExecutionPlan(cyclic), undefined);
});

test("stardock_plan creates canonical plan, brief, criterion, and compact status without start ceremony", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-execution-plan-tool-"));
	try {
		const { tools, ctx } = makeHarness(cwd);
		const { id: _id, ...input } = fanoutPlan();
		const result = await tools.get("stardock_plan").execute("plan-call", { ...input, name: "auth-redesign" }, undefined, undefined, ctx);
		assert.equal(result.isError, undefined);
		assert.match(result.content[0].text, /Suggested action: stardock_run/);
		const state = loadState(ctx, "auth-redesign");
		assert.ok(state?.executionPlan);
		assert.equal(state.executionPlan.nodes.length, 4);
		assert.equal(state.briefs.length, 4);
		assert.equal(state.criterionLedger.criteria.length, 4);
		assert.equal(state.currentBriefId, undefined);
		assert.match(fs.readFileSync(taskPath(cwd, "auth-redesign"), "utf8"), /human-readable projection/);
		const status = await tools.get("stardock_status").execute("status-call", { name: "auth-redesign" }, undefined, undefined, ctx);
		assert.match(status.content[0].text, /Ready: interfaces/);
		assert.equal("contractDigest" in status.details.plan, false);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("materialization and stardock_run dispatch the complete ready antichain", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-execution-fanout-"));
	try {
		const { id: _id, ...input } = fanoutPlan();
		input.nodes = input.nodes.filter((node) => node.id !== "interfaces").map((node) => ({ ...node, dependsOn: [] }));
		const { pi, tools, ctx } = makeHarness(cwd);
		await tools.get("stardock_plan").execute("plan-call", { ...input, name: "parallel-auth" }, undefined, undefined, ctx);
		const git = {
			inspectWorktree: async () => ({
				worktreePath: cwd,
				repositoryCommonDir: path.join(cwd, ".git"),
				headCommit: "a".repeat(40),
				branchRef: "refs/heads/main",
				clean: true,
			}),
		} as any;
		const materialized = await materializeExecutionPlanWave(ctx, "parallel-auth", undefined, git);
		assert.deepEqual(materialized.planNodeIds, ["api", "storage", "ui"]);
		assert.equal(materialized.nodeIds.length, 3);
		const afterMaterialize = loadState(ctx, "parallel-auth")!;
		assert.equal(afterMaterialize.executionGraph?.stages[0].maxConcurrency, 3);
		assert.equal(afterMaterialize.executionGraph?.stages[0].implementationNodeIds.length, 3);

		// Recreate because direct materialization intentionally leaves an active wave.
		fs.rmSync(path.join(cwd, ".stardock"), { recursive: true, force: true });
		await tools.get("stardock_plan").execute("plan-call-2", { ...input, name: "parallel-auth-run" }, undefined, undefined, ctx);
		const runtime = { ref: { currentLoop: "parallel-auth-run", sessionId: "test-session" }, updateUI() {} } as any;
		const result = await executeExecutionPlanRun(pi, runtime, {}, undefined, undefined, ctx, {
			gitAdapter: git,
			runReady: (async (_pi: any, _ctx: any, request: any) => {
				mutateState(_ctx, "parallel-auth-run", (candidate) => {
					candidate.executionGraph!.nodes.find((node) => node.id === request.nodeIds[0])!.attempts.push({
						id: "attempt-0", workerRunId: "run-0", baseCommit: "a".repeat(40), branchRef: "lane-0",
						laneCommits: [], validation: [], status: "needs_review", startedAt: new Date().toISOString(),
						worktreePath: path.join(cwd, "leased-lane"), repositoryCommonDir: path.join(cwd, ".git"),
						leaseHolder: "stardock:test", leaseDisposition: "held",
					});
				});
				return {
				ok: true,
				graphId: request.graphId,
				stageId: request.stageId,
				stateRevision: request.expectedGraphRevision,
				selectedNodeIds: [...(request.nodeIds ?? [])],
				lanes: (request.nodeIds ?? []).map((nodeId: string, index: number) => ({ nodeId, attemptId: `attempt-${index}`, workerRunId: `run-${index}`, status: "needs_review" as const, violations: [] })),
				counts: { needs_review: request.nodeIds?.length ?? 0 },
				setupFailed: false,
				cancelled: false,
				timedOut: false,
				};
			}) as any,
		});
		assert.equal(result.isError, undefined);
		assert.match(result.content[0].text, /3 isolated lane\(s\).*runId run-0/);
		assert.equal((result.details as any).lanes[0].workerRunId, "run-0");
		assert.deepEqual((result.details as any).plan.reviewRunIds, ["run-0", "run-1", "run-2"]);
		assert.match(result.content[0].text, /Suggested action: stardock_review/);
		assert.match(result.content[0].text, /Review these run IDs with stardock_review before attempting workspace cleanup/);
		assert.deepEqual(loadState(ctx, "parallel-auth-run")?.executionPlan?.nodes.map((node) => node.status), ["needs_review", "needs_review", "needs_review"]);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("interrupted mixed waves recover durable review evidence and retry automatic failures within budget", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-execution-mixed-recovery-"));
	try {
		const { id: _id, ...input } = fanoutPlan();
		input.nodes = input.nodes.slice(1, 3).map((node) => ({ ...node, dependsOn: [] }));
		const { pi, tools, ctx } = makeHarness(cwd);
		await tools.get("stardock_plan").execute("plan-call", { ...input, name: "mixed-recovery" }, undefined, undefined, ctx);
		await materializeExecutionPlanWave(ctx, "mixed-recovery", undefined, {
			inspectWorktree: async () => ({ worktreePath: cwd, repositoryCommonDir: path.join(cwd, ".git"), headCommit: "e".repeat(40), branchRef: "refs/heads/main", clean: true }),
		} as any);
		const runIds = seedReviewWave(ctx, "mixed-recovery");
		mutateState(ctx, "mixed-recovery", (state) => {
			const plan = state.executionPlan!;
			const graph = state.executionGraph!;
			const wave = plan.waves.at(-1)!;
			wave.status = "running";
			const stage = graph.stages.find((candidate) => candidate.id === wave.stageId)!;
			stage.status = "failed";
			graph.status = "blocked";
			const failedPlanNode = plan.nodes[1];
			failedPlanNode.status = "running";
			const failedExecutionNode = graph.nodes.find((node) => node.id === failedPlanNode.currentExecutionNodeId)!;
			failedExecutionNode.status = "failed";
			state.workerRuns.find((run) => run.id === runIds[1])!.status = "failed";
		});
		const runtime = { ref: { currentLoop: "mixed-recovery", sessionId: "test-session" }, updateUI() {} } as any;
		const recovered = await executeExecutionPlanRun(pi, runtime, {}, undefined, undefined, ctx);
		assert.equal(recovered.isError, true);
		assert.match(recovered.content[0].text, /Recovered durable results/);
		let state = loadState(ctx, "mixed-recovery")!;
		assert.deepEqual(state.executionPlan?.nodes.map((node) => node.status), ["needs_review", "needs_review"]);
		assert.deepEqual(state.executionPlan?.nodes.map((node) => node.attemptsUsed), [1, 1]);
		assert.equal(summarizeExecutionPlan(state.executionPlan!).nextAction, "review");
		const partial = applyExecutionPlanReview(ctx, "mixed-recovery", [{ runId: runIds[0], decision: "accept", rationale: "The successful lane evidence is useful." }]);
		assert.equal(partial.plan.nextAction, "review");
		const reviewed = applyExecutionPlanReview(ctx, "mixed-recovery", [{ runId: runIds[1], decision: "retry", rationale: "Retry the transport-failed lane." }]);
		assert.equal(reviewed.plan.nextAction, "run");
		state = loadState(ctx, "mixed-recovery")!;
		assert.equal(state.executionGraph?.stages[0].status, "contracts_ready");
		assert.equal(state.executionPlan?.nodes[1].status, "retry_ready");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("stardock_integrate hides merge, validation, finalize, and release protocol behind one call", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-execution-integrate-"));
	try {
		const { id: _id, ...input } = fanoutPlan();
		input.nodes = input.nodes.slice(1, 3).map((node) => ({ ...node, dependsOn: [] }));
		const { pi, tools, ctx } = makeHarness(cwd);
		await tools.get("stardock_plan").execute("plan-call", { ...input, name: "integrate-plan" }, undefined, undefined, ctx);
		await materializeExecutionPlanWave(ctx, "integrate-plan", undefined, {
			inspectWorktree: async () => ({ worktreePath: cwd, repositoryCommonDir: path.join(cwd, ".git"), headCommit: "a".repeat(40), branchRef: "refs/heads/main", clean: true }),
		} as any);
		const runIds = seedReviewWave(ctx, "integrate-plan");
		applyExecutionPlanReview(ctx, "integrate-plan", runIds.map((runId) => ({ runId, decision: "accept", rationale: "Accepted." })));
		markAcceptedWaveForOptionalPromotion(ctx, "integrate-plan");
		mutateState(ctx, "integrate-plan", (state) => {
			state.verificationArtifacts.push({ id: "legacy-unscoped", kind: "other", summary: "Unrelated legacy evidence", createdAt: "2026-01-01T00:00:00.000Z" });
		});
		const graph = loadState(ctx, "integrate-plan")!.executionGraph!;
		const stage = graph.stages[0];
		const laneHeads = ["b".repeat(40), "c".repeat(40)];
		let inspection = 0;
		const git = {
			inspectWorktree: async () => ({ worktreePath: cwd, repositoryCommonDir: path.join(cwd, ".git"), headCommit: laneHeads[Math.min(inspection++, 1)], branchRef: `refs/heads/${stage.integrationBranch}`, clean: true }),
			resolveBranch: async (_cwd: string, branch: string) => branch === stage.integrationBranch ? undefined : laneHeads[1],
		} as any;
		const runtime = { ref: { currentLoop: "integrate-plan", sessionId: "test-session" }, updateUI() {}, completeLoop() {} } as any;
		const commands = ["switch", "merge-a", "merge-b"].map((label) => ({ command: "git", args: [label], cwd }));
		const result = await executeExecutionPlanIntegrate(pi, runtime, {}, undefined, ctx, {
			gitAdapter: git,
			createPlan: (async () => ({
				ok: true,
				graphId: graph.id,
				stageId: stage.id,
				graphRevision: graph.revision,
				expectedParent: { branch: "main", branchRef: "refs/heads/main", headCommit: "a".repeat(40), worktreePath: cwd, repositoryCommonDir: path.join(cwd, ".git") },
				integration: { branch: stage.integrationBranch, branchRef: `refs/heads/${stage.integrationBranch}`, baseCommit: "a".repeat(40) },
				acceptedLanes: stage.implementationNodeIds.map((nodeId, index) => ({ nodeId, attemptId: `attempt-${index}`, workerRunId: runIds[index], branchRef: `lane-${index}`, baseCommit: "a".repeat(40), headCommit: `${index + 1}`.repeat(40), commits: [`${index + 1}`.repeat(40)], changedPaths: [], writes: [], resourceClaims: [] })),
				preflight: { parentClean: true, integrationBranchAvailable: true, laneBranchesExact: true, sourceAncestryValid: true, pathConflicts: [], resourceConflicts: [], conflictPolicy: "abort" },
				commands,
			})) as any,
			prepare: (async (_ctx: any, args: any) => {
				assert.equal(args.validation.length, 2);
				return { ok: true, graphId: graph.id, stageId: stage.id, stateRevision: graph.revision + 1, prepareToken: "token", preparedHeadCommit: laneHeads[1], expectedParentHead: "a".repeat(40), fastForwardCommands: [{ command: "git", args: ["ff"], cwd }] };
			}) as any,
			record: (async () => ({ ok: true, idempotent: false, graphId: graph.id, stageId: stage.id, stateRevision: graph.revision + 2, parentResultCommit: laneHeads[1] })) as any,
			release: (async () => ({ ok: true, graphId: graph.id, stageId: stage.id, stateRevision: graph.revision + 3, releasedAttemptIds: ["attempt-1", "attempt-2"], preserved: [], ownershipReleased: true })) as any,
			runCommand: async () => ({ code: 0, stdout: "passed", stderr: "" }),
		});
		assert.equal(result.isError, undefined);
		assert.match(result.content[0].text, /original workspace/);
		const final = loadState(ctx, "integrate-plan")!;
		assert.equal(final.executionPlan?.status, "completed");
		assert.deepEqual(final.executionPlan?.nodes.map((node) => node.status), ["integrated", "integrated"]);
		assert.equal(final.finalVerificationReports[0].status, "passed");
		assert.equal(final.finalVerificationReports[0].artifactIds.includes("legacy-unscoped"), false);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("stardock_integrate removes only a verified generated stale branch before retrying", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-execution-stale-integration-"));
	try {
		const { id: _id, ...input } = fanoutPlan();
		input.nodes = [{ ...input.nodes[0] }];
		const { pi, tools, ctx } = makeHarness(cwd);
		await tools.get("stardock_plan").execute("plan-call", { ...input, name: "stale-integration" }, undefined, undefined, ctx);
		await materializeExecutionPlanWave(ctx, "stale-integration", undefined, {
			inspectWorktree: async () => ({ worktreePath: cwd, repositoryCommonDir: path.join(cwd, ".git"), headCommit: "a".repeat(40), branchRef: "refs/heads/main", clean: true }),
		} as any);
		const [runId] = seedReviewWave(ctx, "stale-integration");
		applyExecutionPlanReview(ctx, "stale-integration", [{ runId, decision: "accept", rationale: "Accepted." }]);
		markAcceptedWaveForOptionalPromotion(ctx, "stale-integration");
		const initial = mutateState(ctx, "stale-integration", (state) => {
			const node = state.executionGraph!.nodes.find((candidate) => candidate.id === state.executionGraph!.stages[0].implementationNodeIds[0])!;
			node.attempts[0].headCommit = "1".repeat(40);
			node.attempts[0].clean = true;
		});
		const graph = initial.executionGraph!;
		const stage = graph.stages[0];
		const base = stage.integrationBaseCommit;
		const laneHead = "1".repeat(40);
		const mergeHead = "f".repeat(40);
		let staleBranchExists = true;
		let currentRef = `refs/heads/${stage.integrationBranch}`;
		const commandArgs: string[][] = [];
		const git = {
			resolveBranch: async (_cwd: string, branch: string) => branch === stage.integrationBranch ? (staleBranchExists ? mergeHead : undefined) : base,
			inspectWorktree: async () => ({ worktreePath: cwd, repositoryCommonDir: path.join(cwd, ".git"), headCommit: mergeHead, branchRef: currentRef, clean: true }),
			firstParentCommits: async () => [mergeHead],
			commitParents: async () => [base, laneHead],
		} as any;
		const runtime = { ref: { currentLoop: "stale-integration", sessionId: "test-session" }, updateUI() {}, completeLoop() {} } as any;
		const result = await executeExecutionPlanIntegrate(pi, runtime, {}, undefined, ctx, {
			gitAdapter: git,
			createPlan: (async () => ({
				ok: true,
				graphId: graph.id,
				stageId: stage.id,
				graphRevision: graph.revision,
				expectedParent: { branch: "main", branchRef: "refs/heads/main", headCommit: base, worktreePath: cwd, repositoryCommonDir: path.join(cwd, ".git") },
				integration: { branch: stage.integrationBranch, branchRef: `refs/heads/${stage.integrationBranch}`, baseCommit: base },
				acceptedLanes: [{ nodeId: stage.implementationNodeIds[0], attemptId: "review-attempt-1", workerRunId: runId, branchRef: "lane-1", baseCommit: base, headCommit: laneHead, commits: [laneHead], changedPaths: [], writes: [], resourceClaims: [] }],
				preflight: { parentClean: true, integrationBranchAvailable: true, laneBranchesExact: true, sourceAncestryValid: true, pathConflicts: [], resourceConflicts: [], conflictPolicy: "abort" },
				commands: [{ command: "git", args: ["switch-integration"], cwd }, { command: "git", args: ["merge-lane"], cwd }],
			})) as any,
			prepare: (async () => ({ ok: true, graphId: graph.id, stageId: stage.id, stateRevision: graph.revision + 1, prepareToken: "token", preparedHeadCommit: mergeHead, expectedParentHead: base, fastForwardCommands: [] })) as any,
			record: (async () => ({ ok: true, idempotent: false, graphId: graph.id, stageId: stage.id, stateRevision: graph.revision + 2, parentResultCommit: mergeHead })) as any,
			release: (async () => ({ ok: true, graphId: graph.id, stageId: stage.id, stateRevision: graph.revision + 3, releasedAttemptIds: ["review-attempt-1"], preserved: [], ownershipReleased: true })) as any,
			runCommand: async (command) => {
				commandArgs.push(command.args);
				if (command.args.includes("main")) currentRef = "refs/heads/main";
				if (command.args.includes("-D")) staleBranchExists = false;
				return { code: 0, stdout: "passed", stderr: "" };
			},
		});
		assert.equal(result.isError, undefined, result.content[0].text);
		assert.equal(staleBranchExists, false);
		assert.equal(commandArgs.some((args) => args.includes("-D") && args.includes(stage.integrationBranch)), true);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("prepared integration recovery skips fast-forward commands after the parent already advanced", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-execution-prepared-recovery-"));
	try {
		const { id: _id, ...input } = fanoutPlan();
		input.nodes = [{ ...input.nodes[0] }];
		const { pi, tools, ctx } = makeHarness(cwd);
		await tools.get("stardock_plan").execute("plan-call", { ...input, name: "prepared-recovery" }, undefined, undefined, ctx);
		await materializeExecutionPlanWave(ctx, "prepared-recovery", undefined, {
			inspectWorktree: async () => ({ worktreePath: cwd, repositoryCommonDir: path.join(cwd, ".git"), headCommit: "a".repeat(40), branchRef: "refs/heads/main", clean: true }),
		} as any);
		const [runId] = seedReviewWave(ctx, "prepared-recovery");
		applyExecutionPlanReview(ctx, "prepared-recovery", [{ runId, decision: "accept", rationale: "Accepted." }]);
		markAcceptedWaveForOptionalPromotion(ctx, "prepared-recovery");
		const state = mutateState(ctx, "prepared-recovery", (candidate) => {
			const stage = candidate.executionGraph!.stages[0];
			stage.status = "integration_prepared";
			(stage as any).integration = {
				status: "prepared",
				expectedParentHead: "a".repeat(40),
				integrationBranch: stage.integrationBranch,
				laneMerges: [{ nodeId: stage.implementationNodeIds[0], sourceHeadCommit: "1".repeat(40), mergeCommit: "f".repeat(40) }],
				fanInCommits: [],
				integrationHeadCommit: "f".repeat(40),
				prepareTokenDigest: "digest",
				preparedAt: "2026-01-01T00:00:00.000Z",
				validation: [{ command: "npm test", result: "passed", summary: "passed" }],
			};
		});
		const graph = state.executionGraph!;
		const stage = graph.stages[0];
		let commandCount = 0;
		const runtime = { ref: { currentLoop: "prepared-recovery", sessionId: "test-session" }, updateUI() {}, completeLoop() {} } as any;
		const result = await executeExecutionPlanIntegrate(pi, runtime, {}, undefined, ctx, {
			gitAdapter: { resolveBranch: async () => "f".repeat(40) } as any,
			reissue: (async () => ({ ok: true, graphId: graph.id, stageId: stage.id, stateRevision: graph.revision + 1, prepareToken: "reissued", preparedHeadCommit: "f".repeat(40), expectedParentHead: "a".repeat(40), parentAlreadyFastForwarded: true, fastForwardCommands: [{ command: "git", args: ["must-not-run"], cwd }] })) as any,
			record: (async () => ({ ok: true, idempotent: false, graphId: graph.id, stageId: stage.id, stateRevision: graph.revision + 2, parentResultCommit: "f".repeat(40) })) as any,
			release: (async () => ({ ok: true, graphId: graph.id, stageId: stage.id, stateRevision: graph.revision + 3, releasedAttemptIds: ["attempt-1"], preserved: [], ownershipReleased: true })) as any,
			runCommand: async () => { commandCount += 1; return { code: 0, stdout: "", stderr: "" }; },
		});
		assert.equal(result.isError, undefined, result.content[0].text);
		assert.equal(commandCount, 0);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("session startup automatically preserves the tool surface required by an active legacy loop", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-execution-legacy-resume-"));
	try {
		const { tools, activeTools, commands, handlers, ctx } = makeHarness(cwd);
		await tools.get("stardock_start").execute("legacy-start", { name: "legacy-resume", taskContent: "# Legacy task\n", maxIterations: 2 }, undefined, undefined, ctx);
		for (const handler of handlers.get("session_start") ?? []) await handler({ reason: "startup" }, ctx);
		assert.equal(activeTools.has("stardock_done"), true);
		assert.equal(activeTools.has("stardock_worker"), true);
		assert.equal(activeTools.has("stardock_plan"), true);
		await commands.get("stardock").handler("stop", ctx);
		for (const handler of handlers.get("session_start") ?? []) await handler({ reason: "new-session" }, ctx);
		assert.equal(activeTools.has("stardock_done"), false);
		await commands.get("stardock").handler("resume legacy-resume", ctx);
		assert.equal(activeTools.has("stardock_done"), true, "interactive legacy resume must restore its required tools before queuing the prompt");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("session startup exposes the governor-owned execution surface and graph-first prompts", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-execution-surface-"));
	try {
		const { tools, activeTools, commands, handlers, notifications, ctx } = makeHarness(cwd);
		for (const handler of handlers.get("session_start") ?? []) await handler({ reason: "startup" }, ctx);
		assert.deepEqual([...activeTools].filter((name) => name.startsWith("stardock_")).sort(), ["stardock_complete", "stardock_integrate", "stardock_plan", "stardock_recover", "stardock_review", "stardock_run", "stardock_status"]);
		assert.ok(commands.has("stardock-legacy"));
		await commands.get("stardock-legacy").handler("on", ctx);
		assert.equal(activeTools.has("stardock_worker"), true);
		for (const handler of handlers.get("session_start") ?? []) await handler({ reason: "switch" }, ctx);
		assert.equal(activeTools.has("stardock_worker"), false, "legacy activation must not leak into the next session");
		await commands.get("stardock-legacy").handler("off", ctx);
		assert.equal(activeTools.has("stardock_worker"), false);

		const { id: _id, ...input } = fanoutPlan();
		await tools.get("stardock_plan").execute("plan-call", { ...input, name: "surface-plan" }, undefined, undefined, ctx);
		await commands.get("stardock").handler("view surface-plan", ctx);
		assert.match(notifications.at(-1) ?? "", /Result target: governor-reviewed node evidence/);
		const promptResults: string[] = [];
		for (const handler of handlers.get("before_agent_start") ?? []) {
			const result = await handler({ systemPrompt: "base" }, ctx);
			if (result?.systemPrompt) promptResults.push(result.systemPrompt);
		}
		assert.equal(promptResults.length, 1);
		assert.match(promptResults[0], /governor of a Stardock DAG/);
		assert.match(promptResults[0], /stardock_run once to execute the complete ready set/);
		assert.match(promptResults[0], /integration\/promotion as an explicit node/);
		assert.match(promptResults[0], /signals are advisory/);
		assert.doesNotMatch(promptResults[0], /serial mutable worker/);
		const completed = await tools.get("stardock_complete").execute("complete-plan", {}, undefined, undefined, ctx);
		assert.match(completed.content[0].text, /Completed Stardock loop.*by governor decision/);
		assert.match(completed.content[0].text, /Advisory warnings/);
		assert.equal(loadState(ctx, "surface-plan")?.status, "completed");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
