import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { BrowserBridgeServer } from "../../bridge-server/lifecycle.ts";
import type { BridgeEnvelope } from "../../core/protocol.ts";
import type { BrowserBridgeRuntime } from "../../core/state.ts";
import { chooseSelectionTarget } from "../select-elements/tool.ts";

interface InteractParams {
	target?: { clientId?: string; tabId?: number };
	actions: Array<{ type: string; text?: string; key?: string }>;
	requireUserConfirmation?: boolean;
	continueOnError?: boolean;
	timeoutMs?: number;
}

export function registerInteractTool(pi: ExtensionAPI, runtime: BrowserBridgeRuntime, server: BrowserBridgeServer): void {
	pi.registerTool({
		name: "browser_bridge_interact",
		label: "Browser Interact",
		description: "Run bounded click, type, scroll, or key actions in an activated browser tab through the companion extension. This does not evaluate arbitrary JavaScript.",
		promptSnippet: "Run bounded browser page actions such as click, type, scroll, or key without arbitrary JavaScript eval.",
		promptGuidelines: [
			"Use browser_bridge_interact only for bounded visible page actions requested by the user; it is not an arbitrary JavaScript execution tool.",
			"Prefer browser_bridge_select_elements before browser_bridge_interact when an action target should be chosen by the user.",
		],
		parameters: Type.Object({
			target: Type.Optional(Type.Object({ clientId: Type.Optional(Type.String()), tabId: Type.Optional(Type.Number()) })),
			actions: Type.Array(Type.Record(Type.String(), Type.Unknown()), { description: "Ordered click/type/scroll/key actions." }),
			requireUserConfirmation: Type.Optional(Type.Boolean({ description: "Require in-page confirmation before executing. Defaults true for type/key or multiple actions." })),
			continueOnError: Type.Optional(Type.Boolean({ description: "Continue after an action-level failure. Default false." })),
			timeoutMs: Type.Optional(Type.Number({ description: "Interaction request timeout in milliseconds. Default 15000." })),
		}),
		async execute(_toolCallId: string, params: InteractParams, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: ExtensionContext) {
			const target = chooseSelectionTarget(runtime, params);
			const timeoutMs = clampTimeout(params.timeoutMs);
			const request = {
				actions: params.actions,
				requireUserConfirmation: confirmationRequired(params),
				continueOnError: params.continueOnError === true,
			};
			const response = await server.sendRequestToClient(target.client.clientId, "interact", request, { timeoutMs, target: { tabId: target.tab.tabId } });
			return formatInteractToolResult(response);
		},
	});
}

export function confirmationRequired(params: Pick<InteractParams, "actions" | "requireUserConfirmation">): boolean {
	if (params.requireUserConfirmation !== undefined) return params.requireUserConfirmation;
	return params.actions.length !== 1 || params.actions.some((action) => action.type === "type" || action.type === "key");
}

export function formatInteractToolResult(response: BridgeEnvelope): { content: Array<{ type: "text"; text: string }>; details: unknown } {
	if (response.type === "error") throw new Error(errorMessage(response.payload));
	const payload = response.payload as { ok?: boolean; cancelled?: boolean; results?: Array<{ index: number; type: string; ok: boolean; summary: string }> };
	const results = Array.isArray(payload.results) ? payload.results : [];
	const lines = [payload.cancelled ? "Browser interaction cancelled." : `Browser interaction ${payload.ok === false ? "completed with failures" : "completed"}: ${results.length} action result(s).`];
	for (const result of results.slice(0, 10)) lines.push(`${result.ok ? "✓" : "✗"} ${result.index + 1}. ${result.type}: ${result.summary}`);
	return { content: [{ type: "text", text: lines.join("\n") }], details: response.payload };
}

function errorMessage(payload: unknown): string {
	return typeof payload === "object" && payload !== null && typeof (payload as { message?: unknown }).message === "string"
		? (payload as { message: string }).message
		: "Browser interaction failed.";
}

function clampTimeout(value: number | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return 15_000;
	return Math.min(2 * 60_000, Math.max(1_000, Math.trunc(value)));
}
