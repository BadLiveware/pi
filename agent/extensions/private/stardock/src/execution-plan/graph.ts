import { createHash } from "node:crypto";
import * as path from "node:path";
import type { ResourceClaim } from "../stages/contracts.ts";
import type {
	ExecutionPlan,
	ExecutionPlanInput,
	ExecutionPlanNode,
	ExecutionPlanNodeInput,
	ExecutionPlanNodeStatus,
	ExecutionPlanSnapshot,
} from "./contracts.ts";

export interface ExecutionPlanValidation {
	ok: boolean;
	errors: string[];
	topologicalOrder: string[];
}

export interface ExecutionPlanValidationOptions {
	allowEmptyNodes?: boolean;
	allowMissingDependencies?: boolean;
	deferCrossNodeConflicts?: boolean;
}

export interface ExecutionPlanCreationOptions extends ExecutionPlanValidationOptions {
	draft?: boolean;
}

const NODE_STATUSES: ExecutionPlanNodeStatus[] = ["pending", "ready", "running", "needs_review", "accepted", "integrated", "retry_ready", "abandoned", "blocked"];

function unique(values: string[] | undefined): string[] {
	return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function normalizedWrite(value: string): string {
	const normalized = path.posix.normalize(value.trim().replaceAll("\\", "/")).replace(/^\.\//, "");
	if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
		throw new Error(`write path "${value}" must be a nonempty repository-relative path`);
	}
	return normalized.replace(/\/$/, "");
}

function pathsOverlap(left: string, right: string): boolean {
	return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function claimsConflict(left: ResourceClaim, right: ResourceClaim): boolean {
	if (left.key !== right.key) return false;
	if (left.mode === "exclusive" || right.mode === "exclusive") return true;
	return left.value === right.value;
}

function topologicalOrder(nodes: Array<{ id: string; dependsOn?: string[] }>): string[] {
	const ids = new Set(nodes.map((node) => node.id));
	const indegree = new Map(nodes.map((node) => [node.id, 0]));
	const dependents = new Map<string, string[]>();
	for (const node of nodes) {
		for (const dependency of unique(node.dependsOn)) {
			if (!ids.has(dependency)) continue;
			indegree.set(node.id, (indegree.get(node.id) ?? 0) + 1);
			const list = dependents.get(dependency) ?? [];
			list.push(node.id);
			dependents.set(dependency, list);
		}
	}
	const position = new Map(nodes.map((node, index) => [node.id, index]));
	const ready = nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).map((node) => node.id);
	const ordered: string[] = [];
	while (ready.length) {
		ready.sort((left, right) => (position.get(left) ?? 0) - (position.get(right) ?? 0) || left.localeCompare(right));
		const id = ready.shift()!;
		ordered.push(id);
		for (const dependent of dependents.get(id) ?? []) {
			const next = (indegree.get(dependent) ?? 0) - 1;
			indegree.set(dependent, next);
			if (next === 0) ready.push(dependent);
		}
	}
	return ordered;
}

function dependencyClosure(nodes: ExecutionPlanNodeInput[]): Map<string, Set<string>> {
	const byId = new Map(nodes.map((node) => [node.id, node]));
	const memo = new Map<string, Set<string>>();
	const visit = (id: string, stack = new Set<string>()): Set<string> => {
		if (memo.has(id)) return memo.get(id)!;
		if (stack.has(id)) return new Set();
		const nextStack = new Set(stack).add(id);
		const result = new Set<string>();
		for (const dependency of unique(byId.get(id)?.dependsOn)) {
			result.add(dependency);
			for (const ancestor of visit(dependency, nextStack)) result.add(ancestor);
		}
		memo.set(id, result);
		return result;
	};
	for (const node of nodes) visit(node.id);
	return memo;
}

function validateNode(node: ExecutionPlanNodeInput, defaultMaxAttempts: number, errors: string[]): void {
	if (!node.id.trim()) errors.push("Execution plan node id must not be empty.");
	if (node.id !== node.id.trim()) errors.push(`Execution plan node id "${node.id}" must not have surrounding whitespace.`);
	if (!node.objective.trim()) errors.push(`Execution plan node "${node.id}" objective must not be empty.`);
	if (!node.task.trim()) errors.push(`Execution plan node "${node.id}" task must not be empty.`);
	if (!node.acceptanceCriteria.length || node.acceptanceCriteria.some((criterion) => !criterion.trim())) {
		errors.push(`Execution plan node "${node.id}" must declare at least one nonblank acceptance criterion.`);
	}
	if (node.validationCommands?.some((command) => !command.trim())) {
		errors.push(`Execution plan node "${node.id}" validation commands must not contain blanks.`);
	}
	const attempts = node.maxAttempts ?? defaultMaxAttempts;
	if (!Number.isInteger(attempts) || attempts < 1) errors.push(`Execution plan node "${node.id}" maxAttempts must be a positive integer.`);
	for (const write of node.writes ?? []) {
		try {
			normalizedWrite(write);
		} catch (error) {
			errors.push(`Execution plan node "${node.id}" has invalid write ownership: ${(error as Error).message}.`);
		}
	}
	for (const claim of node.resourceClaims ?? []) {
		if (!claim.key.trim()) errors.push(`Execution plan node "${node.id}" resource key must not be empty.`);
		if (claim.mode === "shared" && !claim.value?.trim()) errors.push(`Execution plan node "${node.id}" shared resource "${claim.key}" requires an explicit value.`);
	}
}

export function validateExecutionPlanInput(input: ExecutionPlanInput, options: ExecutionPlanValidationOptions = {}): ExecutionPlanValidation {
	const errors: string[] = [];
	if (!input.id.trim()) errors.push("Execution plan id must not be empty.");
	if (!input.objective.trim()) errors.push("Execution plan objective must not be empty.");
	if (input.supersedesPlan?.trim() && !input.replanReason?.trim()) errors.push("A superseding execution plan requires a nonblank replanReason.");
	if (input.replanReason?.trim() && !input.supersedesPlan?.trim()) errors.push("A replanReason requires supersedesPlan to identify the blocked plan.");
	if (!input.nodes.length && !options.allowEmptyNodes) errors.push("Execution plan requires at least one node.");
	const maxConcurrency = input.maxConcurrency ?? 4;
	const defaultMaxAttempts = input.defaultMaxAttempts ?? 2;
	if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) errors.push("Execution plan maxConcurrency must be a positive integer.");
	if (!Number.isInteger(defaultMaxAttempts) || defaultMaxAttempts < 1) errors.push("Execution plan defaultMaxAttempts must be a positive integer.");
	if (input.integrationValidationCommands?.some((command) => !command.trim())) {
		errors.push("Execution plan integration validation commands must not contain blanks.");
	}
	const normalizedNodes = input.nodes.map((node) => ({ ...node, id: node.id.trim(), dependsOn: unique(node.dependsOn) }));
	const ids = new Set<string>();
	for (const node of input.nodes) {
		const id = node.id.trim();
		if (ids.has(id)) errors.push(`Duplicate execution plan node id "${id}".`);
		ids.add(id);
		validateNode(node, defaultMaxAttempts, errors);
	}
	for (const node of normalizedNodes) {
		for (const dependency of unique(node.dependsOn)) {
			if (!ids.has(dependency) && !options.allowMissingDependencies) errors.push(`Execution plan node "${node.id}" depends on missing node "${dependency}".`);
			if (dependency === node.id) errors.push(`Execution plan node "${node.id}" cannot depend on itself.`);
		}
	}
	const ordered = topologicalOrder(normalizedNodes);
	if (ordered.length !== ids.size) errors.push("Execution plan contains a dependency cycle.");

	if (!options.deferCrossNodeConflicts) {
		const closure = dependencyClosure(normalizedNodes);
		for (let leftIndex = 0; leftIndex < normalizedNodes.length; leftIndex++) {
			const left = normalizedNodes[leftIndex];
			for (let rightIndex = leftIndex + 1; rightIndex < normalizedNodes.length; rightIndex++) {
				const right = normalizedNodes[rightIndex];
				const orderedPair = closure.get(left.id)?.has(right.id) || closure.get(right.id)?.has(left.id);
				if (orderedPair) continue;
				for (const leftWrite of left.writes ?? []) {
					for (const rightWrite of right.writes ?? []) {
						try {
							const normalizedLeft = normalizedWrite(leftWrite);
							const normalizedRight = normalizedWrite(rightWrite);
							if (pathsOverlap(normalizedLeft, normalizedRight)) errors.push(`Independent nodes "${left.id}" and "${right.id}" have overlapping writes "${normalizedLeft}" and "${normalizedRight}"; add a dependency or split ownership.`);
						} catch {
							// Per-node validation already reports malformed paths.
						}
					}
				}
				for (const leftClaim of left.resourceClaims ?? []) {
					for (const rightClaim of right.resourceClaims ?? []) {
						if (claimsConflict(leftClaim, rightClaim)) errors.push(`Independent nodes "${left.id}" and "${right.id}" have conflicting resource claim "${leftClaim.key}"; add a dependency or allocate distinct values.`);
					}
				}
			}
		}
	}
	return { ok: errors.length === 0, errors: [...new Set(errors)], topologicalOrder: ordered };
}

function internalNodeKey(id: string): string {
	const readable = id.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "node";
	return `${readable}-${createHash("sha256").update(id).digest("hex").slice(0, 10)}`;
}

function canonicalNode(input: ExecutionPlanNodeInput, defaultMaxAttempts: number): ExecutionPlanNode {
	const internalKey = internalNodeKey(input.id.trim());
	return {
		id: input.id.trim(),
		kind: input.kind ?? "work",
		objective: input.objective.trim(),
		task: input.task.trim(),
		dependsOn: unique(input.dependsOn),
		acceptanceCriteria: unique(input.acceptanceCriteria),
		reads: unique(input.reads),
		writes: unique(input.writes).map(normalizedWrite),
		resourceClaims: structuredClone(input.resourceClaims ?? []),
		validationCommands: unique(input.validationCommands),
		maxAttempts: input.maxAttempts ?? defaultMaxAttempts,
		attemptsUsed: 0,
		status: input.dependsOn?.length ? "pending" : "ready",
		criterionId: `plan:${internalKey}:criterion`,
		briefId: `plan:${internalKey}:brief`,
	};
}

export function createExecutionPlan(input: ExecutionPlanInput, now = new Date().toISOString(), options: ExecutionPlanCreationOptions = {}): ExecutionPlan {
	const validation = validateExecutionPlanInput(input, options);
	if (!validation.ok) throw new Error(validation.errors.join(" "));
	const defaultMaxAttempts = input.defaultMaxAttempts ?? 2;
	const plan: ExecutionPlan = {
		id: input.id.trim(),
		revision: 0,
		status: options.draft ? "draft" : "running",
		objective: input.objective.trim(),
		constraints: unique(input.constraints),
		...(input.supersedesPlan?.trim() ? { supersedesPlan: input.supersedesPlan.trim(), replanReason: input.replanReason!.trim() } : {}),
		maxConcurrency: input.maxConcurrency ?? 4,
		defaultMaxAttempts,
		integrationValidationCommands: unique(input.integrationValidationCommands),
		nodes: input.nodes.map((node) => canonicalNode(node, defaultMaxAttempts)),
		waves: [],
		decisions: [],
		createdAt: now,
		updatedAt: now,
	};
	refreshExecutionPlan(plan);
	return plan;
}

export function readyExecutionPlanNodeIds(plan: ExecutionPlan): string[] {
	return plan.nodes.filter((node) => node.status === "ready" || node.status === "retry_ready").map((node) => node.id);
}

export function refreshExecutionPlan(plan: ExecutionPlan): void {
	const byId = new Map(plan.nodes.map((node) => [node.id, node]));
	const dependencySatisfied = (status: ExecutionPlanNodeStatus | undefined) => status === "accepted" || status === "integrated" || status === "abandoned";
	for (const node of plan.nodes) {
		if (node.status !== "pending") continue;
		if (node.dependsOn.every((id) => dependencySatisfied(byId.get(id)?.status))) node.status = "ready";
	}
	if (plan.status === "draft" || plan.status === "superseded") return;
	if (plan.nodes.every((node) => dependencySatisfied(node.status))) plan.status = "completed";
	else if (plan.nodes.some((node) => node.status === "needs_review")) plan.status = "review";
	else if (plan.nodes.some((node) => node.status === "blocked")) plan.status = "blocked";
	else if (plan.waves.some((wave) => wave.status === "integrating")) plan.status = "integrating";
	else plan.status = "running";
}

export function summarizeExecutionPlan(plan: ExecutionPlan): ExecutionPlanSnapshot {
	const counts = Object.fromEntries(NODE_STATUSES.map((status) => [status, plan.nodes.filter((node) => node.status === status).length])) as Record<ExecutionPlanNodeStatus, number>;
	const currentWave = [...plan.waves].reverse().find((wave) => wave.status !== "settled" && wave.status !== "integrated" && wave.status !== "abandoned");
	let nextAction: ExecutionPlanSnapshot["nextAction"] = "run";
	if (plan.status === "draft") nextAction = "plan";
	else if (plan.status === "completed" || plan.status === "superseded") nextAction = "complete";
	else if (plan.status === "blocked") nextAction = "plan";
	else if (counts.needs_review > 0) nextAction = "review";
	else if (currentWave?.status === "integrating") nextAction = "integrate";
	const availableActions = new Set<ExecutionPlanSnapshot["nextAction"]>([nextAction]);
	if (plan.status !== "completed" && plan.status !== "superseded") {
		availableActions.add("plan");
		availableActions.add("complete");
		if (counts.needs_review > 0) availableActions.add("review");
		if (readyExecutionPlanNodeIds(plan).length > 0) availableActions.add("run");
		if (currentWave?.status === "integrating") availableActions.add("integrate");
	}
	return {
		id: plan.id,
		revision: plan.revision,
		status: plan.status,
		objective: plan.objective,
		supersededBy: plan.supersededBy,
		counts,
		readyNodeIds: readyExecutionPlanNodeIds(plan),
		runningNodeIds: plan.nodes.filter((node) => node.status === "running").map((node) => node.id),
		reviewNodeIds: plan.nodes.filter((node) => node.status === "needs_review").map((node) => node.id),
		reviewRunIds: plan.nodes.filter((node) => node.status === "needs_review").map((node) => node.currentWorkerRunId).filter((id): id is string => Boolean(id)),
		blockedNodeIds: plan.nodes.filter((node) => node.status === "blocked").map((node) => node.id),
		currentWave,
		nextAction,
		availableActions: [...availableActions],
	};
}
