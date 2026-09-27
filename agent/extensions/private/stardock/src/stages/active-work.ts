import type { LoopState } from "../state/core.ts";
import { OwnershipProtocolError } from "./ownership-records.ts";

/** A free-text classification never proves that a stage's worker stopped. */
export function assertNoActiveStageWork(state: LoopState, graphId: string, stageId: string): void {
	const graph = state.executionGraph;
	const stage = graph?.stages.find((item) => item.id === stageId);
	if (!graph || graph.id !== graphId || !stage) throw new OwnershipProtocolError("stage_missing", "Cannot verify active work without exact graph and stage evidence.");
	if (state.workerRuns.some((run) => run.graphId === graphId && run.stageId === stageId && run.status === "running")) {
		throw new OwnershipProtocolError("worker_running", `Stage "${stageId}" still has a running WorkerRun; settle or explicitly reconcile the worker before ownership or lease recovery.`);
	}
	for (const nodeId of stage.implementationNodeIds) {
		const node = graph.nodes.find((item) => item.id === nodeId);
		if (node && (["leased", "running", "reconciling"].includes(node.status)
			|| node.attempts.some((attempt) => attempt.status === "prepared" || attempt.status === "running"))) {
			throw new OwnershipProtocolError("attempt_running", `Execution node "${nodeId}" still records active work; settle it before ownership or lease recovery.`);
		}
	}
}

export function assertStageReviewDecided(state: LoopState, stageId: string): void {
	const undecided = state.executionPlan?.nodes.filter((node) => node.currentStageId === stageId && node.status === "needs_review") ?? [];
	if (undecided.length) {
		throw new OwnershipProtocolError("review_pending", `Stage "${stageId}" still has ${undecided.length} undecided plan lane(s); review their WorkerRuns before returning a workspace lease.`);
	}
}
