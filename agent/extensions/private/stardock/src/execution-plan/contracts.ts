import type { ResourceClaim } from "../stages/contracts.ts";

export type ExecutionPlanStatus = "draft" | "running" | "review" | "integrating" | "blocked" | "superseded" | "completed";
export type ExecutionPlanNodeKind = "prerequisite" | "work";
export type ExecutionPlanNodeStatus = "pending" | "ready" | "running" | "needs_review" | "accepted" | "integrated" | "retry_ready" | "abandoned" | "blocked";
export type ExecutionPlanWaveStatus = "running" | "review" | "settled" | "integrating" | "integrated" | "abandoned";

export interface ExecutionPlanNodeInput {
	id: string;
	kind?: ExecutionPlanNodeKind;
	objective: string;
	task: string;
	dependsOn?: string[];
	acceptanceCriteria: string[];
	reads?: string[];
	writes?: string[];
	resourceClaims?: ResourceClaim[];
	validationCommands?: string[];
	maxAttempts?: number;
}

export interface ExecutionPlanInput {
	id: string;
	objective: string;
	constraints?: string[];
	supersedesPlan?: string;
	replanReason?: string;
	maxConcurrency?: number;
	defaultMaxAttempts?: number;
	/** Optional commands used only when the governor explicitly invokes the legacy promotion helper. */
	integrationValidationCommands?: string[];
	nodes: ExecutionPlanNodeInput[];
}

export interface ExecutionPlanNode extends Omit<ExecutionPlanNodeInput, "kind" | "dependsOn" | "acceptanceCriteria" | "reads" | "writes" | "resourceClaims" | "validationCommands" | "maxAttempts"> {
	kind: ExecutionPlanNodeKind;
	dependsOn: string[];
	acceptanceCriteria: string[];
	reads: string[];
	writes: string[];
	resourceClaims: ResourceClaim[];
	validationCommands: string[];
	maxAttempts: number;
	attemptsUsed: number;
	status: ExecutionPlanNodeStatus;
	criterionId: string;
	briefId: string;
	currentWaveId?: string;
	currentStageId?: string;
	currentExecutionNodeId?: string;
	currentWorkerRunId?: string;
	lastError?: string;
}

export interface ExecutionPlanWave {
	id: string;
	stageId: string;
	nodeIds: string[];
	status: ExecutionPlanWaveStatus;
	createdAt: string;
	integratedAt?: string;
}

export interface ExecutionPlanDecision {
	kind: "replan_required" | "integration_recovery";
	summary: string;
	nodeIds: string[];
	createdAt: string;
}

export interface ExecutionPlan {
	id: string;
	revision: number;
	status: ExecutionPlanStatus;
	objective: string;
	constraints: string[];
	supersedesPlan?: string;
	replanReason?: string;
	supersededBy?: string;
	maxConcurrency: number;
	defaultMaxAttempts: number;
	integrationValidationCommands: string[];
	nodes: ExecutionPlanNode[];
	waves: ExecutionPlanWave[];
	decisions: ExecutionPlanDecision[];
	createdAt: string;
	updatedAt: string;
}

export interface ExecutionPlanSnapshot {
	id: string;
	revision: number;
	status: ExecutionPlanStatus;
	objective: string;
	supersededBy?: string;
	counts: Record<ExecutionPlanNodeStatus, number>;
	readyNodeIds: string[];
	runningNodeIds: string[];
	reviewNodeIds: string[];
	reviewRunIds: string[];
	blockedNodeIds: string[];
	currentWave?: ExecutionPlanWave;
	nextAction: "run" | "review" | "integrate" | "plan" | "complete";
	availableActions: Array<"run" | "review" | "integrate" | "plan" | "complete">;
}
