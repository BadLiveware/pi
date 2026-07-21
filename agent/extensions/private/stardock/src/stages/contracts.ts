import { createHash } from "node:crypto";
import * as path from "node:path";
import type { IterationBrief } from "../state/core.ts";

export type ExecutionGraphStatus = "draft" | "running" | "blocked" | "completed" | "abandoned";
export type ExecutionNodeKind = "contract" | "serial" | "implementation" | "fan_in";
export type ExecutionNodeStatus = "blocked" | "ready" | "leased" | "running" | "detached" | "reconciling" | "needs_review" | "succeeded" | "failed" | "retry_ready" | "integrated" | "abandoned";
export type ExecutionStageStatus = "draft" | "contracts_ready" | "running" | "awaiting_integration" | "integration_prepared" | "integrated" | "failed" | "detached" | "abandoned";
export type ValidationResult = "passed" | "failed" | "skipped";

export interface ExecutionValidationRecord {
	command: string;
	result: ValidationResult;
	summary: string;
}

export interface ResourceClaim {
	key: string;
	mode: "shared" | "exclusive";
	value?: string;
}

export type ExecutionAttemptStatus = "prepared" | "running" | "needs_review" | "failed" | "detached";

export interface ExecutionAttempt {
	id: string;
	workerRunId?: string;
	workerReportId?: string;
	bridgeRunId?: string;
	nodeContractDigest?: string;
	stageContractDigest?: string;
	writes?: string[];
	resourceClaims?: ResourceClaim[];
	validationCommands?: string[];
	baseCommit: string;
	branchRef: string;
	laneCommits: string[];
	headCommit?: string;
	worktreePath?: string;
	leaseHolder?: string;
	clean?: boolean;
	changedPaths?: string[];
	violations?: string[];
	validation: ExecutionValidationRecord[];
	status?: ExecutionAttemptStatus;
	startedAt: string;
	completedAt?: string;
}

export interface IntegrationLaneMerge {
	nodeId: string;
	sourceHeadCommit: string;
	mergeCommit: string;
}

export interface IntegrationRecord {
	status: "building" | "prepared" | "integrated" | "failed";
	expectedParentHead: string;
	integrationBranch: string;
	laneMerges: IntegrationLaneMerge[];
	fanInCommits: string[];
	integrationHeadCommit: string;
	prepareTokenDigest?: string;
	preparedAt?: string;
	parentResultCommit?: string;
	validation: ExecutionValidationRecord[];
}

export interface ExecutionNode {
	id: string;
	kind: ExecutionNodeKind;
	objective: string;
	dependsOn: string[];
	briefId?: string;
	briefDigest?: string;
	writes: string[];
	reads: string[];
	resourceClaims: ResourceClaim[];
	validationCommands: string[];
	status: ExecutionNodeStatus;
	attempts: ExecutionAttempt[];
}

export interface ExecutionStage {
	id: string;
	contractNodeId: string;
	implementationNodeIds: string[];
	fanInNodeId: string;
	status: ExecutionStageStatus;
	parentBranch: string;
	integrationBaseCommit: string;
	contractCommit: string;
	contractDigest: string;
	integrationBranch: string;
	maxConcurrency: number;
	integrationOrder: string[];
	integration?: IntegrationRecord;
}

export type ExecutionOwnershipStatus = "active" | "detached" | "reconciling";

export interface ExecutionStageOwnership {
	graphId: string;
	stageId: string;
	sessionId: string;
	pid: number;
	tokenDigest: string;
	status: ExecutionOwnershipStatus;
	acquiredAt: string;
	heartbeatAt: string;
	stateRevision: number;
	detachedAt?: string;
}

export interface ExecutionGraph {
	id: string;
	revision: number;
	status: ExecutionGraphStatus;
	nodes: ExecutionNode[];
	stages: ExecutionStage[];
	createdAt: string;
	updatedAt: string;
	ownership?: ExecutionStageOwnership;
}

function canonicalValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map((item) => canonicalValue(item));
	if (!value || typeof value !== "object") return value;
	const source = value as Record<string, unknown>;
	const result: Record<string, unknown> = {};
	for (const key of Object.keys(source).sort()) {
		const item = source[key];
		if (item !== undefined) result[key] = canonicalValue(item);
	}
	return result;
}

function sortedUnique(values: string[]): string[] {
	return [...new Set(values)].sort();
}

function canonicalPaths(values: string[]): string[] {
	const normalized = values.map((value) => path.posix.normalize(value.trim().replaceAll("\\", "/")).replace(/^\.\//, ""));
	return sortedUnique(normalized);
}

function canonicalClaims(claims: ResourceClaim[]): ResourceClaim[] {
	return claims
		.map((claim) => {
			const canonical: ResourceClaim = { key: claim.key, mode: claim.mode };
			if (claim.value !== undefined) canonical.value = claim.value;
			return canonical;
		})
		.sort((left, right) => {
			const leftKey = `${left.key}\u0000${left.mode}\u0000${left.value ?? ""}`;
			const rightKey = `${right.key}\u0000${right.mode}\u0000${right.value ?? ""}`;
			return leftKey.localeCompare(rightKey);
		});
}

export function canonicalJson(value: unknown): string {
	return JSON.stringify(canonicalValue(value));
}

export function canonicalDigest(value: unknown): string {
	return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function iterationBriefContract(brief: IterationBrief): Record<string, unknown> {
	return {
		id: brief.id,
		objective: brief.objective,
		task: brief.task,
		criterionIds: sortedUnique(brief.criterionIds),
		acceptanceCriteria: [...brief.acceptanceCriteria],
		verificationRequired: [...brief.verificationRequired],
		requiredContext: [...brief.requiredContext],
		constraints: [...brief.constraints],
		avoid: [...brief.avoid],
		outputContract: brief.outputContract,
		sourceRefs: sortedUnique(brief.sourceRefs),
	};
}

export function digestIterationBriefContract(brief: IterationBrief): string {
	return canonicalDigest(iterationBriefContract(brief));
}

export function executionNodeContract(node: ExecutionNode): Record<string, unknown> {
	return {
		id: node.id,
		kind: node.kind,
		objective: node.objective,
		dependsOn: sortedUnique(node.dependsOn),
		briefId: node.briefId,
		briefDigest: node.briefDigest,
		writes: canonicalPaths(node.writes),
		reads: canonicalPaths(node.reads),
		resourceClaims: canonicalClaims(node.resourceClaims),
		validationCommands: sortedUnique(node.validationCommands),
	};
}

export function digestExecutionNodeContract(node: ExecutionNode): string {
	return canonicalDigest(executionNodeContract(node));
}

export function executionStageContract(graph: ExecutionGraph, stage: ExecutionStage): Record<string, unknown> {
	const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
	const roleNodeIds = [stage.contractNodeId, ...stage.implementationNodeIds, stage.fanInNodeId];
	const nodes = roleNodeIds
		.map((nodeId) => nodeById.get(nodeId))
		.filter((node): node is ExecutionNode => Boolean(node))
		.map((node) => executionNodeContract(node))
		.sort((left, right) => String(left.id).localeCompare(String(right.id)));
	return {
		id: stage.id,
		contractNodeId: stage.contractNodeId,
		implementationNodeIds: sortedUnique(stage.implementationNodeIds),
		fanInNodeId: stage.fanInNodeId,
		parentBranch: stage.parentBranch,
		integrationBaseCommit: stage.integrationBaseCommit,
		contractCommit: stage.contractCommit,
		integrationBranch: stage.integrationBranch,
		maxConcurrency: stage.maxConcurrency,
		integrationOrder: [...stage.integrationOrder],
		nodes,
	};
}

export function digestExecutionStageContract(graph: ExecutionGraph, stage: ExecutionStage): string {
	return canonicalDigest(executionStageContract(graph, stage));
}

export function createEmptyExecutionGraph(id: string, now = new Date().toISOString()): ExecutionGraph {
	return {
		id,
		revision: 0,
		status: "draft",
		nodes: [],
		stages: [],
		createdAt: now,
		updatedAt: now,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function hasOptionalString(record: Record<string, unknown>, key: string): boolean {
	return record[key] === undefined || typeof record[key] === "string";
}

function isExecutionValidationRecord(value: unknown): value is ExecutionValidationRecord {
	if (!isRecord(value)) return false;
	if (typeof value.command !== "string" || typeof value.summary !== "string") return false;
	return value.result === "passed" || value.result === "failed" || value.result === "skipped";
}

function isResourceClaim(value: unknown): value is ResourceClaim {
	if (!isRecord(value)) return false;
	if (typeof value.key !== "string") return false;
	if (value.mode !== "shared" && value.mode !== "exclusive") return false;
	return hasOptionalString(value, "value");
}

function isExecutionAttempt(value: unknown): value is ExecutionAttempt {
	if (!isRecord(value)) return false;
	if (typeof value.id !== "string" || typeof value.baseCommit !== "string" || typeof value.branchRef !== "string" || typeof value.startedAt !== "string") return false;
	if (!isStringArray(value.laneCommits)) return false;
	if (value.writes !== undefined && !isStringArray(value.writes)) return false;
	if (value.resourceClaims !== undefined && (!Array.isArray(value.resourceClaims) || !value.resourceClaims.every(isResourceClaim))) return false;
	if (value.validationCommands !== undefined && !isStringArray(value.validationCommands)) return false;
	if (value.changedPaths !== undefined && !isStringArray(value.changedPaths)) return false;
	if (value.violations !== undefined && !isStringArray(value.violations)) return false;
	if (!Array.isArray(value.validation) || !value.validation.every(isExecutionValidationRecord)) return false;
	for (const key of ["workerRunId", "workerReportId", "bridgeRunId", "nodeContractDigest", "stageContractDigest", "headCommit", "worktreePath", "leaseHolder", "completedAt"]) {
		if (!hasOptionalString(value, key)) return false;
	}
	if (value.clean !== undefined && typeof value.clean !== "boolean") return false;
	if (value.status === undefined) return true;
	return value.status === "prepared" || value.status === "running" || value.status === "needs_review" || value.status === "failed" || value.status === "detached";
}

function isExecutionNode(value: unknown): value is ExecutionNode {
	if (!isRecord(value)) return false;
	if (typeof value.id !== "string" || typeof value.objective !== "string") return false;
	if (value.kind !== "contract" && value.kind !== "serial" && value.kind !== "implementation" && value.kind !== "fan_in") return false;
	if (!isStringArray(value.dependsOn) || !isStringArray(value.writes) || !isStringArray(value.reads) || !isStringArray(value.validationCommands)) return false;
	if (!Array.isArray(value.resourceClaims) || !value.resourceClaims.every(isResourceClaim)) return false;
	if (!Array.isArray(value.attempts) || !value.attempts.every(isExecutionAttempt)) return false;
	if (!hasOptionalString(value, "briefId") || !hasOptionalString(value, "briefDigest")) return false;
	return value.status === "blocked"
		|| value.status === "ready"
		|| value.status === "leased"
		|| value.status === "running"
		|| value.status === "detached"
		|| value.status === "reconciling"
		|| value.status === "needs_review"
		|| value.status === "succeeded"
		|| value.status === "failed"
		|| value.status === "retry_ready"
		|| value.status === "integrated"
		|| value.status === "abandoned";
}

function isIntegrationLaneMerge(value: unknown): value is IntegrationLaneMerge {
	if (!isRecord(value)) return false;
	return typeof value.nodeId === "string" && typeof value.sourceHeadCommit === "string" && typeof value.mergeCommit === "string";
}

function isIntegrationRecord(value: unknown): value is IntegrationRecord {
	if (!isRecord(value)) return false;
	if (value.status !== "building" && value.status !== "prepared" && value.status !== "integrated" && value.status !== "failed") return false;
	if (typeof value.expectedParentHead !== "string" || typeof value.integrationBranch !== "string" || typeof value.integrationHeadCommit !== "string") return false;
	if (!Array.isArray(value.laneMerges) || !value.laneMerges.every(isIntegrationLaneMerge)) return false;
	if (!isStringArray(value.fanInCommits)) return false;
	if (!Array.isArray(value.validation) || !value.validation.every(isExecutionValidationRecord)) return false;
	for (const key of ["prepareTokenDigest", "preparedAt", "parentResultCommit"]) {
		if (!hasOptionalString(value, key)) return false;
	}
	return true;
}

function isExecutionStage(value: unknown): value is ExecutionStage {
	if (!isRecord(value)) return false;
	for (const key of ["id", "contractNodeId", "fanInNodeId", "parentBranch", "integrationBaseCommit", "contractCommit", "contractDigest", "integrationBranch"]) {
		if (typeof value[key] !== "string") return false;
	}
	if (!isStringArray(value.implementationNodeIds) || !isStringArray(value.integrationOrder)) return false;
	if (!Number.isInteger(value.maxConcurrency)) return false;
	if (value.integration !== undefined && !isIntegrationRecord(value.integration)) return false;
	return value.status === "draft"
		|| value.status === "contracts_ready"
		|| value.status === "running"
		|| value.status === "awaiting_integration"
		|| value.status === "integration_prepared"
		|| value.status === "integrated"
		|| value.status === "failed"
		|| value.status === "detached"
		|| value.status === "abandoned";
}

function isExecutionStageOwnership(value: unknown): value is ExecutionStageOwnership {
	if (!isRecord(value)) return false;
	for (const key of ["graphId", "stageId", "sessionId", "tokenDigest", "acquiredAt", "heartbeatAt"]) {
		if (typeof value[key] !== "string") return false;
	}
	if (!Number.isInteger(value.pid) || !Number.isInteger(value.stateRevision)) return false;
	if (value.detachedAt !== undefined && typeof value.detachedAt !== "string") return false;
	return value.status === "active" || value.status === "detached" || value.status === "reconciling";
}

export function readPersistedExecutionGraph(value: unknown): ExecutionGraph | undefined {
	if (!isRecord(value)) return undefined;
	const candidate = structuredClone(value);
	if (typeof candidate.id !== "string" || typeof candidate.createdAt !== "string" || typeof candidate.updatedAt !== "string") return undefined;
	if (!Number.isInteger(candidate.revision)) return undefined;
	if (candidate.status !== "draft" && candidate.status !== "running" && candidate.status !== "blocked" && candidate.status !== "completed" && candidate.status !== "abandoned") return undefined;
	if (!Array.isArray(candidate.nodes) || !candidate.nodes.every(isExecutionNode)) return undefined;
	if (!Array.isArray(candidate.stages) || !candidate.stages.every(isExecutionStage)) return undefined;
	if (candidate.ownership !== undefined && !isExecutionStageOwnership(candidate.ownership)) return undefined;
	return candidate as unknown as ExecutionGraph;
}
