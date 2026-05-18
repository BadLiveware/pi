import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { browserBridgeStatePayload, formatBrowserBridgeStatus, type BrowserBridgeRuntime } from "../../core/state.ts";

const HELP = [
	"Usage: /browser-bridge status",
	"",
	"Available commands:",
	"  status   Show local browser bridge state and diagnostics.",
].join("\n");

export function registerBrowserBridgeCommands(pi: ExtensionAPI, runtime: BrowserBridgeRuntime): void {
	pi.registerCommand("browser-bridge", {
		description: "Show local browser bridge status and diagnostics.",
		handler: async (args: string, ctx: ExtensionContext) => {
			const command = args.trim() || "status";
			if (command === "status") {
				const snapshot = browserBridgeStatePayload(runtime.state);
				ctx.ui.notify(formatBrowserBridgeStatus(snapshot), "info");
				return;
			}
			if (command === "help" || command === "--help" || command === "-h") {
				ctx.ui.notify(HELP, "info");
				return;
			}
			ctx.ui.notify(`Unsupported browser bridge command "${command}".\n\n${HELP}`, "warning");
		},
	});
}
