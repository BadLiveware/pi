export const BRIDGE_PROTOCOL_VERSION = 1 as const;

export type BridgeDirection = "pi-to-browser" | "browser-to-pi";

export interface BridgeEnvelope<TPayload = unknown> {
	version: typeof BRIDGE_PROTOCOL_VERSION;
	id: string;
	requestId?: string;
	direction: BridgeDirection;
	type: string;
	target?: { tabId?: number; frameId?: number };
	payload: TPayload;
}

export function makeEnvelope<TPayload>(input: { id?: string; requestId?: string; direction: BridgeDirection; type: string; payload: TPayload; target?: { tabId?: number; frameId?: number } }): BridgeEnvelope<TPayload> {
	return {
		version: BRIDGE_PROTOCOL_VERSION,
		id: input.id ?? makeId("msg"),
		requestId: input.requestId,
		direction: input.direction,
		type: input.type,
		payload: input.payload,
		...(input.target ? { target: input.target } : {}),
	};
}

export function parseEnvelope(text: string): BridgeEnvelope | undefined {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (!isRecord(value)) return undefined;
	if (value.version !== BRIDGE_PROTOCOL_VERSION) return undefined;
	if (typeof value.id !== "string") return undefined;
	if (value.direction !== "pi-to-browser" && value.direction !== "browser-to-pi") return undefined;
	if (typeof value.type !== "string") return undefined;
	return {
		version: BRIDGE_PROTOCOL_VERSION,
		id: value.id,
		requestId: typeof value.requestId === "string" ? value.requestId : undefined,
		direction: value.direction,
		type: value.type,
		target: isRecord(value.target) ? {
			tabId: typeof value.target.tabId === "number" ? value.target.tabId : undefined,
			frameId: typeof value.target.frameId === "number" ? value.target.frameId : undefined,
		} : undefined,
		payload: value.payload,
	};
}

export function makeId(prefix: string): string {
	const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
	return `${prefix}-${random}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
