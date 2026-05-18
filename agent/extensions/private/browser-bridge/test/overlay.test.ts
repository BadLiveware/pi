import assert from "node:assert/strict";
import test from "node:test";
import { makeBridgeEnvelope } from "../src/core/protocol.ts";
import { formatOverlayToolResult, normalizeOverlayCommands } from "../src/slices/overlay/tool.ts";

test("normalizeOverlayCommands preserves command objects and replaces invalid values", () => {
	assert.deepEqual(normalizeOverlayCommands([{ action: "show" }, null, "bad"]), [{ action: "show" }, { action: "show" }, { action: "show" }]);
});

test("formatOverlayToolResult summarizes applied command count", () => {
	const result = formatOverlayToolResult(makeBridgeEnvelope({
		id: "overlay-1",
		direction: "browser-to-pi",
		type: "overlay:result",
		payload: { ok: true, applied: 3 },
	}));
	assert.match(result.content[0]?.text ?? "", /Applied 3 browser overlay command/);
});

test("formatOverlayToolResult throws bridge errors", () => {
	assert.throws(() => formatOverlayToolResult(makeBridgeEnvelope({
		id: "overlay-err",
		direction: "browser-to-pi",
		type: "error",
		payload: { message: "overlay failed" },
	})), /overlay failed/);
});
