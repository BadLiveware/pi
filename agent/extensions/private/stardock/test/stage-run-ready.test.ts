import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { digestExecutionNodeContract, type ExecutionAttempt, type ExecutionNode } from "../src/stages/contracts.ts";
import { validateLaneResult } from "../src/stages/lane-result-validation.ts";
import { acquireStageOwnership, detachOwnedStages } from "../src/stages/ownership.ts";
import { cancelActiveStageRuns } from "../src/stages/run-ready-registry.ts";
import { runReadyStage } from "../src/stages/run-ready.ts";
import type { TreehouseLease } from "../src/stages/treehouse-adapter.ts";
import { loadState, mutateState } from "../src/state/store.ts";
import { reviewWorkerRun } from "../src/worker-runs.ts";
import { fiveNodeWaveFixture } from "./fixtures/execution-graphs.ts";
import { BlockingSetupAdapter, DuplicateLeaseAdapter, FakeAdapter, HungCleanupAdapter, PartialSetupAdapter, startFiveLane } from "./stage-run-ready-test-support.ts";

const BASE = "1111111111111111111111111111111111111111";

test("runReady precreates five durable lanes and observes bounded distinct-worktree concurrency", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stage-run-ready-"));
	try {
		const harness = await startFiveLane(cwd);
		const adapter = new FakeAdapter();
		let active = 0;
		let maximum = 0;
		const launchRunCounts: number[] = [];
		const launchReportStatuses: string[][] = [];
		const completionOrder: string[] = [];
		let id = 0;
		const result = await runReadyStage({ events: harness.events } as any, harness.ctx, {
			loopName: harness.loopName,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: harness.graph.revision,
			sessionId: "run-ready-test",
		}, undefined, undefined, {
			adapter,
			idFactory: () => `id${++id}`,
			invokeWorker: async ({ node, lease }) => {
				const launchState = loadState(harness.ctx, harness.loopName);
				launchRunCounts.push(launchState?.workerRuns.filter((run) => run.isolation === "treehouse").length ?? 0);
				launchReportStatuses.push(launchState?.workerReports.map((report) => report.status) ?? []);
				active += 1;
				maximum = Math.max(maximum, active);
				const index = adapter.leases.indexOf(lease);
				await new Promise((resolve) => setTimeout(resolve, (adapter.leases.length - index) * 3));
				active -= 1;
				completionOrder.push(node.id);
				return { response: { requestId: node.id, result: { details: { runId: `bridge-${node.id}`, results: [{ finalOutput: `implemented ${node.id}` }] } }, isError: false } };
			},
		});
		assert.equal(result.ok, true);
		assert.equal(result.counts.needs_review, 5);
		assert.equal(maximum, 2);
		assert.deepEqual(new Set(adapter.leases.map((lease) => lease.worktreePath)).size, 5);
		assert.deepEqual(launchRunCounts, [5, 5, 5, 5, 5]);
		assert.ok(launchReportStatuses[0].every((status) => status === "draft"));
		assert.notDeepEqual(completionOrder, harness.graph.stages[0].implementationNodeIds);
		const state = loadState(harness.ctx, harness.loopName);
		assert.equal(state?.workerRuns.filter((run) => run.isolation === "treehouse" && run.status === "needs_review").length, 5);
		assert.equal(state?.workerReports.length, 5);
		for (const nodeId of harness.graph.stages[0].implementationNodeIds) {
			const node: ExecutionNode | undefined = state?.executionGraph?.nodes.find((candidate) => candidate.id === nodeId);
			assert.equal(node?.status, "needs_review");
			assert.equal(node?.attempts.length, 1);
			assert.equal(node?.attempts[0].clean, true);
			assert.equal(node?.attempts[0].laneCommits.length, 1);
		}
		const implicitReview = reviewWorkerRun(harness.ctx, harness.loopName, {}, () => undefined);
		assert.equal(implicitReview.details.code, "run_id_required");
		for (const run of [...(state?.workerRuns ?? [])].reverse()) {
			const reviewed = reviewWorkerRun(harness.ctx, harness.loopName, { runId: run.id, reviewStatus: "accepted" }, () => undefined);
			assert.ok(reviewed.details.run);
			assert.equal(reviewed.details.run.status, "accepted");
		}
		const reviewedState = loadState(harness.ctx, harness.loopName);
		assert.equal(reviewedState?.executionGraph?.stages[0].status, "awaiting_integration");
		assert.ok(reviewedState?.executionGraph?.stages[0].implementationNodeIds.every((nodeId) => reviewedState.executionGraph?.nodes.find((node) => node.id === nodeId)?.status === "succeeded"));
		detachOwnedStages(harness.ctx, "run-ready-test");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("lane validation rejects dirty, uncommitted, contract, branch, write, resource, and validation violations", () => {
	const graph = fiveNodeWaveFixture();
	const node = graph.nodes.find((candidate) => candidate.kind === "implementation");
	assert.ok(node);
	const attempt: ExecutionAttempt = {
		id: "attempt",
		nodeContractDigest: digestExecutionNodeContract(node),
		stageContractDigest: graph.stages[0].contractDigest,
		writes: [],
		resourceClaims: [{ key: "port:test", mode: "exclusive", value: "1" }],
		validationCommands: ["npm test"],
		baseCommit: "2".repeat(40),
		branchRef: "expected",
		laneCommits: [],
		validation: [],
		startedAt: "2026-07-21T00:00:00.000Z",
	};
	const lease: TreehouseLease = { worktreePath: "/fake/lane", repositoryCommonDir: "/fake/.git", contractCommit: BASE, branchRef: "expected", leaseHolder: "holder" };
	const violations = validateLaneResult({ cwd: "/repo" } as any, node, attempt, BASE, graph.stages[0].contractDigest, lease, {
		headCommit: BASE,
		branchRef: "refs/heads/wrong",
		clean: false,
		baseIsAncestor: false,
		laneCommits: [],
		changedPaths: ["outside/file.ts"],
	}, [{ command: "npm test", result: "failed", summary: "failed" }]);
	assert.ok(violations.some((value) => value.includes("dirty")));
	assert.ok(violations.some((value) => value.includes("not an ancestor")));
	assert.ok(violations.some((value) => value.includes("no commit")));
	assert.ok(violations.some((value) => value.includes("outside node write")));
	assert.ok(violations.some((value) => value.includes("contract commit")));
	assert.ok(violations.some((value) => value.includes("lane branch")));
	assert.ok(violations.some((value) => value.includes("resource claims")));
	assert.ok(violations.some((value) => value.includes("validation")));
});

test("runReady remains blocked by an open current-workspace implementer", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stage-run-ready-current-workspace-"));
	try {
		const harness = await startFiveLane(cwd);
		mutateState(harness.ctx, harness.loopName, (state) => {
			state.workerRuns.push({
				id: "run-current",
				role: "implementer",
				status: "running",
				scope: "brief",
				briefId: state.briefs[0].id,
				isolation: "current_workspace",
				requestId: "current-workspace-request",
				agentName: "implementer",
				context: "fresh",
				outputMode: "inline",
				outputRefs: [],
				changedFiles: [],
				expectedMutation: true,
				allowDirtyWorkspace: false,
				startedAt: "2026-07-21T00:00:00.000Z",
				updatedAt: "2026-07-21T00:00:00.000Z",
			});
		});
		const adapter = new FakeAdapter();
		await assert.rejects(() => runReadyStage({ events: harness.events } as any, harness.ctx, {
			loopName: harness.loopName,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: harness.graph.revision,
			sessionId: "run-ready-current-workspace-test",
		}, undefined, undefined, { adapter }), /current-workspace implementer/);
		assert.equal(adapter.leases.length, 0);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("runReady preserves successful siblings when one worker fails", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stage-run-ready-worker-failure-"));
	try {
		const harness = await startFiveLane(cwd);
		const adapter = new FakeAdapter();
		let id = 0;
		let calls = 0;
		const result = await runReadyStage({ events: harness.events } as any, harness.ctx, {
			loopName: harness.loopName,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: harness.graph.revision,
			sessionId: "run-ready-worker-failure-test",
		}, undefined, undefined, {
			adapter,
			idFactory: () => `failure${++id}`,
			invokeWorker: async ({ node }) => {
				calls += 1;
				const failed = calls === 1;
				let finalOutput = "done";
				let errorText: string | undefined;
				if (failed) {
					finalOutput = "failed";
					errorText = "fake worker failure";
				}
				return { response: { requestId: node.id, result: { details: { results: [{ finalOutput }] } }, isError: failed, errorText } };
			},
		});
		assert.equal(result.counts.failed, 1);
		assert.equal(result.counts.needs_review, 4);
		assert.equal(calls, 5);
		detachOwnedStages(harness.ctx, "run-ready-worker-failure-test");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("runReady timeout cancels owned workers and settles every precreated lane as detached", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stage-run-ready-timeout-"));
	try {
		const harness = await startFiveLane(cwd);
		const adapter = new FakeAdapter();
		let id = 0;
		let invoked = 0;
		const result = await runReadyStage({ events: harness.events } as any, harness.ctx, {
			loopName: harness.loopName,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: harness.graph.revision,
			sessionId: "run-ready-timeout-test",
			timeoutMs: 5,
		}, undefined, undefined, {
			adapter,
			idFactory: () => `timeout${++id}`,
			invokeWorker: async ({ node, signal }) => {
				invoked += 1;
				if (!signal.aborted) await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
				return { response: { requestId: node.id, result: { details: { results: [{ error: "cancelled" }] } }, isError: true, errorText: "cancelled" } };
			},
		});
		assert.equal(result.ok, false);
		assert.equal(result.timedOut, true);
		assert.equal(result.cancelled, true);
		assert.equal(result.counts.detached, 5);
		assert.equal(invoked, 2);
		const state = loadState(harness.ctx, harness.loopName);
		assert.equal(state?.executionGraph?.stages[0].status, "detached");
		detachOwnedStages(harness.ctx, "run-ready-timeout-test");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("direct cancellation during lease setup is observed before fan-out and settles", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stage-run-ready-setup-cancel-"));
	try {
		const harness = await startFiveLane(cwd);
		const adapter = new BlockingSetupAdapter();
		const controller = new AbortController();
		let invoked = 0;
		const run = runReadyStage({ events: harness.events } as any, harness.ctx, {
			loopName: harness.loopName,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: harness.graph.revision,
			sessionId: "run-ready-setup-cancel-test",
		}, controller.signal, undefined, {
			adapter,
			invokeWorker: async () => {
				invoked += 1;
				throw new Error("must not run");
			},
		});
		await adapter.setupStarted;
		assert.ok(adapter.seenSignal);
		controller.abort(new Error("caller cancelled setup"));
		const result = await run;
		assert.equal(result.cancelled, true);
		assert.equal(result.setupFailed, true);
		assert.equal(result.counts.detached, 1);
		assert.equal(result.counts.not_started, 4);
		assert.equal(invoked, 0);
		const failedSetupAttempt = loadState(harness.ctx, harness.loopName)?.executionGraph?.nodes.find((node) => node.id === result.lanes[0].nodeId)?.attempts[0];
		assert.equal(failedSetupAttempt?.status, "detached");
		assert.match(failedSetupAttempt?.leaseHolder ?? "", /^stardock:/);
		assert.ok(failedSetupAttempt?.violations?.some((violation) => violation.includes("caller cancelled setup")));
		assert.equal(loadState(harness.ctx, harness.loopName)?.executionGraph?.stages[0].status, "detached");
		detachOwnedStages(harness.ctx, "run-ready-setup-cancel-test");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("session shutdown cancellation waits for setup settlement", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stage-run-ready-shutdown-setup-"));
	try {
		const harness = await startFiveLane(cwd);
		const adapter = new BlockingSetupAdapter();
		const sessionId = "run-ready-shutdown-setup-test";
		const run = runReadyStage({ events: harness.events } as any, harness.ctx, {
			loopName: harness.loopName,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: harness.graph.revision,
			sessionId,
		}, undefined, undefined, { adapter });
		await adapter.setupStarted;
		const [cancelled, result] = await Promise.all([cancelActiveStageRuns(harness.ctx, sessionId), run]);
		assert.deepEqual(cancelled, [harness.loopName]);
		assert.equal(result.cancelled, true);
		assert.equal(result.setupFailed, true);
		detachOwnedStages(harness.ctx, sessionId);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("runReady reuses only exact active local ownership at the supplied revision", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stage-run-ready-owner-reuse-"));
	try {
		const harness = await startFiveLane(cwd);
		const sessionId = "run-ready-owner-reuse-test";
		const acquisition = acquireStageOwnership(harness.ctx, {
			loopName: harness.loopName,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: harness.graph.revision,
			sessionId,
		});
		await assert.rejects(() => runReadyStage({ events: harness.events } as any, harness.ctx, {
			loopName: harness.loopName,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: acquisition.stateRevision,
			sessionId: "sibling-session",
		}, undefined, undefined, { adapter: new FakeAdapter() }), /exact active local ownership/);
		let id = 0;
		const result = await runReadyStage({ events: harness.events } as any, harness.ctx, {
			loopName: harness.loopName,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: acquisition.stateRevision,
			sessionId,
		}, undefined, undefined, {
			adapter: new FakeAdapter(),
			idFactory: () => `reuse${++id}`,
			invokeWorker: async ({ node }) => ({ response: { requestId: node.id, result: { details: { results: [{ finalOutput: "done" }] } }, isError: false } }),
		});
		assert.equal(result.counts.needs_review, 5);
		detachOwnedStages(harness.ctx, sessionId);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("runReady persists post-get partial lease identity for reconciliation", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stage-run-ready-partial-lease-"));
	try {
		const harness = await startFiveLane(cwd);
		const result = await runReadyStage({ events: harness.events } as any, harness.ctx, {
			loopName: harness.loopName,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: harness.graph.revision,
			sessionId: "run-ready-partial-lease-test",
		}, undefined, undefined, { adapter: new PartialSetupAdapter() });
		assert.equal(result.setupFailed, true);
		assert.equal(result.counts.detached, 1);
		const attempt = loadState(harness.ctx, harness.loopName)?.executionGraph?.nodes.find((node) => node.id === result.lanes[0].nodeId)?.attempts[0];
		assert.equal(attempt?.worktreePath, "/fake/partial-lease");
		assert.match(attempt?.leaseHolder ?? "", /^stardock:/);
		assert.ok(attempt?.violations?.includes("post-get inspection failed"));
		detachOwnedStages(harness.ctx, "run-ready-partial-lease-test");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("runReady preserves every attempt affected by a canonical duplicate lease identity", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stage-run-ready-duplicate-lease-"));
	try {
		const harness = await startFiveLane(cwd);
		const adapter = new DuplicateLeaseAdapter();
		let id = 0;
		const result = await runReadyStage({ events: harness.events } as any, harness.ctx, {
			loopName: harness.loopName,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: harness.graph.revision,
			sessionId: "run-ready-duplicate-lease-test",
		}, undefined, undefined, { adapter, idFactory: () => `duplicate${++id}` });
		assert.equal(result.setupFailed, true);
		assert.equal(result.counts.detached, 2);
		assert.equal(adapter.returned.length, 0);
		const affected = loadState(harness.ctx, harness.loopName)?.executionGraph?.nodes.filter((node) => node.attempts.some((attempt) => attempt.worktreePath === adapter.duplicatePath));
		assert.equal(affected?.length, 2);
		assert.ok(affected?.every((node) => node.status === "detached"));
		assert.ok(affected?.every((node) => node.attempts[0].violations?.some((violation) => violation.includes("duplicate lease identity"))));
		detachOwnedStages(harness.ctx, "run-ready-duplicate-lease-test");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("hung cleanup uses an independent bounded signal and cannot prevent settlement", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stage-run-ready-hung-cleanup-"));
	try {
		const harness = await startFiveLane(cwd);
		const adapter = new HungCleanupAdapter();
		adapter.failAt = 2;
		let id = 0;
		const result = await runReadyStage({ events: harness.events } as any, harness.ctx, {
			loopName: harness.loopName,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: harness.graph.revision,
			sessionId: "run-ready-hung-cleanup-test",
		}, undefined, undefined, { adapter, cleanupTimeoutMs: 5, idFactory: () => `cleanup${++id}` });
		assert.equal(result.setupFailed, true);
		assert.equal(result.counts.detached, 2);
		assert.equal(adapter.cleanupSignals.length, 2);
		assert.ok(adapter.cleanupSignals.every((cleanupSignal) => cleanupSignal.aborted));
		const state = loadState(harness.ctx, harness.loopName);
		const detachedAttempts = state?.executionGraph?.nodes.flatMap((node) => node.attempts).filter((attempt) => attempt.status === "detached") ?? [];
		assert.ok(detachedAttempts.every((attempt) => attempt.violations?.some((violation) => violation.includes("cleanup timed out"))));
		detachOwnedStages(harness.ctx, "run-ready-hung-cleanup-test");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("runReady launches no workers after partial setup failure and returns only prepared clean leases", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stage-run-ready-setup-"));
	try {
		const harness = await startFiveLane(cwd);
		const adapter = new FakeAdapter();
		adapter.failAt = 2;
		let invoked = 0;
		let id = 0;
		const result = await runReadyStage({ events: harness.events } as any, harness.ctx, {
			loopName: harness.loopName,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: harness.graph.revision,
			sessionId: "run-ready-setup-test",
		}, undefined, undefined, {
			adapter,
			idFactory: () => `setup${++id}`,
			invokeWorker: async () => {
				invoked += 1;
				throw new Error("must not run");
			},
		});
		assert.equal(result.setupFailed, true);
		assert.equal(invoked, 0);
		assert.equal(adapter.returned.length, 2);
		assert.equal(result.counts.failed, 3);
		assert.equal(result.counts.not_started, 2);
		const failedNode = loadState(harness.ctx, harness.loopName)?.executionGraph?.nodes.find((node) => node.id === result.lanes.find((lane) => lane.error === "fake acquisition failed")?.nodeId);
		assert.equal(failedNode?.attempts.length, 1);
		assert.match(failedNode?.attempts[0].leaseHolder ?? "", /^stardock:/);
		assert.ok(failedNode?.attempts[0].violations?.includes("fake acquisition failed"));
		detachOwnedStages(harness.ctx, "run-ready-setup-test");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
