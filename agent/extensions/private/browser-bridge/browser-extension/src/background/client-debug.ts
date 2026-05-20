import type { ExtensionDebugLogEntry } from "../shared/debug-log.js";
import { makeEnvelope } from "../shared/protocol.js";

export function mirrorBrowserDebugToPi(entry: ExtensionDebugLogEntry, socket: WebSocket | undefined, connected: boolean): void {
	if (entry.level !== "warn" && entry.level !== "error") return;
	if (!socket || socket.readyState !== WebSocket.OPEN || !connected) return;
	try {
		socket.send(JSON.stringify(makeEnvelope({
			direction: "browser-to-pi",
			type: "client:debug",
			payload: {
				at: entry.at,
				source: entry.source,
				level: entry.level,
				event: entry.event,
				message: entry.message,
				data: entry.data,
			},
		})));
	} catch (error) {
		console.debug("[pi-browser-bridge] client-debug-mirror-failed", error);
	}
}
