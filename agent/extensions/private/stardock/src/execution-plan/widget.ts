import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { LoopState, WorkerRun } from "../state/core.ts";
import { compactText } from "../state/core.ts";
import type { ExecutionPlanNode, ExecutionPlanNodeStatus } from "./contracts.ts";
import { summarizeExecutionPlan } from "./graph.ts";

export interface ExecutionNodeActivity {
	loopName: string;
	nodeId: string;
	status: "queued" | "running" | "settled";
	startedAt: number;
	updatedAt: number;
	completedAt?: number;
	currentTool?: string;
	toolCount?: number;
	tokenCount?: number;
}

type StardockTheme = ExtensionContext["ui"]["theme"];

function key(loopName: string, nodeId: string): string {
	return `${loopName}\u0000${nodeId}`;
}

function numberField(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function beginExecutionActivities(store: Map<string, ExecutionNodeActivity> | undefined, loopName: string, nodeIds: string[], now = Date.now()): void {
	if (!store) return;
	for (const nodeId of nodeIds) {
		store.set(key(loopName, nodeId), { loopName, nodeId, status: "queued", startedAt: now, updatedAt: now });
	}
}

export function updateExecutionActivity(store: Map<string, ExecutionNodeActivity> | undefined, loopName: string, text: string, details: Record<string, unknown>, now = Date.now()): void {
	if (!store || typeof details.nodeId !== "string") return;
	const nodeId = details.nodeId;
	const current = store.get(key(loopName, nodeId)) ?? { loopName, nodeId, status: "queued" as const, startedAt: now, updatedAt: now };
	const update = record(details.update) ?? details;
	const currentTool = typeof update.currentTool === "string" ? update.currentTool : current.currentTool;
	const startedAt = current.status === "queued" ? now : current.startedAt;
	const toolCount = numberField(update.toolCount) ?? current.toolCount;
	const tokenCount = numberField(update.tokenCount) ?? numberField(update.totalTokens) ?? numberField(update.tokens) ?? current.tokenCount;
	const settled = typeof details.status === "string" || /settled/i.test(text);
	store.set(key(loopName, nodeId), {
		...current,
		status: settled ? "settled" : "running",
		startedAt,
		updatedAt: now,
		...(settled ? { completedAt: now } : {}),
		...(currentTool ? { currentTool } : {}),
		...(toolCount !== undefined ? { toolCount } : {}),
		...(tokenCount !== undefined ? { tokenCount } : {}),
	});
}

export function settleExecutionActivities(store: Map<string, ExecutionNodeActivity> | undefined, loopName: string, nodeIds: string[], now = Date.now()): void {
	if (!store) return;
	for (const nodeId of nodeIds) {
		const current = store.get(key(loopName, nodeId));
		if (current) store.set(key(loopName, nodeId), { ...current, status: "settled", updatedAt: now, completedAt: now });
	}
}

function activityFor(store: Map<string, ExecutionNodeActivity> | undefined, loopName: string, node: ExecutionPlanNode): ExecutionNodeActivity | undefined {
	return node.currentExecutionNodeId ? store?.get(key(loopName, node.currentExecutionNodeId)) : undefined;
}

function latestRun(state: LoopState, node: ExecutionPlanNode): WorkerRun | undefined {
	if (node.currentWorkerRunId) return state.workerRuns.find((run) => run.id === node.currentWorkerRunId);
	return [...state.workerRuns].reverse().find((run) => run.nodeId === node.currentExecutionNodeId);
}

function elapsed(startedAt: number, endedAt: number): string {
	const seconds = Math.max(0, (endedAt - startedAt) / 1000);
	if (seconds < 60) return `${seconds.toFixed(1)}s`;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m${Math.floor(seconds % 60).toString().padStart(2, "0")}s`;
}

function compactCount(value: number): string {
	if (value < 1_000) return String(Math.round(value));
	if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`;
	return `${(value / 1_000_000).toFixed(1)}m`;
}

function statusLabel(status: ExecutionPlanNodeStatus): string {
	if (status === "needs_review") return "needs review";
	if (status === "retry_ready") return "retry ready";
	return status;
}

function statusGlyph(status: ExecutionPlanNodeStatus): string {
	if (status === "integrated" || status === "accepted") return "✓";
	if (status === "running") return "◆";
	if (status === "needs_review") return "◇";
	if (status === "retry_ready") return "↻";
	if (status === "blocked") return "!";
	if (status === "ready") return "○";
	return "·";
}

function statusColor(status: ExecutionPlanNodeStatus): "success" | "accent" | "warning" | "error" | "dim" {
	if (status === "integrated" || status === "accepted") return "success";
	if (status === "running" || status === "ready") return "accent";
	if (status === "needs_review" || status === "retry_ready") return "warning";
	if (status === "blocked") return "error";
	return "dim";
}

function topologicalNodes(nodes: ExecutionPlanNode[]): ExecutionPlanNode[] {
	const remaining = [...nodes];
	const emitted = new Set<string>();
	const ordered: ExecutionPlanNode[] = [];
	while (remaining.length) {
		const index = remaining.findIndex((node) => node.dependsOn.every((dependency) => emitted.has(dependency)));
		if (index < 0) return [...ordered, ...remaining];
		const [node] = remaining.splice(index, 1);
		ordered.push(node);
		emitted.add(node.id);
	}
	return ordered;
}

function nodeDetail(state: LoopState, node: ExecutionPlanNode, activity: ExecutionNodeActivity | undefined, now: number): string {
	const parts = [node.status === "running" && activity?.status === "queued" ? "queued" : statusLabel(node.status)];
	const run = latestRun(state, node);
	if (node.status === "running" && run?.agentName) parts.push(run.agentName);
	if (activity?.currentTool) parts.push(activity.currentTool);
	if (activity?.toolCount !== undefined) parts.push(`${activity.toolCount} tool use${activity.toolCount === 1 ? "" : "s"}`);
	if (activity?.tokenCount !== undefined) parts.push(`${compactCount(activity.tokenCount)} token`);
	if (activity && activity.status !== "queued") parts.push(elapsed(activity.startedAt, activity.completedAt ?? now));
	if (node.status === "pending" && node.dependsOn.length) parts.push(`after ${node.dependsOn.join(", ")}`);
	else if (node.dependsOn.length) parts.push(`← ${node.dependsOn.join(", ")}`);
	if (node.status === "blocked" && node.lastError) parts.push(compactText(node.lastError, 48) ?? node.lastError);
	return parts.join(" · ");
}

export function formatExecutionPlanDetail(state: LoopState, store: Map<string, ExecutionNodeActivity> | undefined, now = Date.now()): string {
	const plan = state.executionPlan;
	if (!plan) return `Loop "${state.name}" has no execution DAG.`;
	const plainTheme = { fg: (_style: string, text: string) => text, bold: (text: string) => text } as StardockTheme;
	return [
		...renderExecutionPlanWidget(state, store, plainTheme, now),
		"",
		`Objective: ${plan.objective}`,
		`Result target: governor-reviewed node evidence and explicit dependent outcomes`,
		...(plan.constraints.length ? ["Constraints:", ...plan.constraints.map((constraint) => `- ${constraint}`)] : []),
		"Nodes:",
		...topologicalNodes(plan.nodes).map((node) => `- ${node.id} [${node.kind}; ${node.status}; attempts ${node.attemptsUsed}/${node.maxAttempts}] deps=${node.dependsOn.join(",") || "none"} writes=${node.writes.join(",") || "none"}`),
	].join("\n");
}

export function renderExecutionPlanWidget(
	state: LoopState,
	store: Map<string, ExecutionNodeActivity> | undefined,
	theme: StardockTheme,
	now = Date.now(),
): string[] {
	const plan = state.executionPlan;
	if (!plan) return [];
	const snapshot = summarizeExecutionPlan(plan);
	const resolved = plan.nodes.filter((node) => node.status === "integrated" || node.status === "accepted").length;
	const trackedActivities = plan.nodes.map((node) => activityFor(store, state.name, node)).filter((activity): activity is ExecutionNodeActivity => Boolean(activity));
	const running = trackedActivities.length ? trackedActivities.filter((activity) => activity.status === "running").length : plan.nodes.filter((node) => node.status === "running").length;
	const queued = trackedActivities.filter((activity) => activity.status === "queued").length;
	const review = plan.nodes.filter((node) => node.status === "needs_review").length;
	const waveNumber = snapshot.currentWave ? plan.waves.findIndex((wave) => wave.id === snapshot.currentWave?.id) + 1 : plan.waves.length;
	const header = plan.status === "draft"
		? `┊ DAG draft · ${plan.nodes.length} node${plan.nodes.length === 1 ? "" : "s"} authored · next plan`
		: `┊ DAG · wave ${Math.max(1, waveNumber)} · ${running} agent${running === 1 ? "" : "s"} running${queued ? ` · ${queued} queued` : ""} · ${resolved}/${plan.nodes.length} resolved · ${review} review · next ${snapshot.nextAction}`;
	const lines = [
		theme.fg("accent", `${theme.bold("stardock")} ${state.name} (${plan.nodes.length})`),
		theme.fg("muted", header),
	];
	const orderedNodes = topologicalNodes(plan.nodes);
	for (const [index, node] of orderedNodes.entries()) {
		const connector = index === orderedNodes.length - 1 ? "└" : "├";
		const nodeActivity = activityFor(store, state.name, node);
		const queuedNode = node.status === "running" && nodeActivity?.status === "queued";
		const glyph = theme.fg(queuedNode ? "dim" : statusColor(node.status), queuedNode ? "·" : statusGlyph(node.status));
		const label = theme.fg(node.status === "running" && !queuedNode ? "accent" : "text", theme.bold(node.id));
		const detail = theme.fg(node.status === "blocked" ? "warning" : "dim", nodeDetail(state, node, nodeActivity, now));
		lines.push(`${theme.fg("dim", connector)} ${glyph} ${label} ${theme.fg("dim", "·")} ${detail}`);
	}
	lines.push(theme.fg("accent", "  /stardock view for DAG detail"));
	return lines;
}
