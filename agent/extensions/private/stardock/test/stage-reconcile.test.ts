import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { reconcileStageResources, releaseStage } from "../src/stages/reconcile.ts";
import { loadState } from "../src/state/store.ts";
import { completeFakeWave, evidenceAdapter, reservationKey, rewriteState } from "./stage-reconcile-test-support.ts";
import { statePath } from "./test-harness.ts";

test("read-only reconcile inspects every unreleased durable attempt without changing durable bytes", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stage-reconcile-"));
	try {
		const { harness } = await completeFakeWave(cwd);
		rewriteState(cwd, harness.loopName, (raw) => {
			const lane = raw.executionGraph.nodes.find((node: any) => node.kind === "implementation");
			const latest = lane.attempts[0];
			lane.attempts.unshift({
				id: "historical-one",
				baseCommit: latest.baseCommit,
				branchRef: latest.branchRef,
				laneCommits: [latest.headCommit],
				headCommit: latest.headCommit,
				worktreePath: "/fake/historical-one",
				repositoryCommonDir: latest.repositoryCommonDir,
				leaseHolder: "historical-holder",
				leaseDisposition: "preserved",
				changedPaths: ["src/one/result.ts"],
				validation: [],
				status: "failed",
				startedAt: latest.startedAt,
				completedAt: latest.completedAt,
			});
		});
		const adapter = evidenceAdapter(cwd, harness.loopName);
		const attempts = loadState(harness.ctx, harness.loopName)?.executionGraph?.nodes.flatMap((node) => node.attempts) ?? [];
		adapter.modes.set(attempts.find((attempt) => attempt.id === "reconcile2")?.worktreePath as string, "unchanged");
		adapter.modes.set(attempts.find((attempt) => attempt.id === "reconcile3")?.worktreePath as string, "dirty");
		adapter.modes.set(attempts.find((attempt) => attempt.id === "reconcile4")?.worktreePath as string, "missing");
		const before = fs.readFileSync(statePath(cwd, harness.loopName));
		const result = await reconcileStageResources(harness.ctx, {
			loopName: harness.loopName,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: loadState(harness.ctx, harness.loopName)?.executionGraph?.revision,
		}, undefined, adapter);
		assert.equal(result.attempts.length, 6);
		assert.ok(result.attempts.some((attempt) => attempt.attemptId === "historical-one"));
		assert.deepEqual(fs.readFileSync(statePath(cwd, harness.loopName)), before);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("apply reconcile recovers release_pending already returned and fails closed on ambiguous pool evidence", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stage-reconcile-recovery-"));
	try {
		const { harness } = await completeFakeWave(cwd);
		const state = loadState(harness.ctx, harness.loopName)?.executionGraph;
		const implementationNodes = state?.nodes.filter((node) => node.kind === "implementation") ?? [];
		const first = implementationNodes[0]?.attempts[0];
		const second = implementationNodes[1]?.attempts[0];
		assert.ok(first?.worktreePath);
		assert.ok(second?.worktreePath);
		rewriteState(cwd, harness.loopName, (raw) => {
			const attempts = raw.executionGraph.nodes.flatMap((node: any) => node.attempts);
			attempts.find((attempt: any) => attempt.id === first?.id).leaseDisposition = "release_pending";
			attempts.find((attempt: any) => attempt.id === second?.id).leaseDisposition = "release_pending";
		});
		const adapter = evidenceAdapter(cwd, harness.loopName);
		adapter.reservations.set(first?.worktreePath as string, "absent");
		adapter.reservations.set(second?.worktreePath as string, "ambiguous");
		const result = await reconcileStageResources(harness.ctx, {
			loopName: harness.loopName,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: state?.revision,
			apply: true,
		}, undefined, adapter);
		assert.equal(result.attempts.find((attempt) => attempt.attemptId === first?.id)?.classification, "released");
		assert.equal(result.attempts.find((attempt) => attempt.attemptId === second?.id)?.classification, "failed");
		const after = loadState(harness.ctx, harness.loopName)?.executionGraph;
		const afterAttempts = after?.nodes.flatMap((node) => node.attempts) ?? [];
		assert.equal(afterAttempts.find((attempt) => attempt.id === first?.id)?.leaseDisposition, "released");
		assert.equal(afterAttempts.find((attempt) => attempt.id === second?.id)?.leaseDisposition, "preserved");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("release keeps incomplete setup identity unreleased until exact absence is proven", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stage-release-recovery-"));
	try {
		const { harness } = await completeFakeWave(cwd);
		rewriteState(cwd, harness.loopName, (raw) => {
			raw.executionGraph.stages[0].status = "abandoned";
			raw.executionGraph.stages[0].abandonment = { rationale: "cleanup", approvalRef: "approved-1", abandonedAt: "2026-07-21T00:00:00.000Z" };
			raw.executionGraph.nodes.find((node: any) => node.id === raw.executionGraph.stages[0].fanInNodeId).status = "abandoned";
			const lane = raw.executionGraph.nodes.find((node: any) => node.kind === "implementation");
			lane.attempts.push({
				id: "partial-one",
				baseCommit: lane.attempts[0].baseCommit,
				branchRef: lane.attempts[0].branchRef,
				laneCommits: [],
				worktreePath: "/fake/partial-one",
				leaseHolder: "partial-holder",
				leaseDisposition: "preserved",
				validation: [],
				status: "failed",
				startedAt: lane.attempts[0].startedAt,
				completedAt: lane.attempts[0].completedAt,
			});
		});
		const adapter = evidenceAdapter(cwd, harness.loopName);
		adapter.reservations.set("/fake/partial-one", "ambiguous");
		const released = await releaseStage(harness.ctx, {
			loopName: harness.loopName,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: loadState(harness.ctx, harness.loopName)?.executionGraph?.revision as number,
		}, undefined, adapter);
		assert.equal(released.releasedAttemptIds.length, 5);
		assert.equal(released.ownershipReleased, false);
		assert.deepEqual(released.preserved, [{ attemptId: "partial-one", reason: "fake pool still has conflicting holder/path evidence" }]);
		assert.ok(loadState(harness.ctx, harness.loopName)?.executionGraph?.ownership);

		adapter.reservations.set("/fake/partial-one", "absent");
		const reconciled = await reconcileStageResources(harness.ctx, {
			loopName: harness.loopName,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: loadState(harness.ctx, harness.loopName)?.executionGraph?.revision,
			apply: true,
		}, undefined, adapter);
		assert.equal(reconciled.attempts.find((attempt) => attempt.attemptId === "partial-one")?.classification, "released");

		const finalized = await releaseStage(harness.ctx, {
			loopName: harness.loopName,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: loadState(harness.ctx, harness.loopName)?.executionGraph?.revision as number,
		}, undefined, adapter);
		assert.equal(finalized.ownershipReleased, true);
		assert.equal(loadState(harness.ctx, harness.loopName)?.executionGraph?.ownership, undefined);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("holder-only tracked attempts reconcile and release from transient parent context without persisted repositoryCommonDir", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stage-holder-only-"));
	try {
		const { harness } = await completeFakeWave(cwd);
		rewriteState(cwd, harness.loopName, (raw) => {
			raw.executionGraph.stages[0].status = "abandoned";
			raw.executionGraph.stages[0].abandonment = { rationale: "cleanup", approvalRef: "approved-2", abandonedAt: "2026-07-21T00:00:00.000Z" };
			raw.executionGraph.nodes.find((node: any) => node.id === raw.executionGraph.stages[0].fanInNodeId).status = "abandoned";
			const lane = raw.executionGraph.nodes.find((node: any) => node.kind === "implementation");
			lane.attempts.push({
				id: "holder-only",
				baseCommit: lane.attempts[0].baseCommit,
				branchRef: lane.attempts[0].branchRef,
				laneCommits: [],
				leaseHolder: "holder-only-evidence",
				leaseDisposition: "preserved",
				validation: [],
				status: "failed",
				startedAt: lane.attempts[0].startedAt,
				completedAt: lane.attempts[0].completedAt,
			});
		});
		assert.equal(loadState(harness.ctx, harness.loopName)?.executionGraph?.nodes.flatMap((node) => node.attempts).find((attempt) => attempt.id === "holder-only")?.repositoryCommonDir, undefined);
		const adapter = evidenceAdapter(cwd, harness.loopName);
		const holderOnlyKey = reservationKey({ statusContextCwd: cwd, leaseHolder: "holder-only-evidence" });
		adapter.reservations.set(holderOnlyKey, "held");
		const held = await releaseStage(harness.ctx, {
			loopName: harness.loopName,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: loadState(harness.ctx, harness.loopName)?.executionGraph?.revision as number,
		}, undefined, adapter);
		assert.deepEqual(held.preserved, [{ attemptId: "holder-only", reason: "fake pool still reports the exact holder holder-only-evidence" }]);
		assert.equal(loadState(harness.ctx, harness.loopName)?.executionGraph?.ownership === undefined, false);

		adapter.reservations.set(holderOnlyKey, "ambiguous");
		const ambiguous = await releaseStage(harness.ctx, {
			loopName: harness.loopName,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: loadState(harness.ctx, harness.loopName)?.executionGraph?.revision as number,
		}, undefined, adapter);
		assert.deepEqual(ambiguous.preserved, [{ attemptId: "holder-only", reason: "fake pool still has conflicting holder/path evidence" }]);

		adapter.reservations.set(holderOnlyKey, "absent");
		const reconciled = await reconcileStageResources(harness.ctx, {
			loopName: harness.loopName,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: loadState(harness.ctx, harness.loopName)?.executionGraph?.revision,
			apply: true,
		}, undefined, adapter);
		assert.equal(reconciled.attempts.find((attempt) => attempt.attemptId === "holder-only")?.classification, "released");

		const released = await releaseStage(harness.ctx, {
			loopName: harness.loopName,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: loadState(harness.ctx, harness.loopName)?.executionGraph?.revision as number,
		}, undefined, adapter);
		assert.equal(released.ownershipReleased, true);
		assert.equal(loadState(harness.ctx, harness.loopName)?.executionGraph?.ownership, undefined);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("terminal reconcile preserves integrated and abandoned lifecycle statuses while updating lease disposition only", async () => {
	for (const stageStatus of ["integrated", "abandoned"] as const) {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stage-terminal-reconcile-"));
		try {
			const { harness } = await completeFakeWave(cwd);
			let terminalNodeStatus = "abandoned";
			if (stageStatus === "integrated") terminalNodeStatus = "integrated";
			rewriteState(cwd, harness.loopName, (raw) => {
				raw.executionGraph.stages[0].status = stageStatus;
				if (stageStatus === "abandoned") raw.executionGraph.stages[0].abandonment = { rationale: "cleanup", approvalRef: "approved-3", abandonedAt: "2026-07-21T00:00:00.000Z" };
				for (const node of raw.executionGraph.nodes.filter((candidate: any) => candidate.kind === "implementation" || candidate.id === raw.executionGraph.stages[0].fanInNodeId)) {
					node.status = terminalNodeStatus;
				}
				const implementationNodes = raw.executionGraph.nodes.filter((node: any) => node.kind === "implementation");
				implementationNodes[0].attempts[0].leaseDisposition = "release_pending";
				implementationNodes[1].attempts[0].leaseDisposition = "release_pending";
			});
			const adapter = evidenceAdapter(cwd, harness.loopName);
			const graphBefore = loadState(harness.ctx, harness.loopName)?.executionGraph;
			const implementationNodes = graphBefore?.nodes.filter((node) => node.kind === "implementation") ?? [];
			adapter.reservations.set(implementationNodes[0]?.attempts[0]?.worktreePath as string, "absent");
			adapter.reservations.set(implementationNodes[1]?.attempts[0]?.worktreePath as string, "ambiguous");
			await reconcileStageResources(harness.ctx, {
				loopName: harness.loopName,
				graphId: harness.graph.id,
				stageId: harness.graph.stages[0].id,
				expectedGraphRevision: graphBefore?.revision,
				apply: true,
			}, undefined, adapter);
			const after = loadState(harness.ctx, harness.loopName)?.executionGraph;
			const afterImplementation = after?.nodes.filter((node) => node.kind === "implementation") ?? [];
			assert.equal(after?.stages[0].status, stageStatus);
			assert.equal(afterImplementation[0]?.status, terminalNodeStatus);
			assert.equal(afterImplementation[1]?.status, terminalNodeStatus);
			assert.equal(afterImplementation[0]?.attempts[0]?.status, "needs_review");
			assert.equal(afterImplementation[1]?.attempts[0]?.status, "needs_review");
			assert.equal(afterImplementation[0]?.attempts[0]?.leaseDisposition, "released");
			assert.equal(afterImplementation[1]?.attempts[0]?.leaseDisposition, "preserved");
		} finally {
			fs.rmSync(cwd, { recursive: true, force: true });
		}
	}
});
