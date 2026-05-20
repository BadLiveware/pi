import type { BridgeEnvelope } from "../shared/protocol.js";

interface PendingAck {
	type: string;
	resolve: (envelope: BridgeEnvelope) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof globalThis.setTimeout>;
}

interface AckControllerDependencies {
	isOpen: () => boolean;
	send: (envelope: BridgeEnvelope) => void;
}

export interface BridgeAckController {
	sendWithAck(envelope: BridgeEnvelope, timeoutMs?: number): Promise<BridgeEnvelope>;
	resolve(envelope: BridgeEnvelope): boolean;
	rejectAll(error: Error): void;
}

export function createBridgeAckController(deps: AckControllerDependencies): BridgeAckController {
	const pendingAcks = new Map<string, PendingAck>();
	return {
		async sendWithAck(envelope, timeoutMs = 5000) {
			if (!deps.isOpen()) throw new Error("Connect to Pi before sharing with the bridge.");
			return await new Promise<BridgeEnvelope>((resolve, reject) => {
				const timer = globalThis.setTimeout(() => {
					pendingAcks.delete(envelope.id);
					reject(new Error(`Timed out waiting for Pi to acknowledge ${envelope.type}.`));
				}, timeoutMs);
				pendingAcks.set(envelope.id, { type: envelope.type, resolve, reject, timer });
				deps.send(envelope);
			});
		},
		resolve(envelope) {
			const pending = envelope.requestId ? pendingAcks.get(envelope.requestId) : undefined;
			if (!pending || !envelope.requestId) return false;
			pendingAcks.delete(envelope.requestId);
			globalThis.clearTimeout(pending.timer);
			if (envelope.type === "error") {
				pending.reject(new Error(errorPayloadMessage(envelope.payload)));
				return true;
			}
			pending.resolve(envelope);
			return true;
		},
		rejectAll(error) {
			for (const [requestId, pending] of pendingAcks) {
				globalThis.clearTimeout(pending.timer);
				pending.reject(error);
				pendingAcks.delete(requestId);
			}
		},
	};
}

function errorPayloadMessage(payload: unknown): string {
	return typeof payload === "object" && payload !== null && typeof (payload as { message?: unknown }).message === "string"
		? (payload as { message: string }).message
		: "Pi bridge rejected the shared browser artifact.";
}
