import assert from "node:assert/strict";
import test from "node:test";
import { makeBridgeEnvelope } from "../src/core/protocol.ts";
import { createBrowserBridgeRuntime } from "../src/core/state.ts";
import { formatStyleInspectionToolResult, resolveStyleElementTarget } from "../src/slices/style-inspection/tool.ts";

test("style inspection formats computed styles, variables, images, and ancestors", () => {
	const result = formatStyleInspectionToolResult(makeBridgeEnvelope({
		id: "style-1",
		direction: "browser-to-pi",
		type: "style-inspection:result",
		payload: {
			ok: true,
			elements: [{
				descriptor: { elementId: "el-1", selectorCandidates: ["#new-listing"], textPreview: "New listing" },
				styles: { "background-color": "rgb(254, 248, 128)", color: "rgb(40, 40, 40)", display: "inline-flex", width: "82px" },
				cssVariables: { "--color-branded": "#fef880" },
				imageSources: ["url(https://example.test/image.png)"],
				ancestors: [{ descriptor: { tagName: "nav" }, styles: { display: "flex" } }],
			}],
		},
	}));
	const text = result.content[0]?.text ?? "";
	assert.match(text, /Style inspection: 1 element/);
	assert.match(text, /#new-listing \[el-1\] — New listing/);
	assert.match(text, /background-color=rgb\(254, 248, 128\)/);
	assert.match(text, /css variables: 1/);
	assert.match(text, /images: url/);
	assert.match(text, /ancestors: 1/);
});

test("style inspection throws bridge and content errors", () => {
	assert.throws(() => formatStyleInspectionToolResult(makeBridgeEnvelope({
		id: "style-err",
		direction: "browser-to-pi",
		type: "error",
		payload: { message: "style failed" },
	})), /style failed/);
	assert.throws(() => formatStyleInspectionToolResult(makeBridgeEnvelope({
		id: "style-err-2",
		direction: "browser-to-pi",
		type: "style-inspection:result",
		payload: { ok: false, error: "no element" },
	})), /no element/);
});

test("style element targets default to latest or previous shared selections", () => {
	const runtime = createBrowserBridgeRuntime(1000);
	const target = { client: { clientId: "client-a", browser: "chromium" as const, connectedAt: 1000, capabilities: [], activeTabId: 7 }, tab: { clientId: "client-a", tabId: 7, active: true, capabilities: [] } };
	runtime.state.sharedSelections.push(
		{ selectionId: "selection-source", clientId: "client-a", tabId: 7, status: "selected", selectedAt: 1001, elements: [{ elementId: "el-source", selectorCandidates: [".source"] }] },
		{ selectionId: "selection-target", clientId: "client-a", tabId: 7, status: "selected", selectedAt: 1002, context: { frameId: 3 }, elements: [{ elementId: "el-target", selectorCandidates: [".target"] }] },
	);

	assert.deepEqual(resolveStyleElementTarget(runtime, target, undefined, { fallbackSelectionOffset: 0, role: "target" }), { selectionId: "selection-target", selectionIndex: 0, elementId: "el-target", frameId: 3, expected: { elementId: "el-target", selectorCandidates: [".target"] } });
	assert.deepEqual(resolveStyleElementTarget(runtime, target, undefined, { fallbackSelectionOffset: 1, role: "source" }), { selectionId: "selection-source", selectionIndex: 0, elementId: "el-source", expected: { elementId: "el-source", selectorCandidates: [".source"] } });
	assert.deepEqual(resolveStyleElementTarget(runtime, target, { selectionId: "selection-source", selectionIndex: 0 }, { fallbackSelectionOffset: 0, role: "source" }), { selectionId: "selection-source", selectionIndex: 0, elementId: "el-source", expected: { elementId: "el-source", selectorCandidates: [".source"] } });
	assert.deepEqual(resolveStyleElementTarget(runtime, target, { selector: "h1" }, { fallbackSelectionOffset: 0, role: "target" }), { selector: "h1" });
});
