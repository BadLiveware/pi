import assert from "node:assert/strict";
import test from "node:test";
import { BROWSER_BRIDGE_CAPABILITIES, browserBridgeStatePayload, createBrowserBridgeRuntime, formatBrowserBridgeStatus } from "../src/core/state.ts";

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
	assert.equal(snapshot.pendingRequests.length, 0);
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
	assert.match(full, /diagnostics:/);
	assert.doesNotMatch(compact, /diagnostics:/);
});

test("state payload is a defensive copy", () => {
	const runtime = createBrowserBridgeRuntime(1234);
	const snapshot = browserBridgeStatePayload(runtime.state);
	snapshot.capabilities.push("mutated");
	snapshot.server.diagnostics.push("mutated");

	const fresh = browserBridgeStatePayload(runtime.state);
	assert.deepEqual(fresh.capabilities, [...BROWSER_BRIDGE_CAPABILITIES]);
	assert.doesNotMatch(fresh.diagnostics.join("\n"), /mutated/);
});
