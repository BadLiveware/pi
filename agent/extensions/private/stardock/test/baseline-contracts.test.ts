import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { runSubagentThroughBridge, type EventBus } from "../src/brief-worker-run-bridge.ts";
import { makeHarness, statePath } from "./test-harness.ts";

const REGISTERED_TOOL_NAMES = [
	"stardock_advisory_adapter",
	"stardock_attempt_report",
	"stardock_auditor",
	"stardock_breakout",
	"stardock_brief",
	"stardock_brief_worker",
	"stardock_complete",
	"stardock_done",
	"stardock_final_report",
	"stardock_govern",
	"stardock_governor_state",
	"stardock_handoff",
	"stardock_integrate",
	"stardock_ledger",
	"stardock_outside_answer",
	"stardock_outside_payload",
	"stardock_outside_requests",
	"stardock_plan",
	"stardock_policy",
	"stardock_recover",
	"stardock_review",
	"stardock_run",
	"stardock_stage",
	"stardock_start",
	"stardock_state",
	"stardock_status",
	"stardock_worker",
	"stardock_worker_report",
] as const;

const STATE_KEYS = [
	"active",
	"advisoryHandoffs",
	"auditorReviews",
	"baselineValidations",
	"breakoutPackages",
	"briefs",
	"criterionLedger",
	"executionGraph",
	"finalVerificationReports",
	"governorState",
	"itemsPerIteration",
	"iteration",
	"lastReflectionAt",
	"maxIterations",
	"mode",
	"modeState",
	"name",
	"outsideRequests",
	"reflectEvery",
	"reflectInstructions",
	"schemaVersion",
	"startedAt",
	"status",
	"taskFile",
	"verificationArtifacts",
	"workerReports",
	"workerRuns",
] as const;

class FakeEventBus implements EventBus {
	readonly emitted: Array<{ event: string; data: unknown }> = [];
	private readonly handlers = new Map<string, Set<(data: unknown) => void>>();

	on(event: string, handler: (data: unknown) => void): () => void {
		const handlers = this.handlers.get(event) ?? new Set();
		handlers.add(handler);
		this.handlers.set(event, handlers);
		return () => handlers.delete(handler);
	}

	emit(event: string, data: unknown): void {
		this.emitted.push({ event, data });
		for (const handler of [...(this.handlers.get(event) ?? [])]) handler(data);
	}
}

test("baseline tool surface registers the exact current taxonomy", () => {
	const { tools } = makeHarness(os.tmpdir());
	assert.deepEqual([...tools.keys()].sort(), [...REGISTERED_TOOL_NAMES]);
});

test("baseline state writes the exact current schema-v3 top-level shape", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-baseline-state-"));
	try {
		const { tools, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		assert.ok(start);
		await start.execute("baseline-state", { name: "Baseline Shape", mode: "checklist", taskContent: "# Baseline shape\n" }, undefined, undefined, ctx);

		const raw = JSON.parse(fs.readFileSync(statePath(cwd, "Baseline_Shape"), "utf-8"));
		assert.equal(raw.schemaVersion, 3);
		assert.equal(raw.active, true);
		assert.equal(raw.itemsPerIteration, 0);
		assert.deepEqual(Object.keys(raw).sort(), [...STATE_KEYS]);
		assert.deepEqual(Object.keys(raw.modeState).sort(), ["kind"]);
		assert.deepEqual(raw.executionGraph.nodes, []);
		assert.deepEqual(raw.executionGraph.stages, []);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("baseline bridge forwards start, multiple updates, and response events", async () => {
	const events = new FakeEventBus();
	const updates: Array<{ text: string; details?: Record<string, unknown> }> = [];
	events.on("subagent:slash:request", (data) => {
		const requestId = (data as { requestId: string }).requestId;
		events.emit("subagent:slash:started", { requestId });
		events.emit("subagent:slash:update", { requestId, currentTool: "read", toolCount: 1 });
		events.emit("subagent:slash:update", { requestId, currentTool: "grep", toolCount: 2 });
		events.emit("subagent:slash:response", {
			requestId,
			isError: false,
			result: { content: [{ type: "text", text: "finished" }] },
		});
	});

	const response = await runSubagentThroughBridge({
		events,
		requestId: "request-success",
		params: { agent: "implementer" },
		onUpdate: (text, details) => updates.push({ text, details }),
	});

	assert.equal(response.requestId, "request-success");
	assert.equal(response.isError, false);
	assert.deepEqual(updates.map((update) => update.text), [
		"Subagent run started.",
		"Subagent running. Current tool: read.",
		"Subagent running. Current tool: grep.",
	]);
	assert.equal((updates[2].details?.update as { toolCount: number }).toolCount, 2);
});

test("baseline bridge rejects a pre-aborted call without emitting request or cancellation events", async () => {
	const events = new FakeEventBus();
	const controller = new AbortController();
	controller.abort();

	await assert.rejects(
		runSubagentThroughBridge({ events, requestId: "request-pre-aborted", params: {}, signal: controller.signal, cancellationSettlementMs: 5 }),
		/Subagent run cancelled before request dispatch/,
	);
	assert.deepEqual(events.emitted, []);
});

test("baseline bridge cancellation waits for the matching terminal acknowledgement", async () => {
	const events = new FakeEventBus();
	const controller = new AbortController();
	let acknowledged = false;
	events.on("subagent:slash:request", (data) => {
		const requestId = (data as { requestId: string }).requestId;
		events.emit("subagent:slash:started", { requestId });
		controller.abort();
	});
	events.on("subagent:slash:cancel", (data) => {
		const requestId = (data as { requestId: string }).requestId;
		setTimeout(() => {
			acknowledged = true;
			events.emit("subagent:slash:response", {
				requestId,
				isError: true,
				errorText: "cancelled",
				result: { content: [{ type: "text", text: "cancelled" }], isError: true },
			});
		}, 10);
	});

	await assert.rejects(
		runSubagentThroughBridge({ events, requestId: "request-cancel", params: {}, signal: controller.signal, cancellationSettlementMs: 100 }),
		/Subagent run cancelled after bridge acknowledgement/,
	);
	assert.equal(acknowledged, true);
	assert.ok(events.emitted.some(({ event, data }) => event === "subagent:slash:cancel" && (data as { requestId: string }).requestId === "request-cancel"));
});

test("baseline bridge cancellation fails explicitly after a bounded unconfirmed settlement", async () => {
	const events = new FakeEventBus();
	const controller = new AbortController();
	events.on("subagent:slash:request", (data) => {
		const requestId = (data as { requestId: string }).requestId;
		events.emit("subagent:slash:started", { requestId });
		controller.abort();
	});

	await assert.rejects(
		runSubagentThroughBridge({ events, requestId: "request-unconfirmed-cancel", params: {}, signal: controller.signal, cancellationSettlementMs: 5 }),
		/cancellation was not confirmed within 5ms/,
	);
});

test("baseline bridge preserves provider failure responses", async () => {
	const events = new FakeEventBus();
	events.on("subagent:slash:request", (data) => {
		const requestId = (data as { requestId: string }).requestId;
		events.emit("subagent:slash:started", { requestId });
		events.emit("subagent:slash:response", {
			requestId,
			isError: true,
			errorText: "bridge worker failed",
			result: { content: [{ type: "text", text: "failed" }], isError: true },
		});
	});

	const response = await runSubagentThroughBridge({ events, requestId: "request-failure", params: {} });
	assert.equal(response.isError, true);
	assert.equal(response.errorText, "bridge worker failed");
});

test("baseline commands keep status, archived list, pause, and force-complete semantics", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-baseline-commands-"));
	try {
		const { tools, commands, notifications, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const stardock = commands.get("stardock");
		const forceComplete = commands.get("stardock-stop");
		assert.ok(start);
		assert.ok(stardock);
		assert.ok(forceComplete);

		await start.execute("baseline-paused", { name: "Paused Loop", mode: "checklist", taskContent: "# Paused\n" }, undefined, undefined, ctx);
		await stardock.handler("stop", ctx);
		assert.equal(JSON.parse(fs.readFileSync(statePath(cwd, "Paused_Loop"), "utf-8")).status, "paused");

		await start.execute("baseline-completed", { name: "Completed Loop", mode: "checklist", taskContent: "# Completed\n" }, undefined, undefined, ctx);
		await forceComplete.handler("", ctx);
		assert.equal(JSON.parse(fs.readFileSync(statePath(cwd, "Completed_Loop"), "utf-8")).status, "completed");
		await stardock.handler("archive Completed_Loop", ctx);

		await stardock.handler("status", ctx);
		assert.match(notifications.at(-1) ?? "", /Paused_Loop: .*paused/);
		assert.doesNotMatch(notifications.at(-1) ?? "", /Completed_Loop/);

		await stardock.handler("list --archived", ctx);
		assert.match(notifications.at(-1) ?? "", /Archived loops:/);
		assert.match(notifications.at(-1) ?? "", /Completed_Loop: .*completed/);
		assert.doesNotMatch(notifications.at(-1) ?? "", /Paused_Loop/);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
