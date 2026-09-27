import type { LoopState, PromptReason } from "../state/core.ts";
import { summarizeExecutionPlan } from "./graph.ts";

function nodeLine(state: LoopState, nodeId: string): string {
	const node = state.executionPlan?.nodes.find((candidate) => candidate.id === nodeId);
	if (!node) return nodeId;
	return `${node.id} [${node.status}; attempts ${node.attemptsUsed}/${node.maxAttempts}] — ${node.objective}`;
}

function nextInstruction(state: LoopState): string {
	const plan = state.executionPlan!;
	const snapshot = summarizeExecutionPlan(plan);
	if (plan.status === "superseded") return `This immutable plan generation was superseded by "${plan.supersededBy ?? "a replacement plan"}". Switch to that plan; do not execute this generation.`;
	if (snapshot.nextAction === "run") return "Call stardock_run once to execute the complete ready set. Do not select or serialize individual ready nodes.";
	if (snapshot.nextAction === "review") {
		const runIds = plan.nodes.filter((node) => node.status === "needs_review").map((node) => node.currentWorkerRunId).filter(Boolean);
		return `Inspect the concise settled reports, then record accept, retry, or abandon decisions for whichever runIds you are ready to decide: ${runIds.join(", ")}. Worker and validation warnings inform but do not veto the governor.`;
	}
	if (snapshot.nextAction === "integrate") return "This persisted legacy wave has accepted commit outputs available for optional promotion with stardock_integrate. The governor may instead preserve the evidence and choose another safe action.";
	if (snapshot.nextAction === "plan" && plan.status === "draft") return `Continue authoring plan "${state.name}" with stardock_plan action "upsert", then call action "seal" after every node contract is present. Do not run the draft.`;
	if (snapshot.nextAction === "plan") return `This plan needs a governor decision. Inspect its evidence, then retry, abandon, or supersede it under a new name. No auditor or policy action is mandatory.`;
	return "The DAG is complete by governor decision. Report the consumed evidence and any unresolved warnings; code promotion is separate and optional unless the DAG modeled it explicitly.";
}

export function buildExecutionPlanSystemInstructions(state: LoopState): string {
	const plan = state.executionPlan!;
	const snapshot = summarizeExecutionPlan(plan);
	return [
		"You are the governor of a Stardock DAG. Stardock schedules isolated jobs and compresses node communication; it does not own semantic decisions or integration.",
		`- Objective: ${plan.objective}`,
		plan.constraints.length ? `- Constraints: ${plan.constraints.join("; ")}` : undefined,
		`- Plan status: ${snapshot.status}`,
		`- Ready nodes: ${snapshot.readyNodeIds.join(", ") || "none"}`,
		"- Keep node execution isolated and keep the governor context focused on the request, DAG, concise node reports, decisions, risks, and useful evidence.",
		"- Nodes may return findings, throw-away experiments, optional artifacts, optional commits, or no filesystem changes. Accepted nodes satisfy dependencies; model integration/promotion as an explicit node only when consumers need combined code.",
		"- Worker transport, validation, auditor, policy, and attempt-budget signals are advisory. The governor may accept, retry, abandon, supersede, or complete with rationale.",
		`- ${nextInstruction(state)}`,
	].filter((line): line is string => Boolean(line)).join("\n");
}

export function buildExecutionPlanPrompt(state: LoopState, reason: PromptReason): string {
	const plan = state.executionPlan!;
	const snapshot = summarizeExecutionPlan(plan);
	const currentWave = snapshot.currentWave;
	const lines = [
		"───────────────────────────────────────────────────────────────────────",
		`🚀 STARDOCK EXECUTION: ${state.name} | ${snapshot.status}${reason === "reflection" ? " | REVIEW" : ""}`,
		"───────────────────────────────────────────────────────────────────────",
		"",
		"## Governor context",
		`Objective: ${plan.objective}`,
		...(plan.constraints.length ? ["Constraints:", ...plan.constraints.map((constraint) => `- ${constraint}`)] : []),
		"",
		"## DAG status",
		`Ready: ${snapshot.readyNodeIds.length}`,
		`Running: ${snapshot.runningNodeIds.length}`,
		`Needs review: ${snapshot.reviewNodeIds.length}`,
		`Blocked: ${snapshot.blockedNodeIds.length}`,
	];
	if (snapshot.readyNodeIds.length) lines.push("Ready nodes:", ...snapshot.readyNodeIds.map((id) => `- ${nodeLine(state, id)}`));
	if (snapshot.runningNodeIds.length) lines.push("Running nodes:", ...snapshot.runningNodeIds.map((id) => `- ${nodeLine(state, id)}`));
	if (snapshot.reviewNodeIds.length) lines.push("Review nodes:", ...snapshot.reviewNodeIds.map((id) => `- ${nodeLine(state, id)}`));
	if (snapshot.blockedNodeIds.length) lines.push("Blocked nodes:", ...snapshot.blockedNodeIds.map((id) => `- ${nodeLine(state, id)}`));
	if (currentWave) lines.push("", `Current wave: ${currentWave.id} [${currentWave.status}] — ${currentWave.nodeIds.join(", ")}`);
	const latestDecision = plan.decisions.at(-1);
	if (latestDecision) lines.push("", "Latest decision:", `- ${latestDecision.kind}: ${latestDecision.summary}`);
	lines.push("", "## Available governor move", nextInstruction(state));
	return lines.join("\n");
}
