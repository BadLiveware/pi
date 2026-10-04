import type { ExecutionGraph } from "./contracts.ts";
import { readyExecutionNodeIds, validateExecutionGraph } from "./graph.ts";
import { OwnershipProtocolError } from "./ownership-records.ts";

export function assertStageAcquirable(graph: ExecutionGraph, stageId: string, repoRoot: string, reconciliation = false, selectedNodeIds?: string[]): void {
	const validation = validateExecutionGraph(graph, repoRoot);
	if (!validation.ok) throw new OwnershipProtocolError("graph_invalid", `Execution graph validation failed before ownership acquisition: ${validation.errors.join(" ")}`);
	if (graph.status === "completed" || graph.status === "abandoned") {
		throw new OwnershipProtocolError("graph_terminal", `Execution graph "${graph.id}" is terminal and cannot acquire stage ownership.`);
	}
	const stage = graph.stages.find((candidate) => candidate.id === stageId);
	if (!stage) throw new OwnershipProtocolError("stage_missing", `Execution stage "${stageId}" was not found in graph "${graph.id}".`);
	if (stage.status === "integrated" || stage.status === "abandoned") {
		throw new OwnershipProtocolError("stage_terminal", `Execution stage "${stage.id}" is terminal and cannot acquire ownership.`);
	}
	if (reconciliation) return;
	if (stage.status !== "draft" && stage.status !== "contracts_ready" && !(selectedNodeIds && stage.status === "running")) {
		throw new OwnershipProtocolError("stage_unready", `Execution stage "${stage.id}" has status "${stage.status}" and cannot begin ownership acquisition.`);
	}
	const selected = selectedNodeIds ?? stage.implementationNodeIds;
	if (!selected.length || new Set(selected).size !== selected.length || selected.some((id) => !stage.implementationNodeIds.includes(id))) {
		throw new OwnershipProtocolError("stage_unready", `Execution stage "${stage.id}" requires a nonempty unique selection of its implementation nodes.`);
	}
	const ready = new Set(readyExecutionNodeIds(graph));
	const missing = selected.filter((nodeId) => !ready.has(nodeId));
	if (missing.length > 0) throw new OwnershipProtocolError("stage_unready", `Execution stage "${stage.id}" is not fully ready; blocked implementation nodes: ${missing.sort().join(", ")}.`);
}
