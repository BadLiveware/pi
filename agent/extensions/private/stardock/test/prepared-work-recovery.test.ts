import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { materializeExecutionPlanWave } from "../src/execution-plan/materialize.ts";
import { executeExecutionPlanRun } from "../src/execution-plan/run-tool.ts";
import { assertStageWorkRecoverable, settleNeverDispatchedStageWork } from "../src/stages/prepared-work-recovery.ts";
import { bindOwnershipContext, ownershipTokenForContext, removeOwnershipToken } from "../src/stages/ownership-records.ts";
import { loadState, mutateState } from "../src/state/store.ts";
import { makeHarness, statePath } from "./test-harness.ts";
import { stageOwnerFile } from "./stage-ownership-test-support.ts";
import { runReadyStage } from "../src/stages/run-ready.ts";
import { FakeAdapter, startFiveLane } from "./stage-run-ready-test-support.ts";

const fixture = fileURLToPath(new URL("./fixtures/pre-dispatch-owner-child.ts", import.meta.url));

test("transport sees durable commitment for its lane while queued lanes remain prepared", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "stardock-dispatch-boundary-"));
	let h: Awaited<ReturnType<typeof startFiveLane>> | undefined;
	try {
		h = await startFiveLane(cwd);
		bindOwnershipContext(h.ctx, "dispatch-boundary-session");
		let calls = 0;
		await runReadyStage(h.pi, h.ctx, {
			loopName: h.loopName, graphId: h.graph.id, stageId: h.graph.stages[0].id,
			expectedGraphRevision: h.graph.revision, sessionId: "dispatch-boundary-session",
		}, undefined, undefined, {
			adapter: new FakeAdapter(),
			invokeWorker: async ({ node, attempt }) => {
				const persisted = loadState(h!.ctx, h!.loopName)!.executionGraph!.nodes.find((item) => item.id === node.id)!.attempts.at(-1)!;
				assert.equal(persisted.dispatchState, "committed");
				assert.ok(persisted.dispatchCommittedAt);
				assert.equal(attempt.dispatchCommittedAt, persisted.dispatchCommittedAt);
				if (calls++ === 0) {
					const others = loadState(h!.ctx, h!.loopName)!.executionGraph!.nodes.filter((item) => item.kind === "implementation" && item.id !== node.id);
					assert.ok(others.every((item) => item.attempts.at(-1)!.dispatchState === "prepared"));
				}
				return { response: { requestId: node.id, result: { details: { results: [{ finalOutput: "settled" }] } }, isError: false } };
			},
		});
		assert.equal(calls, 5);
	} finally {
		if (h) removeOwnershipToken(h.ctx, h.loopName, "dispatch-boundary-session");
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

async function orphan(phase = "queued") {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "stardock-prepared-recovery-"));
	const harness = makeHarness(cwd);
	const name = "prepared-recovery";
	const sessionId = "recovering-test-session";
	const runtime = { ref: { currentLoop: name, sessionId }, updateUI() {} } as any;
	const cleanup = () => { removeOwnershipToken(harness.ctx, name, ownershipTokenForContext(harness.ctx, name)?.sessionId ?? sessionId); fs.rmSync(cwd, { recursive: true, force: true }); };
	try {
		await harness.tools.get("stardock_plan").execute("plan", { name, objective: "Crash boundary", nodes: ["first", "second"].map((id) => ({ id, objective: id, task: id, acceptanceCriteria: ["Evidence"] })) }, undefined, undefined, harness.ctx);
		await materializeExecutionPlanWave(harness.ctx, name, undefined, { inspectWorktree: async () => ({ worktreePath: cwd, repositoryCommonDir: path.join(cwd, ".git"), headCommit: "a".repeat(40), branchRef: "refs/heads/main", clean: true }) } as any);
		await new Promise<void>((resolve, reject) => {
			const child = spawn(process.execPath, ["--experimental-strip-types", fixture, cwd, name, phase], { stdio: ["ignore", "pipe", "pipe"] });
			let stderr = "";
			child.stderr.on("data", (chunk) => { stderr += String(chunk); });
			child.stdout.resume();
			child.on("error", reject);
			child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr || `child exit ${code}`)));
		});
		bindOwnershipContext(harness.ctx, sessionId);
		const state = loadState(harness.ctx, name)!;
		const graph = state.executionGraph!;
		const input = { action: "takeover", name, graphId: graph.id, stageId: graph.stages[0].id, expectedGraphRevision: graph.revision,
			rationale: "The subprocess exited at the recorded dispatch boundary.", approvalRef: "user:repair-test", classification: "Prepared lanes retain leases; inspect exact persisted dispatch evidence." };
		const call = (params: any) => harness.tools.get("stardock_recover").execute("recover", params, undefined, undefined, harness.ctx);
		return { ...harness, name, cwd, runtime, cleanup, state, input, call };
	} catch (error) { cleanup(); throw error; }
}

for (const phase of ["leased", "queued"]) {
	test(`dead-owner takeover atomically settles exact ${phase} never-dispatched lanes and preserves leases`, async () => {
		const h = await orphan(phase);
		try {
			const beforeBytes = fs.readFileSync(statePath(h.cwd, h.name), "utf8");
			const inspect = await h.call({ action: "inspect", name: h.name });
			assert.equal(inspect.details.ownership.ownerProcess, "dead");
			assert.equal(inspect.details.preparedUndispatchedAttemptIds.length, 2);
			assert.ok(inspect.details.actions.some((action: string) => action.startsWith("takeover")));
			assert.equal(fs.readFileSync(statePath(h.cwd, h.name), "utf8"), beforeBytes, "inspection is not settlement authority");
			const stale = await h.call({ ...h.input, expectedGraphRevision: h.input.expectedGraphRevision - 1 });
			assert.equal(stale.details.code, "stale_revision");
			assert.equal(fs.readFileSync(statePath(h.cwd, h.name), "utf8"), beforeBytes);
			const taken = await h.call(h.input);
			assert.equal(taken.details.ok, true, taken.content[0].text);
			const after = loadState(h.ctx, h.name)!;
			assert.equal(after.executionGraph!.revision, h.input.expectedGraphRevision + 1, "settlement and replacement ownership use one CAS");
			assert.notEqual(after.executionGraph!.ownership!.sessionId, h.state.executionGraph!.ownership!.sessionId);
			const attempts = after.executionGraph!.nodes.flatMap((node) => node.attempts);
			for (const attempt of attempts) {
				const before = h.state.executionGraph!.nodes.flatMap((node) => node.attempts).find((item) => item.id === attempt.id)!;
				assert.equal(attempt.status, "failed");
				assert.equal(attempt.dispatchState, "prepared");
				assert.equal(attempt.leaseDisposition, "preserved");
				assert.equal(attempt.worktreePath, before.worktreePath);
				assert.equal(attempt.leaseHolder, before.leaseHolder);
				assert.equal(attempt.branchRef, before.branchRef);
				assert.equal(attempt.dispatchCommittedAt, undefined);
			}
			assert.deepEqual(after.recoveryEvents!.at(-1)!.recoveredPreparedAttemptIds, attempts.map((attempt) => attempt.id));
			assert.ok(after.workerRuns.every((run) => run.status === "failed"));
			assert.ok(after.workerReports.every((report) => report.status === "needs_review"));
			const restored = await executeExecutionPlanRun(h.pi, h.runtime, {}, undefined, undefined, h.ctx);
			assert.equal(restored.details.recovered, true);
			assert.equal(restored.details.plan!.reviewRunIds.length, 2);
			assert.equal(restored.details.plan!.nextAction, "review");
		} finally { h.cleanup(); }
	});
}

test("partial setup recovery leaves unprepared lanes retryable without inventing review evidence", async () => {
	const h = await orphan("partial");
	try {
		assert.equal((await h.call(h.input)).details.ok, true);
		const restored = await executeExecutionPlanRun(h.pi, h.runtime, {}, undefined, undefined, h.ctx);
		assert.equal(restored.details.recovered, true);
		assert.equal(restored.details.plan!.reviewRunIds.length, 1);
		assert.deepEqual(loadState(h.ctx, h.name)!.executionPlan!.nodes.map((node) => node.status), ["needs_review", "retry_ready"]);
		assert.equal(restored.details.lanes!.find((lane) => lane.planNodeId === "second")!.workerRunId, undefined);
	} finally { h.cleanup(); }
});

test("exact persisted dead custody recovers prepared lanes even if the owner file was lost", async () => {
	const h = await orphan();
	try {
		fs.rmSync(stageOwnerFile(h.cwd, h.name));
		const inspection = await h.call({ action: "inspect", name: h.name });
		assert.equal(inspection.details.preparedUndispatchedAttemptIds.length, 2);
		assert.equal((await h.call(h.input)).details.ok, true);
		assert.ok(loadState(h.ctx, h.name)!.workerRuns.every((run) => run.status === "failed"));
	} finally { h.cleanup(); }
});

const corruptions: Record<string, (raw: any) => void> = {
	"legacy unknown marker": (raw) => { delete raw.executionGraph.nodes.find((node: any) => node.attempts.length).attempts[0].dispatchState; },
	"prepared marker with bridge evidence": (raw) => { raw.executionGraph.nodes.find((node: any) => node.attempts.length).attempts[0].bridgeRunId = "bridge-started"; },
	"mismatched WorkerRun identity": (raw) => { raw.workerRuns[0].nodeId = "other-node"; },
	"mismatched report identity": (raw) => { raw.workerRuns[0].reportId = "other-report"; },
	"missing lease identity": (raw) => { delete raw.executionGraph.nodes.find((node: any) => node.attempts.length).attempts[0].leaseHolder; },
	"extra unclassified running worker": (raw) => { raw.workerRuns.push({ ...raw.workerRuns[0], id: "extra-running-worker" }); },
	"older active attempt": (raw) => { const node = raw.executionGraph.nodes.find((item: any) => item.attempts.length); node.attempts.push({ ...node.attempts[0], id: "later-attempt", status: "failed" }); },
};

for (const [label, corrupt] of Object.entries(corruptions)) {
	test(`takeover remains blocked and unchanged for ${label}`, async () => {
		const h = await orphan();
		try {
			const file = statePath(h.cwd, h.name);
			const raw = JSON.parse(fs.readFileSync(file, "utf8"));
			corrupt(raw);
			fs.writeFileSync(file, JSON.stringify(raw, null, 2));
			const before = fs.readFileSync(file, "utf8");
			const ownerBefore = fs.readFileSync(stageOwnerFile(h.cwd, h.name), "utf8");
			const inspect = await h.call({ action: "inspect", name: h.name });
			assert.ok(inspect.details.takeoverBlock);
			assert.equal(inspect.details.actions.some((action: string) => action.startsWith("takeover")), false);
			const refused = await h.call(h.input);
			assert.equal(refused.details.ok, false);
			assert.equal(refused.details.code, "worker_running");
			assert.equal(fs.readFileSync(file, "utf8"), before);
			assert.equal(fs.readFileSync(stageOwnerFile(h.cwd, h.name), "utf8"), ownerBefore);
		} finally { h.cleanup(); }
	});
}

test("a committed lane blocks whole-stage takeover, including queued never-dispatched siblings", async () => {
	const h = await orphan("committed");
	try {
		const before = JSON.stringify(loadState(h.ctx, h.name));
		assert.throws(() => assertStageWorkRecoverable(h.state, h.input.graphId, h.input.stageId), /running WorkerRun/);
		const refused = await h.call(h.input);
		assert.equal(refused.details.code, "worker_running");
		assert.equal(JSON.stringify(loadState(h.ctx, h.name)), before);
	} finally { h.cleanup(); }
});

test("live owner and changed post-inspection dispatch evidence cannot be overridden by classification", async () => {
	const h = await orphan();
	try {
		const file = statePath(h.cwd, h.name);
		const ownerFile = stageOwnerFile(h.cwd, h.name);
		const raw = JSON.parse(fs.readFileSync(file, "utf8"));
		const owner = JSON.parse(fs.readFileSync(ownerFile, "utf8"));
		const deadPid = owner.pid;
		raw.executionGraph.ownership.pid = process.pid;
		owner.pid = process.pid;
		fs.writeFileSync(file, JSON.stringify(raw));
		fs.writeFileSync(ownerFile, JSON.stringify(owner));
		assert.equal((await h.call(h.input)).details.code, "owner_live");
		raw.executionGraph.ownership.pid = deadPid;
		owner.pid = deadPid;
		fs.writeFileSync(file, JSON.stringify(raw));
		fs.writeFileSync(ownerFile, JSON.stringify(owner));
		assert.equal((await h.call({ action: "inspect", name: h.name })).details.preparedUndispatchedAttemptIds.length, 2);
		const attempt = raw.executionGraph.nodes.find((node: any) => node.attempts.length).attempts[0];
		attempt.dispatchState = "committed";
		attempt.dispatchCommittedAt = new Date().toISOString();
		fs.writeFileSync(file, JSON.stringify(raw));
		const snapshot = loadState(h.ctx, h.name)!;
		assert.throws(() => settleNeverDispatchedStageWork(snapshot, h.input.graphId, h.input.stageId, new Date().toISOString()), /running WorkerRun/);
		assert.equal((await h.call(h.input)).details.code, "worker_running");
		assert.equal(loadState(h.ctx, h.name)!.recoveryEvents, undefined);
	} finally { h.cleanup(); }
});

test("dispatch evidence is monotonic, immutable, and cannot be backfilled on legacy attempts", async () => {
	const h = await orphan();
	try {
		assert.equal((await h.call(h.input)).details.ok, true);
		const getAttempt = (candidate: any) => candidate.executionGraph.nodes.find((node: any) => node.attempts.length).attempts[0];
		assert.throws(() => mutateState(h.ctx, h.name, (candidate) => { delete getAttempt(candidate).dispatchState; }), /dispatch evidence/);
		mutateState(h.ctx, h.name, (candidate) => { getAttempt(candidate).dispatchState = "committed"; getAttempt(candidate).dispatchCommittedAt = "2026-10-04T00:00:00.000Z"; });
		for (const change of [
			(attempt: any) => { attempt.dispatchState = "prepared"; delete attempt.dispatchCommittedAt; },
			(attempt: any) => { delete attempt.dispatchCommittedAt; },
			(attempt: any) => { attempt.dispatchCommittedAt = "2026-10-05T00:00:00.000Z"; },
		]) assert.throws(() => mutateState(h.ctx, h.name, (candidate) => change(getAttempt(candidate))), /dispatch evidence/);
		const file = statePath(h.cwd, h.name);
		const legacy = JSON.parse(fs.readFileSync(file, "utf8"));
		delete getAttempt(legacy).dispatchState;
		delete getAttempt(legacy).dispatchCommittedAt;
		fs.writeFileSync(file, JSON.stringify(legacy));
		assert.throws(() => mutateState(h.ctx, h.name, (candidate) => { getAttempt(candidate).dispatchState = "prepared"; }), /dispatch evidence/);
	} finally { h.cleanup(); }
});
