import assert from "node:assert/strict";
import test from "node:test";
import { makeBridgeEnvelope } from "../src/core/protocol.ts";
import { createBrowserBridgeRuntime } from "../src/core/state.ts";
import { chooseSelectionTarget, formatSelectionToolResult } from "../src/slices/select-elements/tool.ts";

test("chooseSelectionTarget requires a connected client and activated tab", () => {
	const runtime = createBrowserBridgeRuntime(1000);
	assert.throws(() => chooseSelectionTarget(runtime, {}), /No browser bridge client/);

	runtime.state.clients.push({ clientId: "client-a", browser: "chromium", connectedAt: 1000, capabilities: [], activeTabId: 5 });
	assert.throws(() => chooseSelectionTarget(runtime, {}), /No activated tab/);

	runtime.state.tabs.push({ clientId: "client-a", tabId: 5, title: "Fixture", origin: "https://example.test", active: true, capabilities: ["element-selection"] });
	const target = chooseSelectionTarget(runtime, {});
	assert.equal(target.client.clientId, "client-a");
	assert.equal(target.tab.tabId, 5);
});

test("chooseSelectionTarget honors explicit client and tab target", () => {
	const runtime = createBrowserBridgeRuntime(1000);
	runtime.state.clients.push(
		{ clientId: "client-a", browser: "chromium", connectedAt: 1000, capabilities: [], activeTabId: 1 },
		{ clientId: "client-b", browser: "chrome", connectedAt: 1001, capabilities: [], activeTabId: 2 },
	);
	runtime.state.tabs.push(
		{ clientId: "client-a", tabId: 1, active: true, capabilities: [] },
		{ clientId: "client-b", tabId: 2, active: true, capabilities: [] },
	);
	const target = chooseSelectionTarget(runtime, { target: { clientId: "client-b", tabId: 2 } });
	assert.equal(target.client.clientId, "client-b");
	assert.equal(target.tab.tabId, 2);
});

test("formatSelectionToolResult summarizes selected descriptors", () => {
	const result = formatSelectionToolResult(makeBridgeEnvelope({
		id: "resp-1",
		direction: "browser-to-pi",
		type: "select-elements:result",
		payload: {
			status: "selected",
			elements: [
				{ tagName: "button", selectorCandidates: ["#save"], textPreview: "Save changes" },
			],
		},
	}));
	assert.match(result.content[0]?.text ?? "", /Selection selected: 1 element/);
	assert.match(result.content[0]?.text ?? "", /#save/);
});

test("formatSelectionToolResult throws bridge error payloads", () => {
	assert.throws(() => formatSelectionToolResult(makeBridgeEnvelope({
		id: "err-1",
		direction: "browser-to-pi",
		type: "error",
		payload: { message: "selection failed" },
	})), /selection failed/);
});
