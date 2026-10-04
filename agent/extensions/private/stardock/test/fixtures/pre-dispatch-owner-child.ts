import * as fs from "node:fs";
import { acquireStageOwnership } from "../../src/stages/ownership.ts";
import { bindOwnershipContext } from "../../src/stages/ownership-records.ts";
import { loadState } from "../../src/state/store.ts";
import { precreateLane, mutatePreparedLanes, type PreparedLane } from "../../src/stages/run-ready-state.ts";
import { commitPreparedLaneDispatch } from "../../src/stages/worker-dispatch.ts";
import { FakeAdapter } from "../stage-run-ready-test-support.ts";

const [cwd, loopName, phase] = process.argv.slice(2);
const ctx = { cwd } as never;
const graph = loadState(ctx, loopName)!.executionGraph!;
const stage = graph.stages[0];
const request = { loopName, graphId: graph.id, stageId: stage.id, expectedGraphRevision: graph.revision, sessionId: "pre-dispatch-child" };
bindOwnershipContext(ctx, request.sessionId);
acquireStageOwnership(ctx, request);
const adapter = new FakeAdapter();
const prepared: PreparedLane[] = [];
for (const nodeId of stage.implementationNodeIds) {
	const node = graph.nodes.find((item) => item.id === nodeId)!;
	const attemptId = `attempt-${node.id}`;
	const lease = await adapter.leaseAndAnchor({ nodeId, attemptId, contractCommit: stage.contractCommit, leaseHolder: `stardock:${attemptId}` });
	prepared.push(precreateLane(ctx, request, node, lease, attemptId, `request-${node.id}`, `${cwd}/${node.id}.txt`, new Date().toISOString()));
	if (phase === "partial") break;
}
if (phase !== "leased") mutatePreparedLanes(ctx, request, prepared, (node, attempt) => { node.status = "running"; attempt.status = "running"; });
if (phase === "committed") commitPreparedLaneDispatch(ctx, request, prepared[0]);
fs.writeSync(1, JSON.stringify({ pid: process.pid, attemptIds: prepared.map((lane) => lane.attemptId) }));
// Deliberately exit without worker dispatch, lifecycle hooks, or lease return.
process.exit(0);
