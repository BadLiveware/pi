import {
	canonicalDigest,
	digestExecutionStageContract,
	type ExecutionAttempt,
	type ExecutionGraph,
	type ExecutionNode,
	type ExecutionNodeKind,
	type ExecutionNodeStatus,
	type ExecutionStage,
} from "../../src/stages/contracts.ts";

const BASE_SHA = "1111111111111111111111111111111111111111";
const FIXTURE_TIME = "2026-07-21T00:00:00.000Z";

export function fixtureNode(id: string, kind: ExecutionNodeKind, dependsOn: string[] = [], status: ExecutionNodeStatus = "blocked"): ExecutionNode {
	const node: ExecutionNode = {
		id,
		kind,
		objective: `Execute ${id}`,
		dependsOn,
		writes: [],
		reads: [],
		resourceClaims: [],
		validationCommands: [],
		status,
		attempts: [],
	};
	if (kind === "implementation") {
		node.briefId = `brief-${id}`;
		node.briefDigest = canonicalDigest({ id: node.briefId, objective: node.objective });
		node.validationCommands = ["npm test"];
		node.writes = [`src/${id}`];
	}
	return node;
}

export function fixtureStage(id: string, contractNodeId: string, implementationNodeIds: string[], fanInNodeId: string): ExecutionStage {
	return {
		id,
		contractNodeId,
		implementationNodeIds,
		fanInNodeId,
		status: "draft",
		parentBranch: "main",
		integrationBaseCommit: BASE_SHA,
		contractCommit: BASE_SHA,
		contractDigest: "",
		integrationBranch: `stardock/${id}/integration`,
		maxConcurrency: Math.max(1, implementationNodeIds.length),
		integrationOrder: [...implementationNodeIds].sort(),
	};
}

export function fixtureGraph(id: string, nodes: ExecutionNode[], stages: ExecutionStage[] = []): ExecutionGraph {
	const graph: ExecutionGraph = {
		id,
		revision: 1,
		status: "running",
		nodes,
		stages,
		createdAt: FIXTURE_TIME,
		updatedAt: FIXTURE_TIME,
	};
	refreshStageDigests(graph);
	return graph;
}

export function refreshStageDigests(graph: ExecutionGraph): void {
	for (const stage of graph.stages) stage.contractDigest = digestExecutionStageContract(graph, stage);
}

export function serialChainFixture(): ExecutionGraph {
	return fixtureGraph("serial-chain", [
		fixtureNode("serial-a", "serial", [], "ready"),
		fixtureNode("serial-b", "serial", ["serial-a"]),
		fixtureNode("serial-c", "serial", ["serial-b"]),
	]);
}

export function fiveNodeWaveFixture(): ExecutionGraph {
	const contract = fixtureNode("wave-contract", "contract", [], "integrated");
	const implementations = ["wave-e", "wave-c", "wave-a", "wave-d", "wave-b"].map((id) => fixtureNode(id, "implementation", [contract.id]));
	const fanIn = fixtureNode("wave-fan-in", "fan_in", implementations.map((node) => node.id));
	const stage = fixtureStage("wave-stage", contract.id, implementations.map((node) => node.id), fanIn.id);
	return fixtureGraph("five-node-wave", [fanIn, ...implementations, contract], [stage]);
}

export function crossStageFixture(): ExecutionGraph {
	const contractA = fixtureNode("stage-a-contract", "contract", [], "integrated");
	const implementationA = fixtureNode("stage-a-implementation", "implementation", [contractA.id], "succeeded");
	const fanInA = fixtureNode("stage-a-fan-in", "fan_in", [implementationA.id], "blocked");
	const contractB = fixtureNode("stage-b-contract", "contract", [fanInA.id], "blocked");
	const implementationB = fixtureNode("stage-b-implementation", "implementation", [contractB.id]);
	const fanInB = fixtureNode("stage-b-fan-in", "fan_in", [implementationB.id]);
	const stageA = fixtureStage("stage-a", contractA.id, [implementationA.id], fanInA.id);
	const stageB = fixtureStage("stage-b", contractB.id, [implementationB.id], fanInB.id);
	return fixtureGraph("cross-stage", [implementationB, fanInA, contractA, fanInB, contractB, implementationA], [stageB, stageA]);
}

function fixtureAttempt(nodeId: string, index: number): ExecutionAttempt {
	return {
		id: `${nodeId}-attempt-${index}`,
		baseCommit: BASE_SHA,
		branchRef: `stardock/${nodeId}/${index}`,
		laneCommits: [],
		validation: [],
		startedAt: FIXTURE_TIME,
	};
}

export function largeHistoryFixture(nodeCount = 120, attemptsPerNode = 40): ExecutionGraph {
	const nodes: ExecutionNode[] = [];
	for (let index = 0; index < nodeCount; index++) {
		const node = fixtureNode(`large-${String(index).padStart(3, "0")}`, "serial", [], "integrated");
		for (let attemptIndex = 0; attemptIndex < attemptsPerNode; attemptIndex++) node.attempts.push(fixtureAttempt(node.id, attemptIndex));
		nodes.push(node);
	}
	return fixtureGraph("large-history", nodes);
}
