import type { ExecutionPlan, ExecutionPlanDecision, ExecutionPlanNode, ExecutionPlanWave } from "./contracts.ts";
import { validateExecutionPlanInput } from "./graph.ts";

function record(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function strings(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function optionalString(value: unknown): value is string | undefined {
	return value === undefined || typeof value === "string";
}

function planNode(value: unknown): value is ExecutionPlanNode {
	if (!record(value)) return false;
	if (typeof value.id !== "string" || typeof value.objective !== "string" || typeof value.task !== "string") return false;
	if (value.kind !== "prerequisite" && value.kind !== "work") return false;
	if (!strings(value.dependsOn) || !strings(value.acceptanceCriteria) || !strings(value.reads) || !strings(value.writes) || !strings(value.validationCommands)) return false;
	if (!Array.isArray(value.resourceClaims) || !value.resourceClaims.every((claim) => record(claim) && typeof claim.key === "string" && (claim.mode === "shared" || claim.mode === "exclusive") && optionalString(claim.value))) return false;
	if (!Number.isInteger(value.maxAttempts) || Number(value.maxAttempts) < 1 || !Number.isInteger(value.attemptsUsed) || Number(value.attemptsUsed) < 0) return false;
	if (!["pending", "ready", "running", "needs_review", "accepted", "integrated", "retry_ready", "abandoned", "blocked"].includes(String(value.status))) return false;
	if (typeof value.criterionId !== "string" || typeof value.briefId !== "string") return false;
	return optionalString(value.currentWaveId)
		&& optionalString(value.currentStageId)
		&& optionalString(value.currentExecutionNodeId)
		&& optionalString(value.currentWorkerRunId)
		&& optionalString(value.lastError);
}

function wave(value: unknown): value is ExecutionPlanWave {
	if (!record(value)) return false;
	return typeof value.id === "string"
		&& typeof value.stageId === "string"
		&& strings(value.nodeIds)
		&& ["running", "review", "settled", "integrating", "integrated", "abandoned"].includes(String(value.status))
		&& typeof value.createdAt === "string"
		&& optionalString(value.integratedAt);
}

function decision(value: unknown): value is ExecutionPlanDecision {
	if (!record(value)) return false;
	return (value.kind === "replan_required" || value.kind === "integration_recovery")
		&& typeof value.summary === "string"
		&& strings(value.nodeIds)
		&& typeof value.createdAt === "string";
}

export function readPersistedExecutionPlan(value: unknown): ExecutionPlan | undefined {
	if (!record(value)) return undefined;
	if (typeof value.id !== "string" || typeof value.objective !== "string" || typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") return undefined;
	if (!Number.isInteger(value.revision) || Number(value.revision) < 0 || !Number.isInteger(value.maxConcurrency) || Number(value.maxConcurrency) < 1 || !Number.isInteger(value.defaultMaxAttempts) || Number(value.defaultMaxAttempts) < 1) return undefined;
	if (!["draft", "running", "review", "integrating", "blocked", "superseded", "completed"].includes(String(value.status))) return undefined;
	if (!strings(value.constraints) || !strings(value.integrationValidationCommands)) return undefined;
	if (!optionalString(value.supersedesPlan) || !optionalString(value.replanReason) || !optionalString(value.supersededBy)) return undefined;
	if (!Array.isArray(value.nodes) || !value.nodes.every(planNode)) return undefined;
	if (!Array.isArray(value.waves) || !value.waves.every(wave)) return undefined;
	if (!Array.isArray(value.decisions) || !value.decisions.every(decision)) return undefined;
	const plan = structuredClone(value) as unknown as ExecutionPlan;
	const validation = validateExecutionPlanInput({
		id: plan.id,
		objective: plan.objective,
		constraints: plan.constraints,
		supersedesPlan: plan.supersedesPlan,
		replanReason: plan.replanReason,
		maxConcurrency: plan.maxConcurrency,
		defaultMaxAttempts: plan.defaultMaxAttempts,
		integrationValidationCommands: plan.integrationValidationCommands,
		nodes: plan.nodes,
	}, plan.status === "draft" ? { allowEmptyNodes: true, allowMissingDependencies: true, deferCrossNodeConflicts: true } : undefined);
	if (!validation.ok) return undefined;
	const nodeIds = new Set(plan.nodes.map((node) => node.id));
	const waveIds = new Set<string>();
	for (const item of plan.waves) {
		if (waveIds.has(item.id) || !item.nodeIds.length || item.nodeIds.some((id) => !nodeIds.has(id))) return undefined;
		waveIds.add(item.id);
	}
	for (const node of plan.nodes) {
		if (node.currentWaveId && !waveIds.has(node.currentWaveId)) return undefined;
	}
	if (plan.decisions.some((item) => item.nodeIds.some((id) => !nodeIds.has(id)))) return undefined;
	return plan;
}
