import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { loadState, mutateState, saveState } from "../src/state/store.ts";
import { startOwnershipGraph as startGraph } from "./stage-ownership-test-support.ts";
import { runDir } from "./test-harness.ts";

test("attempt identities and once-set refs are immutable while commit and validation histories are append-only", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-owner-attempt-history-"));
	try {
		const harness = await startGraph(cwd, "Attempt History");
		mutateState(harness.ctx, harness.name, (state) => {
			const node = state.executionGraph?.nodes.find((value) => value.id === "wave-a");
			assert.ok(node);
			node.attempts.push({
				id: "attempt-open",
				baseCommit: "1".repeat(40),
				branchRef: "stardock/wave-a/attempt-open",
				laneCommits: [],
				validation: [],
				startedAt: "2026-07-21T00:00:00.000Z",
			}, {
				id: "attempt-next",
				baseCommit: "1".repeat(40),
				branchRef: "stardock/wave-a/attempt-next",
				laneCommits: [],
				validation: [],
				startedAt: "2026-07-21T00:02:00.000Z",
			});
		});
		const appended = loadState(harness.ctx, harness.name);
		assert.ok(appended);
		const appendedAttempt = appended.executionGraph?.nodes.find((value) => value.id === "wave-a")?.attempts[0];
		assert.ok(appendedAttempt);
		appendedAttempt.laneCommits.push("2".repeat(40));
		appendedAttempt.validation.push({ command: "npm test", result: "passed", summary: "passed" });
		appendedAttempt.headCommit = "2".repeat(40);
		saveState(harness.ctx, appended);

		const changedNodeContract = loadState(harness.ctx, harness.name);
		assert.ok(changedNodeContract);
		const contractNode = changedNodeContract.executionGraph?.nodes.find((value) => value.id === "wave-a");
		assert.ok(contractNode);
		contractNode.objective = "silently changed objective";
		assert.throws(() => saveState(harness.ctx, changedNodeContract), /node "wave-a" contract cannot change/);

		const changedStageContract = loadState(harness.ctx, harness.name);
		assert.ok(changedStageContract);
		const stageContract = changedStageContract.executionGraph?.stages[0];
		assert.ok(stageContract);
		stageContract.maxConcurrency += 1;
		assert.throws(() => saveState(harness.ctx, changedStageContract), /stage "wave-stage" contract cannot change/);

		const changedIdentity = loadState(harness.ctx, harness.name);
		assert.ok(changedIdentity);
		const changedAttempt = changedIdentity.executionGraph?.nodes.find((value) => value.id === "wave-a")?.attempts[0];
		assert.ok(changedAttempt);
		changedAttempt.baseCommit = "3".repeat(40);
		assert.throws(() => saveState(harness.ctx, changedIdentity), /immutable/);

		const rewrittenHistory = loadState(harness.ctx, harness.name);
		assert.ok(rewrittenHistory);
		const rewrittenAttempt = rewrittenHistory.executionGraph?.nodes.find((value) => value.id === "wave-a")?.attempts[0];
		assert.ok(rewrittenAttempt);
		rewrittenAttempt.laneCommits[0] = "4".repeat(40);
		assert.throws(() => saveState(harness.ctx, rewrittenHistory), /append-only/);

		const changedOnceSet = loadState(harness.ctx, harness.name);
		assert.ok(changedOnceSet);
		const onceSetAttempt = changedOnceSet.executionGraph?.nodes.find((value) => value.id === "wave-a")?.attempts[0];
		assert.ok(onceSetAttempt);
		onceSetAttempt.headCommit = "5".repeat(40);
		assert.throws(() => saveState(harness.ctx, changedOnceSet), /once-set/);

		const reordered = loadState(harness.ctx, harness.name);
		assert.ok(reordered);
		const reorderedNode = reordered.executionGraph?.nodes.find((value) => value.id === "wave-a");
		assert.ok(reorderedNode);
		reorderedNode.attempts.reverse();
		assert.throws(() => saveState(harness.ctx, reordered), /attempt order is append-only/);

		const duplicateAcrossNodes = loadState(harness.ctx, harness.name);
		assert.ok(duplicateAcrossNodes);
		const secondNode = duplicateAcrossNodes.executionGraph?.nodes.find((value) => value.id === "wave-b");
		assert.ok(secondNode);
		secondNode.attempts.push({
			id: "attempt-open",
			baseCommit: "1".repeat(40),
			branchRef: "stardock/wave-b/attempt-open",
			laneCommits: [],
			validation: [],
			startedAt: "2026-07-21T00:03:00.000Z",
		});
		assert.throws(() => saveState(harness.ctx, duplicateAcrossNodes), /unique across the graph/);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("session shutdown detaches running work and completed attempts remain immutable", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-owner-shutdown-"));
	try {
		const harness = await startGraph(cwd, "Owner Shutdown");
		const stage = harness.tools.get("stardock_stage");
		const acquisition = await stage.execute("acquire", {
			action: "acquire",
			loopName: harness.name,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: harness.graph.revision,
		}, undefined, undefined, harness.ctx);
		mutateState(harness.ctx, harness.name, (state) => {
			const node = state.executionGraph?.nodes.find((value) => value.id === "wave-a");
			assert.ok(node);
			node.status = "running";
			node.attempts.push({
				id: "attempt-1",
				baseCommit: "1".repeat(40),
				branchRef: "stardock/wave-a/attempt-1",
				laneCommits: ["2".repeat(40)],
				headCommit: "2".repeat(40),
				validation: [],
				startedAt: "2026-07-21T00:00:00.000Z",
				completedAt: "2026-07-21T00:01:00.000Z",
			});
		});
		const ownerTampered = loadState(harness.ctx, harness.name);
		assert.ok(ownerTampered);
		const ownerAttempt = ownerTampered.executionGraph?.nodes.find((value) => value.id === "wave-a")?.attempts[0];
		assert.ok(ownerAttempt);
		ownerAttempt.branchRef = "changed";
		assert.throws(() => saveState(harness.ctx, ownerTampered), /immutable/);

		for (const handler of harness.handlers.get("session_shutdown") ?? []) await handler({}, harness.ctx);
		const detached = loadState(harness.ctx, harness.name);
		const node = detached?.executionGraph?.nodes.find((value) => value.id === "wave-a");
		assert.equal(node?.status, "detached");
		assert.equal(detached?.executionGraph?.stages[0].status, "detached");
		assert.equal(detached?.executionGraph?.ownership?.status, "detached");
		assert.equal(node?.attempts.length, 1);
		assert.equal(fs.existsSync(path.join(runDir(cwd, harness.name), "stage-owner.json")), true);
		assert.equal(acquisition.details.ok, true);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
