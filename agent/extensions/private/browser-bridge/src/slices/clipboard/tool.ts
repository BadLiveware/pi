import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { BrowserBridgeServer } from "../../bridge-server/lifecycle.ts";
import type { BridgeEnvelope } from "../../core/protocol.ts";
import type { BrowserBridgeRuntime } from "../../core/state.ts";
import { chooseSelectionTarget } from "../select-elements/tool.ts";

interface ClipboardParams {
	target?: { clientId?: string; tabId?: number };
	action: "write";
	text: string;
	requireUserConfirmation?: boolean;
	timeoutMs?: number;
}

export function registerClipboardTool(pi: ExtensionAPI, runtime: BrowserBridgeRuntime, server: BrowserBridgeServer): void {
	pi.registerTool({
		name: "browser_bridge_clipboard",
		label: "Browser Clipboard",
		description: "Write text to the user's clipboard through an activated browser tab with explicit confirmation by default. Clipboard reads are not supported.",
		promptSnippet: "Set the user's clipboard through the connected browser only when explicitly requested, with confirmation by default.",
		promptGuidelines: [
			"Use browser_bridge_clipboard when the user explicitly asks you to copy a value or set their clipboard through the browser bridge.",
			"Keep clipboard writes separate from browser_bridge_interact; do not use page interaction to smuggle clipboard changes.",
			"Leave requireUserConfirmation enabled unless the user explicitly authorizes a non-interactive clipboard write.",
		],
		parameters: Type.Object({
			target: Type.Optional(Type.Object({ clientId: Type.Optional(Type.String()), tabId: Type.Optional(Type.Number()) })),
			action: Type.Literal("write", { description: "Write text to the clipboard. Clipboard reads are intentionally unsupported." }),
			text: Type.String({ description: "Text to write to the clipboard." }),
			requireUserConfirmation: Type.Optional(Type.Boolean({ description: "Require an in-page confirmation before writing. Default true." })),
			timeoutMs: Type.Optional(Type.Number({ description: "Clipboard request timeout in milliseconds. Default 15000." })),
		}),
		async execute(_toolCallId: string, params: ClipboardParams, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: ExtensionContext) {
			const target = chooseSelectionTarget(runtime, params);
			const timeoutMs = clampTimeout(params.timeoutMs);
			const response = await server.sendRequestToClient(target.client.clientId, "clipboard", {
				action: "write",
				text: params.text,
				requireUserConfirmation: params.requireUserConfirmation !== false,
			}, { timeoutMs, target: { tabId: target.tab.tabId } });
			return formatClipboardToolResult(response);
		},
	});
}

export function formatClipboardToolResult(response: BridgeEnvelope): { content: Array<{ type: "text"; text: string }>; details: unknown } {
	if (response.type === "error") throw new Error(errorMessage(response.payload));
	const payload = response.payload as { ok?: boolean; cancelled?: boolean; chars?: number; summary?: string };
	const chars = typeof payload.chars === "number" ? payload.chars : 0;
	const message = payload.cancelled
		? "Clipboard write cancelled."
		: payload.ok === false
			? `Clipboard write failed: ${payload.summary ?? "unknown error"}`
			: `Clipboard updated with ${chars} character(s).`;
	return { content: [{ type: "text", text: message }], details: response.payload };
}

function errorMessage(payload: unknown): string {
	return typeof payload === "object" && payload !== null && typeof (payload as { message?: unknown }).message === "string"
		? (payload as { message: string }).message
		: "Browser clipboard request failed.";
}

function clampTimeout(value: number | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return 15_000;
	return Math.min(60_000, Math.max(1_000, Math.trunc(value)));
}
