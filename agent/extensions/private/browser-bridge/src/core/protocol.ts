export const BRIDGE_PROTOCOL_VERSION = 1 as const;

export type BridgeDirection = "pi-to-browser" | "browser-to-pi";

export type BridgeErrorCode =
	| "invalid_json"
	| "invalid_envelope"
	| "unsupported_version"
	| "pairing_required"
	| "pairing_failed"
	| "unknown_request"
	| "timeout"
	| "not_connected"
	| "server_error";

export interface BridgeEnvelope<TPayload = unknown> {
	version: typeof BRIDGE_PROTOCOL_VERSION;
	id: string;
	requestId?: string;
	direction: BridgeDirection;
	type: string;
	target?: { tabId?: number; frameId?: number };
	payload: TPayload;
}

export interface BridgeErrorPayload {
	code: BridgeErrorCode;
	message: string;
	retryable?: boolean;
}

export type ParseBridgeEnvelopeResult =
	| { ok: true; envelope: BridgeEnvelope }
	| { ok: false; code: BridgeErrorCode; message: string };

export function parseBridgeEnvelopeJson(text: string, expectedDirection?: BridgeDirection): ParseBridgeEnvelopeResult {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return { ok: false, code: "invalid_json", message: "Bridge message is not valid JSON." };
	}
	return parseBridgeEnvelope(value, expectedDirection);
}

export function parseBridgeEnvelope(value: unknown, expectedDirection?: BridgeDirection): ParseBridgeEnvelopeResult {
	if (!isRecord(value)) return { ok: false, code: "invalid_envelope", message: "Bridge message must be an object." };
	if (value.version !== BRIDGE_PROTOCOL_VERSION) return { ok: false, code: "unsupported_version", message: `Unsupported bridge protocol version ${String(value.version)}.` };
	if (typeof value.id !== "string" || value.id.length === 0) return { ok: false, code: "invalid_envelope", message: "Bridge message id must be a non-empty string." };
	if (value.direction !== "pi-to-browser" && value.direction !== "browser-to-pi") return { ok: false, code: "invalid_envelope", message: "Bridge message direction is invalid." };
	if (expectedDirection && value.direction !== expectedDirection) return { ok: false, code: "invalid_envelope", message: `Expected ${expectedDirection} message direction.` };
	if (typeof value.type !== "string" || value.type.length === 0) return { ok: false, code: "invalid_envelope", message: "Bridge message type must be a non-empty string." };
	if (value.requestId !== undefined && typeof value.requestId !== "string") return { ok: false, code: "invalid_envelope", message: "Bridge message requestId must be a string when present." };
	const target = parseTarget(value.target);
	if (target === false) return { ok: false, code: "invalid_envelope", message: "Bridge message target is invalid." };
	return {
		ok: true,
		envelope: {
			version: BRIDGE_PROTOCOL_VERSION,
			id: value.id,
			requestId: value.requestId,
			direction: value.direction,
			type: value.type,
			target,
			payload: value.payload,
		},
	};
}

export function makeBridgeEnvelope<TPayload>(input: {
	id: string;
	direction: BridgeDirection;
	type: string;
	payload: TPayload;
	requestId?: string;
	target?: { tabId?: number; frameId?: number };
}): BridgeEnvelope<TPayload> {
	return {
		version: BRIDGE_PROTOCOL_VERSION,
		id: input.id,
		direction: input.direction,
		type: input.type,
		payload: input.payload,
		...(input.requestId ? { requestId: input.requestId } : {}),
		...(input.target ? { target: input.target } : {}),
	};
}

export function makeBridgeErrorEnvelope(input: { id: string; requestId?: string; code: BridgeErrorCode; message: string; retryable?: boolean }): BridgeEnvelope<BridgeErrorPayload> {
	return makeBridgeEnvelope({
		id: input.id,
		requestId: input.requestId,
		direction: "pi-to-browser",
		type: "error",
		payload: {
			code: input.code,
			message: input.message,
			...(input.retryable === undefined ? {} : { retryable: input.retryable }),
		},
	});
}

export function isBridgeErrorEnvelope(envelope: BridgeEnvelope): envelope is BridgeEnvelope<BridgeErrorPayload> {
	return envelope.type === "error" && isRecord(envelope.payload) && typeof envelope.payload.code === "string" && typeof envelope.payload.message === "string";
}

function parseTarget(value: unknown): { tabId?: number; frameId?: number } | undefined | false {
	if (value === undefined) return undefined;
	if (!isRecord(value)) return false;
	const target: { tabId?: number; frameId?: number } = {};
	if (value.tabId !== undefined) {
		if (!isSafeInteger(value.tabId)) return false;
		target.tabId = value.tabId;
	}
	if (value.frameId !== undefined) {
		if (!isSafeInteger(value.frameId)) return false;
		target.frameId = value.frameId;
	}
	return target;
}

function isSafeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
