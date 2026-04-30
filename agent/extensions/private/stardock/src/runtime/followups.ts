/** Stardock-local read-only followup tool runner. */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { evaluateAuditorPolicy, evaluateBreakoutPolicy, evaluateCompletionPolicy, formatAuditorPolicy, formatBreakoutPolicy, formatCompletionPolicy } from "../policy.ts";
import { existingStatePath } from "../state/paths.ts";
import { listLoops, loadState } from "../state/store.ts";
import { formatRunOverview, formatRunTimeline, formatStateSummary, summarizeLoopState } from "../views.ts";

export type FollowupAttachMode = "content" | "details" | "both";

export interface FollowupToolRequest {
	name: string;
	args?: Record<string, unknown>;
	attachAs?: FollowupAttachMode;
}

export const FollowupToolParameter = Type.Optional(
	Type.Object({
		name: Type.String({ description: "Read-only Stardock followup tool name, e.g. stardock_state or stardock_policy." }),
		args: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Arguments for the read-only followup tool." })),
		attachAs: Type.Optional(Type.Union([Type.Literal("content"), Type.Literal("details"), Type.Literal("both")], { description: "Where to attach the followup output. Default details." })),
	}),
);

interface FollowupOutput {
	name: string;
	args: Record<string, unknown>;
	content: string;
	details: Record<string, unknown>;
}

interface ToolResultLike {
	content: Array<{ type: "text"; text: string }>;
	details?: Record<string, unknown>;
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
	const value = args[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanArg(args: Record<string, unknown>, key: string): boolean {
	return args[key] === true;
}

function runStateFollowup(ctx: ExtensionContext, currentLoop: string | null, args: Record<string, unknown>): FollowupOutput {
	const archived = booleanArg(args, "archived");
	const includeDetails = booleanArg(args, "includeDetails");
	const view = stringArg(args, "view") ?? "summary";
	const loopName = stringArg(args, "loopName");
	if (loopName) {
		const state = loadState(ctx, loopName, archived);
		if (!state) return { name: "stardock_state", args, content: `Loop "${loopName}" not found.`, details: { loopName, archived, ok: false } };
		const text = view === "overview" ? formatRunOverview(ctx, state, archived) : view === "timeline" ? formatRunTimeline(state) : `Loop: ${state.name}\nStatus: ${state.status}\nMode: ${state.mode}\nIteration: ${state.iteration}${state.maxIterations > 0 ? `/${state.maxIterations}` : ""}\nTask file: ${state.taskFile}\nState file: ${ctx.cwd ? existingStatePath(ctx, state.name, archived).replace(`${ctx.cwd}/`, "") : existingStatePath(ctx, state.name, archived)}`;
		return { name: "stardock_state", args, content: text, details: { loopName: state.name, archived, view, loop: summarizeLoopState(ctx, state, archived, includeDetails) } };
	}
	const loops = listLoops(ctx, archived).sort((a, b) => a.name.localeCompare(b.name));
	return { name: "stardock_state", args, content: loops.length > 0 ? `${archived ? "Archived Stardock loops" : "Stardock loops"}:\n${loops.map(formatStateSummary).join("\n")}` : `No ${archived ? "archived " : ""}Stardock loops found.`, details: { archived, currentLoop, loops: loops.map((state) => summarizeLoopState(ctx, state, archived, includeDetails)) } };
}

function runPolicyFollowup(ctx: ExtensionContext, currentLoop: string | null, args: Record<string, unknown>): FollowupOutput {
	const loopName = stringArg(args, "loopName") ?? currentLoop;
	if (!loopName) return { name: "stardock_policy", args, content: "No active Stardock loop.", details: { ok: false } };
	const state = loadState(ctx, loopName);
	if (!state) return { name: "stardock_policy", args, content: `Loop "${loopName}" not found.`, details: { loopName, ok: false } };
	const action = stringArg(args, "action") ?? "completion";
	if (action === "auditor") return { name: "stardock_policy", args, content: formatAuditorPolicy(state), details: { loopName, policy: evaluateAuditorPolicy(state) } };
	if (action === "breakout") return { name: "stardock_policy", args, content: formatBreakoutPolicy(state), details: { loopName, policy: evaluateBreakoutPolicy(state) } };
	return { name: "stardock_policy", args, content: formatCompletionPolicy(state), details: { loopName, policy: evaluateCompletionPolicy(state) } };
}

export function runFollowupTool(ctx: ExtensionContext, currentLoop: string | null, request: FollowupToolRequest | undefined, stack: string[] = []): FollowupOutput | undefined {
	if (!request) return undefined;
	if (stack.includes(request.name)) {
		return { name: request.name, args: request.args ?? {}, content: `Rejected cyclic followupTool: ${[...stack, request.name].join(" -> ")}`, details: { ok: false, reason: "cycle", stack: [...stack, request.name] } };
	}
	const args = request.args ?? {};
	if (request.name === "stardock_state") return runStateFollowup(ctx, currentLoop, args);
	if (request.name === "stardock_policy") return runPolicyFollowup(ctx, currentLoop, args);
	return { name: request.name, args, content: `Unsupported or mutating Stardock followupTool: ${request.name}. Followups must be read-only Stardock tools.`, details: { ok: false, reason: "unsupported_or_mutating" } };
}

export function withFollowupTool<T extends ToolResultLike>(result: T, ctx: ExtensionContext, currentLoop: string | null, request: FollowupToolRequest | undefined, stack: string[] = []): T {
	const followup = runFollowupTool(ctx, currentLoop, request, stack);
	if (!followup) return result;
	const attachAs = request?.attachAs ?? "details";
	const details = { ...(result.details ?? {}) };
	if (attachAs === "details" || attachAs === "both") details.followupTool = followup;
	if (attachAs === "content" || attachAs === "both") result.content = [...result.content, { type: "text", text: `\nFollowup ${followup.name}:\n${followup.content}` }];
	return { ...result, details };
}
