import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import type { StardockRuntime } from "../runtime/types.ts";
import type { IterationBrief, LoopState } from "../state/core.ts";
import { createLoopState } from "../state/factory.ts";
import { defaultTaskFile, ensureDir, sanitize } from "../state/paths.ts";
import { releaseStage } from "../stages/reconcile.ts";
import type { RunReadyAdapter } from "../stages/run-ready.ts";
import { loadState, mutateState, saveState } from "../state/store.ts";
import type { ExecutionPlan, ExecutionPlanInput, ExecutionPlanNode, ExecutionPlanNodeInput } from "./contracts.ts";
import { createExecutionPlan } from "./graph.ts";

export type ExecutionPlanAuthoringAction = "replace" | "draft" | "upsert" | "seal";

export interface ExecutionPlanAuthoringResult {
	state: LoopState;
	warnings: string[];
}

export interface ExecutionPlanAuthoringParams {
	action?: ExecutionPlanAuthoringAction;
	name: string;
	objective?: string;
	constraints?: string[];
	supersedesPlan?: string;
	replanReason?: string;
	maxConcurrency?: number;
	defaultMaxAttempts?: number;
	integrationValidationCommands?: string[];
	nodes?: ExecutionPlanNodeInput[];
}

function generatedTask(plan: ExecutionPlan): string {
	return [
		`# ${plan.objective}`,
		"",
		"This file is a human-readable projection of the Stardock execution plan. Plan state is canonical.",
		"",
		...(plan.status === "draft" ? ["Status: draft. Add or correct nodes with `stardock_plan` and seal before running.", ""] : []),
		...(plan.supersedesPlan ? ["## Replan", `- Supersedes: ${plan.supersedesPlan}`, `- Reason: ${plan.replanReason}`, ""] : []),
		"## Constraints",
		...(plan.constraints.length ? plan.constraints.map((item) => `- ${item}`) : ["- None recorded"]),
		"",
		"## Jobs",
		...(plan.nodes.length ? plan.nodes.map((node) => `- [${node.status === "accepted" || node.status === "integrated" ? "x" : " "}] ${node.id} [${node.status}]: ${node.objective}`) : ["- No nodes authored yet."]),
		"",
		"## Optional promotion validation",
		...(plan.integrationValidationCommands.length ? plan.integrationValidationCommands.map((command) => `- \`${command}\``) : ["- None recorded"]),
		"",
	].join("\n");
}

function criterionFor(node: ExecutionPlanNode) {
	return {
		id: node.criterionId,
		taskId: node.id,
		sourceRef: `execution-plan:${node.id}`,
		requirement: node.task,
		description: node.objective,
		passCondition: node.acceptanceCriteria.join("; ") || "The governor accepts the node result.",
		testMethod: node.validationCommands.join("; "),
		status: "pending" as const,
	};
}

function briefFor(plan: ExecutionPlan, node: ExecutionPlanNode, now: string): IterationBrief {
	return {
		id: node.briefId,
		status: "draft",
		source: "manual",
		objective: node.objective,
		task: node.task,
		criterionIds: [node.criterionId],
		acceptanceCriteria: [...node.acceptanceCriteria],
		verificationRequired: [...node.validationCommands],
		requiredContext: [...node.reads],
		constraints: [...plan.constraints, `If writing durable files, stay within: ${node.writes.join(", ") || "no declared paths"}.`],
		avoid: ["Do not expand into another execution-plan node or decide the governor's next action."],
		outputContract: "Return a concise governor-facing outcome with relevant evidence, optional artifact or commit handles, validation observations, risks, and open questions.",
		sourceRefs: [`execution-plan:${plan.id}`, `execution-node:${node.id}`],
		createdAt: now,
		updatedAt: now,
	};
}

function applyPlanRecords(state: LoopState, plan: ExecutionPlan, now: string): void {
	const retainedCriterionIds = new Set(plan.nodes.map((node) => node.criterionId));
	const retainedBriefIds = new Set(plan.nodes.map((node) => node.briefId));
	const priorCriterionIds = new Set(state.executionPlan?.nodes.map((node) => node.criterionId) ?? []);
	const priorBriefIds = new Set(state.executionPlan?.nodes.map((node) => node.briefId) ?? []);
	state.criterionLedger.criteria = state.criterionLedger.criteria.filter((criterion) => !priorCriterionIds.has(criterion.id) || retainedCriterionIds.has(criterion.id));
	state.briefs = state.briefs.filter((brief) => !priorBriefIds.has(brief.id) || retainedBriefIds.has(brief.id));
	state.executionPlan = plan;
	for (const node of plan.nodes) {
		const criterion = criterionFor(node);
		const criterionIndex = state.criterionLedger.criteria.findIndex((item) => item.id === criterion.id);
		if (criterionIndex >= 0) state.criterionLedger.criteria[criterionIndex] = { ...state.criterionLedger.criteria[criterionIndex], ...criterion };
		else state.criterionLedger.criteria.push(criterion);
		const brief = briefFor(plan, node, now);
		const briefIndex = state.briefs.findIndex((item) => item.id === brief.id);
		if (briefIndex >= 0) state.briefs[briefIndex] = { ...state.briefs[briefIndex], ...brief, createdAt: state.briefs[briefIndex].createdAt };
		else state.briefs.push(brief);
	}
	state.criterionLedger.requirementTrace = plan.nodes.map((node) => ({ requirement: node.task, criterionIds: [node.criterionId] }));
	delete state.currentBriefId;
}

function writeTaskProjection(ctx: ExtensionContext, state: LoopState): string | undefined {
	if (!state.executionPlan) return undefined;
	try {
		const fullPath = path.resolve(ctx.cwd, state.taskFile);
		ensureDir(fullPath);
		fs.writeFileSync(fullPath, generatedTask(state.executionPlan), "utf8");
		return undefined;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `Canonical plan state was committed, but the human-readable task projection could not be updated: ${message}`;
	}
}

function resultWithProjection(ctx: ExtensionContext, state: LoopState): ExecutionPlanAuthoringResult {
	const warning = writeTaskProjection(ctx, state);
	return { state, warnings: warning ? [warning] : [] };
}

function requiredInput(params: ExecutionPlanAuthoringParams, planId: string): ExecutionPlanInput {
	if (!params.objective?.trim()) throw new Error("A replacement or draft plan requires a nonblank objective.");
	if ((params.nodes?.length ?? 0) > 100) throw new Error("Execution plans support at most 100 nodes.");
	return {
		id: planId,
		objective: params.objective,
		constraints: params.constraints,
		supersedesPlan: params.supersedesPlan,
		replanReason: params.replanReason,
		maxConcurrency: params.maxConcurrency,
		defaultMaxAttempts: params.defaultMaxAttempts,
		integrationValidationCommands: params.integrationValidationCommands ?? [],
		nodes: params.nodes ?? [],
	};
}

function validateSupersedingInput(ctx: ExtensionContext, loopName: string, input: ExecutionPlanInput): ExecutionPlanInput {
	if (!input.supersedesPlan) return input;
	const predecessorName = sanitize(input.supersedesPlan);
	if (predecessorName === loopName) throw new Error("A plan must be superseded under a new name so its evidence remains immutable.");
	const predecessorState = loadState(ctx, predecessorName);
	const predecessor = predecessorState?.executionPlan;
	if (!predecessor) throw new Error(`Superseded execution plan "${predecessorName}" was not found.`);
	const alreadyRetiredForThisPlan = predecessor.status === "superseded" && predecessor.supersededBy === loopName;
	const hasRunningWorker = predecessorState.workerRuns.some((run) => run.status === "running");
	const hasPreparedIntegration = predecessorState.executionGraph?.stages.some((stage) => stage.status === "integration_prepared");
	if (!alreadyRetiredForThisPlan && (hasRunningWorker || hasPreparedIntegration)) {
		throw new Error(`Execution plan "${predecessorName}" has active mechanical work (${hasRunningWorker ? "running worker" : "prepared integration"}); cancel or reconcile that resource before superseding.`);
	}
	return { ...input, supersedesPlan: predecessorName };
}

function inputFromPlan(plan: ExecutionPlan): ExecutionPlanInput {
	return {
		id: plan.id,
		objective: plan.objective,
		constraints: [...plan.constraints],
		supersedesPlan: plan.supersedesPlan,
		replanReason: plan.replanReason,
		maxConcurrency: plan.maxConcurrency,
		defaultMaxAttempts: plan.defaultMaxAttempts,
		integrationValidationCommands: [...plan.integrationValidationCommands],
		nodes: plan.nodes.map((node) => ({
			id: node.id,
			kind: node.kind,
			objective: node.objective,
			task: node.task,
			dependsOn: [...node.dependsOn],
			acceptanceCriteria: [...node.acceptanceCriteria],
			reads: [...node.reads],
			writes: [...node.writes],
			resourceClaims: structuredClone(node.resourceClaims),
			validationCommands: [...node.validationCommands],
			maxAttempts: node.maxAttempts,
		})),
	};
}

function assertMutableDraft(state: LoopState | null, loopName: string): asserts state is LoopState & { executionPlan: ExecutionPlan } {
	if (!state?.executionPlan) throw new Error(`Draft execution plan "${loopName}" was not found. Create it with action "draft" first.`);
	if (state.executionPlan.status !== "draft") throw new Error(`Execution plan "${loopName}" is sealed (${state.executionPlan.status}) and cannot be changed. Use a new plan generation to replan.`);
	if (state.executionPlan.waves.length || state.executionGraph?.nodes.some((node) => node.attempts.length)) throw new Error("A draft with durable execution attempts cannot be changed.");
}

function commitDraftTransition(ctx: ExtensionContext, loopName: string, expectedRevision: number, plan: ExecutionPlan, now: string): LoopState {
	return mutateState(ctx, loopName, (candidate) => {
		const current = candidate.executionPlan;
		if (!current || current.status !== "draft" || current.revision !== expectedRevision) throw new Error("Draft changed before this authoring update committed. Reload stardock_status and retry against the latest revision.");
		applyPlanRecords(candidate, plan, now);
	});
}

function retireSupersededPlan(ctx: ExtensionContext, predecessorName: string, successorName: string): void {
	const observed = loadState(ctx, predecessorName);
	const observedPlan = observed?.executionPlan;
	if (!observedPlan) throw new Error(`Superseded execution plan "${predecessorName}" was not found.`);
	if (observedPlan.status === "superseded" && observedPlan.supersededBy === successorName) return;
	const expectedRevision = observedPlan.revision;
	const now = new Date().toISOString();
	mutateState(ctx, predecessorName, (candidate) => {
		const plan = candidate.executionPlan;
		if (!plan || plan.revision !== expectedRevision) throw new Error(`Superseded execution plan "${predecessorName}" changed before retirement. Re-evaluate the replacement plan.`);
		if (plan.status === "superseded" && plan.supersededBy === successorName) return;
		plan.status = "superseded";
		plan.supersededBy = successorName;
		for (const node of plan.nodes) {
			if (!["accepted", "integrated", "abandoned"].includes(node.status)) node.status = "abandoned";
		}
		for (const wave of plan.waves) {
			if (wave.status !== "integrated" && wave.status !== "settled" && wave.status !== "abandoned") wave.status = "abandoned";
		}
		const graph = candidate.executionGraph;
		if (graph) {
			for (const node of graph.nodes) {
				if (!["succeeded", "integrated", "abandoned"].includes(node.status)) node.status = "abandoned";
			}
			for (const stage of graph.stages) {
				if (stage.status === "integrated" || stage.status === "settled" || stage.status === "abandoned") continue;
				stage.status = "abandoned";
				stage.abandonment = { rationale: `Superseded by ${successorName}.`, approvalRef: `governor:${successorName}`, abandonedAt: now };
			}
			graph.status = "abandoned";
			graph.updatedAt = now;
		}
		plan.revision += 1;
		plan.updatedAt = now;
	});
}


export async function releaseSupersededPlanResources(ctx: ExtensionContext, predecessorName: string, signal?: AbortSignal, adapter?: RunReadyAdapter): Promise<string[]> {
	const warnings: string[] = [];
	const loopName = sanitize(predecessorName);
	let state = loadState(ctx, loopName);
	if (!state?.executionGraph) return warnings;
	for (const stage of state.executionGraph.stages) {
		const hasHeldAttempt = stage.implementationNodeIds.some((nodeId) => state?.executionGraph?.nodes.find((node) => node.id === nodeId)?.attempts.some((attempt) => attempt.leaseDisposition !== "released" && Boolean(attempt.worktreePath || attempt.repositoryCommonDir || attempt.leaseHolder)));
		if (!hasHeldAttempt) continue;
		try {
			const released = await releaseStage(ctx, {
				loopName,
				graphId: state.executionGraph.id,
				stageId: stage.id,
				expectedGraphRevision: state.executionGraph.revision,
			}, signal, adapter);
			for (const preserved of released.preserved) warnings.push(`Superseded attempt ${preserved.attemptId} was preserved: ${preserved.reason}`);
		} catch (error) {
			warnings.push(`Superseded stage ${stage.id} cleanup needs attention: ${error instanceof Error ? error.message : String(error)}`);
		}
		state = loadState(ctx, loopName);
		if (!state?.executionGraph) break;
	}
	return warnings;
}

function persistNewPlan(ctx: ExtensionContext, loopName: string, plan: ExecutionPlan, now: string): LoopState {
	const state = createLoopState({ name: loopName, taskFile: defaultTaskFile(loopName), mode: "checklist", modeState: { kind: "checklist" }, maxIterations: 0, executionPlan: plan, now });
	applyPlanRecords(state, plan, now);
	saveState(ctx, state);
	return state;
}

function saveNewPlan(ctx: ExtensionContext, runtime: StardockRuntime, loopName: string, plan: ExecutionPlan, now: string): ExecutionPlanAuthoringResult {
	const state = persistNewPlan(ctx, loopName, plan, now);
	runtime.ref.currentLoop = loopName;
	return resultWithProjection(ctx, state);
}

function replacePlan(ctx: ExtensionContext, runtime: StardockRuntime, params: ExecutionPlanAuthoringParams, loopName: string): ExecutionPlanAuthoringResult {
	const existing = loadState(ctx, loopName);
	const input = validateSupersedingInput(ctx, loopName, requiredInput(params, `${loopName}:plan`));
	if (existing?.executionPlan && existing.executionPlan.status !== "draft") throw new Error(`Execution plan "${loopName}" is sealed (${existing.executionPlan.status}) and cannot be replaced. Create a new named plan generation instead.`);
	const plan = createExecutionPlan(input);
	plan.revision = (existing?.executionPlan?.revision ?? 0) + 1;
	const now = new Date().toISOString();
	plan.createdAt = existing?.executionPlan?.createdAt ?? plan.createdAt;
	plan.updatedAt = now;
	if (!existing && input.supersedesPlan) {
		const draftPlan = structuredClone(plan);
		draftPlan.status = "draft";
		draftPlan.revision = 1;
		persistNewPlan(ctx, loopName, draftPlan, now);
		retireSupersededPlan(ctx, input.supersedesPlan, loopName);
		plan.revision = 2;
		const state = commitDraftTransition(ctx, loopName, draftPlan.revision, plan, now);
		runtime.ref.currentLoop = loopName;
		return resultWithProjection(ctx, state);
	}
	if (input.supersedesPlan) retireSupersededPlan(ctx, input.supersedesPlan, loopName);
	if (!existing) return saveNewPlan(ctx, runtime, loopName, plan, now);
	assertMutableDraft(existing, loopName);
	const state = commitDraftTransition(ctx, loopName, existing.executionPlan.revision, plan, now);
	runtime.ref.currentLoop = loopName;
	return resultWithProjection(ctx, state);
}

function createDraft(ctx: ExtensionContext, runtime: StardockRuntime, params: ExecutionPlanAuthoringParams, loopName: string): ExecutionPlanAuthoringResult {
	if (loadState(ctx, loopName)) throw new Error(`Loop "${loopName}" already exists. Use action "upsert" for its draft or choose a new name.`);
	const now = new Date().toISOString();
	const input = validateSupersedingInput(ctx, loopName, requiredInput(params, `${loopName}:plan`));
	const plan = createExecutionPlan(input, now, { draft: true, allowEmptyNodes: true, allowMissingDependencies: true, deferCrossNodeConflicts: true });
	plan.revision = 1;
	return saveNewPlan(ctx, runtime, loopName, plan, now);
}

function upsertDraft(ctx: ExtensionContext, runtime: StardockRuntime, params: ExecutionPlanAuthoringParams, loopName: string): ExecutionPlanAuthoringResult {
	const existing = loadState(ctx, loopName);
	assertMutableDraft(existing, loopName);
	if (!params.nodes?.length) throw new Error("Draft upsert requires at least one node.");
	const chunkIds = new Set<string>();
	for (const node of params.nodes) {
		const id = node.id.trim();
		if (chunkIds.has(id)) throw new Error(`Draft upsert contains duplicate node id "${id}".`);
		chunkIds.add(id);
	}
	const input = inputFromPlan(existing.executionPlan);
	for (const node of params.nodes) {
		const index = input.nodes.findIndex((candidate) => candidate.id.trim() === node.id.trim());
		if (index >= 0) input.nodes[index] = node;
		else input.nodes.push(node);
	}
	if (input.nodes.length > 100) throw new Error("Execution plans support at most 100 nodes.");
	const now = new Date().toISOString();
	const plan = createExecutionPlan(input, now, { draft: true, allowEmptyNodes: true, allowMissingDependencies: true, deferCrossNodeConflicts: true });
	plan.revision = existing.executionPlan.revision + 1;
	plan.createdAt = existing.executionPlan.createdAt;
	const state = commitDraftTransition(ctx, loopName, existing.executionPlan.revision, plan, now);
	runtime.ref.currentLoop = loopName;
	return resultWithProjection(ctx, state);
}

function sealDraft(ctx: ExtensionContext, runtime: StardockRuntime, loopName: string): ExecutionPlanAuthoringResult {
	const existing = loadState(ctx, loopName);
	assertMutableDraft(existing, loopName);
	const now = new Date().toISOString();
	const plan = createExecutionPlan(inputFromPlan(existing.executionPlan), now);
	plan.revision = existing.executionPlan.revision + 1;
	plan.createdAt = existing.executionPlan.createdAt;
	if (plan.supersedesPlan) retireSupersededPlan(ctx, plan.supersedesPlan, loopName);
	const state = commitDraftTransition(ctx, loopName, existing.executionPlan.revision, plan, now);
	runtime.ref.currentLoop = loopName;
	return resultWithProjection(ctx, state);
}

export function authorExecutionPlan(ctx: ExtensionContext, runtime: StardockRuntime, params: ExecutionPlanAuthoringParams): ExecutionPlanAuthoringResult {
	const action = params.action ?? "replace";
	const loopName = sanitize(params.name);
	if (action === "draft") return createDraft(ctx, runtime, params, loopName);
	if (action === "upsert") {
		if (params.objective !== undefined || params.constraints !== undefined || params.supersedesPlan !== undefined || params.replanReason !== undefined || params.maxConcurrency !== undefined || params.defaultMaxAttempts !== undefined || params.integrationValidationCommands !== undefined) {
			throw new Error("Draft upsert accepts only name and nodes. Replace the unexecuted plan if top-level metadata must change.");
		}
		return upsertDraft(ctx, runtime, params, loopName);
	}
	if (action === "seal") {
		if (params.nodes !== undefined || params.objective !== undefined || params.constraints !== undefined || params.supersedesPlan !== undefined || params.replanReason !== undefined || params.maxConcurrency !== undefined || params.defaultMaxAttempts !== undefined || params.integrationValidationCommands !== undefined) {
			throw new Error("Seal accepts only the draft plan name; update nodes before sealing.");
		}
		return sealDraft(ctx, runtime, loopName);
	}
	return replacePlan(ctx, runtime, params, loopName);
}
