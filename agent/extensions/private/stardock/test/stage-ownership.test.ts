import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { detachOwnedStages, inspectStageOwnership, reconcileStageOwnership } from "../src/stages/ownership.ts";
import { acquireMutationMutex, OwnershipProtocolError, releaseMatchingMutationMutex } from "../src/stages/ownership-records.ts";
import { loadState, mutateState, saveState } from "../src/state/store.ts";
import {
	HEARTBEAT_INTERVAL_WAIT_MS,
	MUTEX_CHILD_FIXTURE,
	runAcquisitionChild,
	stageOwnerFile,
	startOwnershipGraph as startGraph,
	stateMutexFile,
	waitForFile,
} from "./stage-ownership-test-support.ts";
import { makeHarness, runDir, statePath } from "./test-harness.ts";

test("two processes race first acquisition and only one durable owner becomes active", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-owner-race-"));
	try {
		const { name, graph } = await startGraph(cwd, "Owner Race");
		const gate = path.join(cwd, "start-race");
		const base = [cwd, name, graph.id, graph.stages[0].id, String(graph.revision)];
		const first = runAcquisitionChild([...base, "child-a", gate]);
		const second = runAcquisitionChild([...base, "child-b", gate]);
		fs.writeFileSync(gate, "go", "utf-8");
		const results = await Promise.all([first, second]);
		const diagnostics = JSON.stringify(results);
		const successful = results.filter((value) => value.result.ok);
		const rejected = results.filter((value) => !value.result.ok);
		assert.equal(successful.length, 1, diagnostics);
		assert.equal(rejected.length, 1, diagnostics);
		assert.ok(["owner_busy", "stage_unready"].includes(String(rejected[0].result.code)), diagnostics);
		const ownerRaw = JSON.parse(fs.readFileSync(path.join(runDir(cwd, name), "stage-owner.json"), "utf-8"));
		assert.equal(ownerRaw.status, "active");
		assert.equal(Object.hasOwn(ownerRaw, "token"), false);
		assert.match(ownerRaw.tokenDigest, /^[0-9a-f]{64}$/);
		const stateRaw = fs.readFileSync(statePath(cwd, name), "utf-8");
		assert.equal(stateRaw.includes('"token":'), false);
		assert.equal(JSON.parse(stateRaw).executionGraph.ownership.tokenDigest, ownerRaw.tokenDigest);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("stale acquisition rolls back only its acquiring record", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-owner-stale-"));
	try {
		const { tools, ctx, name, graph } = await startGraph(cwd, "Owner Stale");
		const stage = tools.get("stardock_stage");
		assert.ok(stage);
		const result = await stage.execute("acquire", {
			action: "acquire",
			loopName: name,
			graphId: graph.id,
			stageId: graph.stages[0].id,
			expectedGraphRevision: graph.revision - 1,
		}, undefined, undefined, ctx);
		assert.equal(result.details.code, "stale_revision");
		assert.equal(fs.existsSync(path.join(runDir(cwd, name), "stage-owner.json")), false);
		assert.equal(loadState(ctx, name)?.executionGraph?.revision, graph.revision);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("non-owner tools reject mutations while read-only state remains available and owner CAS rejects stale candidates", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-owner-guard-"));
	try {
		const ownerHarness = await startGraph(cwd, "Owner Guard");
		const stage = ownerHarness.tools.get("stardock_stage");
		const acquisition = await stage.execute("acquire", {
			action: "acquire",
			loopName: ownerHarness.name,
			graphId: ownerHarness.graph.id,
			stageId: ownerHarness.graph.stages[0].id,
			expectedGraphRevision: ownerHarness.graph.revision,
		}, undefined, undefined, ownerHarness.ctx);
		assert.equal(acquisition.details.ok, true);

		const sibling = makeHarness(cwd);
		for (const handler of sibling.handlers.get("session_start") ?? []) await handler({}, sibling.ctx);
		const blocked = await sibling.tools.get("stardock_done").execute("done", {}, undefined, undefined, sibling.ctx);
		assert.equal(blocked.details.code, "non_owner");
		const readable = await sibling.tools.get("stardock_state").execute("state", { loopName: ownerHarness.name }, undefined, undefined, sibling.ctx);
		assert.equal(readable.details.loopName, ownerHarness.name);

		mutateState(ownerHarness.ctx, ownerHarness.name, (state) => {
			const node = state.executionGraph?.nodes.find((value) => value.id === "wave-a");
			assert.ok(node);
			node.status = "succeeded";
		});
		mutateState(ownerHarness.ctx, ownerHarness.name, (state) => {
			const node = state.executionGraph?.nodes.find((value) => value.id === "wave-b");
			assert.ok(node);
			node.status = "succeeded";
		});
		const serialized = loadState(ownerHarness.ctx, ownerHarness.name);
		assert.equal(serialized?.executionGraph?.nodes.find((value) => value.id === "wave-a")?.status, "succeeded");
		assert.equal(serialized?.executionGraph?.nodes.find((value) => value.id === "wave-b")?.status, "succeeded");
		assert.equal(inspectStageOwnership(ownerHarness.ctx, ownerHarness.name).stateMatchesOwner, true);

		const command = sibling.commands.get("stardock");
		const legacyStop = sibling.commands.get("stardock-stop");
		await command.handler(`cancel ${ownerHarness.name}`, sibling.ctx);
		await command.handler("nuke --yes", sibling.ctx);
		await legacyStop.handler("", sibling.ctx);
		assert.equal(fs.existsSync(statePath(cwd, ownerHarness.name)), true);
		assert.ok(sibling.notifications.some((message) => message.includes("rejected")));

		const ownerBeforeHeartbeat = JSON.parse(fs.readFileSync(path.join(runDir(cwd, ownerHarness.name), "stage-owner.json"), "utf-8"));
		await new Promise((resolve) => setTimeout(resolve, 2));
		const heartbeat = await stage.execute("heartbeat", { action: "heartbeat", loopName: ownerHarness.name }, undefined, undefined, ownerHarness.ctx);
		assert.equal(heartbeat.details.ok, true);
		const ownerAfterHeartbeat = JSON.parse(fs.readFileSync(path.join(runDir(cwd, ownerHarness.name), "stage-owner.json"), "utf-8"));
		assert.ok(Date.parse(ownerAfterHeartbeat.heartbeatAt) >= Date.parse(ownerBeforeHeartbeat.heartbeatAt));

		const first = loadState(ownerHarness.ctx, ownerHarness.name);
		const stale = loadState(ownerHarness.ctx, ownerHarness.name);
		assert.ok(first);
		assert.ok(stale);
		first.iteration += 1;
		saveState(ownerHarness.ctx, first);
		stale.iteration += 1;
		assert.throws(() => saveState(ownerHarness.ctx, stale), (error: unknown) => error instanceof OwnershipProtocolError && error.code === "stale_revision");
		detachOwnedStages(ownerHarness.ctx, acquisition.details.acquisition.owner.sessionId);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("non-owner read-only action matrix remains available while mutation and review actions are blocked", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-owner-tool-matrix-"));
	try {
		const ownerHarness = await startGraph(cwd, "Owner Tool Matrix");
		const stage = ownerHarness.tools.get("stardock_stage");
		const acquisition = await stage.execute("acquire", {
			action: "acquire",
			loopName: ownerHarness.name,
			graphId: ownerHarness.graph.id,
			stageId: ownerHarness.graph.stages[0].id,
			expectedGraphRevision: ownerHarness.graph.revision,
		}, undefined, undefined, ownerHarness.ctx);
		assert.equal(acquisition.details.ok, true);
		const sibling = makeHarness(cwd);
		for (const handler of sibling.handlers.get("session_start") ?? []) await handler({}, sibling.ctx);
		const readOnlyCalls = [
			["stardock_state", { loopName: ownerHarness.name }],
			["stardock_policy", { action: "completion", loopName: ownerHarness.name }],
			["stardock_outside_requests", { loopName: ownerHarness.name }],
			["stardock_outside_payload", { loopName: ownerHarness.name, requestId: "missing" }],
			["stardock_advisory_adapter", { action: "payload", loopName: ownerHarness.name, role: "explorer" }],
			["stardock_stage", { action: "list", loopName: ownerHarness.name }],
			["stardock_stage", { action: "reconcile", loopName: ownerHarness.name }],
		];
		for (const name of ["stardock_brief", "stardock_worker", "stardock_governor_state", "stardock_brief_worker", "stardock_auditor", "stardock_ledger", "stardock_final_report", "stardock_worker_report", "stardock_breakout", "stardock_handoff"]) {
			readOnlyCalls.push([name, { action: "list", loopName: ownerHarness.name }]);
		}
		for (const [name, params] of readOnlyCalls) {
			const tool = sibling.tools.get(name as string);
			assert.ok(tool, `missing ${String(name)}`);
			const result = await tool.execute("read-only", params, undefined, undefined, sibling.ctx);
			assert.notEqual(result.details?.code, "non_owner", `${String(name)} should remain read-only`);
		}
		const mutationCalls = [
			["stardock_done", {}],
			["stardock_complete", {}],
			["stardock_brief", { action: "upsert", loopName: ownerHarness.name }],
			["stardock_worker", { action: "run", loopName: ownerHarness.name }],
			["stardock_worker", { action: "review", loopName: ownerHarness.name }],
			["stardock_ledger", { action: "recordArtifact", loopName: ownerHarness.name }],
			["stardock_auditor", { action: "record", loopName: ownerHarness.name }],
			["stardock_final_report", { action: "record", loopName: ownerHarness.name }],
			["stardock_worker_report", { action: "record", loopName: ownerHarness.name }],
			["stardock_breakout", { action: "record", loopName: ownerHarness.name }],
			["stardock_handoff", { action: "record", loopName: ownerHarness.name }],
		];
		for (const [name, params] of mutationCalls) {
			const result = await sibling.tools.get(name as string).execute("mutation", params, undefined, undefined, sibling.ctx);
			assert.equal(result.details?.code, "non_owner", `${String(name)} should be owner-guarded`);
		}
		detachOwnedStages(ownerHarness.ctx, acquisition.details.acquisition.owner.sessionId);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("owner pause leaves detached recoverable ownership and stops further owner heartbeat mutation", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-owner-pause-"));
	try {
		const harness = await startGraph(cwd, "Owner Pause");
		const acquisition = await harness.tools.get("stardock_stage").execute("acquire", {
			action: "acquire",
			loopName: harness.name,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: harness.graph.revision,
		}, undefined, undefined, harness.ctx);
		assert.equal(acquisition.details.ok, true);
		await harness.commands.get("stardock").handler("stop", harness.ctx);
		const state = loadState(harness.ctx, harness.name);
		assert.equal(state?.status, "paused");
		assert.equal(state?.executionGraph?.ownership?.status, "detached");
		assert.equal(state?.executionGraph?.stages[0].status, "detached");
		assert.equal(fs.existsSync(stageOwnerFile(cwd, harness.name)), true);
		const heartbeat = await harness.tools.get("stardock_stage").execute("heartbeat", { action: "heartbeat", loopName: harness.name }, undefined, undefined, harness.ctx);
		assert.equal(heartbeat.details.code, "non_owner");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("dead matching owner and mutex require approved reconciliation before quarantine and takeover", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-owner-reconcile-"));
	try {
		const { name, graph } = await startGraph(cwd, "Owner Reconcile");
		const gate = path.join(cwd, "start-owner");
		const child = runAcquisitionChild([cwd, name, graph.id, graph.stages[0].id, String(graph.revision), "dead-child", gate]);
		fs.writeFileSync(gate, "go", "utf-8");
		const childResult = await child;
		assert.equal(childResult.result.ok, true);
		const ctx = { cwd } as never;
		const ownerPath = path.join(runDir(cwd, name), "stage-owner.json");
		const owner = JSON.parse(fs.readFileSync(ownerPath, "utf-8"));
		fs.writeFileSync(path.join(runDir(cwd, name), "state-mutation.json"), JSON.stringify({
			version: 1,
			graphId: owner.graphId,
			stageId: owner.stageId,
			sessionId: owner.sessionId,
			pid: owner.pid,
			tokenDigest: owner.tokenDigest,
			acquiredAt: owner.acquiredAt,
		}, null, 2));
		const inspection = inspectStageOwnership(ctx, name);
		assert.equal(inspection.ownerProcess, "dead");
		assert.equal(inspection.mutexMatchesOwner, true);
		assert.throws(() => mutateState(ctx, name, (state) => { state.iteration += 1; }, { mutexWaitMs: 20 }), /owned by session/);
		assert.throws(() => reconcileStageOwnership(ctx, { loopName: name, takeOwnership: true, sessionId: "takeover" }), /rationale/);
		const priorRevision = inspection.stateRevision;
		const priorOwnership = inspection.stateOwnership;
		const takeover = reconcileStageOwnership(ctx, {
			loopName: name,
			takeOwnership: true,
			rationale: "The child process exited after durable acquisition.",
			approvalRef: "approval:test",
			classification: "No worker or Treehouse lease was started.",
			sessionId: "takeover",
		});
		assert.equal("ok" in takeover, true);
		assert.equal(takeover.stateRevision, Number(priorRevision) + 1);
		assert.notDeepEqual(inspectStageOwnership(ctx, name).stateOwnership, priorOwnership);
		assert.equal(fs.readdirSync(path.join(runDir(cwd, name), "ownership-quarantine")).length, 2);
		assert.equal(fs.existsSync(path.join(runDir(cwd, name), "state-mutation.json")), false);
		detachOwnedStages(ctx, "takeover");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("dead standalone mutex remains durable and bounded mutation wait never auto-clears it", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-owner-mutex-"));
	try {
		const { ctx, name, graph } = await startGraph(cwd, "Dead Mutex");
		const mutexPath = path.join(runDir(cwd, name), "state-mutation.json");
		fs.writeFileSync(mutexPath, JSON.stringify({
			version: 1,
			graphId: graph.id,
			sessionId: "dead-mutex",
			pid: 99999999,
			tokenDigest: "a".repeat(64),
			acquiredAt: "2026-07-21T00:00:00.000Z",
		}, null, 2));
		assert.throws(
			() => mutateState(ctx, name, (state) => { state.iteration += 1; }, { mutexWaitMs: 20 }),
			(error: unknown) => error instanceof OwnershipProtocolError && error.code === "mutex_busy",
		);
		assert.equal(fs.existsSync(mutexPath), true);
		const inspection = inspectStageOwnership(ctx, name);
		assert.equal(inspection.owner, null);
		assert.equal(inspection.mutexProcess, "dead");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("automatic heartbeat skips one busy tick and later preserves the latest owner revision", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-owner-heartbeat-race-"));
	try {
		const harness = await startGraph(cwd, "Owner Heartbeat Race");
		const stage = harness.tools.get("stardock_stage");
		const acquisition = await stage.execute("acquire", {
			action: "acquire",
			loopName: harness.name,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: harness.graph.revision,
		}, undefined, undefined, harness.ctx);
		assert.equal(acquisition.details.ok, true);
		const owner = JSON.parse(fs.readFileSync(stageOwnerFile(cwd, harness.name), "utf-8"));
		const held = {
			version: 1 as const,
			graphId: owner.graphId,
			stageId: owner.stageId,
			sessionId: owner.sessionId,
			pid: process.pid,
			tokenDigest: owner.tokenDigest,
			acquiredAt: new Date().toISOString(),
		};
		acquireMutationMutex(harness.ctx, harness.name, held);
		const beforeBusyTick = owner.heartbeatAt;
		await new Promise((resolve) => setTimeout(resolve, HEARTBEAT_INTERVAL_WAIT_MS));
		assert.equal(JSON.parse(fs.readFileSync(stageOwnerFile(cwd, harness.name), "utf-8")).heartbeatAt, beforeBusyTick);
		releaseMatchingMutationMutex(harness.ctx, harness.name, held.tokenDigest);
		mutateState(harness.ctx, harness.name, (state) => { state.iteration += 1; });
		const revisionAfterMutation = loadState(harness.ctx, harness.name)?.executionGraph?.revision;
		await new Promise((resolve) => setTimeout(resolve, HEARTBEAT_INTERVAL_WAIT_MS));
		const afterRecovery = JSON.parse(fs.readFileSync(stageOwnerFile(cwd, harness.name), "utf-8"));
		assert.ok(Date.parse(afterRecovery.heartbeatAt) > Date.parse(beforeBusyTick));
		assert.equal(afterRecovery.stateRevision, revisionAfterMutation);
		detachOwnedStages(harness.ctx, acquisition.details.acquisition.owner.sessionId);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("malformed ownership evidence and orphaned graph ownership fail closed", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-owner-malformed-"));
	try {
		const harness = await startGraph(cwd, "Owner Malformed");
		const stage = harness.tools.get("stardock_stage");
		const acquisition = await stage.execute("acquire", {
			action: "acquire",
			loopName: harness.name,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: harness.graph.revision,
		}, undefined, undefined, harness.ctx);
		assert.equal(acquisition.details.ok, true);
		fs.writeFileSync(stageOwnerFile(cwd, harness.name), "{not-json", "utf-8");
		assert.throws(
			() => mutateState(harness.ctx, harness.name, (state) => { state.iteration += 1; }),
			(error: unknown) => error instanceof OwnershipProtocolError && error.code === "evidence_malformed",
		);
		fs.unlinkSync(stageOwnerFile(cwd, harness.name));
		assert.throws(
			() => mutateState(harness.ctx, harness.name, (state) => { state.iteration += 1; }),
			(error: unknown) => error instanceof OwnershipProtocolError && error.code === "owner_orphaned",
		);
		fs.writeFileSync(stateMutexFile(cwd, harness.name), "[]", "utf-8");
		assert.throws(
			() => inspectStageOwnership(harness.ctx, harness.name),
			(error: unknown) => error instanceof OwnershipProtocolError && error.code === "evidence_malformed",
		);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("acquisition revalidates graph digest, complete readiness, and terminal status", async () => {
	for (const scenario of ["digest", "readiness", "terminal"] as const) {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `pi-stardock-owner-${scenario}-`));
		try {
			const harness = await startGraph(cwd, `Owner ${scenario}`);
			const raw = JSON.parse(fs.readFileSync(statePath(cwd, harness.name), "utf-8"));
			if (scenario === "digest") raw.executionGraph.stages[0].contractDigest = "0".repeat(64);
			if (scenario === "readiness") raw.executionGraph.nodes.find((node: { id: string }) => node.id === "wave-a").status = "running";
			if (scenario === "terminal") raw.executionGraph.stages[0].status = "integrated";
			fs.writeFileSync(statePath(cwd, harness.name), JSON.stringify(raw, null, 2));
			const result = await harness.tools.get("stardock_stage").execute("acquire", {
				action: "acquire",
				loopName: harness.name,
				graphId: harness.graph.id,
				stageId: harness.graph.stages[0].id,
				expectedGraphRevision: harness.graph.revision,
			}, undefined, undefined, harness.ctx);
			if (scenario === "digest") assert.equal(result.details.code, "graph_invalid");
			if (scenario === "readiness") assert.equal(result.details.code, "stage_unready");
			if (scenario === "terminal") assert.equal(result.details.code, "stage_terminal");
			assert.equal(fs.existsSync(stageOwnerFile(cwd, harness.name)), false);
		} finally {
			fs.rmSync(cwd, { recursive: true, force: true });
		}
	}
});

test("killed standalone mutex holder requires approved quarantine before reacquisition", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-owner-killed-mutex-"));
	try {
		const { name, graph } = await startGraph(cwd, "Killed Mutex");
		const readyPath = path.join(cwd, "mutex-ready");
		const tokenDigest = "b".repeat(64);
		const child = spawn(process.execPath, [
			"--experimental-strip-types",
			MUTEX_CHILD_FIXTURE,
			cwd,
			name,
			graph.id,
			graph.stages[0].id,
			"killed-holder",
			tokenDigest,
			readyPath,
		], { stdio: "ignore" });
		await waitForFile(readyPath);
		child.kill("SIGKILL");
		await new Promise<void>((resolve) => child.once("close", () => resolve()));
		const ctx = { cwd } as never;
		assert.equal(inspectStageOwnership(ctx, name).mutexProcess, "dead");
		const result = reconcileStageOwnership(ctx, {
			loopName: name,
			takeOwnership: true,
			rationale: "The standalone mutex holder was killed during the guarded mutation.",
			approvalRef: "approval:killed-mutex",
			classification: "No owner, WorkerRun, or Treehouse lease exists.",
			graphId: graph.id,
			stageId: graph.stages[0].id,
			sessionId: "recovered-holder",
		});
		assert.equal("ok" in result, true);
		assert.equal(fs.readdirSync(path.join(runDir(cwd, name), "ownership-quarantine")).length, 1);
		detachOwnedStages(ctx, "recovered-holder");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("approved reconciliation recovers orphaned persisted ownership but refuses live evidence", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-owner-orphan-"));
	try {
		const harness = await startGraph(cwd, "Owner Orphan");
		const stage = harness.tools.get("stardock_stage");
		const acquisition = await stage.execute("acquire", {
			action: "acquire",
			loopName: harness.name,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: harness.graph.revision,
		}, undefined, undefined, harness.ctx);
		assert.equal(acquisition.details.ok, true);
		fs.unlinkSync(stageOwnerFile(cwd, harness.name));
		assert.throws(() => reconcileStageOwnership(harness.ctx, {
			loopName: harness.name,
			takeOwnership: true,
			rationale: "Owner record was lost.",
			approvalRef: "approval:orphan",
			classification: "No worker or lease exists.",
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			sessionId: "replacement",
		}), (error: unknown) => error instanceof OwnershipProtocolError && error.code === "owner_live");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("approved reconciliation recovers dead orphaned persisted ownership", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-owner-dead-orphan-"));
	try {
		const { name, graph } = await startGraph(cwd, "Dead Owner Orphan");
		const gate = path.join(cwd, "start-dead-orphan");
		const child = runAcquisitionChild([cwd, name, graph.id, graph.stages[0].id, String(graph.revision), "dead-orphan", gate]);
		fs.writeFileSync(gate, "go", "utf-8");
		const childResult = await child;
		assert.equal(childResult.result.ok, true);
		fs.unlinkSync(stageOwnerFile(cwd, name));
		const ctx = { cwd } as never;
		const result = reconcileStageOwnership(ctx, {
			loopName: name,
			takeOwnership: true,
			rationale: "The owner process exited and its owner file was lost.",
			approvalRef: "approval:dead-orphan",
			classification: "No worker or Treehouse lease was started.",
			graphId: graph.id,
			stageId: graph.stages[0].id,
			sessionId: "dead-orphan-replacement",
		});
		assert.equal("ok" in result, true);
		assert.equal(inspectStageOwnership(ctx, name).stateMatchesOwner, true);
		detachOwnedStages(ctx, "dead-orphan-replacement");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
