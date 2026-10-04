import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ExecutionAttempt } from "./contracts.ts";
import type { RunReadyRequest } from "./run-ready.ts";
import { mutatePreparedLanes, type PreparedLane } from "./run-ready-state.ts";

/** Commit the may-have-launched boundary durably before any transport side effect. */
export function commitPreparedLaneDispatch(ctx: ExtensionContext, request: RunReadyRequest, lane: PreparedLane): ExecutionAttempt {
	let committed: ExecutionAttempt | undefined;
	mutatePreparedLanes(ctx, request, [lane], (node, attempt, run, report) => {
		if (node.attempts.at(-1)?.id !== attempt.id || node.status !== "running" || attempt.status !== "running"
			|| attempt.dispatchState !== "prepared" || attempt.dispatchCommittedAt !== undefined || attempt.bridgeRunId !== undefined
			|| run.status !== "running" || run.graphId !== request.graphId || run.stageId !== request.stageId
			|| run.nodeId !== node.id || run.attemptId !== attempt.id || run.reportId !== report.id
			|| attempt.workerRunId !== run.id || attempt.workerReportId !== report.id) {
			throw new Error(`Prepared dispatch evidence changed for lane "${lane.nodeId}"; no worker was invoked.`);
		}
		attempt.dispatchState = "committed";
		attempt.dispatchCommittedAt = new Date().toISOString();
		committed = structuredClone(attempt);
	});
	if (!committed) throw new Error(`Dispatch commitment was not persisted for lane "${lane.nodeId}".`);
	return committed;
}
