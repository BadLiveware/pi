/**
 * Stardock-local tool result and followup primitives.
 *
 * This is intentionally Pi-free: adapters decide how to expose parameters and
 * render results, while this module owns Stardock's local followup/effect rules.
 */

export type StardockToolEffect = "read" | "write" | "message";
export type FollowupAttachMode = "content" | "details" | "both";

export interface FollowupToolRequest {
	name: string;
	args?: Record<string, unknown>;
	attachAs?: FollowupAttachMode;
}

export interface FollowupOutput {
	name: string;
	args: Record<string, unknown>;
	content: string;
	details: Record<string, unknown>;
}

export interface StardockTextResult {
	content: Array<{ type: "text"; text: string }>;
	details?: Record<string, unknown>;
}

const READONLY_TOOLS = new Set(["stardock_state", "stardock_policy"]);
const LIST_ONLY_TOOLS = new Set([
	"stardock_brief",
	"stardock_ledger",
	"stardock_final_report",
	"stardock_auditor",
	"stardock_breakout",
	"stardock_handoff",
	"stardock_worker_report",
]);

export function stringArg(args: Record<string, unknown>, key: string): string | undefined {
	const value = args[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function booleanArg(args: Record<string, unknown>, key: string): boolean {
	return args[key] === true;
}

export function followupEffect(name: string, args: Record<string, unknown>): StardockToolEffect | undefined {
	if (READONLY_TOOLS.has(name)) return "read";
	if (LIST_ONLY_TOOLS.has(name)) return (stringArg(args, "action") ?? "list") === "list" ? "read" : "write";
	return undefined;
}

export function unsupportedFollowup(name: string, args: Record<string, unknown>): FollowupOutput {
	const effect = followupEffect(name, args);
	if (effect && effect !== "read") {
		return {
			name,
			args,
			content: `Rejected mutating Stardock followupTool action: ${name}.${String(args.action)}.`,
			details: { ok: false, reason: "mutating_action", effect },
		};
	}
	return {
		name,
		args,
		content: `Unsupported Stardock followupTool: ${name}. Followups must be read-only Stardock tools or read-only list actions.`,
		details: { ok: false, reason: "unsupported_followup" },
	};
}

export function cyclicFollowup(name: string, args: Record<string, unknown>, stack: string[]): FollowupOutput {
	return {
		name,
		args,
		content: `Rejected cyclic followupTool: ${[...stack, name].join(" -> ")}`,
		details: { ok: false, reason: "cycle", stack: [...stack, name] },
	};
}

export function attachFollowup<T extends StardockTextResult>(result: T, request: FollowupToolRequest | undefined, followup: FollowupOutput | undefined): T {
	if (!request || !followup) return result;
	const attachAs = request.attachAs ?? "details";
	const details = { ...(result.details ?? {}) };
	if (attachAs === "details" || attachAs === "both") details.followupTool = followup;
	if (attachAs === "content" || attachAs === "both") result.content = [...result.content, { type: "text", text: `\nFollowup ${followup.name}:\n${followup.content}` }];
	return { ...result, details };
}
