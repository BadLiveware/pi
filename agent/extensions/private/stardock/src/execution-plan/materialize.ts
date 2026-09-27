import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import { digestIterationBriefContract, digestExecutionStageContract, type ExecutionGraph, type ExecutionNode, type ExecutionStage } from "../stages/contracts.ts";
import { validateExecutionGraph } from "../stages/graph.ts";
import { DefaultStageGitAdapter, type GitWorktreeInspection, type StageGitAdapter } from "../stages/stage-git-adapter.ts";
import { loadState, mutateState } from "../state/store.ts";
import { readyExecutionPlanNodeIds, refreshExecutionPlan } from "./graph.ts";

export interface MaterializedExecutionWave {
	graphId: string;
	graphRevision: number;
	waveId: string;
	stageId: string;
	nodeIds: string[];
	planNodeIds: string[];
	baseCommit: string;
}

function safeSegment(value: string): string {
	const readable = value.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "node";
	const digest = createHash("sha256").update(value).digest("hex").slice(0, 10);
	return `${readable}-${digest}`;
}

function parentBranch(inspection: GitWorktreeInspection): string {
	const prefix = "refs/heads/";
	if (!inspection.branchRef?.startsWith(prefix)) throw new Error("The parent checkout must be on a named branch before Stardock can run a wave.");
	return inspection.branchRef.slice(prefix.length);
}

function dependencyFanIns(state: NonNullable<ReturnType<typeof loadState>>, planNodeIds: string[]): string[] {
	const plan = state.executionPlan!;
	const graph = state.executionGraph;
	const byId = new Map(plan.nodes.map((node) => [node.id, node]));
	const fanIns = new Set<string>();
	for (const nodeId of planNodeIds) {
		for (const dependencyId of byId.get(nodeId)?.dependsOn ?? []) {
			const stageId = byId.get(dependencyId)?.currentStageId;
			const stage = graph?.stages.find((candidate) => candidate.id === stageId);
			if (stage) fanIns.add(stage.fanInNodeId);
		}
	}
	return [...fanIns].sort();
}

function appendWaveGraph(
	state: NonNullable<ReturnType<typeof loadState>>,
	inspection: GitWorktreeInspection,
	planNodeIds: string[],
	now: string,
): { graph: ExecutionGraph; stage: ExecutionStage; implementationNodes: ExecutionNode[] } {
	const plan = state.executionPlan!;
	const waveNumber = plan.waves.length + 1;
	const waveId = `wave-${waveNumber}`;
	const stageId = `plan-${waveId}`;
	const contractNodeId = `${stageId}-contract`;
	const fanInNodeId = `${stageId}-fan-in`;
	const graph = structuredClone(state.executionGraph!);
	const dependencyIds = dependencyFanIns(state, planNodeIds);
	const waveNodeIds = new Set(planNodeIds);
	const isFinalWave = plan.nodes.every((node) => node.status === "accepted" || node.status === "integrated" || node.status === "abandoned" || waveNodeIds.has(node.id));
	const contractNode: ExecutionNode = {
		id: contractNodeId,
		kind: "contract",
		objective: `Frozen parent contract for ${waveId}`,
		dependsOn: dependencyIds,
		writes: [],
		reads: [],
		resourceClaims: [],
		validationCommands: [],
		status: "integrated",
		attempts: [],
	};
	const implementationNodes = planNodeIds.map((planNodeId): ExecutionNode => {
		const planNode = plan.nodes.find((node) => node.id === planNodeId)!;
		const brief = state.briefs.find((candidate) => candidate.id === planNode.briefId);
		if (!brief) throw new Error(`Execution plan node "${planNode.id}" is missing internal brief "${planNode.briefId}".`);
		return {
			id: `${stageId}-${safeSegment(planNode.id)}`,
			kind: "implementation",
			objective: planNode.objective,
			dependsOn: [contractNodeId],
			briefId: brief.id,
			briefDigest: digestIterationBriefContract(brief),
			writes: [...planNode.writes],
			reads: [...planNode.reads],
			resourceClaims: structuredClone(planNode.resourceClaims),
			validationCommands: [...planNode.validationCommands],
			status: "ready",
			attempts: [],
		};
	});
	const fanInNode: ExecutionNode = {
		id: fanInNodeId,
		kind: "fan_in",
		objective: `${isFinalWave ? "Integrate and validate the final combined result for" : "Integrate prerequisite/intermediate work for"} ${planNodeIds.join(", ")}`,
		dependsOn: implementationNodes.map((node) => node.id),
		writes: [],
		reads: [],
		resourceClaims: [],
		validationCommands: isFinalWave ? [...plan.integrationValidationCommands] : [],
		status: "blocked",
		attempts: [],
	};
	const stage: ExecutionStage = {
		id: stageId,
		contractNodeId,
		implementationNodeIds: implementationNodes.map((node) => node.id),
		fanInNodeId,
		status: "contracts_ready",
		parentBranch: parentBranch(inspection),
		integrationBaseCommit: inspection.headCommit,
		contractCommit: inspection.headCommit,
		contractDigest: "0".repeat(64),
		integrationBranch: `stardock/${safeSegment(state.name)}/${waveId}-integration`,
		maxConcurrency: plan.maxConcurrency,
		integrationOrder: implementationNodes.map((node) => node.id),
	};
	graph.nodes.push(contractNode, ...implementationNodes, fanInNode);
	graph.stages.push(stage);
	graph.status = "running";
	graph.updatedAt = now;
	stage.contractDigest = digestExecutionStageContract(graph, stage);
	return { graph, stage, implementationNodes };
}

export async function materializeExecutionPlanWave(
	ctx: ExtensionContext,
	loopName: string,
	signal?: AbortSignal,
	git: StageGitAdapter = new DefaultStageGitAdapter(),
): Promise<MaterializedExecutionWave> {
	const state = loadState(ctx, loopName);
	if (!state?.executionPlan || !state.executionGraph) throw new Error(`Loop "${loopName}" has no executable Stardock plan.`);
	if (state.executionPlan.status === "draft") throw new Error("Execution plan is still a draft. Seal it with stardock_plan before running work.");
	if (state.executionPlan.status === "blocked" || state.executionPlan.status === "superseded" || state.executionPlan.status === "completed") throw new Error(`Execution plan is ${state.executionPlan.status}; no job wave can start.`);
	const currentWave = [...state.executionPlan.waves].reverse().find((wave) => wave.status !== "settled" && wave.status !== "integrated" && wave.status !== "abandoned");
	if (currentWave) throw new Error(`Execution wave "${currentWave.id}" is still ${currentWave.status}. Record a governor decision before starting another wave.`);
	if (state.executionGraph.ownership) throw new Error(`Execution graph is still owned by stage "${state.executionGraph.ownership.stageId}".`);
	const planNodeIds = readyExecutionPlanNodeIds(state.executionPlan);
	if (!planNodeIds.length) throw new Error("Execution plan has no ready nodes. Inspect status for a blocked dependency or completion action.");
	const inspection = await git.inspectWorktree(ctx.cwd, signal);
	if (!inspection.clean) throw new Error("Parent worktree must be clean before starting an isolated job wave.");
	const now = new Date().toISOString();
	const built = appendWaveGraph(state, inspection, planNodeIds, now);
	const validation = validateExecutionGraph(built.graph, ctx.cwd);
	if (!validation.ok) throw new Error(`Could not materialize execution wave: ${validation.errors.join(" ")}`);
	const waveId = `wave-${state.executionPlan.waves.length + 1}`;
	const saved = mutateState(ctx, loopName, (candidate) => {
		const plan = candidate.executionPlan;
		if (!plan) throw new Error("Execution plan disappeared before wave materialization.");
		if (plan.revision !== state.executionPlan!.revision || plan.status !== "running") throw new Error("Execution plan changed or became non-runnable before wave materialization. Inspect stardock_status before retrying.");
		if (readyExecutionPlanNodeIds(plan).join("\0") !== planNodeIds.join("\0")) throw new Error("Ready execution set changed before wave materialization.");
		candidate.executionGraph = structuredClone(built.graph);
		plan.waves.push({ id: waveId, stageId: built.stage.id, nodeIds: [...planNodeIds], status: "running", createdAt: now });
		for (let index = 0; index < planNodeIds.length; index++) {
			const node = plan.nodes.find((item) => item.id === planNodeIds[index])!;
			node.status = "running";
			node.currentWaveId = waveId;
			node.currentStageId = built.stage.id;
			node.currentExecutionNodeId = built.implementationNodes[index].id;
			delete node.currentWorkerRunId;
			delete node.lastError;
		}
		plan.revision += 1;
		plan.updatedAt = now;
		refreshExecutionPlan(plan);
	});
	return {
		graphId: saved.executionGraph!.id,
		graphRevision: saved.executionGraph!.revision,
		waveId,
		stageId: built.stage.id,
		nodeIds: built.implementationNodes.map((node) => node.id),
		planNodeIds,
		baseCommit: inspection.headCommit,
	};
}
