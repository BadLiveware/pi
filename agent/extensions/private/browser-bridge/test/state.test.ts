import assert from "node:assert/strict";
import test from "node:test";
import { BROWSER_BRIDGE_CAPABILITIES, appendBrowserBridgeDebugLog, browserBridgeStatePayload, createBrowserBridgeRuntime, formatBrowserBridgeStatus } from "../src/core/state.ts";

test("initial browser bridge state is inert and diagnostic", () => {
	const runtime = createBrowserBridgeRuntime(1234);
	const snapshot = browserBridgeStatePayload(runtime.state);

	assert.equal(snapshot.createdAt, 1234);
	assert.equal(snapshot.server.enabled, false);
	assert.equal(snapshot.server.listener, "stopped");
	assert.equal(snapshot.server.host, "127.0.0.1");
	assert.equal(snapshot.server.port, undefined);
	assert.equal(snapshot.clients.length, 0);
	assert.equal(snapshot.tabs.length, 0);
	assert.equal(snapshot.sharedSelections.length, 0);
	assert.equal(snapshot.pendingRequests.length, 0);
	assert.equal(snapshot.debugLog.length, 0);
	assert.deepEqual(snapshot.capabilities, [...BROWSER_BRIDGE_CAPABILITIES]);
	assert.match(snapshot.diagnostics.join("\n"), /disabled/);
});

test("status summary includes compact counts and can omit diagnostics", () => {
	const runtime = createBrowserBridgeRuntime(1234);
	const snapshot = browserBridgeStatePayload(runtime.state);
	const full = formatBrowserBridgeStatus(snapshot);
	const compact = formatBrowserBridgeStatus(snapshot, { includeDiagnostics: false });

	assert.match(full, /browser-bridge: disabled/);
	assert.match(full, /listener: stopped/);
	assert.match(full, /clients: 0/);
	assert.match(full, /shared selections: 0/);
	assert.match(full, /diagnostics:/);
	assert.doesNotMatch(compact, /diagnostics:/);
});

test("state payload is a defensive copy", () => {
	const runtime = createBrowserBridgeRuntime(1234);
	appendBrowserBridgeDebugLog(runtime.state, { at: 1235, source: "server", level: "info", event: "test", data: { clientId: "client-a" } });
	runtime.state.sharedSelections.push({ selectionId: "selection-1", clientId: "client-a", status: "selected", selectedAt: 1236, elements: [{ selectorCandidates: ["button"], attributes: { "data-testid": "button" }, boundingBox: { x: 1, y: 2, width: 3, height: 4 } }] });
	const snapshot = browserBridgeStatePayload(runtime.state);
	snapshot.capabilities.push("mutated");
	snapshot.server.diagnostics.push("mutated");
	snapshot.debugLog[0]!.data!.clientId = "mutated";
	snapshot.sharedSelections[0]!.elements[0]!.selectorCandidates![0] = "mutated";
	snapshot.sharedSelections[0]!.elements[0]!.attributes!["data-testid"] = "mutated";
	snapshot.sharedSelections[0]!.elements[0]!.boundingBox!.x = 99;

	const fresh = browserBridgeStatePayload(runtime.state);
	assert.deepEqual(fresh.capabilities, [...BROWSER_BRIDGE_CAPABILITIES]);
	assert.doesNotMatch(fresh.diagnostics.join("\n"), /mutated/);
	assert.equal(fresh.debugLog[0]?.data?.clientId, "client-a");
	assert.equal(fresh.sharedSelections[0]?.elements[0]?.selectorCandidates?.[0], "button");
	assert.equal(fresh.sharedSelections[0]?.elements[0]?.attributes?.["data-testid"], "button");
	assert.equal(fresh.sharedSelections[0]?.elements[0]?.boundingBox?.x, 1);
});

test("status summary can include recent debug log entries", () => {
	const runtime = createBrowserBridgeRuntime(1234);
	appendBrowserBridgeDebugLog(runtime.state, { at: 1235, source: "server", level: "info", event: "server-started", data: { port: 43871 } });
	const snapshot = browserBridgeStatePayload(runtime.state);
	const compact = formatBrowserBridgeStatus(snapshot);
	const debug = formatBrowserBridgeStatus(snapshot, { includeDebugLog: true });

	assert.doesNotMatch(compact, /debug log:/);
	assert.match(debug, /debug log:/);
	assert.match(debug, /server:server-started/);
});
