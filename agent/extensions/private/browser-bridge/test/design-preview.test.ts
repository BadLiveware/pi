import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { makeBridgeEnvelope } from "../src/core/protocol.ts";
import { createBrowserBridgeRuntime } from "../src/core/state.ts";
import { formatDesignPreviewToolResult, normalizeCaptureAfter, normalizeDesignPreviewCommands, updateDesignPreviewState } from "../src/slices/design-preview/tool.ts";

test("normalizeDesignPreviewCommands preserves command objects and replaces invalid values", () => {
	assert.deepEqual(normalizeDesignPreviewCommands([{ action: "list" }, null, "bad"]), [{ action: "list" }, { action: "list" }, { action: "list" }]);
});

test("normalizeDesignPreviewCommands resolves shared selection targets non-interactively", () => {
	const runtime = createBrowserBridgeRuntime(1000);
	const target = { client: { clientId: "client-a" }, tab: { tabId: 7 } };
	runtime.state.sharedSelections.push({ selectionId: "selection-target", clientId: "client-a", tabId: 7, status: "selected", selectedAt: 1001, context: { frameId: 3 }, elements: [{ elementId: "el-doc-1", selectorCandidates: [".card"], tagName: "div", textPreview: "Card" }] });

	assert.deepEqual(normalizeDesignPreviewCommands([{ action: "style", selectionId: "selection-target", styles: { color: "red" } }], runtime, target), [{ action: "style", selectionId: "selection-target", selectionIndex: 0, frameId: 3, elementId: "el-doc-1", expected: { elementId: "el-doc-1", selectorCandidates: [".card"], tagName: "div", textPreview: "Card" }, styles: { color: "red" } }]);
	assert.deepEqual(normalizeDesignPreviewCommands([{ action: "style", elementId: "el-doc-1", styles: { color: "red" } }], runtime, target), [{ action: "style", elementId: "el-doc-1", selectionId: "selection-target", selectionIndex: 0, frameId: 3, expected: { elementId: "el-doc-1", selectorCandidates: [".card"], tagName: "div", textPreview: "Card" }, styles: { color: "red" } }]);
});

test("formatDesignPreviewToolResult summarizes applied and active patches", () => {
	const result = formatDesignPreviewToolResult(makeBridgeEnvelope({
		id: "preview-1",
		direction: "browser-to-pi",
		type: "design-preview:result",
		payload: {
			ok: true,
			applied: 1,
			cleared: 0,
			active: [{ patchId: "preview-1" }],
			results: [{
				ok: true,
				action: "style",
				summary: "Styled 1 element(s): background-color.",
				computedAfter: [{ descriptor: { elementId: "el-1", selectorCandidates: ["h1"] }, styles: { "background-color": "rgb(254, 248, 128)", color: "rgb(40, 40, 40)" } }],
			}],
		},
	}));
	assert.match(result.content[0]?.text ?? "", /1 applied, 0 cleared, 1 active/);
	assert.match(result.content[0]?.text ?? "", /style: Styled 1 element/);
	assert.match(result.content[0]?.text ?? "", /after 1 h1 \[el-1\]: background-color=rgb\(254, 248, 128\)/);
});

test("normalizeCaptureAfter defaults mutating previews to full viewport screenshot capture", () => {
	assert.deepEqual(normalizeCaptureAfter(undefined, [{ action: "style" }]), { mode: "viewport" });
	assert.deepEqual(normalizeCaptureAfter(undefined, [{ action: "clear" }]), { mode: "viewport" });
	assert.equal(normalizeCaptureAfter(undefined, [{ action: "list" }]), undefined);
	assert.equal(normalizeCaptureAfter(false, [{ action: "style" }]), false);
});

test("formatDesignPreviewToolResult materializes snapshot data URLs", () => {
	const result = formatDesignPreviewToolResult(makeBridgeEnvelope({
		id: "preview-snapshot",
		direction: "browser-to-pi",
		type: "design-preview:result",
		payload: {
			ok: true,
			applied: 0,
			cleared: 0,
			active: [],
			snapshot: { dataUrl: "data:image/png;base64,aGVsbG8=", mediaType: "image/png", fullViewport: true },
		},
	}));
	const text = result.content[0]?.text ?? "";
	assert.match(text, /snapshot: \/tmp\/pi-browser-bridge-previews\/preview-/);
	const details = result.details as { snapshot?: { path?: string; dataUrl?: string } };
	assert.equal(details.snapshot?.dataUrl, undefined);
	assert.equal(typeof details.snapshot?.path, "string");
	assert.equal(existsSync(details.snapshot!.path!), true);
});

test("formatDesignPreviewToolResult throws bridge errors", () => {
	assert.throws(() => formatDesignPreviewToolResult(makeBridgeEnvelope({
		id: "preview-err",
		direction: "browser-to-pi",
		type: "error",
		payload: { message: "design preview failed" },
	})), /design preview failed/);
});

test("updateDesignPreviewState mirrors active preview patches", () => {
	const runtime = createBrowserBridgeRuntime(1000);
	updateDesignPreviewState(runtime, "client-a", 42, {
		active: [
			{ patchId: "preview-1", action: "style", selector: "button", elementCount: 1, summary: "Styled 1 element(s): background-color.", createdAt: 1234 },
		],
	});
	assert.deepEqual(runtime.state.designPreviews, [{ patchId: "preview-1", clientId: "client-a", tabId: 42, action: "style", selector: "button", elementCount: 1, summary: "Styled 1 element(s): background-color.", createdAt: 1234 }]);
	updateDesignPreviewState(runtime, "client-a", 42, { active: [] });
	assert.equal(runtime.state.designPreviews.length, 0);
});
