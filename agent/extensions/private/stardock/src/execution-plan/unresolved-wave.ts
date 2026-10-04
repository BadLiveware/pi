import type { ExecutionPlan, ExecutionPlanNode, ExecutionPlanWave } from "./contracts.ts";

/** Retry/resume membership comes from durable decisions, not the original full wave. */
export function unresolvedWaveNodes(plan: ExecutionPlan, wave: ExecutionPlanWave): ExecutionPlanNode[] {
	return wave.nodeIds.flatMap((id) => {
		const node = plan.nodes.find((candidate) => candidate.id === id);
		if (!node) throw new Error(`Execution wave "${wave.id}" has incomplete durable node evidence.`);
		if (["accepted", "integrated", "abandoned"].includes(node.status)) return [];
		if (node.currentWaveId !== wave.id || node.currentStageId !== wave.stageId || !node.currentExecutionNodeId) {
			throw new Error(`Execution wave "${wave.id}" has incomplete node identity mappings.`);
		}
		return [node];
	});
}
