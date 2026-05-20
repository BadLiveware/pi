import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { browserBridgeStatePayload, formatBrowserBridgeStatus, type BrowserBridgeRuntime } from "../../core/state.ts";

interface BrowserBridgeStateParams {
	includeDiagnostics?: boolean;
	includeDebugLog?: boolean;
	debugLogLimit?: number;
}

export function registerBrowserBridgeStateTool(pi: ExtensionAPI, runtime: BrowserBridgeRuntime): void {
	pi.registerTool({
		name: "browser_bridge_state",
		label: "Browser Bridge State",
		description: "Inspect the local browser bridge server, connected browser clients, activated tabs, shared selections/drawings, pending requests, capabilities, diagnostics, and optional debug log.",
		promptSnippet: "Inspect browser bridge state, connected browser clients, activated tabs, shared selections/drawings, pending requests, capabilities, diagnostics, and optional debug log.",
		promptGuidelines: [
			"Use browser_bridge_state before using browser bridge capabilities when connection, activation, or diagnostics matter.",
			"browser_bridge_state is read-only and safe to call when the bridge may not be running or no browser extension is connected.",
		],
		parameters: Type.Object({
			includeDiagnostics: Type.Optional(Type.Boolean({ description: "Include diagnostics in the human-readable summary. Default true." })),
			includeDebugLog: Type.Optional(Type.Boolean({ description: "Include recent redacted Pi-side debug log entries in the human-readable summary. Details always include debugLog." })),
			debugLogLimit: Type.Optional(Type.Number({ description: "Maximum debug log entries to show in the human-readable summary. Default 12." })),
		}),
		async execute(_toolCallId: string, params: BrowserBridgeStateParams, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: ExtensionContext) {
			const snapshot = browserBridgeStatePayload(runtime.state);
			return {
				content: [{ type: "text", text: formatBrowserBridgeStatus(snapshot, { includeDiagnostics: params.includeDiagnostics !== false, includeDebugLog: params.includeDebugLog === true, debugLogLimit: params.debugLogLimit }) }],
				details: snapshot,
			};
		},
	});
}
