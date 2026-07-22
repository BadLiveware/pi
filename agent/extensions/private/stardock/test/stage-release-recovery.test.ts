import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { abandonStage, releaseStage } from "../src/stages/reconcile.ts";
import { stageOwnerPath } from "../src/state/paths.ts";
import { loadState } from "../src/state/store.ts";
import { completeFakeWave, evidenceAdapter, rewriteState } from "./stage-reconcile-test-support.ts";

test("abandon persists rationale and approval and release retry only clears exact stale owner evidence", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stage-owner-cleanup-"));
	try {
		const { harness } = await completeFakeWave(cwd);
		const adapter = evidenceAdapter(cwd, harness.loopName);
		const ownerFile = stageOwnerPath(harness.ctx, harness.loopName);
		const stageTool = harness.tools.get("stardock_stage");
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
		const mismatchedRetry = await stageTool.execute("release-mismatched-terminal-owner", {
			action: "release",
			loopName: harness.loopName,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: releasedState?.revision as number,
		}, undefined, undefined, harness.ctx);
		assert.equal(mismatchedRetry.isError, true);
		assert.equal(mismatchedRetry.details.code, "evidence_changed");

		fs.writeFileSync(ownerFile, JSON.stringify(exactOwner, null, 2));
		const retried = await stageTool.execute("release-exact-terminal-owner", {
			action: "release",
			loopName: harness.loopName,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: releasedState?.revision as number,
		}, undefined, undefined, harness.ctx);
		assert.equal(retried.details.ownershipReleased, true);
		assert.equal(fs.existsSync(ownerFile), false);

		rewriteState(cwd, harness.loopName, (raw) => { raw.executionGraph.revision += 1; });
		const laterRevision = loadState(harness.ctx, harness.loopName)?.executionGraph?.revision as number;
		const idempotent = await stageTool.execute("release-after-later-revision", {
			action: "release",
			loopName: harness.loopName,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: laterRevision,
		}, undefined, undefined, harness.ctx);
		assert.equal(idempotent.details.ok, true);
		assert.equal(idempotent.details.ownershipReleased, true);
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
		}, undefined, adapter), /requires graph revision/i);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
