import assert from "node:assert/strict";
import test from "node:test";
import { makeBridgeEnvelope } from "../src/core/protocol.ts";
import { formatClipboardToolResult } from "../src/slices/clipboard/tool.ts";

test("formatClipboardToolResult summarizes writes without echoing text", () => {
	const result = formatClipboardToolResult(makeBridgeEnvelope({
		id: "clipboard-1",
		direction: "browser-to-pi",
		type: "clipboard:result",
		payload: { ok: true, action: "write", chars: 12, summary: "wrote secret text" },
	}));
	assert.match(result.content[0]?.text ?? "", /12 character/);
	assert.doesNotMatch(result.content[0]?.text ?? "", /secret text/);
});

test("formatClipboardToolResult reports cancellation and bridge errors", () => {
	const cancelled = formatClipboardToolResult(makeBridgeEnvelope({
		id: "clipboard-2",
		direction: "browser-to-pi",
		type: "clipboard:result",
		payload: { ok: false, cancelled: true, action: "write", chars: 4, summary: "cancelled" },
	}));
	assert.match(cancelled.content[0]?.text ?? "", /cancelled/i);
	assert.throws(
		() => formatClipboardToolResult(makeBridgeEnvelope({ id: "err", direction: "browser-to-pi", type: "error", payload: { message: "clipboard failed" } })),
		/clipboard failed/,
	);
});
