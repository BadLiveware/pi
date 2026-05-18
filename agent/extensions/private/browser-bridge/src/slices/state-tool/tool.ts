import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { browserBridgeStatePayload, formatBrowserBridgeStatus, type BrowserBridgeRuntime } from "../../core/state.ts";

interface BrowserBridgeStateParams {
	includeDiagnostics?: boolean;
}

export function registerBrowserBridgeStateTool(pi: ExtensionAPI, runtime: BrowserBridgeRuntime): void {
	pi.registerTool({
		name: "browser_bridge_state",
		label: "Browser Bridge State",
		description: "Inspect the local browser bridge server, connected browser clients, activated tabs, pending requests, capabilities, and diagnostics.",
		promptSnippet: "Inspect browser bridge state, connected browser clients, activated tabs, pending requests, capabilities, and diagnostics.",
		promptGuidelines: [
			"Use browser_bridge_state before using browser bridge capabilities when connection, activation, or diagnostics matter.",
			"browser_bridge_state is read-only and safe to call when the bridge may not be running or no browser extension is connected.",
		],
		parameters: Type.Object({
			includeDiagnostics: Type.Optional(Type.Boolean({ description: "Include diagnostics in the human-readable summary. Default true." })),
		}),
		async execute(_toolCallId: string, params: BrowserBridgeStateParams, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: ExtensionContext) {
			const snapshot = browserBridgeStatePayload(runtime.state);
			return {
				content: [{ type: "text", text: formatBrowserBridgeStatus(snapshot, { includeDiagnostics: params.includeDiagnostics !== false }) }],
				details: snapshot,
			};
		},
	});
}
