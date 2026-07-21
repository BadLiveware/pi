import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { detachOwnedStages, inspectStageOwnership, reconcileStageOwnership } from "../src/stages/ownership.ts";
import { OwnershipProtocolError, quarantineOwnershipFile } from "../src/stages/ownership-records.ts";
import { loadState, mutateState } from "../src/state/store.ts";
import {
	runAcquisitionChild,
	stageOwnerFile,
	startOwnershipGraph as startGraph,
	stateMutexFile,
} from "./stage-ownership-test-support.ts";
import { statePath } from "./test-harness.ts";

test("a crash after owner quarantine leaves prior graph ownership durable and retryable", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-owner-quarantine-crash-"));
	try {
		const { name, graph } = await startGraph(cwd, "Owner Quarantine Crash");
		const gate = path.join(cwd, "start-quarantine-crash");
		const child = runAcquisitionChild([cwd, name, graph.id, graph.stages[0].id, String(graph.revision), "quarantined-child", gate]);
		fs.writeFileSync(gate, "go", "utf-8");
		assert.equal((await child).result.ok, true);
		const ctx = { cwd } as never;
		const before = inspectStageOwnership(ctx, name);
		assert.equal(before.ownerProcess, "dead");
		assert.ok(before.owner);
		assert.ok(before.stateOwnership);
		quarantineOwnershipFile(ctx, name, "owner", before.owner.tokenDigest);
		const orphaned = inspectStageOwnership(ctx, name);
		assert.equal(orphaned.owner, null);
		assert.deepEqual(orphaned.stateOwnership, before.stateOwnership);
		assert.equal(orphaned.stateRevision, before.stateRevision);
		assert.throws(
			() => mutateState(ctx, name, (state) => { state.iteration += 1; }),
			(error: unknown) => error instanceof OwnershipProtocolError && error.code === "owner_orphaned",
		);
		const takeover = reconcileStageOwnership(ctx, {
			loopName: name,
			takeOwnership: true,
			rationale: "The approved reconciler died after quarantining the dead owner record.",
			approvalRef: "approval:quarantine-crash",
			classification: "No worker or Treehouse lease was started.",
			graphId: graph.id,
			stageId: graph.stages[0].id,
			sessionId: "quarantine-crash-retry",
		});
		assert.equal("ok" in takeover, true);
		assert.equal(takeover.stateRevision, Number(before.stateRevision) + 1);
		detachOwnedStages(ctx, "quarantine-crash-retry");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("standalone mutex recovery cannot bypass normal stage readiness", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-owner-standalone-readiness-"));
	try {
		const harness = await startGraph(cwd, "Standalone Readiness");
		const raw = JSON.parse(fs.readFileSync(statePath(cwd, harness.name), "utf-8"));
		raw.executionGraph.stages[0].status = "running";
		fs.writeFileSync(statePath(cwd, harness.name), JSON.stringify(raw, null, 2));
		fs.writeFileSync(stateMutexFile(cwd, harness.name), JSON.stringify({
			version: 1,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			sessionId: "dead-standalone",
			pid: 99999999,
			tokenDigest: "c".repeat(64),
			acquiredAt: "2026-07-21T00:00:00.000Z",
		}, null, 2));
		assert.throws(() => reconcileStageOwnership(harness.ctx, {
			loopName: harness.name,
			takeOwnership: true,
			rationale: "The standalone mutex holder died.",
			approvalRef: "approval:standalone-readiness",
			classification: "No owner, WorkerRun, or Treehouse lease exists.",
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			sessionId: "standalone-replacement",
		}), (error: unknown) => error instanceof OwnershipProtocolError && error.code === "stage_unready");
		assert.equal(loadState(harness.ctx, harness.name)?.executionGraph?.stages[0].status, "running");
		assert.equal(fs.existsSync(stageOwnerFile(cwd, harness.name)), false);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
