/** Durable governor memory for Stardock loops. */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { compactText, type GovernorState, type LoopState, type RejectedPath } from "./state/core.ts";
import { defaultGovernorState, normalizeStringList } from "./state/migration.ts";
import { loadState, saveState } from "./state/store.ts";

export interface GovernorStateToolDeps {
	getCurrentLoop(): string | null;
	updateUI(ctx: ExtensionContext): void;
}

type GovernorStateField = Exclude<keyof GovernorState, "updatedAt">;

const LIST_FIELDS = ["completedMilestones", "activeConstraints", "knownRisks", "openQuestions", "evidenceGaps", "nextContextHints"] as const;
const CLEARABLE_FIELDS: GovernorStateField[] = ["objective", "currentStrategy", ...LIST_FIELDS, "rejectedPaths"];

function compactList(items: string[], maxItems = 6, maxLength = 140): string[] {
	const compacted = items.map((item) => compactText(item, maxLength) ?? item);
	if (compacted.length <= maxItems) return compacted;
	return [...compacted.slice(0, maxItems), `... ${compacted.length - maxItems} more`];
}

function normalizeOptionalText(value: unknown, maxLength = 500): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed ? compactText(trimmed, maxLength) ?? trimmed : undefined;
}

function normalizeRejectedPaths(value: unknown): RejectedPath[] | undefined {
	if (!Array.isArray(value)) return undefined;
	return value
		.map((item): RejectedPath | null => {
			if (!item || typeof item !== "object") return null;
			const raw = item as Record<string, unknown>;
			const summary = normalizeOptionalText(raw.summary, 240);
			const reason = normalizeOptionalText(raw.reason, 240);
			return summary && reason ? { summary, reason } : null;
		})
		.filter((item): item is RejectedPath => item !== null);
}

function mergeStrings(current: string[], incoming: unknown): string[] {
	const next = normalizeStringList(incoming).map((item) => compactText(item, 240) ?? item);
	return [...new Set([...current, ...next])];
}

function mergeRejectedPaths(current: RejectedPath[], incoming: unknown): RejectedPath[] {
	const next = normalizeRejectedPaths(incoming) ?? [];
	const seen = new Set(current.map((item) => `${item.summary}\u0000${item.reason}`));
	const merged = [...current];
	for (const item of next) {
		const key = `${item.summary}\u0000${item.reason}`;
		if (seen.has(key)) continue;
		seen.add(key);
		merged.push(item);
	}
	return merged;
}

function hasMemory(memory: GovernorState): boolean {
	return Boolean(
		memory.objective ||
			memory.currentStrategy ||
			LIST_FIELDS.some((field) => memory[field].length > 0) ||
			memory.rejectedPaths.length > 0,
	);
}

export function hasGovernorMemory(state: LoopState): boolean {
	return hasMemory(state.governorState);
}

export function formatGovernorState(memory: GovernorState): string {
	if (!hasMemory(memory)) return "No governor memory recorded.";
	const lines = ["Governor memory"];
	if (memory.objective) lines.push(`Objective: ${memory.objective}`);
	if (memory.currentStrategy) lines.push(`Current strategy: ${memory.currentStrategy}`);
	const labels: Record<(typeof LIST_FIELDS)[number], string> = {
		completedMilestones: "Completed milestones",
		activeConstraints: "Active constraints",
		knownRisks: "Known risks",
		openQuestions: "Open questions",
		evidenceGaps: "Evidence gaps",
		nextContextHints: "Next context hints",
	};
	for (const field of LIST_FIELDS) {
		const values = memory[field];
		if (!values.length) continue;
		lines.push(labels[field], ...compactList(values).map((item) => `- ${item}`));
	}
	if (memory.rejectedPaths.length) {
		lines.push("Rejected paths");
		for (const item of memory.rejectedPaths.slice(0, 6)) lines.push(`- ${compactText(item.summary, 120)} — ${compactText(item.reason, 140)}`);
		if (memory.rejectedPaths.length > 6) lines.push(`- ... ${memory.rejectedPaths.length - 6} more`);
	}
	lines.push(`Updated: ${memory.updatedAt}`);
	return lines.join("\n");
}

export function appendGovernorMemoryPromptSection(parts: string[], state: LoopState): void {
	if (!hasGovernorMemory(state)) return;
	parts.push("## Governor Memory", formatGovernorState(state.governorState), "");
}

function clearGovernorFields(memory: GovernorState, fields?: string[]): GovernorState {
	const next = { ...memory, rejectedPaths: [...memory.rejectedPaths] };
	for (const field of LIST_FIELDS) next[field] = [...memory[field]];
	const selected = fields?.length ? fields.filter((field): field is GovernorStateField => CLEARABLE_FIELDS.includes(field as GovernorStateField)) : CLEARABLE_FIELDS;
	for (const field of selected) {
		if (field === "objective" || field === "currentStrategy") next[field] = undefined;
		else if (field === "rejectedPaths") next.rejectedPaths = [];
		else next[field] = [];
	}
	next.updatedAt = new Date().toISOString();
	return next;
}

function applyGovernorParams(memory: GovernorState, params: Record<string, unknown>, mode: "upsert" | "append"): GovernorState {
	const next = { ...memory, rejectedPaths: [...memory.rejectedPaths] };
	for (const field of LIST_FIELDS) next[field] = [...memory[field]];
	const objective = normalizeOptionalText(params.objective, 500);
	const currentStrategy = normalizeOptionalText(params.currentStrategy, 500);
	if ("objective" in params) next.objective = objective;
	if ("currentStrategy" in params) next.currentStrategy = currentStrategy;
	for (const field of LIST_FIELDS) {
		if (!(field in params)) continue;
		next[field] = mode === "append" ? mergeStrings(next[field], params[field]) : normalizeStringList(params[field]).map((item) => compactText(item, 240) ?? item);
	}
	if ("rejectedPaths" in params) next.rejectedPaths = mode === "append" ? mergeRejectedPaths(next.rejectedPaths, params.rejectedPaths) : normalizeRejectedPaths(params.rejectedPaths) ?? [];
	next.updatedAt = new Date().toISOString();
	return next;
}

export function registerGovernorStateTool(pi: ExtensionAPI, deps: GovernorStateToolDeps): void {
	const listParam = Type.Optional(Type.Array(Type.String()));
	const rejectedPathParam = Type.Optional(Type.Array(Type.Object({ summary: Type.String(), reason: Type.String() })));
	pi.registerTool({
		name: "stardock_governor_state",
		label: "Manage Stardock Governor Memory",
		description: "Inspect or update durable governor memory for loop direction, constraints, risks, rejected paths, and next-context hints.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("list"), Type.Literal("upsert"), Type.Literal("append"), Type.Literal("clear")], { description: "list inspects memory; upsert replaces provided fields; append merges list fields; clear removes selected fields or all memory." }),
			loopName: Type.Optional(Type.String({ description: "Loop name. Defaults to the active loop." })),
			objective: Type.Optional(Type.String({ description: "Durable loop objective summary." })),
			currentStrategy: Type.Optional(Type.String({ description: "Current governor strategy or lane." })),
			completedMilestones: listParam,
			activeConstraints: listParam,
			knownRisks: listParam,
			openQuestions: listParam,
			evidenceGaps: listParam,
			nextContextHints: listParam,
			rejectedPaths: rejectedPathParam,
			fields: Type.Optional(Type.Array(Type.Union(CLEARABLE_FIELDS.map((field) => Type.Literal(field)) as any), { description: "Fields to clear. Omit for all governor memory." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const loopName = params.loopName ?? deps.getCurrentLoop();
			if (!loopName) return { content: [{ type: "text", text: "No active Stardock loop." }], details: {} };
			const state = loadState(ctx, loopName);
			if (!state) return { content: [{ type: "text", text: `Loop "${loopName}" not found.` }], details: { loopName } };
			if (!state.governorState) state.governorState = defaultGovernorState();
			if (params.action === "list") return { content: [{ type: "text", text: formatGovernorState(state.governorState) }], details: { loopName, governorState: state.governorState } };
			if (params.action === "clear") state.governorState = clearGovernorFields(state.governorState, params.fields);
			else state.governorState = applyGovernorParams(state.governorState, params, params.action);
			saveState(ctx, state);
			deps.updateUI(ctx);
			return { content: [{ type: "text", text: formatGovernorState(state.governorState) }], details: { loopName, governorState: state.governorState } };
		},
	});
}
