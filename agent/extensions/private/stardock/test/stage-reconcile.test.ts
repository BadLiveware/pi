import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { abandonStage, reconcileStageResources, releaseStage } from "../src/stages/reconcile.ts";
import { runReadyStage, type RunReadyAdapter } from "../src/stages/run-ready.ts";
import { stageOwnerPath } from "../src/state/paths.ts";
import type { TreehouseLease } from "../src/stages/treehouse-adapter.ts";
import { loadState } from "../src/state/store.ts";
import { FakeAdapter, startFiveLane } from "./stage-run-ready-test-support.ts";
import { statePath } from "./test-harness.ts";

async function completeFakeWave(cwd: string) {
	const harness = await startFiveLane(cwd);
	const setupAdapter = new FakeAdapter();
	let id = 0;
	await runReadyStage({ events: harness.events } as any, harness.ctx, {
		loopName: harness.loopName,
		graphId: harness.graph.id,
		stageId: harness.graph.stages[0].id,
		expectedGraphRevision: harness.graph.revision,
		sessionId: "reconcile-test",
	}, undefined, undefined, {
		adapter: setupAdapter,
		idFactory: () => `reconcile${++id}`,
		invokeWorker: async ({ node }) => ({ response: { requestId: node.id, result: { details: { results: [{ finalOutput: "done" }] } }, isError: false } }),
	});
	return { harness, setupAdapter };
}

function reservationKey(lease: { worktreePath?: string; repositoryCommonDir?: string; statusContextCwd?: string; leaseHolder?: string }): string {
	if (lease.worktreePath) return lease.worktreePath;
	return `${lease.statusContextCwd ?? lease.repositoryCommonDir ?? "no-repo"}::${lease.leaseHolder ?? "no-holder"}`;
}

class EvidenceAdapter implements RunReadyAdapter {
	readonly returned: string[] = [];
	readonly modes = new Map<string, "committed" | "unchanged" | "dirty" | "missing">();
	readonly reservations = new Map<string, "held" | "absent" | "ambiguous">();
	private readonly attempts: Map<string, { base: string; head: string; branch: string; commits: string[]; changedPaths: string[] }>;

	constructor(attempts: Map<string, { base: string; head: string; branch: string; commits: string[]; changedPaths: string[] }>) {
		this.attempts = attempts;
	}

	async leaseAndAnchor(): Promise<TreehouseLease> {
		throw new Error("not used");
	}

	async inspectLaneCompletion(lease: TreehouseLease) {
		const evidence = this.attempts.get(lease.worktreePath);
		if (!evidence || this.modes.get(lease.worktreePath) === "missing") throw new Error("worktree missing");
		const mode = this.modes.get(lease.worktreePath) ?? "committed";
		let headCommit = evidence.head;
		let laneCommits = evidence.commits;
		let changedPaths = evidence.changedPaths;
		if (mode === "unchanged") {
			headCommit = evidence.base;
			laneCommits = [];
			changedPaths = [];
		}
		return { headCommit, branchRef: `refs/heads/${evidence.branch}`, clean: mode !== "dirty", baseIsAncestor: true, laneCommits, changedPaths };
	}

	async inspectLeaseReservation(lease: { worktreePath?: string; repositoryCommonDir?: string; statusContextCwd?: string; leaseHolder?: string }) {
		const state = this.reservations.get(reservationKey(lease)) ?? "held";
		let reason = "fake pool still reports the exact worktree lease";
		if (!lease.worktreePath && lease.leaseHolder) reason = `fake pool still reports the exact holder ${lease.leaseHolder}`;
		if (state === "absent") reason = "fake pool is empty for the exact holder/path evidence";
		if (state === "ambiguous") reason = "fake pool still has conflicting holder/path evidence";
		return {
			state,
			poolPath: "/fake/pool",
			reason,
			entries: [],
			holderEntries: [],
			statusStdout: "",
		};
	}

	async runValidationCommands() {
		return [];
	}

	async returnLease(input: { lease: TreehouseLease }): Promise<void> {
		this.returned.push(input.lease.worktreePath);
	}
}

function evidenceAdapter(cwd: string, loopName: string): EvidenceAdapter {
	const state = loadState({ cwd } as any, loopName);
	const attempts = new Map<string, { base: string; head: string; branch: string; commits: string[]; changedPaths: string[] }>();
	for (const attempt of state?.executionGraph?.nodes.flatMap((node) => node.attempts) ?? []) {
		if (!attempt.worktreePath || !attempt.headCommit) continue;
		attempts.set(attempt.worktreePath, { base: attempt.baseCommit, head: attempt.headCommit, branch: attempt.branchRef, commits: attempt.laneCommits, changedPaths: attempt.changedPaths ?? [] });
	}
	return new EvidenceAdapter(attempts);
}

function rewriteState(cwd: string, loopName: string, update: (raw: any) => void): void {
	const filePath = statePath(cwd, loopName);
	const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
	update(raw);
	fs.writeFileSync(filePath, JSON.stringify(raw, null, 2));
}

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

test("abandon persists rationale and approval and release retry only clears exact stale owner evidence", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stage-owner-cleanup-"));
	try {
		const { harness } = await completeFakeWave(cwd);
		const adapter = evidenceAdapter(cwd, harness.loopName);
		const ownerFile = stageOwnerPath(harness.ctx, harness.loopName);
		const abandoned = await abandonStage(harness.ctx, {
			loopName: harness.loopName,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: loadState(harness.ctx, harness.loopName)?.executionGraph?.revision as number,
			rationale: "human approved cleanup",
			approvalRef: "ticket-123",
		}, undefined, adapter);
		const afterAbandon = loadState(harness.ctx, harness.loopName)?.executionGraph;
		assert.deepEqual(afterAbandon?.stages[0].abandonment, {
			rationale: "human approved cleanup",
			approvalRef: "ticket-123",
			abandonedAt: afterAbandon?.stages[0].abandonment?.abandonedAt,
		});

		const firstRelease = await releaseStage(harness.ctx, {
			loopName: harness.loopName,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: abandoned.stateRevision,
		}, undefined, adapter);
		assert.equal(firstRelease.ownershipReleased, true);
		const releasedState = loadState(harness.ctx, harness.loopName)?.executionGraph;
		assert.equal(releasedState?.ownership, undefined);
		assert.ok(releasedState?.stages[0].terminalOwnershipCleanup);
		const exactOwner = {
			version: 1,
			status: "active",
			graphId: releasedState?.stages[0].terminalOwnershipCleanup?.graphId,
			stageId: releasedState?.stages[0].terminalOwnershipCleanup?.stageId,
			sessionId: releasedState?.stages[0].terminalOwnershipCleanup?.sessionId,
			pid: releasedState?.stages[0].terminalOwnershipCleanup?.pid,
			tokenDigest: releasedState?.stages[0].terminalOwnershipCleanup?.tokenDigest,
			expectedGraphRevision: releasedState?.stages[0].terminalOwnershipCleanup?.stateRevision,
			acquiredAt: releasedState?.stages[0].terminalOwnershipCleanup?.acquiredAt,
			heartbeatAt: releasedState?.stages[0].terminalOwnershipCleanup?.heartbeatAt,
			stateRevision: releasedState?.stages[0].terminalOwnershipCleanup?.stateRevision,
		};

		const mismatched = { ...exactOwner, tokenDigest: "9".repeat(64) };
		fs.writeFileSync(ownerFile, JSON.stringify(mismatched, null, 2));
		await assert.rejects(() => releaseStage(harness.ctx, {
			loopName: harness.loopName,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: releasedState?.revision as number,
		}, undefined, adapter), /terminal ownership cleanup/);

		fs.writeFileSync(ownerFile, JSON.stringify(exactOwner, null, 2));
		const retried = await releaseStage(harness.ctx, {
			loopName: harness.loopName,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: releasedState?.revision as number,
		}, undefined, adapter);
		assert.equal(retried.ownershipReleased, true);
		assert.equal(fs.existsSync(ownerFile), false);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("repeat abandonment is immutable and terminal cleanup enforces the recorded revision", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stage-abandon-repeat-"));
	try {
		const { harness } = await completeFakeWave(cwd);
		const adapter = evidenceAdapter(cwd, harness.loopName);
		const first = await abandonStage(harness.ctx, {
			loopName: harness.loopName,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: loadState(harness.ctx, harness.loopName)?.executionGraph?.revision as number,
			rationale: "cleanup once",
			approvalRef: "ticket-456",
		}, undefined, adapter);
		const repeated = await abandonStage(harness.ctx, {
			loopName: harness.loopName,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: first.stateRevision,
			rationale: "cleanup once",
			approvalRef: "ticket-456",
		}, undefined, adapter);
		assert.equal(repeated.stateRevision, first.stateRevision);
		await assert.rejects(() => abandonStage(harness.ctx, {
			loopName: harness.loopName,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: first.stateRevision,
			rationale: "different rationale",
			approvalRef: "ticket-456",
		}, undefined, adapter), /immutable/);

		const released = await releaseStage(harness.ctx, {
			loopName: harness.loopName,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: first.stateRevision,
		}, undefined, adapter);
		assert.equal(released.ownershipReleased, true);
		const afterRelease = loadState(harness.ctx, harness.loopName)?.executionGraph;
		assert.ok(afterRelease?.stages[0].terminalOwnershipCleanup);
		const cleanup = afterRelease?.stages[0].terminalOwnershipCleanup;
		fs.writeFileSync(stageOwnerPath(harness.ctx, harness.loopName), JSON.stringify({
			version: 1,
			status: "active",
			graphId: cleanup?.graphId,
			stageId: cleanup?.stageId,
			sessionId: cleanup?.sessionId,
			pid: cleanup?.pid,
			tokenDigest: cleanup?.tokenDigest,
			expectedGraphRevision: cleanup?.stateRevision,
			acquiredAt: cleanup?.acquiredAt,
			heartbeatAt: cleanup?.heartbeatAt,
			stateRevision: cleanup?.stateRevision,
		}, null, 2));
		rewriteState(cwd, harness.loopName, (raw) => {
			raw.executionGraph.stages[0].terminalOwnershipCleanup.stateRevision = raw.executionGraph.revision;
		});
		await assert.rejects(() => releaseStage(harness.ctx, {
			loopName: harness.loopName,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: loadState(harness.ctx, harness.loopName)?.executionGraph?.revision as number,
		}, undefined, adapter), /requires graph revision/);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
