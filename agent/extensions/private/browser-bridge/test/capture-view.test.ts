import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { makeBridgeEnvelope } from "../src/core/protocol.ts";
import { formatCaptureViewToolResult } from "../src/slices/capture-view/tool.ts";

test("formatCaptureViewToolResult materializes viewport captures", () => {
	const result = formatCaptureViewToolResult(makeBridgeEnvelope({
		id: "capture-1",
		direction: "browser-to-pi",
		type: "capture-view:result",
		payload: { ok: true, snapshot: { dataUrl: "data:image/png;base64,aGVsbG8=", mediaType: "image/png", fullViewport: true, viewport: { width: 800, height: 600 } } },
	}));
	const text = result.content[0]?.text ?? "";
	assert.match(text, /Browser viewport captured: \/tmp\/pi-browser-bridge-captures\/capture-/);
	assert.match(text, /viewport: 800x600/);
	const details = result.details as { snapshot?: { path?: string; dataUrl?: string } };
	assert.equal(details.snapshot?.dataUrl, undefined);
	assert.equal(typeof details.snapshot?.path, "string");
	assert.equal(existsSync(details.snapshot!.path!), true);
});

test("formatCaptureViewToolResult throws bridge errors", () => {
	assert.throws(() => formatCaptureViewToolResult(makeBridgeEnvelope({
		id: "capture-err",
		direction: "browser-to-pi",
		type: "error",
		payload: { message: "capture failed" },
	})), /capture failed/);
});
