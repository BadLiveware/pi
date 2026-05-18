import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { BrowserBridgeServer } from "../../bridge-server/lifecycle.ts";
import type { BridgeEnvelope } from "../../core/protocol.ts";
import type { BrowserBridgeRuntime } from "../../core/state.ts";
import { chooseSelectionTarget } from "../select-elements/tool.ts";

interface OverlayParams {
	target?: { clientId?: string; tabId?: number };
	commands: unknown[];
	timeoutMs?: number;
}

export function registerOverlayTool(pi: ExtensionAPI, runtime: BrowserBridgeRuntime, server: BrowserBridgeServer): void {
	pi.registerTool({
		name: "browser_bridge_overlay",
		label: "Browser Overlay",
		description: "Show, hide, clear, highlight, or draw visible annotations on an activated browser tab through the companion extension.",
		promptSnippet: "Draw visible annotations or highlights on an activated browser tab through the companion extension.",
		promptGuidelines: [
			"Use browser_bridge_overlay after browser_bridge_select_elements when you need to highlight selected page elements or draw visible boxes/arrows for the user.",
			"browser_bridge_overlay commands are visible annotations only; do not use it for page interaction or automation.",
		],
		parameters: Type.Object({
			target: Type.Optional(Type.Object({
				clientId: Type.Optional(Type.String({ description: "Specific connected browser client id. Defaults to the active connected client." })),
				tabId: Type.Optional(Type.Number({ description: "Specific activated tab id. Defaults to the client's active tab." })),
			})),
			commands: Type.Array(Type.Record(Type.String(), Type.Unknown()), { description: "Ordered overlay commands: show, hide, clear, highlight, or draw." }),
			timeoutMs: Type.Optional(Type.Number({ description: "Overlay request timeout in milliseconds. Default 10000." })),
		}),
		async execute(_toolCallId: string, params: OverlayParams, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: ExtensionContext) {
			const target = chooseSelectionTarget(runtime, params);
			const timeoutMs = clampTimeout(params.timeoutMs);
			const response = await server.sendRequestToClient(target.client.clientId, "overlay", { commands: normalizeOverlayCommands(params.commands) }, { timeoutMs, target: { tabId: target.tab.tabId } });
			return formatOverlayToolResult(response);
		},
	});
}

export function normalizeOverlayCommands(commands: unknown[]): unknown[] {
	return commands.map((command) => typeof command === "object" && command !== null ? command : { action: "show" });
}

export function formatOverlayToolResult(response: BridgeEnvelope): { content: Array<{ type: "text"; text: string }>; details: unknown } {
	if (response.type === "error") throw new Error(errorMessage(response.payload));
	const applied = typeof response.payload === "object" && response.payload !== null && typeof (response.payload as { applied?: unknown }).applied === "number"
		? (response.payload as { applied: number }).applied
		: 0;
	return { content: [{ type: "text", text: `Applied ${applied} browser overlay command(s).` }], details: response.payload };
}

function errorMessage(payload: unknown): string {
	return typeof payload === "object" && payload !== null && typeof (payload as { message?: unknown }).message === "string"
		? (payload as { message: string }).message
		: "Browser overlay command failed.";
}

function clampTimeout(value: number | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return 10_000;
	return Math.min(60_000, Math.max(1_000, Math.trunc(value)));
}
