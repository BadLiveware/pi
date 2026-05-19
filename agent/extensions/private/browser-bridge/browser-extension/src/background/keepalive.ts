import { makeEnvelope, type BridgeEnvelope } from "../shared/protocol.js";
import type { ExtensionDebugLogEntry } from "../shared/debug-log.js";

const KEEPALIVE_INTERVAL_MS = 20_000;

type Debug = (entry: Omit<ExtensionDebugLogEntry, "at" | "source"> & { at?: number }) => void;

export function createKeepAliveController(send: (envelope: BridgeEnvelope) => void, debug: Debug): { start: () => void; stop: () => void } {
	let timer: ReturnType<typeof globalThis.setInterval> | undefined;
	return {
		start() {
			if (timer) return;
			debug({ level: "info", event: "keepalive-started", data: { intervalMs: KEEPALIVE_INTERVAL_MS } });
			timer = globalThis.setInterval(() => {
				send(makeEnvelope({ direction: "browser-to-pi", type: "client:keepalive", payload: { sentAt: Date.now() } }));
			}, KEEPALIVE_INTERVAL_MS);
		},
		stop() {
			if (!timer) return;
			globalThis.clearInterval(timer);
			timer = undefined;
			debug({ level: "info", event: "keepalive-stopped" });
		},
	};
}
