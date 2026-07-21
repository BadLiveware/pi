import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { detachOwnedStages } from "../src/stages/ownership.ts";
import { cancelActiveStageRuns } from "../src/stages/run-ready-registry.ts";
import { runReadyStage } from "../src/stages/run-ready.ts";
import { FakeAdapter, startFiveLane } from "./stage-run-ready-test-support.ts";

test("session shutdown waits for every started bridge cancellation acknowledgement", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stage-run-ready-bridge-shutdown-"));
	try {
		const harness = await startFiveLane(cwd);
		const sessionId = "run-ready-bridge-shutdown-test";
		const startedIds: string[] = [];
		const acknowledgedIds: string[] = [];
		let resolveStarted: () => void = () => undefined;
		const twoStarted = new Promise<void>((resolve) => { resolveStarted = resolve; });
		harness.events.on("subagent:slash:request", (data) => {
			const requestId = (data as { requestId: string }).requestId;
			startedIds.push(requestId);
			harness.events.emit("subagent:slash:started", { requestId });
			if (startedIds.length === 2) resolveStarted();
		});
		harness.events.on("subagent:slash:cancel", (data) => {
			const requestId = (data as { requestId: string }).requestId;
			setTimeout(() => {
				acknowledgedIds.push(requestId);
				harness.events.emit("subagent:slash:response", {
					requestId,
					isError: true,
					errorText: "cancelled and settled",
					result: { content: [{ type: "text", text: "cancelled and settled" }], isError: true },
				});
			}, 15);
		});
		const run = runReadyStage({ events: harness.events } as any, harness.ctx, {
			loopName: harness.loopName,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: harness.graph.revision,
			sessionId,
		}, undefined, undefined, { adapter: new FakeAdapter() });
		await twoStarted;
		let shutdownSettled = false;
		const shutdown = cancelActiveStageRuns(harness.ctx, sessionId).then((cancelled) => {
			shutdownSettled = true;
			return cancelled;
		});
		await new Promise((resolve) => setTimeout(resolve, 2));
		assert.equal(shutdownSettled, false);
		const [cancelled, result] = await Promise.all([shutdown, run]);
		assert.deepEqual(cancelled, [harness.loopName]);
		assert.deepEqual(new Set(acknowledgedIds), new Set(startedIds));
		assert.equal(result.counts.detached, 5);
		detachOwnedStages(harness.ctx, sessionId);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
