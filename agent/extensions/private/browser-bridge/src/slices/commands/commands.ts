import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { BrowserBridgeServer } from "../../bridge-server/lifecycle.ts";
import { appendBrowserBridgeDebugLog, browserBridgeStatePayload, formatBrowserBridgeStatus, type BrowserBridgeRuntime } from "../../core/state.ts";

const HELP = [
	"Usage: /browser-bridge <command>",
	"",
	"Available commands:",
	"  status   Show local browser bridge state and diagnostics. Add 'debug' to include recent debug log entries.",
	"  start    Start the fixed-port local gateway listener.",
	"  stop     Stop the bridge listener and disconnect clients.",
	"  pair     Start the gateway and open a short-lived no-copy pairing window.",
	"  debug    Show recent redacted Pi-side debug log entries.",
].join("\n");

export function registerBrowserBridgeCommands(pi: ExtensionAPI, runtime: BrowserBridgeRuntime, server: BrowserBridgeServer): void {
	pi.registerCommand("browser-bridge", {
		description: "Show or control the local browser bridge gateway: status, start, stop, pair, debug.",
		handler: async (args: string, ctx: ExtensionContext) => {
			const tokens = args.trim().split(/\s+/).filter(Boolean);
			const command = tokens[0] ?? "status";
			const includeDebugLog = tokens.includes("debug");
			if (command === "status") {
				const snapshot = browserBridgeStatePayload(runtime.state);
				ctx.ui.notify(formatBrowserBridgeStatus(snapshot, { includeDebugLog }), "info");
				return;
			}
			if (command === "start") {
				appendBrowserBridgeDebugLog(runtime.state, { source: "command", level: "info", event: "command-start" });
				const started = await server.start();
				ctx.ui.notify(`Browser bridge gateway listening on ${started.url}. Run /browser-bridge pair to open a no-copy pairing window.`, "info");
				return;
			}
			if (command === "stop") {
				appendBrowserBridgeDebugLog(runtime.state, { source: "command", level: "info", event: "command-stop" });
				await server.stop("Bridge stopped by /browser-bridge stop.");
				ctx.ui.notify("Browser bridge stopped and clients disconnected.", "info");
				return;
			}
			if (command === "pair") {
				appendBrowserBridgeDebugLog(runtime.state, { source: "command", level: "info", event: "command-pair" });
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
			if (command === "debug") {
				appendBrowserBridgeDebugLog(runtime.state, { source: "command", level: "info", event: "command-debug" });
				const snapshot = browserBridgeStatePayload(runtime.state);
				ctx.ui.notify(formatBrowserBridgeStatus(snapshot, { includeDebugLog: true, debugLogLimit: 30 }), "info");
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
