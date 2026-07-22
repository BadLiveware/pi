import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { mutationBlockReason } from "../state/store.ts";
import { bindOwnershipContext } from "../stages/ownership-records.ts";
import type { StardockRuntime } from "./types.ts";

const ALWAYS_READ_ONLY_TOOLS = new Set([
	"stardock_state",
	"stardock_policy",
	"stardock_outside_payload",
	"stardock_outside_requests",
	"stardock_advisory_adapter",
]);

function stageActionOwnsItsGuard(params: Record<string, unknown>): boolean {
	if (params.action === "list") return true;
	if (params.action === "reconcile" && params.takeOwnership !== true) return true;
	if (params.action === "acquire" || params.action === "heartbeat" || params.action === "runReady" || params.action === "release") return true;
	if (params.action === "reconcile" && params.takeOwnership === true) return true;
	return false;
}

function shouldGuard(name: string, params: Record<string, unknown>): boolean {
	if (name === "stardock_start") return false;
	if (ALWAYS_READ_ONLY_TOOLS.has(name)) return false;
	if (params.action === "list" || params.action === "payload") return false;
	if (name === "stardock_stage" && stageActionOwnsItsGuard(params)) return false;
	return true;
}

function targetLoop(runtime: StardockRuntime, params: Record<string, unknown>): string | null {
	if (typeof params.loopName === "string" && params.loopName.trim()) return params.loopName;
	return runtime.ref.currentLoop;
}

function rejectedResult(message: string) {
	return {
		content: [{ type: "text" as const, text: message }],
		details: { ok: false, blocked: true, code: "non_owner" },
	};
}

export function ownershipGuardedApi(pi: ExtensionAPI, runtime: StardockRuntime): ExtensionAPI {
	return new Proxy(pi, {
		get(target, property, receiver) {
			if (property !== "registerTool") return Reflect.get(target, property, receiver);
			return (tool: Record<string, unknown>) => {
				const execute = tool.execute as ((toolCallId: string, params: Record<string, unknown>, signal: AbortSignal | undefined, onUpdate: unknown, ctx: ExtensionContext) => unknown);
				const name = String(tool.name);
				const guarded = {
					...tool,
					async execute(toolCallId: string, params: Record<string, unknown>, signal: AbortSignal | undefined, onUpdate: unknown, ctx: ExtensionContext) {
						bindOwnershipContext(ctx, runtime.ref.sessionId);
						if (shouldGuard(name, params)) {
							const loopName = targetLoop(runtime, params);
							if (loopName) {
								const blocked = mutationBlockReason(ctx, loopName);
								if (blocked) return rejectedResult(blocked);
							}
						}
						return execute.call(tool, toolCallId, params, signal, onUpdate, ctx);
					},
				};
				return pi.registerTool(guarded as never);
			};
		},
	});
}
