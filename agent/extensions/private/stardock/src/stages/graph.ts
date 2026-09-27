import * as path from "node:path";
import {
	digestExecutionStageContract,
	type ExecutionGraph,
	type ExecutionNode,
	type ExecutionNodeStatus,
	type ExecutionStage,
} from "./contracts.ts";
import { validateResources } from "./resource-validation.ts";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const READY_CANDIDATE_STATUSES = new Set<ExecutionNodeStatus>(["blocked", "ready", "retry_ready"]);
const SATISFIED_NODE_STATUSES = new Set<ExecutionNodeStatus>(["succeeded", "integrated"]);
const ACTIVE_NODE_STATUSES = new Set<ExecutionNodeStatus>(["leased", "running"]);
const RECONCILE_NODE_STATUSES = new Set<ExecutionNodeStatus>(["detached", "reconciling"]);
const TERMINAL_NODE_STATUSES = new Set<ExecutionNodeStatus>(["succeeded", "integrated", "abandoned"]);
const TERMINAL_STAGE_STATUSES = new Set<ExecutionStage["status"]>(["settled", "integrated", "abandoned"]);

export interface ExecutionGraphValidation {
	ok: boolean;
	errors: string[];
	topologicalOrder: string[];
}

export interface ExecutionGraphSummary {
	id: string;
	revision: number;
	status: ExecutionGraph["status"];
	nodeCount: number;
	stageCount: number;
	attemptCount: number;
	nodeStatusCounts: Partial<Record<ExecutionNodeStatus, number>>;
	stageStatusCounts: Partial<Record<ExecutionStage["status"], number>>;
	readyNodeIds: string[];
	nodePreview: Array<{ id: string; kind: ExecutionNode["kind"]; status: ExecutionNodeStatus; attemptCount: number }>;
	stagePreview: Array<{ id: string; status: ExecutionStage["status"]; implementationCount: number }>;
	truncatedNodes: number;
	truncatedStages: number;
}

export type ExecutionGraphLifecycleState = "clear" | "nonterminal" | "review" | "fan_in" | "reconcile" | "release";

export interface ExecutionGraphLifecyclePolicy {
	blocked: boolean;
	state: ExecutionGraphLifecycleState;
	nextAction?: string;
}

interface StageMembership {
	stageId: string;
	role: "contract" | "implementation" | "fan_in";
}

function addError(errors: string[], message: string): void {
	if (!errors.includes(message)) errors.push(message);
}

function duplicateIds(items: Array<{ id: string }>): string[] {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const item of items) {
		if (seen.has(item.id)) duplicates.add(item.id);
		seen.add(item.id);
	}
	return [...duplicates].sort();
}

function sortedInsert(values: string[], value: string): void {
	values.push(value);
	values.sort();
}

function topologicalOrder(graph: ExecutionGraph): string[] {
	const nodeIds = new Set(graph.nodes.map((node) => node.id));
	const inDegree = new Map<string, number>();
	const dependents = new Map<string, string[]>();
	for (const node of graph.nodes) {
		inDegree.set(node.id, 0);
		dependents.set(node.id, []);
	}
	for (const node of graph.nodes) {
		for (const dependencyId of new Set(node.dependsOn)) {
			if (!nodeIds.has(dependencyId)) continue;
			inDegree.set(node.id, (inDegree.get(node.id) ?? 0) + 1);
			dependents.get(dependencyId)?.push(node.id);
		}
	}
	for (const values of dependents.values()) values.sort();
	const queue = [...inDegree.entries()].filter((entry) => entry[1] === 0).map((entry) => entry[0]).sort();
	const ordered: string[] = [];
	while (queue.length > 0) {
		const current = queue.shift();
		if (current === undefined) continue;
		ordered.push(current);
		for (const dependent of dependents.get(current) ?? []) {
			const remaining = (inDegree.get(dependent) ?? 0) - 1;
			inDegree.set(dependent, remaining);
			if (remaining === 0) sortedInsert(queue, dependent);
		}
	}
	return ordered;
}

function findCycle(graph: ExecutionGraph): string[] {
	const nodeIds = new Set(graph.nodes.map((node) => node.id));
	const dependencies = new Map(graph.nodes.map((node) => [node.id, [...new Set(node.dependsOn)].filter((id) => nodeIds.has(id)).sort()]));
	const visited = new Set<string>();
	const active = new Set<string>();
	const stack: string[] = [];
	let found: string[] = [];
	function visit(nodeId: string): boolean {
		visited.add(nodeId);
		active.add(nodeId);
		stack.push(nodeId);
		for (const dependencyId of dependencies.get(nodeId) ?? []) {
			if (!visited.has(dependencyId)) {
				if (visit(dependencyId)) return true;
				continue;
			}
			if (!active.has(dependencyId)) continue;
			const start = stack.indexOf(dependencyId);
			found = [...stack.slice(start), dependencyId];
			return true;
		}
		stack.pop();
		active.delete(nodeId);
		return false;
	}
	for (const nodeId of [...nodeIds].sort()) {
		if (visited.has(nodeId)) continue;
		if (visit(nodeId)) break;
	}
	return found;
}

export function normalizeWriteClaim(repoRoot: string, claim: string): string {
	const trimmed = claim.trim().replaceAll("\\", "/");
	if (!trimmed) throw new Error("write claim is empty");
	if (trimmed.startsWith("/") || /^[a-zA-Z]:\//.test(trimmed)) throw new Error(`write claim "${claim}" must be relative to the repository root`);
	if (trimmed.split("/").includes("..")) throw new Error(`write claim "${claim}" traverses outside the repository root`);
	const normalized = path.posix.normalize(trimmed).replace(/^\.\//, "");
	if (!normalized || normalized === ".") throw new Error(`write claim "${claim}" does not name a repository path`);
	const resolved = path.resolve(repoRoot, normalized);
	const relative = path.relative(path.resolve(repoRoot), resolved).replaceAll("\\", "/");
	if (relative.startsWith("../") || relative === "..") throw new Error(`write claim "${claim}" traverses outside the repository root`);
	return relative;
}

function pathsOverlap(left: string, right: string): boolean {
	if (left === right) return true;
	if (left.startsWith(`${right}/`)) return true;
	if (right.startsWith(`${left}/`)) return true;
	return false;
}

function stageMemberships(graph: ExecutionGraph): Map<string, StageMembership[]> {
	const memberships = new Map<string, StageMembership[]>();
	function append(nodeId: string, membership: StageMembership): void {
		const values = memberships.get(nodeId) ?? [];
		values.push(membership);
		memberships.set(nodeId, values);
	}
	for (const stage of graph.stages) {
		append(stage.contractNodeId, { stageId: stage.id, role: "contract" });
		for (const nodeId of stage.implementationNodeIds) append(nodeId, { stageId: stage.id, role: "implementation" });
		append(stage.fanInNodeId, { stageId: stage.id, role: "fan_in" });
	}
	return memberships;
}

function validateNodeIdentity(graph: ExecutionGraph, errors: string[]): void {
	for (const node of graph.nodes) {
		if (!node.id.trim()) addError(errors, "Execution node id must not be empty.");
	}
	for (const stage of graph.stages) {
		if (!stage.id.trim()) addError(errors, "Execution stage id must not be empty.");
	}
	for (const id of duplicateIds(graph.nodes)) addError(errors, `Duplicate execution node id "${id}".`);
	for (const id of duplicateIds(graph.stages)) addError(errors, `Duplicate execution stage id "${id}".`);
	const attempts = graph.nodes.flatMap((node) => node.attempts);
	for (const node of [...graph.nodes].sort((left, right) => left.id.localeCompare(right.id))) {
		for (const attempt of node.attempts) {
			if (!attempt.id.trim()) addError(errors, `Execution attempt id for node "${node.id}" must not be empty.`);
		}
	}
	for (const id of duplicateIds(attempts)) addError(errors, `Duplicate execution attempt id "${id}".`);
	const nodeIds = new Set(graph.nodes.map((node) => node.id));
	for (const node of [...graph.nodes].sort((left, right) => left.id.localeCompare(right.id))) {
		for (const dependencyId of [...new Set(node.dependsOn)].sort()) {
			if (!nodeIds.has(dependencyId)) addError(errors, `Node "${node.id}" depends on missing node "${dependencyId}".`);
		}
		if (node.dependsOn.filter((id) => id === node.id).length > 0) addError(errors, `Node "${node.id}" cannot depend on itself.`);
		if (node.kind === "implementation") {
			if (!node.briefId?.trim()) addError(errors, `Implementation node "${node.id}" must name a briefId.`);
			if (!node.briefDigest || !DIGEST_PATTERN.test(node.briefDigest)) addError(errors, `Implementation node "${node.id}" must record a canonical 64-character briefDigest.`);
		}
	}
}

function validateStageRoles(graph: ExecutionGraph, errors: string[]): void {
	const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
	const memberships = stageMemberships(graph);
	for (const [nodeId, values] of [...memberships.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
		if (values.length > 1) addError(errors, `Node "${nodeId}" has multiple stage roles: ${values.map((value) => `${value.stageId}:${value.role}`).sort().join(", ")}.`);
	}
	for (const stage of [...graph.stages].sort((left, right) => left.id.localeCompare(right.id))) {
		const contract = nodeById.get(stage.contractNodeId);
		const fanIn = nodeById.get(stage.fanInNodeId);
		if (!contract) addError(errors, `Stage "${stage.id}" references missing contract node "${stage.contractNodeId}".`);
		else if (contract.kind !== "contract") addError(errors, `Stage "${stage.id}" contract node "${contract.id}" must have kind "contract", not "${contract.kind}".`);
		if (!fanIn) addError(errors, `Stage "${stage.id}" references missing fan-in node "${stage.fanInNodeId}".`);
		else if (fanIn.kind !== "fan_in") addError(errors, `Stage "${stage.id}" fan-in node "${fanIn.id}" must have kind "fan_in", not "${fanIn.kind}".`);
		for (const nodeId of [...stage.implementationNodeIds].sort()) {
			const node = nodeById.get(nodeId);
			if (!node) {
				addError(errors, `Stage "${stage.id}" references missing implementation node "${nodeId}".`);
				continue;
			}
			if (node.kind !== "implementation") addError(errors, `Stage "${stage.id}" implementation node "${nodeId}" must have kind "implementation", not "${node.kind}".`);
			if (!node.dependsOn.includes(stage.contractNodeId)) addError(errors, `Stage "${stage.id}" implementation node "${nodeId}" must depend on contract node "${stage.contractNodeId}".`);
		}
		if (fanIn) {
			for (const nodeId of [...stage.implementationNodeIds].sort()) {
				if (!fanIn.dependsOn.includes(nodeId)) addError(errors, `Stage "${stage.id}" fan-in node "${fanIn.id}" must depend on implementation node "${nodeId}".`);
			}
		}
		const expectedOrder = [...stage.implementationNodeIds].sort();
		const actualOrder = [...stage.integrationOrder].sort();
		if (JSON.stringify(expectedOrder) !== JSON.stringify(actualOrder) || new Set(stage.integrationOrder).size !== stage.integrationOrder.length) {
			addError(errors, `Stage "${stage.id}" integrationOrder must contain each implementation node exactly once.`);
		}
		if (!Number.isInteger(stage.maxConcurrency) || stage.maxConcurrency < 1) addError(errors, `Stage "${stage.id}" maxConcurrency must be a positive integer.`);
	}
}

function validateCrossStageEdges(graph: ExecutionGraph, errors: string[]): void {
	const memberships = stageMemberships(graph);
	const fanInIds = new Set(graph.stages.map((stage) => stage.fanInNodeId));
	for (const node of [...graph.nodes].sort((left, right) => left.id.localeCompare(right.id))) {
		const nodeMembership = memberships.get(node.id)?.[0];
		if (!nodeMembership) continue;
		for (const dependencyId of [...new Set(node.dependsOn)].sort()) {
			const dependencyMembership = memberships.get(dependencyId)?.[0];
			if (!dependencyMembership || dependencyMembership.stageId === nodeMembership.stageId) continue;
			if (!fanInIds.has(dependencyId)) addError(errors, `Cross-stage dependency from node "${node.id}" to "${dependencyId}" must target the prerequisite stage fan-in node.`);
		}
	}
}

function validateStageDigestsAndBases(graph: ExecutionGraph, errors: string[]): void {
	const memberships = stageMemberships(graph);
	for (const stage of [...graph.stages].sort((left, right) => left.id.localeCompare(right.id))) {
		if (!stage.parentBranch.trim()) addError(errors, `Stage "${stage.id}" must record an exact parentBranch.`);
		if (!SHA_PATTERN.test(stage.integrationBaseCommit)) addError(errors, `Stage "${stage.id}" integrationBaseCommit must be an exact 40-character lowercase Git SHA.`);
		if (!SHA_PATTERN.test(stage.contractCommit)) addError(errors, `Stage "${stage.id}" contractCommit must be an exact 40-character lowercase Git SHA.`);
		if (stage.integrationBaseCommit !== stage.contractCommit) addError(errors, `Stage "${stage.id}" immutable base mismatch: integrationBaseCommit must equal contractCommit.`);
		if (!DIGEST_PATTERN.test(stage.contractDigest)) addError(errors, `Stage "${stage.id}" contractDigest must be a canonical 64-character SHA-256 digest.`);
		else {
			const expected = digestExecutionStageContract(graph, stage);
			if (stage.contractDigest !== expected) addError(errors, `Stage "${stage.id}" contractDigest mismatch: expected ${expected}, received ${stage.contractDigest}.`);
		}
		for (const nodeId of [stage.contractNodeId, ...stage.implementationNodeIds, stage.fanInNodeId]) {
			const node = graph.nodes.find((candidate) => candidate.id === nodeId);
			if (!node) continue;
			for (const attempt of node.attempts) {
				if (attempt.baseCommit !== stage.contractCommit) addError(errors, `Attempt "${attempt.id}" for node "${node.id}" has baseCommit ${attempt.baseCommit}; expected stage contractCommit ${stage.contractCommit}.`);
			}
		}
		if (stage.integration) {
			if (stage.integration.expectedParentHead !== stage.integrationBaseCommit) addError(errors, `Stage "${stage.id}" integration expectedParentHead must equal integrationBaseCommit.`);
			if (stage.integration.integrationBranch !== stage.integrationBranch) addError(errors, `Stage "${stage.id}" integration branch does not match the stage integrationBranch.`);
			for (const merge of stage.integration.laneMerges) {
				const membership = memberships.get(merge.nodeId)?.[0];
				if (!membership || membership.stageId !== stage.id || membership.role !== "implementation") addError(errors, `Stage "${stage.id}" integration references non-lane node "${merge.nodeId}".`);
			}
		}
	}
}

function validateWriteOwnership(graph: ExecutionGraph, repoRoot: string, errors: string[]): void {
	const normalizedByNode = new Map<string, string[]>();
	for (const node of [...graph.nodes].sort((left, right) => left.id.localeCompare(right.id))) {
		const claims: string[] = [];
		for (const rawClaim of node.writes) {
			try {
				claims.push(normalizeWriteClaim(repoRoot, rawClaim));
			} catch (error) {
				addError(errors, `Node "${node.id}" has invalid write claim: ${(error as Error).message}.`);
			}
		}
		normalizedByNode.set(node.id, claims);
	}
	for (const stage of [...graph.stages].sort((left, right) => left.id.localeCompare(right.id))) {
		const claims: Array<{ nodeId: string; claim: string }> = [];
		for (const nodeId of [...stage.implementationNodeIds].sort()) {
			for (const claim of normalizedByNode.get(nodeId) ?? []) claims.push({ nodeId, claim });
		}
		for (let leftIndex = 0; leftIndex < claims.length; leftIndex++) {
			const left = claims[leftIndex];
			for (let rightIndex = leftIndex + 1; rightIndex < claims.length; rightIndex++) {
				const right = claims[rightIndex];
				if (left.nodeId === right.nodeId) continue;
				if (pathsOverlap(left.claim, right.claim)) addError(errors, `Stage "${stage.id}" parallel write overlap: node "${left.nodeId}" claims "${left.claim}" and node "${right.nodeId}" claims "${right.claim}".`);
			}
		}
	}
}

export function validateExecutionGraph(graph: ExecutionGraph, repoRoot = "."): ExecutionGraphValidation {
	const errors: string[] = [];
	if (!graph.id.trim()) addError(errors, "Execution graph id must not be empty.");
	if (!Number.isInteger(graph.revision) || graph.revision < 0) addError(errors, "Execution graph revision must be a non-negative integer.");
	validateNodeIdentity(graph, errors);
	validateStageRoles(graph, errors);
	validateCrossStageEdges(graph, errors);
	validateStageDigestsAndBases(graph, errors);
	validateWriteOwnership(graph, repoRoot, errors);
	validateResources(graph, errors);
	const ordered = topologicalOrder(graph);
	const uniqueNodeCount = new Set(graph.nodes.map((node) => node.id)).size;
	if (ordered.length !== uniqueNodeCount) {
		const cycle = findCycle(graph);
		addError(errors, `Execution graph contains a dependency cycle: ${cycle.join(" -> ")}.`);
	}
	return { ok: errors.length === 0, errors, topologicalOrder: ordered };
}

export function initializeExecutionGraph(graph: ExecutionGraph): ExecutionGraph {
	const initialized = structuredClone(graph);
	const order = topologicalOrder(initialized);
	const nodeById = new Map(initialized.nodes.map((node) => [node.id, node]));
	const stageContractIds = new Set(initialized.stages.map((stage) => stage.contractNodeId));
	for (const node of initialized.nodes) {
		node.status = "blocked";
		node.attempts = [];
	}
	for (const nodeId of order) {
		const node = nodeById.get(nodeId);
		if (!node) continue;
		const dependenciesSatisfied = node.dependsOn.every((dependencyId) => {
			const dependency = nodeById.get(dependencyId);
			return dependency?.status === "succeeded" || dependency?.status === "integrated";
		});
		if (!dependenciesSatisfied) continue;
		if (stageContractIds.has(node.id)) node.status = "integrated";
		else node.status = "ready";
	}
	for (const stage of initialized.stages) {
		const contract = nodeById.get(stage.contractNodeId);
		stage.status = "draft";
		if (contract?.status === "integrated") stage.status = "contracts_ready";
		delete stage.integration;
	}
	initialized.status = "running";
	if (initialized.nodes.length === 0) initialized.status = "draft";
	return initialized;
}

function membershipStageId(memberships: Map<string, StageMembership[]>, nodeId: string): string | undefined {
	return memberships.get(nodeId)?.[0]?.stageId;
}

function dependencySatisfied(node: ExecutionNode, dependency: ExecutionNode, memberships: Map<string, StageMembership[]>): boolean {
	const nodeStage = membershipStageId(memberships, node.id);
	const dependencyStage = membershipStageId(memberships, dependency.id);
	if (nodeStage && dependencyStage && nodeStage !== dependencyStage) return dependency.status === "integrated";
	return SATISFIED_NODE_STATUSES.has(dependency.status);
}

export function readyExecutionNodeIds(graph: ExecutionGraph): string[] {
	const validation = validateExecutionGraph(graph);
	if (!validation.ok) return [];
	const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
	const memberships = stageMemberships(graph);
	const ready = new Set<string>();
	for (const node of graph.nodes) {
		if (!READY_CANDIDATE_STATUSES.has(node.status)) continue;
		const satisfied = node.dependsOn.every((dependencyId) => {
			const dependency = nodeById.get(dependencyId);
			if (!dependency) return false;
			return dependencySatisfied(node, dependency, memberships);
		});
		if (satisfied) ready.add(node.id);
	}
	return validation.topologicalOrder.filter((nodeId) => ready.has(nodeId));
}

function countStatuses<T extends string>(values: T[]): Partial<Record<T, number>> {
	const counts: Partial<Record<T, number>> = {};
	for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
	return counts;
}

export function summarizeExecutionGraph(graph: ExecutionGraph, maxNodes = 8, maxStages = 5): ExecutionGraphSummary {
	const nodes = [...graph.nodes].sort((left, right) => left.id.localeCompare(right.id));
	const stages = [...graph.stages].sort((left, right) => left.id.localeCompare(right.id));
	const attemptCount = graph.nodes.reduce((total, node) => total + node.attempts.length, 0);
	return {
		id: graph.id,
		revision: graph.revision,
		status: graph.status,
		nodeCount: graph.nodes.length,
		stageCount: graph.stages.length,
		attemptCount,
		nodeStatusCounts: countStatuses(graph.nodes.map((node) => node.status)),
		stageStatusCounts: countStatuses(graph.stages.map((stage) => stage.status)),
		readyNodeIds: readyExecutionNodeIds(graph).slice(0, maxNodes),
		nodePreview: nodes.slice(0, maxNodes).map((node) => ({ id: node.id, kind: node.kind, status: node.status, attemptCount: node.attempts.length })),
		stagePreview: stages.slice(0, maxStages).map((stage) => ({ id: stage.id, status: stage.status, implementationCount: stage.implementationNodeIds.length })),
		truncatedNodes: Math.max(0, nodes.length - maxNodes),
		truncatedStages: Math.max(0, stages.length - maxStages),
	};
}

function firstNode(graph: ExecutionGraph, statuses: Set<ExecutionNodeStatus>): ExecutionNode | undefined {
	return [...graph.nodes].sort((left, right) => left.id.localeCompare(right.id)).find((node) => statuses.has(node.status));
}

function hasConsistentTerminalState(graph: ExecutionGraph): boolean {
	if (graph.status !== "completed" && graph.status !== "abandoned") return false;
	if (!graph.nodes.every((node) => TERMINAL_NODE_STATUSES.has(node.status))) return false;
	return graph.stages.every((stage) => TERMINAL_STAGE_STATUSES.has(stage.status));
}

export function evaluateExecutionGraphLifecycle(graph: ExecutionGraph | undefined): ExecutionGraphLifecyclePolicy {
	if (!graph || graph.nodes.length === 0) return { blocked: false, state: "clear" };
	if (hasConsistentTerminalState(graph)) return { blocked: false, state: "clear" };
	const review = firstNode(graph, new Set(["needs_review"]));
	if (review) return { blocked: true, state: "review", nextAction: `Review execution node "${review.id}" before integration.` };
	const reconcile = firstNode(graph, RECONCILE_NODE_STATUSES);
	if (reconcile) return { blocked: true, state: "reconcile", nextAction: `Reconcile execution node "${reconcile.id}" before continuing.` };
	const detachedStage = [...graph.stages].sort((left, right) => left.id.localeCompare(right.id)).find((stage) => stage.status === "detached");
	if (detachedStage) return { blocked: true, state: "reconcile", nextAction: `Reconcile execution stage "${detachedStage.id}" before continuing.` };
	const prepared = [...graph.stages].sort((left, right) => left.id.localeCompare(right.id)).find((stage) => stage.status === "integration_prepared" || stage.integration?.status === "prepared");
	if (prepared) return { blocked: true, state: "fan_in", nextAction: `Finalize prepared integration for execution stage "${prepared.id}".` };
	const awaiting = [...graph.stages].sort((left, right) => left.id.localeCompare(right.id)).find((stage) => stage.status === "awaiting_integration");
	if (awaiting) return { blocked: true, state: "fan_in", nextAction: `Prepare fan-in integration for execution stage "${awaiting.id}".` };
	const readyIds = readyExecutionNodeIds(graph);
	if (readyIds.length > 0) {
		const node = graph.nodes.find((candidate) => candidate.id === readyIds[0]);
		if (node?.kind === "fan_in") return { blocked: true, state: "fan_in", nextAction: `Run fan-in execution node "${node.id}".` };
		return { blocked: true, state: "nonterminal", nextAction: `Run ready execution node "${readyIds[0]}".` };
	}
	const failed = firstNode(graph, new Set(["failed", "retry_ready"]));
	if (failed) return { blocked: true, state: "nonterminal", nextAction: `Resolve or retry execution node "${failed.id}".` };
	const active = firstNode(graph, ACTIVE_NODE_STATUSES);
	if (active) return { blocked: true, state: "nonterminal", nextAction: `Wait for execution node "${active.id}" to finish, then review its result.` };
	const unreleased = [...graph.stages].sort((left, right) => left.id.localeCompare(right.id)).find((stage) => stage.status === "integrated");
	if (unreleased) return { blocked: true, state: "release", nextAction: `Release resources for integrated execution stage "${unreleased.id}", then complete the graph.` };
	return { blocked: true, state: "nonterminal", nextAction: `Resolve nonterminal execution graph "${graph.id}" before completing the loop.` };
}
