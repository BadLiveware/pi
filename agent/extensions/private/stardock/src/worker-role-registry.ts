/** Stardock-owned worker role definitions and prompt builders. */

import { buildBriefWorkerPayload } from "./briefs.ts";
import { compactText, type AdvisoryHandoffRole, type ChangedFileReport, type LoopState, type OutsideRequest, type WorkerReportStatus, type WorkerRunStatus } from "./state/core.ts";
import { WORKER_EVIDENCE_PROMOTION_NOTE } from "./worker-evidence-guidance.ts";

export type StardockWorkerRole = AdvisoryHandoffRole;
export type BriefScopedWorkerRole = Extract<AdvisoryHandoffRole, "explorer" | "test_runner" | "implementer" | "reviewer">;
export type WorkerContext = "fresh" | "fork";
export type WorkerMutability = "read_only" | "mutable";
export type WorkerThinkingLevel = string;
export type WorkerScope = "brief" | "outside_request" | "loop";

export interface StardockWorkerRoleDefinition {
	role: StardockWorkerRole;
	scopes: WorkerScope[];
	mutability: WorkerMutability;
	expectedMutation: boolean;
	defaultAgent: string;
	description: string;
}

export interface WorkerClassificationInput {
	role: StardockWorkerRole;
	output: string;
	isError: boolean;
	changedFiles: ChangedFileReport[];
}

export interface BuildWorkerInvocationInput {
	role: StardockWorkerRole;
	briefId?: string;
	request?: OutsideRequest;
	agentName?: string;
	model?: string;
	thinking?: WorkerThinkingLevel;
	fallbackModel?: string;
	context?: WorkerContext;
}

export type WorkerInvocationResult = {
	ok: true;
	invocation: Record<string, unknown>;
	role: StardockWorkerRole;
	scope: WorkerScope;
	requestedOutput: string;
} | { ok: false; error: string };

const ROLE_DEFINITIONS: Record<StardockWorkerRole, StardockWorkerRoleDefinition> = {
	explorer: { role: "explorer", scopes: ["brief"], mutability: "read_only", expectedMutation: false, defaultAgent: "scout", description: "Map files, symbols, tests, validation plans, context gaps, risks, and review hints for one brief; does not satisfy implementation delegation." },
	test_runner: { role: "test_runner", scopes: ["brief"], mutability: "read_only", expectedMutation: false, defaultAgent: "delegate", description: "Run bounded validation for selected criteria without editing or fixing failures." },
	implementer: { role: "implementer", scopes: ["brief"], mutability: "mutable", expectedMutation: true, defaultAgent: "implementer", description: "Execute one scoped job with optional mutation and return governor-facing evidence." },
	governor: { role: "governor", scopes: ["outside_request", "loop"], mutability: "read_only", expectedMutation: false, defaultAgent: "oracle", description: "Emit a bounded steering decision for the loop." },
	auditor: { role: "auditor", scopes: ["outside_request", "loop"], mutability: "read_only", expectedMutation: false, defaultAgent: "auditor", description: "Review control-loop evidence, criteria, governor memory, and automation risks." },
	researcher: { role: "researcher", scopes: ["outside_request", "loop"], mutability: "read_only", expectedMutation: false, defaultAgent: "feynman-researcher", description: "Gather external or local evidence for a bounded Stardock request." },
	reviewer: { role: "reviewer", scopes: ["brief", "outside_request", "loop"], mutability: "read_only", expectedMutation: false, defaultAgent: "auditor", description: "Review implementation or evidence for a bounded Stardock scope." },
};

export function isStardockWorkerRole(value: unknown): value is StardockWorkerRole {
	return typeof value === "string" && value in ROLE_DEFINITIONS;
}

export function isBriefScopedWorkerRole(value: unknown): value is BriefScopedWorkerRole {
	return value === "explorer" || value === "test_runner" || value === "implementer" || value === "reviewer";
}

export function workerRoleDefinition(role: StardockWorkerRole): StardockWorkerRoleDefinition {
	return ROLE_DEFINITIONS[role];
}

export function defaultWorkerAgent(role: StardockWorkerRole): string {
	return workerRoleDefinition(role).defaultAgent;
}

function hasText(output: string): boolean {
	return output.trim().length > 0;
}

function hasResultStatus(output: string, statuses: string[]): boolean {
	const alternatives = statuses.map((status) => status.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
	return new RegExp(`(^|[\\n\\r\\s\\-*])(?:status|result|verdict)\\s*[:=]\\s*(?:${alternatives})(\\b|$)`, "i").test(output);
}

function hasAny(output: string, words: string[]): boolean {
	const alternatives = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
	return new RegExp(`\\b(?:${alternatives})\\b`, "i").test(output);
}

export function classifyWorkerRunStatus(input: WorkerClassificationInput): WorkerRunStatus {
	const output = input.output;
	if (input.role === "implementer") {
		if (input.isError && input.changedFiles.length === 0) return "failed";
		return "needs_review";
	}
	if (input.isError) return "failed";
	if (!hasText(output)) return "needs_review";
	if (input.role === "explorer") return "succeeded";
	if (input.role === "test_runner") return hasResultStatus(output, ["failed", "skipped", "blocked"]) || hasAny(output, ["failed", "blocked"]) ? "needs_review" : "succeeded";
	if (input.role === "governor") return hasResultStatus(output, ["continue", "pivot", "stop", "request_research", "request_auditor", "ask_user", "measure", "exploit_scaffold"]) ? "succeeded" : "needs_review";
	if (input.role === "auditor") return hasResultStatus(output, ["concerns", "blocked"]) ? "needs_review" : hasResultStatus(output, ["passed"]) ? "succeeded" : "needs_review";
	if (input.role === "reviewer") return hasResultStatus(output, ["concerns", "blocked"]) ? "needs_review" : hasResultStatus(output, ["passed"]) ? "succeeded" : "needs_review";
	if (input.role === "researcher") return hasAny(output, ["blocked", "inconclusive", "gap", "gaps", "openQuestions"]) ? "needs_review" : "succeeded";
	return "needs_review";
}

export function classifyWorkerReportStatus(input: WorkerClassificationInput): WorkerReportStatus {
	return classifyWorkerRunStatus(input) === "succeeded" ? "submitted" : "needs_review";
}

export function workerOutputContract(role: StardockWorkerRole): string {
	if (role === "explorer") {
		return [
			"Return a compact explorer WorkerReport of at most 4,000 characters.",
			"Include only the highest-signal evaluatedCriterionIds, likelyFiles (max 12), likelySymbols (max 15), likelyTests (max 12), validationPlan, contextGaps, risks, openQuestions, suggestedNextMove, and reviewHints.",
			"If the brief already names exact files, symbols, tests, and validation, confirm that boundary briefly instead of reconstructing the subsystem.",
			"Do not edit files, run broad validation, spawn agents, or change Stardock state.",
			"State clearly that explorer output is mapping only and does not satisfy implementation delegation for non-trivial code edits.",
		].join(" ");
	}
	if (role === "test_runner") {
		return [
			"Return a compact test-runner WorkerReport.",
			"Run only bounded validation commands named in this brief or needed to verify selected criteria.",
			"Do not edit files, fix failures, spawn agents, or change Stardock state.",
			"Report commands run, pass/fail/skipped/blocked results, compact failure summaries, artifact/log refs when available, evaluatedCriterionIds, risks, openQuestions, and reviewHints for governor inspection.",
		].join(" ");
	}
	if (role === "implementer") {
		return [
			"Return a compact job WorkerReport for the governor.",
			"Include outcome, evidence or artifact refs, validation observations, risks, openQuestions, suggestedNextMove, and changedFiles with summaries only when durable files changed.",
			"Do not call Stardock tools, mark criteria complete, call stardock_done, complete the loop, spawn agents, or start another worker.",
		].join(" ");
	}
	if (role === "governor") {
		return "Return a compact Governor Decision with verdict, rationale, requiredNextMove, forbiddenNextMoves, evidenceGaps, and optional governorMemoryUpdates. Do not edit files or mutate Stardock state.";
	}
	if (role === "auditor") {
		return "Return compact auditor evidence with status, summary, concerns, recommendations, requiredFollowups, and governorDecisionAdvice. Do not edit files or mutate Stardock state.";
	}
	if (role === "researcher") {
		return "Return a compact Research Result with summary, evidence, recommendations, artifactRefs, and openQuestions. Do not edit files or mutate Stardock state.";
	}
	return "Return a compact Worker Review with status, findings, validation checked, reviewHints, and requiredFollowups. Do not edit files or mutate Stardock state.";
}

export function workerInstructions(role: StardockWorkerRole): string {
	if (role === "explorer") {
		return [
			"Adapter role: explorer",
			"You are a Stardock explorer for one active brief.",
			"Do not edit files. Do not run broad validation. Do not spawn agents. Do not call Stardock tools or mutate Stardock state.",
			"Inspect only enough repository context to resolve the brief's remaining mapping gap. If exact files, symbols, tests, and validation are already named, return a short boundary confirmation and stop.",
			"Cap likely files at 12, likely symbols at 15, likely tests at 12, and the entire report at 4,000 characters. Do not inventory the whole subsystem, restate the full plan, or propose broad validation unrelated to the immediate brief.",
			"Treat code-intel/search results as routing evidence only; do not report defects until the governor inspects or validates them.",
			"Your result does not satisfy implementation delegation for non-trivial code edits; if the next step is mutation, tell the governor to run a Stardock implementer worker or record a direct-edit exception before editing.",
			WORKER_EVIDENCE_PROMOTION_NOTE,
		].join("\n");
	}
	if (role === "test_runner") {
		return [
			"Adapter role: test_runner",
			"You are a Stardock test runner for one active brief.",
			"Do not edit files. Do not fix failures. Do not spawn agents. Do not call Stardock tools or mutate Stardock state.",
			"Run only bounded validation commands named in the brief or the smallest project-native checks needed for the selected criteria.",
			"Keep large logs out of the chat; summarize and return paths/artifact refs when available.",
			WORKER_EVIDENCE_PROMOTION_NOTE,
		].join("\n");
	}
	if (role === "implementer") {
		return [
			"Adapter role: implementer",
			"You are a bounded Stardock implementer running in the parent's current workspace with no isolation.",
			"Edit only files necessary for the selected brief. Preserve unrelated local changes and avoid broad refactors.",
			"Do not spawn agents, run hidden fanout, mutate Stardock state, call stardock_done, commit, push, or declare the loop complete.",
			"If the workspace state or brief scope is unsafe, stop and report the blocker instead of making edits.",
			"The governor must accept or dismiss your result before another mutable worker may run; an undecided result remains advisory and does not veto loop completion.",
		].join("\n");
	}
	if (role === "governor") {
		return [
			"Adapter role: governor",
			"You are a Stardock governor reviewing loop direction.",
			"Do not edit files. Do not mutate Stardock state. Do not spawn agents. Do not declare the loop complete.",
			"Decide whether the next move should continue, pivot, stop, request research, request auditor review, or ask the user.",
			"Return a decision the parent can record with stardock_outside_answer and optionally stardock_governor_state.",
		].join("\n");
	}
	if (role === "auditor") {
		return [
			"Adapter role: auditor",
			"You are a Stardock auditor reviewing the control loop, not implementation minutiae.",
			"Do not edit files. Do not mutate Stardock state. Do not spawn agents. Do not declare the loop complete.",
			"Check objective alignment, criteria integrity, evidence sufficiency, context routing, governor memory, scope drift, and automation safety.",
			"Return a compact review the parent can record with stardock_auditor.",
		].join("\n");
	}
	if (role === "researcher") {
		return [
			"Adapter role: researcher",
			"You are a Stardock researcher for one bounded outside request.",
			"Do not edit files. Do not mutate Stardock state. Do not spawn agents.",
			"Gather only evidence needed to answer the request and return compact findings with source or artifact refs.",
		].join("\n");
	}
	return [
		"Adapter role: reviewer",
		"You are a Stardock reviewer for one bounded, risk-selected scope; your invocation should represent concrete uncertainty or required independent evidence rather than routine duplication of the governor's own inspection.",
		"Do not edit files. Do not mutate Stardock state. Do not spawn agents. Do not declare the loop complete.",
		"Inspect only the named risk boundary and return pass/concerns/blockers, validation checked, review hints, and required follow-ups. Do not reconstruct the entire brief when focused evidence is sufficient.",
	].join("\n");
}

function contextMode(value: unknown): WorkerContext {
	return value === "fork" ? "fork" : "fresh";
}

const KNOWN_THINKING_SUFFIXES = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);

export function normalizeWorkerThinking(value: unknown): WorkerThinkingLevel | undefined {
	if (typeof value !== "string") return undefined;
	const thinking = value.trim();
	if (!thinking) return undefined;
	return thinking.toLowerCase() === "none" ? "off" : thinking;
}

function replaceThinkingSuffix(model: string, thinking: WorkerThinkingLevel): string {
	const colonIndex = model.lastIndexOf(":");
	if (colonIndex === -1) return `${model}:${thinking}`;
	const suffix = model.slice(colonIndex + 1);
	if (!KNOWN_THINKING_SUFFIXES.has(suffix)) return `${model}:${thinking}`;
	return `${model.slice(0, colonIndex)}:${thinking}`;
}

export function modelWithThinkingSuffix(model: string | undefined, thinking: WorkerThinkingLevel | undefined, fallbackModel?: string): string | undefined {
	const baseModel = model?.trim() || (thinking ? fallbackModel?.trim() : undefined);
	if (!baseModel) return undefined;
	return thinking ? replaceThinkingSuffix(baseModel, thinking) : baseModel;
}

function invocationFor(role: StardockWorkerRole, task: string, cwd: string, input: BuildWorkerInvocationInput): Record<string, unknown> {
	const thinking = normalizeWorkerThinking(input.thinking);
	const model = modelWithThinkingSuffix(input.model, thinking, input.fallbackModel);
	return {
		agent: input.agentName?.trim() || defaultWorkerAgent(role),
		...(model ? { model } : {}),
		task,
		cwd,
		context: contextMode(input.context),
	};
}

export function buildBriefWorkerInvocation(state: LoopState, cwd: string, input: BuildWorkerInvocationInput & { role: BriefScopedWorkerRole }): WorkerInvocationResult {
	const payload = buildBriefWorkerPayload(state, { briefId: input.briefId, role: input.role, requestedOutput: workerOutputContract(input.role) });
	if (!payload.ok) return payload;
	const task = [workerInstructions(input.role), "", payload.payload].join("\n");
	return { ok: true, invocation: invocationFor(input.role, task, cwd, input), role: input.role, scope: "brief", requestedOutput: workerOutputContract(input.role) };
}

export interface StageWorkerContract {
	graphId: string;
	stageId: string;
	nodeId: string;
	attemptId: string;
	contractCommit: string;
	branchRef: string;
	writes: string[];
	reads: string[];
	resourceClaims: Array<{ key: string; mode: "shared" | "exclusive"; value?: string }>;
	validationCommands: string[];
}

export function buildExecutionDependencyHandoffs(state: LoopState, executionNodeId: string): string[] {
	const plan = state.executionPlan;
	const graph = state.executionGraph;
	if (!plan || !graph) return [];
	const planNode = plan.nodes.find((candidate) => candidate.currentExecutionNodeId === executionNodeId);
	if (!planNode?.dependsOn.length) return [];
	const lines: string[] = [];
	for (const dependencyId of planNode.dependsOn.slice(0, 12)) {
		const dependency = plan.nodes.find((candidate) => candidate.id === dependencyId);
		const executionNode = dependency ? graph.nodes.find((candidate) => candidate.id === dependency.currentExecutionNodeId) : undefined;
		const attempt = [...(executionNode?.attempts ?? [])].reverse().find((candidate) => state.workerRuns.some((run) => run.id === candidate.workerRunId && run.status === "accepted")) ?? executionNode?.attempts.at(-1);
		const report = attempt?.workerReportId ? state.workerReports.find((candidate) => candidate.id === attempt.workerReportId) : undefined;
		const summary = compactText(report?.summary, 280) ?? "No worker report summary was recorded.";
		lines.push(`- ${dependencyId} [${dependency?.status ?? "unknown"}]: ${summary}`);
		if (attempt?.laneCommits.length) lines.push(`  source: branch=${attempt.branchRef ?? "unknown"}; commits=${attempt.laneCommits.join(", ")}`);
		if (report?.artifactIds.length) lines.push(`  artifacts: ${report.artifactIds.slice(0, 10).join(", ")}`);
		if (report?.changedFiles.length) lines.push(`  changed: ${report.changedFiles.slice(0, 10).map((changed) => changed.path).join(", ")}`);
		if (report?.openQuestions.length) lines.push(`  open questions: ${report.openQuestions.slice(0, 5).map((question) => compactText(question, 160)).join(" | ")}`);
	}
	return lines;
}

export function buildStageBriefWorkerInvocation(
	state: LoopState,
	cwd: string,
	input: BuildWorkerInvocationInput & { role: "implementer"; briefId: string; contract: StageWorkerContract },
): WorkerInvocationResult {
	const payload = buildBriefWorkerPayload(state, { briefId: input.briefId, role: input.role, requestedOutput: workerOutputContract(input.role) });
	if (!payload.ok) return payload;
	const contract = input.contract;
	const stageInstructions = [
		"Adapter role: implementer",
		"You are a bounded Stardock job executor running in an isolated Treehouse lease.",
		`Execution identity: graph=${contract.graphId} stage=${contract.stageId} node=${contract.nodeId} attempt=${contract.attemptId}.`,
		`Start contract: exact commit ${contract.contractCommit} on branch ${contract.branchRef}.`,
		`Owned writes: ${contract.writes.join(", ") || "none"}.`,
		`Read scope: ${contract.reads.join(", ") || "none"}.`,
		`Resource claims: ${contract.resourceClaims.map((claim) => {
			let allocatedValue = "";
			if (claim.value) allocatedValue = `=${claim.value}`;
			return `${claim.mode}:${claim.key}${allocatedValue}`;
		}).join(", ") || "none"}.`,
		`Authoritative validation commands (run by Stardock after your response): ${contract.validationCommands.join(" ; ") || "none"}.`,
		"Edit only owned write paths. Stop and report if the frozen contract, write ownership, or resource allocation must change.",
		"Do not edit solely to prove activity. This node may validly return findings, a concise report, throw-away test results, optional artifacts, optional commits, or no filesystem changes.",
		"Run only the targeted feedback needed while doing the work; do not repeat the full authoritative validation list unless the task itself requires it.",
		"If you create durable changes, commit them on the assigned branch and leave the worktree clean. Do not merge, rebase, integrate, return the lease, mutate the parent checkout, or call Stardock tools.",
		"Do not spawn agents, run hidden fanout, push, or declare the loop complete.",
		"Return a concise governor-facing report: outcome, branch/base/head and commits when any, changed paths when any, evidence or artifact references, validation observations, risks, and open questions.",
	].join("\n");
	const dependencyHandoffs = buildExecutionDependencyHandoffs(state, contract.nodeId);
	const task = [stageInstructions, dependencyHandoffs.length ? `\nAccepted dependency handoffs\n${dependencyHandoffs.join("\n")}\nUse these reports, artifacts, branches, and commits as inputs. Verify any dependency evidence you rely on; do not infer that predecessor filesystem changes are already present in this isolated lease.` : "", "", payload.payload].join("\n");
	return { ok: true, invocation: invocationFor(input.role, task, cwd, input), role: input.role, scope: "brief", requestedOutput: workerOutputContract(input.role) };
}

export function buildRequestWorkerInvocation(state: LoopState, cwd: string, input: BuildWorkerInvocationInput & { request: OutsideRequest }): WorkerInvocationResult {
	const role = input.role;
	const request = input.request;
	const task = [
		workerInstructions(role),
		"",
		`Stardock ${role} worker payload for loop "${state.name}"`,
		`Role: ${role}`,
		`Request: ${request.id} [${request.status}/${request.kind}]`,
		`Trigger: ${request.trigger}`,
		`Mode: ${state.mode}`,
		`Iteration: ${state.iteration}${state.maxIterations > 0 ? `/${state.maxIterations}` : ""}`,
		"",
		"Request prompt",
		request.prompt,
		"",
		"Requested output",
		workerOutputContract(role),
		"",
		"Governor recording options:",
		"- The governor may record plain answers with stardock_outside_answer",
		"- The governor may record compact worker results with stardock_worker_report",
		`- ${WORKER_EVIDENCE_PROMOTION_NOTE}`,
		role === "auditor" ? "- The governor may record oversight results with stardock_auditor" : "",
	].filter(Boolean).join("\n");
	return { ok: true, invocation: invocationFor(role, task, cwd, input), role, scope: "outside_request", requestedOutput: workerOutputContract(role) };
}

function compactLoopContext(state: LoopState): string[] {
	const activeBrief = state.briefs.find((brief) => brief.id === state.currentBriefId);
	const criteria = state.criterionLedger.criteria;
	const pendingRequests = state.outsideRequests.filter((request) => request.status === "requested" || request.status === "in_progress");
	return [
		`Mode: ${state.mode}`,
		`Iteration: ${state.iteration}${state.maxIterations > 0 ? `/${state.maxIterations}` : ""}`,
		activeBrief ? `Active brief: ${activeBrief.id} — ${activeBrief.objective}` : "Active brief: none",
		`Criteria: ${criteria.length} total (${criteria.filter((criterion) => criterion.status === "passed").length} passed, ${criteria.filter((criterion) => criterion.status === "pending").length} pending, ${criteria.filter((criterion) => criterion.status === "failed").length} failed, ${criteria.filter((criterion) => criterion.status === "blocked").length} blocked, ${criteria.filter((criterion) => criterion.status === "skipped").length} skipped)`,
		`Worker runs: ${state.workerRuns.length}`,
		`Worker reports: ${state.workerReports.length}`,
		pendingRequests.length ? `Pending outside requests: ${pendingRequests.slice(0, 6).map((request) => `${request.id} [${request.kind}/${request.status}]`).join(", ")}` : "Pending outside requests: none",
	];
}

export function buildLoopWorkerInvocation(state: LoopState, cwd: string, input: BuildWorkerInvocationInput): WorkerInvocationResult {
	const role = input.role;
	if (!workerRoleDefinition(role).scopes.includes("loop")) return { ok: false, error: `Role "${role}" is not loop-scoped. Pass briefId or requestId instead.` };
	const task = [
		workerInstructions(role),
		"",
		`Stardock ${role} loop-scoped worker payload for loop "${state.name}"`,
		`Role: ${role}`,
		...compactLoopContext(state),
		"",
		"Requested output",
		workerOutputContract(role),
		"",
		"Governor recording options:",
		"- The governor may record compact worker results with stardock_worker_report",
		`- ${WORKER_EVIDENCE_PROMOTION_NOTE}`,
		role === "governor" ? "- The governor may record structured decisions with stardock_governor_state and stardock_outside_answer when a request exists" : "",
		role === "auditor" ? "- The governor may record oversight results with stardock_auditor" : "",
	].filter(Boolean).join("\n");
	return { ok: true, invocation: invocationFor(role, task, cwd, input), role, scope: "loop", requestedOutput: workerOutputContract(role) };
}
