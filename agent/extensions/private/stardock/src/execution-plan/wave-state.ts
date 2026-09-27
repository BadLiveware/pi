import type { LoopState } from "../state/core.ts";
import type { ExecutionPlanWave } from "./contracts.ts";
import { refreshExecutionPlan } from "./graph.ts";

function addReplanDecision(state: LoopState, wave: ExecutionPlanWave, now: string): void {
	const plan = state.executionPlan!;
	const blockedIds = plan.nodes.filter((node) => node.currentWaveId === wave.id && node.status === "blocked").map((node) => node.id);
	if (!blockedIds.length) return;
	const alreadyRecorded = plan.decisions.some((decision) => decision.kind === "replan_required" && blockedIds.every((id) => decision.nodeIds.includes(id)));
	if (!alreadyRecorded) {
		plan.decisions.push({
			kind: "replan_required",
			summary: "At least one job retained ambiguous resources or another unresolved condition. The governor may retry, abandon, or create a revised plan under a new name with a recorded supersession reason.",
			nodeIds: blockedIds,
			createdAt: now,
		});
	}
}

export function reconcileExecutionPlanWave(state: LoopState, wave: ExecutionPlanWave, now: string): void {
	const plan = state.executionPlan;
	const graph = state.executionGraph;
	if (!plan || !graph) throw new Error("Execution plan or graph disappeared while reconciling a wave.");
	const stage = graph.stages.find((candidate) => candidate.id === wave.stageId);
	if (!stage) throw new Error(`Execution stage "${wave.stageId}" disappeared while reconciling its wave.`);
	const planNodes = plan.nodes.filter((node) => node.currentWaveId === wave.id);
	for (const planNode of planNodes) {
		const executionNode = graph.nodes.find((node) => node.id === planNode.currentExecutionNodeId);
		if (executionNode) planNode.attemptsUsed = executionNode.attempts.length;
	}
	const fanIn = graph.nodes.find((node) => node.id === stage.fanInNodeId);
	if (planNodes.some((node) => node.status === "needs_review")) {
		wave.status = "review";
		refreshExecutionPlan(plan);
		return;
	}
	if (planNodes.some((node) => node.status === "blocked")) {
		wave.status = "review";
		stage.status = "failed";
		graph.status = "blocked";
		if (fanIn) fanIn.status = "blocked";
		addReplanDecision(state, wave, now);
		refreshExecutionPlan(plan);
		return;
	}
	if (planNodes.some((node) => node.status === "retry_ready")) {
		for (const planNode of planNodes.filter((node) => node.status === "retry_ready")) {
			const executionNode = graph.nodes.find((node) => node.id === planNode.currentExecutionNodeId);
			if (executionNode?.status === "failed" || executionNode?.status === "abandoned") executionNode.status = "retry_ready";
		}
		wave.status = "review";
		stage.status = "contracts_ready";
		graph.status = "running";
		if (fanIn) fanIn.status = "blocked";
		refreshExecutionPlan(plan);
		return;
	}
	if (planNodes.length > 0 && planNodes.every((node) => node.status === "accepted" || node.status === "abandoned")) {
		wave.status = "settled";
		stage.status = "settled";
		graph.status = "running";
		if (fanIn) fanIn.status = "succeeded";
		refreshExecutionPlan(plan);
		return;
	}
	refreshExecutionPlan(plan);
}
