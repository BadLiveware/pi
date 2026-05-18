import assert from "node:assert/strict";
import test from "node:test";
import { BRIDGE_PROTOCOL_VERSION, isBridgeErrorEnvelope, makeBridgeEnvelope, makeBridgeErrorEnvelope, parseBridgeEnvelope, parseBridgeEnvelopeJson } from "../src/core/protocol.ts";

test("protocol parses a valid browser envelope", () => {
	const envelope = makeBridgeEnvelope({
		id: "msg-1",
		direction: "browser-to-pi",
		type: "pair",
		payload: { token: "abc" },
		target: { tabId: 1, frameId: 0 },
	});

	const parsed = parseBridgeEnvelope(envelope, "browser-to-pi");
	assert.equal(parsed.ok, true);
	if (parsed.ok) {
		assert.equal(parsed.envelope.version, BRIDGE_PROTOCOL_VERSION);
		assert.equal(parsed.envelope.id, "msg-1");
		assert.deepEqual(parsed.envelope.target, { tabId: 1, frameId: 0 });
	}
});

test("protocol rejects malformed JSON and unsupported versions", () => {
	assert.deepEqual(parseBridgeEnvelopeJson("{", "browser-to-pi"), {
		ok: false,
		code: "invalid_json",
		message: "Bridge message is not valid JSON.",
	});

	const parsed = parseBridgeEnvelope({ version: 999, id: "x", direction: "browser-to-pi", type: "ping" });
	assert.equal(parsed.ok, false);
	if (!parsed.ok) assert.equal(parsed.code, "unsupported_version");
});

test("protocol validates direction, ids, types, and targets", () => {
	const wrongDirection = parseBridgeEnvelope({ version: 1, id: "x", direction: "pi-to-browser", type: "ping" }, "browser-to-pi");
	assert.equal(wrongDirection.ok, false);
	if (!wrongDirection.ok) assert.equal(wrongDirection.code, "invalid_envelope");

	const missingId = parseBridgeEnvelope({ version: 1, direction: "browser-to-pi", type: "ping" });
	assert.equal(missingId.ok, false);

	const badTarget = parseBridgeEnvelope({ version: 1, id: "x", direction: "browser-to-pi", type: "ping", target: { tabId: -1 } });
	assert.equal(badTarget.ok, false);
});

test("error envelopes carry typed error payloads", () => {
	const envelope = makeBridgeErrorEnvelope({ id: "err-1", requestId: "req-1", code: "pairing_failed", message: "bad token" });
	assert.equal(envelope.type, "error");
	assert.equal(envelope.requestId, "req-1");
	assert.equal(isBridgeErrorEnvelope(envelope), true);
	assert.equal(envelope.payload.code, "pairing_failed");
});
