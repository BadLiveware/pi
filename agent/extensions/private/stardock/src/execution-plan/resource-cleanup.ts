import type { LoopState } from "../state/core.ts";

/** Resource custody is separate from the governor's decision about plan work. */
export function pendingResourceCleanup(state: LoopState): { stageId?: string; stageIds: string[]; stageStatus?: string; runningWorkers: number; attemptIds: string[]; warning: string } | undefined {
	const graph = state.executionGraph;
	if (!graph) return undefined;
	const owner = graph.ownership;
	const tracked = (attempt: { leaseDisposition?: string; worktreePath?: string; repositoryCommonDir?: string; leaseHolder?: string }) =>
		attempt.leaseDisposition !== "released" && Boolean(attempt.worktreePath || attempt.repositoryCommonDir || attempt.leaseHolder);
	const attemptIds = graph.nodes.flatMap((node) => node.attempts.filter(tracked).map((attempt) => attempt.id));
	if (!owner && attemptIds.length === 0) return undefined;
	const stageIds = graph.stages.filter((stage) => stage.implementationNodeIds.some((nodeId) =>
			graph.nodes.find((node) => node.id === nodeId)?.attempts.some(tracked))).map((stage) => stage.id);
	const stageId = owner?.stageId ?? (stageIds.length === 1 ? stageIds[0] : undefined);
	const stage = graph.stages.find((candidate) => candidate.id === stageId);
	const runningWorkers = state.workerRuns.filter((run) => run.graphId === graph.id && run.status === "running"
		&& ((owner !== undefined && run.stageId === owner.stageId) || stageIds.includes(run.stageId ?? ""))).length;
	const parts = [
		owner ? `stage "${owner.stageId}" retains ownership` : undefined,
		attemptIds.length ? `${attemptIds.length} worktree lease(s) remain preserved or unreleased` : undefined,
	].filter(Boolean).join("; ");
	const needsReview = state.executionPlan?.nodes.some((node) => node.status === "needs_review");
	const next = runningWorkers ? "Wait for running workers to settle; never return their leases."
		: needsReview ? "Review the remaining runs with stardock_review; Stardock attempts verified lease return after all lanes are decided."
		: `Inspect with stardock_recover({ action: "inspect", name: "${state.name}"${stageIds.length > 1 ? ", stageId: <one pending stage ID>" : ""} }) before retrying releaseLeases; dirty or unverified work stays preserved.`;
	return { stageId, stageIds, stageStatus: stage?.status, runningWorkers, attemptIds,
		warning: `Resource cleanup pending: ${parts}. ${next}` };
}
