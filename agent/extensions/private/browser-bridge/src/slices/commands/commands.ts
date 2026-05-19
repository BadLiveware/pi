import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { BrowserBridgeServer } from "../../bridge-server/lifecycle.ts";
import { browserBridgeStatePayload, formatBrowserBridgeStatus, type BrowserBridgeRuntime } from "../../core/state.ts";

const HELP = [
	"Usage: /browser-bridge <command>",
	"",
	"Available commands:",
	"  status   Show local browser bridge state and diagnostics.",
	"  start    Start the fixed-port local gateway listener.",
	"  stop     Stop the bridge listener and disconnect clients.",
	"  pair     Start the gateway and open a short-lived no-copy pairing window.",
].join("\n");

export function registerBrowserBridgeCommands(pi: ExtensionAPI, runtime: BrowserBridgeRuntime, server: BrowserBridgeServer): void {
	pi.registerCommand("browser-bridge", {
		description: "Show or control the local browser bridge gateway: status, start, stop, pair.",
		handler: async (args: string, ctx: ExtensionContext) => {
			const command = args.trim() || "status";
			if (command === "status") {
				const snapshot = browserBridgeStatePayload(runtime.state);
				ctx.ui.notify(formatBrowserBridgeStatus(snapshot), "info");
				return;
			}
			if (command === "start") {
				const started = await server.start();
				ctx.ui.notify(`Browser bridge gateway listening on ${started.url}. Run /browser-bridge pair to open a no-copy pairing window.`, "info");
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
					"Pairing window open. In the browser extension popup, click Connect with the default gateway URL.",
					`Fallback pairing details: ${pairing.url} ${pairing.token}`,
					`Gateway URL: ${pairing.url}`,
					`Fallback pairing token: ${pairing.token}`,
					`Expires: ${new Date(pairing.expiresAt).toISOString()}`,
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
