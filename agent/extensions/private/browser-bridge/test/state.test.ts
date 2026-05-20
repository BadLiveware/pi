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
	assert.equal(snapshot.sharedDrawings.length, 0);
	assert.equal(snapshot.designPreviews.length, 0);
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
	assert.match(full, /shared drawings: 0/);
	assert.match(full, /design previews: 0/);
	assert.match(full, /diagnostics:/);
	assert.doesNotMatch(compact, /diagnostics:/);
});

test("status summary includes latest design preview", () => {
	const runtime = createBrowserBridgeRuntime(1234);
	runtime.state.designPreviews.push({ patchId: "preview-1", clientId: "client-a", tabId: 42, action: "style", selector: "button", elementCount: 1, summary: "Styled 1 element(s): background-color.", createdAt: 1236 });
	const status = formatBrowserBridgeStatus(browserBridgeStatePayload(runtime.state), { includeDiagnostics: false });

	assert.match(status, /design previews: 1/);
	assert.match(status, /latest design preview: style, 1 element\(s\), Styled 1 element\(s\): background-color\./);
});

test("status summary includes latest shared selection descriptors", () => {
	const runtime = createBrowserBridgeRuntime(1234);
	runtime.state.sharedSelections.push({
		selectionId: "selection-1",
		clientId: "client-a",
		source: "context-menu",
		url: "https://example.test/page",
		status: "selected",
		selectedAt: 1236,
		elements: [
			{ tagName: "button", selectorCandidates: ["#save"], accessibleName: "Save", textPreview: "Save changes" },
		],
	});
	const status = formatBrowserBridgeStatus(browserBridgeStatePayload(runtime.state), { includeDiagnostics: false });

	assert.match(status, /latest shared selection: context-menu, selected, 1 element/);
	assert.match(status, /#save \(Save\) — Save changes/);
});

test("status summary includes latest shared drawing details", () => {
	const runtime = createBrowserBridgeRuntime(1234);
	runtime.state.sharedDrawings.push({
		drawingId: "drawing-1",
		clientId: "client-a",
		source: "drawing",
		url: "https://example.test/page",
		status: "drawn",
		sharedAt: 1236,
		userNote: "circle this",
		context: { viewportWidth: 800, viewportHeight: 600, scrollX: 5, scrollY: 7, devicePixelRatio: 2 },
		boundingBox: { x: 10, y: 20, width: 30, height: 40, coordinateSpace: "viewport" },
		pageBoundingBox: { x: 15, y: 27, width: 30, height: 40, coordinateSpace: "page" },
		viewport: { width: 800, height: 600, scrollX: 5, scrollY: 7, devicePixelRatio: 2 },
		pointCount: 2,
		strokes: [{ color: "#e53935", width: 4, points: [{ x: 10, y: 20 }, { x: 40, y: 60 }] }],
		gesture: { type: "arrow", confidence: "medium", start: { x: 10, y: 20 }, end: { x: 40, y: 60 }, fromElement: { selectorCandidates: ["#save"], textPreview: "Save" } },
		previewImage: { path: "/tmp/drawing.png", mediaType: "image/png", crop: { x: 0, y: 0, width: 60, height: 80, coordinateSpace: "viewport" }, imageSize: { width: 120, height: 160 }, scale: { x: 2, y: 2 } },
		nearbyElements: [{ tagName: "span", selectorCandidates: [".price"], textPreview: "120 kr" }],
	});
	const status = formatBrowserBridgeStatus(browserBridgeStatePayload(runtime.state), { includeDiagnostics: false });

	assert.match(status, /latest shared drawing: drawing, drawn, 1 stroke\(s\), 2 point\(s\)/);
	assert.match(status, /note: circle this/);
	assert.match(status, /preview: \/tmp\/drawing.png/);
	assert.match(status, /region: viewport x=10 y=20 w=30 h=40; page x=15 y=27 w=30 h=40/);
	assert.match(status, /viewport: 800x600 scroll 5,7 dpr 2/);
	assert.match(status, /preview crop: viewport x=0 y=0 w=60 h=80; image 120x160; scale 2x/);
	assert.match(status, /gesture: arrow \(medium\) from 10,20 to 40,60/);
	assert.match(status, /from: #save — Save/);
	assert.match(status, /.price — 120 kr/);
});

test("status summary includes per-stroke drawing regions", () => {
	const runtime = createBrowserBridgeRuntime(1234);
	runtime.state.sharedDrawings.push({
		drawingId: "drawing-1",
		clientId: "client-a",
		status: "drawn",
		sharedAt: 1236,
		context: { scrollX: 10, scrollY: 20 },
		boundingBox: { x: 10, y: 20, width: 140, height: 210, coordinateSpace: "viewport" },
		pointCount: 4,
		strokes: [
			{ points: [{ x: 10, y: 20 }, { x: 40, y: 60 }], boundingBox: { x: 10, y: 20, width: 30, height: 40, coordinateSpace: "viewport" }, pageBoundingBox: { x: 20, y: 40, width: 30, height: 40, coordinateSpace: "page" } },
			{ points: [{ x: 100, y: 200 }, { x: 150, y: 230 }], boundingBox: { x: 100, y: 200, width: 50, height: 30, coordinateSpace: "viewport" }, pageBoundingBox: { x: 110, y: 220, width: 50, height: 30, coordinateSpace: "page" } },
		],
		nearbyElements: [],
	});
	const status = formatBrowserBridgeStatus(browserBridgeStatePayload(runtime.state), { includeDiagnostics: false });

	assert.match(status, /regions:/);
	assert.match(status, /1\. viewport x=10 y=20 w=30 h=40; page x=20 y=40 w=30 h=40/);
	assert.match(status, /2\. viewport x=100 y=200 w=50 h=30; page x=110 y=220 w=50 h=30/);
});

test("state payload is a defensive copy", () => {
	const runtime = createBrowserBridgeRuntime(1234);
	appendBrowserBridgeDebugLog(runtime.state, { at: 1235, source: "server", level: "info", event: "test", data: { clientId: "client-a" } });
	runtime.state.sharedSelections.push({ selectionId: "selection-1", clientId: "client-a", source: "picker", url: "https://example.test/page", status: "selected", selectedAt: 1236, context: { source: "picker", clientX: 10 }, elements: [{ selectorCandidates: ["button"], attributes: { "data-testid": "button" }, boundingBox: { x: 1, y: 2, width: 3, height: 4 } }] });
	runtime.state.sharedDrawings.push({ drawingId: "drawing-1", clientId: "client-a", status: "drawn", sharedAt: 1237, context: { scrollX: 10 }, boundingBox: { x: 1, y: 2, width: 3, height: 4 }, pageBoundingBox: { x: 11, y: 12, width: 3, height: 4 }, viewport: { width: 800, height: 600, scrollX: 10, scrollY: 10, devicePixelRatio: 2 }, pointCount: 1, strokes: [{ points: [{ x: 1, y: 2 }], boundingBox: { x: 1, y: 2, width: 3, height: 4 }, pageBoundingBox: { x: 11, y: 12, width: 3, height: 4 } }], gesture: { type: "arrow", start: { x: 1, y: 2 }, end: { x: 3, y: 4 }, fromElement: { selectorCandidates: [".from"] } }, previewImage: { path: "/tmp/drawing.png", crop: { x: 1, y: 2, width: 3, height: 4 }, scale: { x: 2, y: 2 } }, nearbyElements: [{ selectorCandidates: [".price"], boundingBox: { x: 1, y: 2, width: 3, height: 4 } }] });
	const snapshot = browserBridgeStatePayload(runtime.state);
	runtime.state.designPreviews.push({ patchId: "preview-1", action: "style", elementCount: 1, summary: "Styled", createdAt: 1238 });
	const previewSnapshot = browserBridgeStatePayload(runtime.state);
	previewSnapshot.designPreviews[0]!.summary = "mutated";
	assert.equal(browserBridgeStatePayload(runtime.state).designPreviews[0]?.summary, "Styled");

	snapshot.capabilities.push("mutated");
	snapshot.server.diagnostics.push("mutated");
	snapshot.debugLog[0]!.data!.clientId = "mutated";
	snapshot.sharedSelections[0]!.context!.source = "mutated";
	snapshot.sharedSelections[0]!.elements[0]!.selectorCandidates![0] = "mutated";
	snapshot.sharedSelections[0]!.elements[0]!.attributes!["data-testid"] = "mutated";
	snapshot.sharedSelections[0]!.elements[0]!.boundingBox!.x = 99;
	snapshot.sharedDrawings[0]!.pageBoundingBox!.x = 99;
	snapshot.sharedDrawings[0]!.viewport!.width = 99;
	snapshot.sharedDrawings[0]!.strokes[0]!.boundingBox!.x = 99;
	snapshot.sharedDrawings[0]!.strokes[0]!.pageBoundingBox!.x = 99;
	snapshot.sharedDrawings[0]!.strokes[0]!.points[0]!.x = 99;
	snapshot.sharedDrawings[0]!.gesture!.fromElement!.selectorCandidates![0] = "mutated";
	snapshot.sharedDrawings[0]!.previewImage!.crop!.x = 99;
	snapshot.sharedDrawings[0]!.previewImage!.scale!.x = 99;
	snapshot.sharedDrawings[0]!.nearbyElements[0]!.selectorCandidates![0] = "mutated";

	const fresh = browserBridgeStatePayload(runtime.state);
	assert.deepEqual(fresh.capabilities, [...BROWSER_BRIDGE_CAPABILITIES]);
	assert.doesNotMatch(fresh.diagnostics.join("\n"), /mutated/);
	assert.equal(fresh.debugLog[0]?.data?.clientId, "client-a");
	assert.equal(fresh.sharedSelections[0]?.context?.source, "picker");
	assert.equal(fresh.sharedSelections[0]?.elements[0]?.selectorCandidates?.[0], "button");
	assert.equal(fresh.sharedSelections[0]?.elements[0]?.attributes?.["data-testid"], "button");
	assert.equal(fresh.sharedSelections[0]?.elements[0]?.boundingBox?.x, 1);
	assert.equal(fresh.sharedDrawings[0]?.pageBoundingBox?.x, 11);
	assert.equal(fresh.sharedDrawings[0]?.viewport?.width, 800);
	assert.equal(fresh.sharedDrawings[0]?.strokes[0]?.boundingBox?.x, 1);
	assert.equal(fresh.sharedDrawings[0]?.strokes[0]?.pageBoundingBox?.x, 11);
	assert.equal(fresh.sharedDrawings[0]?.strokes[0]?.points[0]?.x, 1);
	assert.equal(fresh.sharedDrawings[0]?.gesture?.fromElement?.selectorCandidates?.[0], ".from");
	assert.equal(fresh.sharedDrawings[0]?.previewImage?.crop?.x, 1);
	assert.equal(fresh.sharedDrawings[0]?.previewImage?.scale?.x, 2);
	assert.equal(fresh.sharedDrawings[0]?.nearbyElements[0]?.selectorCandidates?.[0], ".price");
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
