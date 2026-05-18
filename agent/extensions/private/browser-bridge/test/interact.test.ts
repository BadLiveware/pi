import assert from "node:assert/strict";
import test from "node:test";
import { makeBridgeEnvelope } from "../src/core/protocol.ts";
import { confirmationRequired, formatInteractToolResult } from "../src/slices/interact/tool.ts";

test("confirmationRequired defaults based on action risk", () => {
	assert.equal(confirmationRequired({ actions: [{ type: "click" }] }), false);
	assert.equal(confirmationRequired({ actions: [{ type: "type" }] }), true);
	assert.equal(confirmationRequired({ actions: [{ type: "click" }, { type: "scroll" }] }), true);
	assert.equal(confirmationRequired({ actions: [{ type: "type" }], requireUserConfirmation: false }), false);
});

test("formatInteractToolResult summarizes action results", () => {
	const result = formatInteractToolResult(makeBridgeEnvelope({
		id: "interact-1",
		direction: "browser-to-pi",
		type: "interact:result",
		payload: { ok: false, results: [{ index: 0, type: "click", ok: true, summary: "clicked" }, { index: 1, type: "type", ok: false, summary: "not input" }] },
	}));
	assert.match(result.content[0]?.text ?? "", /completed with failures/);
	assert.match(result.content[0]?.text ?? "", /not input/);
});

test("formatInteractToolResult reports cancellation and bridge errors", () => {
	const cancelled = formatInteractToolResult(makeBridgeEnvelope({ id: "interact-2", direction: "browser-to-pi", type: "interact:result", payload: { cancelled: true, results: [] } }));
	assert.match(cancelled.content[0]?.text ?? "", /cancelled/);
	assert.throws(() => formatInteractToolResult(makeBridgeEnvelope({ id: "err", direction: "browser-to-pi", type: "error", payload: { message: "interact failed" } })), /interact failed/);
});
