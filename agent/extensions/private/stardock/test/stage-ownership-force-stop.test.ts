import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { loadState } from "../src/state/store.ts";
import { acquireMutationMutex, digestOwnershipToken, generateOwnershipToken, releaseMatchingMutationMutex } from "../src/stages/ownership-records.ts";
import { registerActiveStageRun, requestActiveStageRunCancellation } from "../src/stages/run-ready-registry.ts";
import { stageOwnerFile, startOwnershipGraph as startGraph } from "./stage-ownership-test-support.ts";
import { makeHarness, runDir } from "./test-harness.ts";

test("owner stardock-stop pauses an inactive stage without removing custody", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-owner-force-stop-"));
	try {
		const ownerHarness = await startGraph(cwd, "Owner Force Stop");
		const stage = ownerHarness.tools.get("stardock_stage");
		const acquisition = await stage.execute("acquire", {
			action: "acquire",
			loopName: ownerHarness.name,
			graphId: ownerHarness.graph.id,
			stageId: ownerHarness.graph.stages[0].id,
			expectedGraphRevision: ownerHarness.graph.revision,
		}, undefined, undefined, ownerHarness.ctx);
		assert.equal(acquisition.details.ok, true);
		assert.equal(fs.existsSync(stageOwnerFile(cwd, ownerHarness.name)), true);

		await ownerHarness.commands.get("stardock-stop").handler("", ownerHarness.ctx);

		const state = loadState(ownerHarness.ctx, ownerHarness.name);
		assert.equal(state?.status, "paused");
		assert.equal(state?.executionGraph?.ownership?.status, "detached");
		assert.equal(fs.existsSync(stageOwnerFile(cwd, ownerHarness.name)), true);
		assert.ok(ownerHarness.notifications.some((message) => message.includes("Stopped Stardock loop")));

		// The quarantined owner can no longer heartbeat or mutate the loop.
		const heartbeat = await stage.execute("heartbeat", { action: "heartbeat", loopName: ownerHarness.name }, undefined, undefined, ownerHarness.ctx);
		assert.notEqual(heartbeat.details.ok, true);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("stardock-stop leaves foreign inactive custody for explicit recovery", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-owner-foreign-stop-"));
	try {
		const ownerHarness = await startGraph(cwd, "Foreign Force Stop");
		const stage = ownerHarness.tools.get("stardock_stage");
		const acquisition = await stage.execute("acquire", {
			action: "acquire", loopName: ownerHarness.name, graphId: ownerHarness.graph.id,
			stageId: ownerHarness.graph.stages[0].id, expectedGraphRevision: ownerHarness.graph.revision,
		}, undefined, undefined, ownerHarness.ctx);
		assert.equal(acquisition.details.ok, true);
		const sibling = makeHarness(cwd);
		for (const handler of sibling.handlers.get("session_start") ?? []) await handler({}, sibling.ctx);
		await sibling.commands.get("stardock-stop").handler("", sibling.ctx);
		assert.equal(loadState(ownerHarness.ctx, ownerHarness.name)?.status, "active");
		assert.equal(fs.existsSync(stageOwnerFile(cwd, ownerHarness.name)), true);
		assert.ok(sibling.notifications.some((message) => message.includes("pending") && message.includes("another session")));
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("stardock-stop preserves a live mutation lock and retries the same loop", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-owner-mutex-stop-"));
	try {
		const first = await startGraph(cwd, "Pending First");
		const second = await startGraph(cwd, "Pending Second");
		const sibling = makeHarness(cwd);
		for (const handler of sibling.handlers.get("session_start") ?? []) await handler({}, sibling.ctx);
		const tokenDigest = digestOwnershipToken(generateOwnershipToken());
		acquireMutationMutex(first.ctx, first.name, {
			version: 1, graphId: first.graph.id, sessionId: "concurrent-writer", pid: process.pid,
			tokenDigest, acquiredAt: new Date().toISOString(),
		});
		try {
			await sibling.commands.get("stardock-stop").handler(first.name, sibling.ctx);
			assert.equal(loadState(first.ctx, first.name)?.status, "active");
			assert.ok(sibling.notifications.some((message) => message.includes("pending")));
		} finally {
			releaseMatchingMutationMutex(first.ctx, first.name, tokenDigest);
		}
		await sibling.commands.get("stardock-stop").handler("", sibling.ctx);
		assert.equal(loadState(first.ctx, first.name)?.status, "completed");
		assert.equal(loadState(second.ctx, second.name)?.status, "active");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("runReady cancellation is visible across command and tool contexts", () => {
	const controller = new AbortController();
	const unregister = registerActiveStageRun({} as any, { loopName: "local", sessionId: "session", controller });
	try {
		assert.equal(requestActiveStageRunCancellation("other", "local"), false);
		assert.equal(requestActiveStageRunCancellation("session", "local"), true);
		assert.equal(controller.signal.aborted, true);
	} finally {
		unregister();
	}
	assert.equal(requestActiveStageRunCancellation("session", "local"), false);
});

test("stardock-stop requests local cancellation before releasing custody", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-owner-local-stop-"));
	try {
		const harness = await startGraph(cwd, "Local Force Stop");
		const stage = harness.tools.get("stardock_stage");
		const acquisition = await stage.execute("acquire", {
			action: "acquire", loopName: harness.name, graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id, expectedGraphRevision: harness.graph.revision,
		}, undefined, undefined, harness.ctx);
		assert.equal(acquisition.details.ok, true);
		const ownerSessionId = loadState(harness.ctx, harness.name)!.executionGraph!.ownership!.sessionId;
		const controller = new AbortController();
		const unregister = registerActiveStageRun(harness.ctx, { loopName: harness.name, sessionId: ownerSessionId, controller });
		try {
			await harness.commands.get("stardock-stop").handler("", harness.ctx);
			assert.equal(controller.signal.aborted, true);
			assert.equal(fs.existsSync(stageOwnerFile(cwd, harness.name)), true);
			assert.ok(harness.notifications.some((message) => message.includes("pending")));
		} finally {
			unregister();
		}
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("stardock-stop retains foreign custody while a worker is running", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-owner-active-stop-"));
	try {
		const ownerHarness = await startGraph(cwd, "Active Force Stop");
		const stage = ownerHarness.tools.get("stardock_stage");
		const acquisition = await stage.execute("acquire", {
			action: "acquire", loopName: ownerHarness.name, graphId: ownerHarness.graph.id,
			stageId: ownerHarness.graph.stages[0].id, expectedGraphRevision: ownerHarness.graph.revision,
		}, undefined, undefined, ownerHarness.ctx);
		assert.equal(acquisition.details.ok, true);
		const before = loadState(ownerHarness.ctx, ownerHarness.name)!;
		const worker = { id: "live-worker", requestId: "live-request", role: "implementer", status: "running",
			graphId: before.executionGraph!.id, stageId: before.executionGraph!.stages[0].id };
		const stateFile = path.join(runDir(cwd, ownerHarness.name), "state.json");
		fs.writeFileSync(stateFile, JSON.stringify({ ...before, workerRuns: [...before.workerRuns, worker] }, null, 2));

		const sibling = makeHarness(cwd);
		for (const handler of sibling.handlers.get("session_start") ?? []) await handler({}, sibling.ctx);
		await sibling.commands.get("stardock-stop").handler("", sibling.ctx);
		const after = loadState(ownerHarness.ctx, ownerHarness.name)!;
		assert.equal(after.executionGraph?.ownership?.sessionId, before.executionGraph?.ownership?.sessionId);
		assert.equal(fs.existsSync(stageOwnerFile(cwd, ownerHarness.name)), true);
		assert.equal(after.status, "active");
		assert.ok(sibling.notifications.some((message) => message.includes("pending") && message.includes("worker")));
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
