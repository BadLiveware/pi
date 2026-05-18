import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { BrowserBridgeServer } from "../../bridge-server/lifecycle.ts";
import { browserBridgeStatePayload, formatBrowserBridgeStatus, type BrowserBridgeRuntime } from "../../core/state.ts";

const HELP = [
	"Usage: /browser-bridge <command>",
	"",
	"Available commands:",
	"  status   Show local browser bridge state and diagnostics.",
	"  start    Start the local 127.0.0.1 bridge listener.",
	"  stop     Stop the bridge listener and disconnect clients.",
	"  pair     Start the listener and create a short-lived pairing token.",
].join("\n");

export function registerBrowserBridgeCommands(pi: ExtensionAPI, runtime: BrowserBridgeRuntime, server: BrowserBridgeServer): void {
	pi.registerCommand("browser-bridge", {
		description: "Show or control the local browser bridge: status, start, stop, pair.",
		handler: async (args: string, ctx: ExtensionContext) => {
			const command = args.trim() || "status";
			if (command === "status") {
				const snapshot = browserBridgeStatePayload(runtime.state);
				ctx.ui.notify(formatBrowserBridgeStatus(snapshot), "info");
				return;
			}
			if (command === "start") {
				const started = await server.start();
				ctx.ui.notify(`Browser bridge listening on ${started.url}. Run /browser-bridge pair to create a pairing token.`, "info");
				return;
			}
			if (command === "stop") {
				await server.stop("Bridge stopped by /browser-bridge stop.");
				ctx.ui.notify("Browser bridge stopped and clients disconnected.", "info");
				return;
			}
			if (command === "pair") {
				await server.start();
				const pairing = server.createPairingToken();
				ctx.ui.notify([
					`Browser bridge URL: ${pairing.url}`,
					`Pairing token: ${pairing.token}`,
					`Expires: ${new Date(pairing.expiresAt).toISOString()}`,
					"Enter this URL and token in the browser extension popup.",
				].join("\n"), "info");
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
