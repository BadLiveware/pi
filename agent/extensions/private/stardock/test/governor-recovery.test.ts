import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { loadState, mutateState } from "../src/state/store.ts";
import { materializeExecutionPlanWave } from "../src/execution-plan/materialize.ts";
import { executeExecutionPlanReview } from "../src/execution-plan/review-tool.ts";
import { detachOwnedStages } from "../src/stages/ownership.ts";
import { releaseStage } from "../src/stages/reconcile.ts";
import { fanoutPlan, seedReviewWave } from "./execution-plan-fixtures.ts";
import { runAcquisitionChild, stageOwnerFile, startOwnershipGraph, stateMutexFile } from "./stage-ownership-test-support.ts";
import { makeHarness, statePath } from "./test-harness.ts";

async function ownedLoop(cwd: string, name: string) {
	const owner = await startOwnershipGraph(cwd, name);
	const acquired = await owner.tools.get("stardock_stage").execute("acquire", {
		action: "acquire", loopName: owner.name, graphId: owner.graph.id,
		stageId: owner.graph.stages[0].id, expectedGraphRevision: owner.graph.revision,
	}, undefined, undefined, owner.ctx);
	assert.equal(acquired.details.ok, true);
	const sibling = makeHarness(cwd);
	for (const handler of sibling.handlers.get("session_start") ?? []) await handler({}, sibling.ctx);
	return { owner, sibling };
}

function request(graphId: string, stageId: string, expectedGraphRevision: number) {
	return {
		action: "relinquishSettled", graphId, stageId, expectedGraphRevision,
		rationale: "The governor decided this terminal stage needs independent cleanup.",
		approvalRef: "user:recovery-request",
	};
}

test("a recovery tool call does not trigger a competing continuation prompt", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "stardock-governor-continuation-"));
	try {
		const { tools, handlers, messages, ctx } = makeHarness(cwd);
		const { id: _id, ...input } = fanoutPlan();
		await tools.get("stardock_plan").execute("plan", { ...input, name: "recover-continuation" }, undefined, undefined, ctx);
		const count = messages.length;
		for (const handler of handlers.get("agent_end") ?? []) await handler({ messages: [{ role: "assistant", content: [{ type: "toolCall", name: "stardock_recover" }] }] }, ctx);
		assert.equal(messages.length, count);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("governor can inspect and relinquish a foreign settled owner without releasing a lease", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "stardock-governor-recover-"));
	try {
		const { owner, sibling } = await ownedLoop(cwd, "Recover Settled");
		mutateState(owner.ctx, owner.name, (state) => {
			const stage = state.executionGraph!.stages[0];
			stage.status = "settled";
			state.executionGraph!.nodes.find((node) => node.id === stage.implementationNodeIds[0])!.attempts.push({
				id: "retained-lease", baseCommit: "a".repeat(40), branchRef: "refs/heads/retained",
				laneCommits: [], validation: [], startedAt: new Date().toISOString(),
				worktreePath: path.join(cwd, "retained"), leaseHolder: "stardock:retained",
				leaseDisposition: "held",
			});
		});
		const before = loadState(sibling.ctx, owner.name)!;
		const generic = await sibling.tools.get("stardock_done").execute("done", {}, undefined, undefined, sibling.ctx);
		assert.equal(generic.details.code, "non_owner");
		assert.ok(sibling.activeTools.has("stardock_recover"), "recovery is available in the primary tool surface");
		const inspect = await sibling.tools.get("stardock_recover").execute("inspect", { action: "inspect", name: owner.name }, undefined, undefined, sibling.ctx);
		assert.equal(inspect.details.ok, true);
		assert.equal(inspect.details.ownership.ownerProcess, "live");
		assert.match(inspect.content[0].text, /Mutation identity: graphId=.*stageId=.*expectedGraphRevision=\d+/);
		assert.match(inspect.content[0].text, /Available recovery actions:.*relinquishSettled/);
		assert.deepEqual(inspect.details.pendingLeaseAttemptIds, ["retained-lease"]);

		const stale = await sibling.tools.get("stardock_recover").execute("stale", {
			...request(owner.graph.id, owner.graph.stages[0].id, before.executionGraph!.revision - 1), name: owner.name,
		}, undefined, undefined, sibling.ctx);
		assert.equal(stale.details.ok, false);
		assert.equal(loadState(sibling.ctx, owner.name)?.executionGraph?.revision, before.executionGraph?.revision);
		const repaired = await sibling.tools.get("stardock_recover").execute("repair", {
			...request(owner.graph.id, owner.graph.stages[0].id, before.executionGraph!.revision), name: owner.name,
		}, undefined, undefined, sibling.ctx);
		assert.equal(repaired.details.ok, true, repaired.content[0].text);
		const after = loadState(sibling.ctx, owner.name)!;
		assert.equal(after.status, "active", "recovery does not make the semantic completion decision");
		assert.equal(after.executionGraph?.ownership, undefined);
		assert.equal(after.executionGraph?.stages[0].terminalOwnershipCleanup?.sessionId, before.executionGraph?.ownership?.sessionId);
		assert.equal(after.executionGraph?.nodes.find((node) => node.attempts.some((attempt) => attempt.id === "retained-lease"))?.attempts[0].leaseDisposition, "preserved");
		assert.equal(fs.existsSync(stageOwnerFile(cwd, owner.name)), false);
		assert.equal(after.recoveryEvents?.at(-1)?.approvalRef, "user:recovery-request");
		assert.equal(after.recoveryEvents?.at(-1)?.action, "relinquishSettled");
		assert.throws(() => mutateState(sibling.ctx, owner.name, (candidate) => { candidate.recoveryEvents = []; }), /Recovery events are append-only/);
		const blockedOwner = await owner.tools.get("stardock_stage").execute("heartbeat", { action: "heartbeat", loopName: owner.name }, undefined, undefined, owner.ctx);
		assert.notEqual(blockedOwner.details.ok, true);
		const completed = await sibling.tools.get("stardock_complete").execute("complete", {}, undefined, undefined, sibling.ctx);
		assert.match(completed.content[0].text, /Completed Stardock loop/);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("a fully decided plan can recover a detached prior session without claiming its lease returned", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "stardock-governor-detached-"));
	try {
		const { tools, ctx } = makeHarness(cwd);
		const { id: _id, ...input } = fanoutPlan();
		input.nodes = [input.nodes[0]];
		await tools.get("stardock_plan").execute("plan", { ...input, name: "recover-detached" }, undefined, undefined, ctx);
		const wave = await materializeExecutionPlanWave(ctx, "recover-detached", undefined, {
			inspectWorktree: async () => ({ worktreePath: cwd, repositoryCommonDir: path.join(cwd, ".git"), headCommit: "b".repeat(40), branchRef: "refs/heads/main", clean: true }),
		} as any);
		const acquisition = await tools.get("stardock_stage").execute("acquire", {
			action: "acquire", loopName: "recover-detached", graphId: wave.graphId,
			stageId: wave.stageId, expectedGraphRevision: wave.graphRevision,
		}, undefined, undefined, ctx);
		assert.equal(acquisition.details.ok, true);
		const [runId] = seedReviewWave(ctx, "recover-detached");
		mutateState(ctx, "recover-detached", (candidate) => {
			const attempt = candidate.executionGraph!.nodes.find((node) => node.attempts.some((item) => item.id === "review-attempt-1"))!.attempts[0];
			attempt.worktreePath = path.join(cwd, "retained-worktree");
			attempt.leaseHolder = "stardock:retained-detached";
			attempt.leaseDisposition = "held";
		});
		const runtime = { ref: { currentLoop: "recover-detached" }, updateUI() {} } as any;
		await executeExecutionPlanReview(runtime, { decisions: [{ runId, decision: "accept", rationale: "Evidence is sufficient." }] }, ctx, undefined, (async () => ({
			ok: false, graphId: wave.graphId, stageId: wave.stageId, stateRevision: 0, releasedAttemptIds: [],
			preserved: [{ attemptId: "review-attempt-1", reason: "Unverified lease." }], ownershipReleased: false,
		})) as any);
		assert.equal(loadState(ctx, "recover-detached")?.executionPlan?.status, "completed");
		detachOwnedStages(ctx, acquisition.details.acquisition.owner.sessionId);
		const detached = loadState(ctx, "recover-detached")!;
		assert.equal(detached.executionGraph?.stages[0].status, "detached");
		const sibling = makeHarness(cwd);
		for (const handler of sibling.handlers.get("session_start") ?? []) await handler({}, sibling.ctx);
		const inspection = await sibling.tools.get("stardock_recover").execute("inspect", { action: "inspect", name: "recover-detached" }, undefined, undefined, sibling.ctx);
		assert.ok(inspection.details.actions.some((action: string) => action.startsWith("relinquishSettled")));
		const recovered = await sibling.tools.get("stardock_recover").execute("relinquish", {
			...request(wave.graphId, wave.stageId, detached.executionGraph!.revision), name: "recover-detached",
		}, undefined, undefined, sibling.ctx);
		assert.equal(recovered.details.ok, true, recovered.content[0].text);
		const after = loadState(ctx, "recover-detached")!;
		assert.equal(after.executionGraph?.stages[0].status, "settled");
		assert.equal(after.executionGraph?.ownership, undefined);
		assert.equal(after.executionGraph?.nodes.find((node) => node.attempts.some((attempt) => attempt.id === "review-attempt-1"))?.attempts[0].leaseDisposition, "preserved");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("governor recovery can finish safe stage cleanup after relinquishing ownership", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "stardock-governor-release-"));
	try {
		const { owner, sibling } = await ownedLoop(cwd, "Recover Release");
		mutateState(owner.ctx, owner.name, (candidate) => { candidate.executionGraph!.stages[0].status = "settled"; });
		let state = loadState(sibling.ctx, owner.name)!;
		const relinquished = await sibling.tools.get("stardock_recover").execute("relinquish", {
			...request(owner.graph.id, owner.graph.stages[0].id, state.executionGraph!.revision), name: owner.name,
		}, undefined, undefined, sibling.ctx);
		assert.equal(relinquished.details.ok, true);
		mutateState(sibling.ctx, owner.name, (candidate) => {
			candidate.workerRuns.push({ id: "late-worker", requestId: "late-request", graphId: owner.graph.id, stageId: owner.graph.stages[0].id, status: "running" } as any);
		});
		state = loadState(sibling.ctx, owner.name)!;
		const rejected = await sibling.tools.get("stardock_recover").execute("unsafe-release", {
			action: "releaseLeases", name: owner.name, graphId: owner.graph.id,
			stageId: owner.graph.stages[0].id, expectedGraphRevision: state.executionGraph!.revision,
		}, undefined, undefined, sibling.ctx);
		assert.equal(rejected.details.code, "worker_running");
		mutateState(sibling.ctx, owner.name, (candidate) => { candidate.workerRuns.find((run) => run.id === "late-worker")!.status = "failed"; });
		state = loadState(sibling.ctx, owner.name)!;
		const inspected = await sibling.tools.get("stardock_recover").execute("inspect-release", { action: "inspect", name: owner.name }, undefined, undefined, sibling.ctx);
		assert.equal(inspected.details.stageId, owner.graph.stages[0].id);
		assert.ok(inspected.details.actions.some((action: string) => action.startsWith("releaseLeases")));
		const resourceRead = await sibling.tools.get("stardock_recover").execute("inspect-resources", {
			action: "reconcileResources", name: owner.name, graphId: owner.graph.id,
			stageId: owner.graph.stages[0].id, expectedGraphRevision: state.executionGraph!.revision,
		}, undefined, undefined, sibling.ctx);
		assert.equal(resourceRead.details.readOnly, true);
		assert.equal(resourceRead.details.stateRevision, state.executionGraph!.revision);
		const terminalApply = await sibling.tools.get("stardock_recover").execute("apply-terminal", {
			action: "reconcileResources", apply: true, name: owner.name, graphId: owner.graph.id,
			stageId: owner.graph.stages[0].id, expectedGraphRevision: state.executionGraph!.revision,
		}, undefined, undefined, sibling.ctx);
		assert.equal(terminalApply.details.code, "stage_terminal");
		const release = await sibling.tools.get("stardock_recover").execute("release", {
			action: "releaseLeases", name: owner.name, graphId: owner.graph.id,
			stageId: owner.graph.stages[0].id, expectedGraphRevision: state.executionGraph!.revision,
		}, undefined, undefined, sibling.ctx);
		assert.equal(release.details.ok, true, release.content[0].text);
		assert.equal(loadState(sibling.ctx, owner.name)?.executionGraph?.status, "completed");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("resource recovery inspects then applies classification only under stage ownership", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "stardock-governor-resources-"));
	try {
		const { owner } = await ownedLoop(cwd, "Recover Resources");
		mutateState(owner.ctx, owner.name, (candidate) => {
			const stage = candidate.executionGraph!.stages[0];
			stage.status = "detached";
			const node = candidate.executionGraph!.nodes.find((item) => item.id === stage.implementationNodeIds[0])!;
			node.status = "detached";
			node.attempts.push({ id: "incomplete-lease", baseCommit: "a".repeat(40), branchRef: "incomplete", laneCommits: [], validation: [], startedAt: new Date().toISOString(), status: "detached", leaseDisposition: "preserved" });
		});
		const revision = loadState(owner.ctx, owner.name)!.executionGraph!.revision;
		const args = { action: "reconcileResources", name: owner.name, graphId: owner.graph.id, stageId: owner.graph.stages[0].id, expectedGraphRevision: revision };
		const inspected = await owner.tools.get("stardock_recover").execute("resources-read", args, undefined, undefined, owner.ctx);
		assert.equal(inspected.details.readOnly, true);
		assert.equal(inspected.details.attempts[0].classification, "failed");
		assert.equal(loadState(owner.ctx, owner.name)!.executionGraph!.revision, revision);
		const applied = await owner.tools.get("stardock_recover").execute("resources-apply", { ...args, apply: true }, undefined, undefined, owner.ctx);
		assert.equal(applied.details.readOnly, false, applied.content[0].text);
		assert.equal(loadState(owner.ctx, owner.name)!.executionGraph!.nodes.find((node) => node.attempts.some((attempt) => attempt.id === "incomplete-lease"))!.status, "failed");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("lease recovery does not call Treehouse return for a stage with active worker or attempt evidence", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "stardock-governor-live-lease-"));
	try {
		const { owner, sibling } = await ownedLoop(cwd, "Recover Live Lease");
		mutateState(owner.ctx, owner.name, (candidate) => {
			const stage = candidate.executionGraph!.stages[0];
			stage.status = "settled";
			candidate.executionGraph!.nodes.find((node) => node.id === stage.implementationNodeIds[0])!.attempts.push({
				id: "live-lease", baseCommit: "a".repeat(40), branchRef: "refs/heads/live",
				laneCommits: [], validation: [], startedAt: new Date().toISOString(), status: "running",
				worktreePath: path.join(cwd, "live"), repositoryCommonDir: path.join(cwd, ".git"),
				leaseHolder: "stardock:live", leaseDisposition: "held",
			});
			candidate.workerRuns.push({ id: "live-run", requestId: "live-request", graphId: owner.graph.id, stageId: stage.id, status: "running" } as any);
		});
		let returns = 0;
		const adapter = {
			inspectLeaseReservation: async () => ({ state: "held", reason: "Held." }),
			inspectLaneCompletion: async () => ({ clean: true, branchRef: "refs/heads/live", headCommit: "a".repeat(40) }),
			returnLease: async () => { returns++; return { exitCode: 0, stdout: "", stderr: "" }; },
		} as any;
		let state = loadState(sibling.ctx, owner.name)!;
		await assert.rejects(releaseStage(sibling.ctx, { loopName: owner.name, graphId: owner.graph.id, stageId: owner.graph.stages[0].id, expectedGraphRevision: state.executionGraph!.revision }, undefined, adapter), /running WorkerRun/);
		mutateState(owner.ctx, owner.name, (candidate) => { candidate.workerRuns.find((run) => run.id === "live-run")!.status = "failed"; });
		state = loadState(sibling.ctx, owner.name)!;
		await assert.rejects(releaseStage(sibling.ctx, { loopName: owner.name, graphId: owner.graph.id, stageId: owner.graph.stages[0].id, expectedGraphRevision: state.executionGraph!.revision }, undefined, adapter), /active work/);
		assert.equal(returns, 0);
		assert.equal(loadState(sibling.ctx, owner.name)?.executionGraph?.nodes.find((node) => node.attempts.some((attempt) => attempt.id === "live-lease"))?.attempts[0].leaseDisposition, "held");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("governor recovery delegates confirmed-dead takeover and retains an audit event", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "stardock-governor-recover-dead-"));
	try {
		const fresh = await startOwnershipGraph(cwd, "Recover Dead Child");
		const sibling = makeHarness(cwd);
		for (const handler of sibling.handlers.get("session_start") ?? []) await handler({}, sibling.ctx);
		const gate = path.join(cwd, "start-recover-dead");
		const child = runAcquisitionChild([cwd, fresh.name, fresh.graph.id, fresh.graph.stages[0].id, String(fresh.graph.revision), "dead-child", gate]);
		fs.writeFileSync(gate, "go", "utf-8");
		assert.equal((await child).result.ok, true);
		const file = statePath(cwd, fresh.name);
		const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
		raw.workerRuns.push({ id: "orphan-worker", requestId: "orphan-request", graphId: fresh.graph.id, stageId: fresh.graph.stages[0].id, status: "running" });
		fs.writeFileSync(file, JSON.stringify(raw, null, 2));
		const selected = loadState(sibling.ctx, fresh.name)!;
		const inspection = await sibling.tools.get("stardock_recover").execute("inspect", { action: "inspect", name: fresh.name }, undefined, undefined, sibling.ctx);
		assert.equal(inspection.details.ownership.ownerProcess, "dead");
		assert.ok(inspection.details.takeoverBlock);
		assert.equal(inspection.details.actions.some((action: string) => action.startsWith("takeover")), false);
		const takeoverRequest = {
			action: "takeover", name: fresh.name, graphId: fresh.graph.id, stageId: fresh.graph.stages[0].id,
			expectedGraphRevision: selected.executionGraph!.revision, rationale: "The owner process exited after acquisition.",
			approvalRef: "user:recover-dead", classification: "The recorded WorkerRun has failed; no Treehouse lease was started.",
		};
		const rejected = await sibling.tools.get("stardock_recover").execute("unsafe-takeover", takeoverRequest, undefined, undefined, sibling.ctx);
		assert.equal(rejected.details.code, "worker_running");
		assert.equal(fs.existsSync(stageOwnerFile(cwd, fresh.name)), true);
		raw.workerRuns[0].status = "failed";
		fs.writeFileSync(file, JSON.stringify(raw, null, 2));
		const takeover = await sibling.tools.get("stardock_recover").execute("takeover", {
			...takeoverRequest,
		}, undefined, undefined, sibling.ctx);
		assert.equal(takeover.details.ok, true, takeover.content[0].text);
		const recovered = loadState(sibling.ctx, fresh.name)!;
		assert.equal(recovered.executionGraph?.ownership?.sessionId !== selected.executionGraph?.ownership?.sessionId, true);
		assert.equal(recovered.recoveryEvents?.at(-1)?.action, "takeover");
		assert.equal(recovered.recoveryEvents?.at(-1)?.approvalRef, "user:recover-dead");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("governor finalizes a crash after terminal state commit but before owner-file cleanup", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "stardock-governor-finalize-"));
	try {
		const { owner, sibling } = await ownedLoop(cwd, "Recover Interrupted Cleanup");
		const file = statePath(cwd, owner.name);
		const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
		const priorOwner = raw.executionGraph.ownership;
		raw.executionGraph.stages[0].status = "settled";
		raw.executionGraph.stages[0].terminalOwnershipCleanup = priorOwner;
		delete raw.executionGraph.ownership;
		raw.executionGraph.revision += 1;
		fs.writeFileSync(file, JSON.stringify(raw, null, 2));
		const inspected = await sibling.tools.get("stardock_recover").execute("inspect", { action: "inspect", name: owner.name }, undefined, undefined, sibling.ctx);
		assert.equal(inspected.details.stageId, owner.graph.stages[0].id);
		assert.ok(inspected.details.actions.some((action: string) => action.startsWith("finalizeCleanup")));
		const input = { action: "finalizeCleanup", name: owner.name, graphId: owner.graph.id, stageId: owner.graph.stages[0].id,
			expectedGraphRevision: raw.executionGraph.revision, rationale: "The terminal state committed before owner-file cleanup.", approvalRef: "user:finalize-cleanup" };
		const finalized = await sibling.tools.get("stardock_recover").execute("finalize", input, undefined, undefined, sibling.ctx);
		assert.equal(finalized.details.ok, true, finalized.content[0].text);
		assert.equal(fs.existsSync(stageOwnerFile(cwd, owner.name)), false);
		assert.equal(loadState(sibling.ctx, owner.name)?.recoveryEvents?.at(-1)?.action, "finalizeCleanup");
		const repeat = await sibling.tools.get("stardock_recover").execute("repeat", { ...input, expectedGraphRevision: finalized.details.stateRevision }, undefined, undefined, sibling.ctx);
		assert.equal(repeat.details.alreadyClean, true);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("finalizeCleanup repairs a post-clear audit gap and quarantines exact dead mutex evidence", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "stardock-governor-audit-gap-"));
	try {
		const { owner, sibling } = await ownedLoop(cwd, "Recover Audit Gap");
		const file = statePath(cwd, owner.name);
		const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
		const priorOwner = raw.executionGraph.ownership;
		raw.executionGraph.stages[0].status = "settled";
		raw.executionGraph.stages[0].terminalOwnershipCleanup = priorOwner;
		delete raw.executionGraph.ownership;
		raw.executionGraph.revision += 1;
		raw.recoveryEvents = [{ action: "finalizeCleanup", graphId: owner.graph.id, stageId: owner.graph.stages[0].id, previousOwnerSessionId: priorOwner.sessionId }];
		fs.writeFileSync(file, JSON.stringify(raw, null, 2));
		fs.rmSync(stageOwnerFile(cwd, owner.name));
		fs.writeFileSync(stateMutexFile(cwd, owner.name), JSON.stringify({
			version: 1, graphId: owner.graph.id, stageId: owner.graph.stages[0].id,
			sessionId: "dead-recovery", pid: 99999999, tokenDigest: "d".repeat(64), acquiredAt: new Date().toISOString(),
		}));
		const inspected = await sibling.tools.get("stardock_recover").execute("inspect", { action: "inspect", name: owner.name }, undefined, undefined, sibling.ctx);
		assert.ok(inspected.details.actions.some((action: string) => action.startsWith("finalizeCleanup")));
		const finalized = await sibling.tools.get("stardock_recover").execute("audit-gap", {
			action: "finalizeCleanup", name: owner.name, graphId: owner.graph.id, stageId: owner.graph.stages[0].id,
			expectedGraphRevision: raw.executionGraph.revision, rationale: "Owner was cleared before the audit write.", approvalRef: "user:audit-gap",
		}, undefined, undefined, sibling.ctx);
		assert.equal(finalized.details.ok, true, finalized.content[0].text);
		assert.equal(finalized.details.alreadyClean, true);
		const events = loadState(sibling.ctx, owner.name)?.recoveryEvents;
		assert.equal(events?.length, 2);
		assert.equal(events?.[0]?.approvalRef, undefined);
		assert.equal(events?.at(-1)?.approvalRef, "user:audit-gap");
		assert.equal(fs.existsSync(stateMutexFile(cwd, owner.name)), false);
		assert.ok(fs.readdirSync(path.join(cwd, ".stardock", "runs", owner.name, "ownership-quarantine")).some((name) => name.startsWith("mutex-")));
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("damaged recovery audit evidence survives ordinary state writes and remains visible", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "stardock-governor-audit-"));
	try {
		const owner = await startOwnershipGraph(cwd, "Recover Audit");
		const file = statePath(cwd, owner.name);
		const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
		raw.recoveryEvents = "damaged-audit-record";
		fs.writeFileSync(file, JSON.stringify(raw, null, 2));
		mutateState(owner.ctx, owner.name, (candidate) => { candidate.iteration += 1; });
		const saved = JSON.parse(fs.readFileSync(file, "utf-8"));
		assert.equal(saved.recoveryEventsUnparsed, "damaged-audit-record");
		assert.throws(() => mutateState(owner.ctx, owner.name, (candidate) => { delete candidate.recoveryEventsUnparsed; }), /Unparsed recovery evidence must be preserved/);
		const inspected = await owner.tools.get("stardock_recover").execute("inspect", { action: "inspect", name: owner.name }, undefined, undefined, owner.ctx);
		assert.equal(inspected.details.unparsedRecoveryEvidence, true);
		assert.match(inspected.content[0].text, /Damaged recovery audit evidence was preserved/);
		const nullAudit = JSON.parse(fs.readFileSync(file, "utf-8"));
		nullAudit.recoveryEventsUnparsed = null;
		fs.writeFileSync(file, JSON.stringify(nullAudit, null, 2));
		mutateState(owner.ctx, owner.name, (candidate) => { candidate.iteration += 1; });
		mutateState(owner.ctx, owner.name, (candidate) => { candidate.iteration += 1; });
		assert.equal(JSON.parse(fs.readFileSync(file, "utf-8")).recoveryEventsUnparsed, null);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("recovery inspection reports malformed owner evidence without mutating the loop", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "stardock-governor-malformed-"));
	try {
		const { owner, sibling } = await ownedLoop(cwd, "Recover Malformed");
		fs.writeFileSync(stageOwnerFile(cwd, owner.name), "{broken", "utf-8");
		const before = fs.readFileSync(statePath(cwd, owner.name), "utf-8");
		const inspected = await sibling.tools.get("stardock_recover").execute("inspect", { action: "inspect", name: owner.name }, undefined, undefined, sibling.ctx);
		assert.equal(inspected.details.ok, false);
		assert.equal(inspected.details.evidenceError.code, "evidence_malformed");
		const current = loadState(sibling.ctx, owner.name)!;
		const blocked = await sibling.tools.get("stardock_recover").execute("malformed-repair", {
			...request(owner.graph.id, owner.graph.stages[0].id, current.executionGraph!.revision), name: owner.name,
		}, undefined, undefined, sibling.ctx);
		assert.equal(blocked.details.code, "evidence_malformed");
		assert.equal(fs.readFileSync(statePath(cwd, owner.name), "utf-8"), before);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("governor recovery refuses active stages and contradictory worker evidence", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "stardock-governor-recover-active-"));
	try {
		const { owner, sibling } = await ownedLoop(cwd, "Recover Active");
		let state = loadState(sibling.ctx, owner.name)!;
		let result = await sibling.tools.get("stardock_recover").execute("active", {
			...request(owner.graph.id, owner.graph.stages[0].id, state.executionGraph!.revision), name: owner.name,
		}, undefined, undefined, sibling.ctx);
		assert.equal(result.details.ok, false);
		assert.match(result.content[0].text, /terminal|settled/i);
		mutateState(owner.ctx, owner.name, (candidate) => {
			candidate.executionGraph!.stages[0].status = "settled";
			candidate.workerRuns.push({ id: "still-running", requestId: "worker-request", graphId: owner.graph.id, stageId: owner.graph.stages[0].id, status: "running" } as any);
		});
		state = loadState(sibling.ctx, owner.name)!;
		result = await sibling.tools.get("stardock_recover").execute("worker", {
			...request(owner.graph.id, owner.graph.stages[0].id, state.executionGraph!.revision), name: owner.name,
		}, undefined, undefined, sibling.ctx);
		assert.equal(result.details.ok, false);
		assert.match(result.content[0].text, /worker/i);
		assert.equal(loadState(sibling.ctx, owner.name)?.executionGraph?.ownership?.sessionId, state.executionGraph?.ownership?.sessionId);
		assert.equal(fs.existsSync(stageOwnerFile(cwd, owner.name)), true);
		const takeover = await sibling.tools.get("stardock_recover").execute("live-takeover", {
			action: "takeover", name: owner.name, graphId: owner.graph.id, stageId: owner.graph.stages[0].id,
			expectedGraphRevision: state.executionGraph!.revision, rationale: "Try a live owner takeover.",
			approvalRef: "user:live-takeover", classification: "Worker remains live.",
		}, undefined, undefined, sibling.ctx);
		assert.equal(takeover.details.code, "worker_running");
		mutateState(owner.ctx, owner.name, (candidate) => { candidate.workerRuns.find((run) => run.id === "still-running")!.status = "failed"; });
		state = loadState(sibling.ctx, owner.name)!;
		const live = await sibling.tools.get("stardock_recover").execute("live-owner", {
			action: "takeover", name: owner.name, graphId: owner.graph.id, stageId: owner.graph.stages[0].id,
			expectedGraphRevision: state.executionGraph!.revision, rationale: "Try a live owner takeover.",
			approvalRef: "user:live-takeover", classification: "Worker settled but owner is live.",
		}, undefined, undefined, sibling.ctx);
		assert.equal(live.details.code, "owner_live");
		assert.equal(loadState(sibling.ctx, owner.name)?.recoveryEvents, undefined);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
