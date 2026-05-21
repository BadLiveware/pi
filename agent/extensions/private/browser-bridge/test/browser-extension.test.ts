/// <reference types="node" />

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const connectionPlanPath = "../browser-extension/src/shared/connection-plan.ts";
const debugLogPath = "../browser-extension/src/shared/debug-log.ts";
const iconPath = "../browser-extension/src/background/icon.ts";
const dataUrlPath = "../browser-extension/src/shared/data-url.ts";
const pairingDetailsPath = "../browser-extension/src/shared/pairing-details.ts";

const { bridgeCloseBeforeAcceptMessage, shouldFallbackBridgeUrlToDefault, shouldFallbackResumeToPairRequest } = await import(connectionPlanPath);
const { appendExtensionDebugLog, formatExtensionDebugLog, parseStoredDebugLog } = await import(debugLogPath);
const { actionIconStatus, actionIconTitle, ACTION_ICON_PATHS, updateActionIcon } = await import(iconPath);
const { dataUrlToBlob } = await import(dataUrlPath);
const { parsePairingDetails } = await import(pairingDetailsPath);

function readBrowserExtensionFile(path: string): string {
	return readFileSync(new URL(`../browser-extension/${path}`, import.meta.url), "utf8");
}

test("background service worker avoids the page window global", () => {
	assert.doesNotMatch(
		readBrowserExtensionFile("src/background.ts"),
		/\bwindow\./,
		"MV3 background service workers do not define window; use globalThis for timers and worker globals.",
	);
});

test("pairing details parser accepts one-line and labeled command output", () => {
	assert.deepEqual(parsePairingDetails("ws://127.0.0.1:43210 abcdefghijklmnopqrstuvwx"), {
		url: "ws://127.0.0.1:43210",
		token: "abcdefghijklmnopqrstuvwx",
	});
	assert.deepEqual(parsePairingDetails("Browser bridge URL: ws://127.0.0.1:43210\nPairing token: a_b-cdefghijklmnopqrstuv"), {
		url: "ws://127.0.0.1:43210",
		token: "a_b-cdefghijklmnopqrstuv",
	});
});

test("connection helpers retry only stale resume failures through no-copy pairing", () => {
	assert.equal(shouldFallbackResumeToPairRequest(new Error("Pi bridge rejected the connection before it accepted the browser: resume failed.")), true);
	assert.equal(shouldFallbackResumeToPairRequest(new Error("Resume secret is missing, invalid, or expired for this Pi session.")), true);
	assert.equal(shouldFallbackResumeToPairRequest(new Error("No active browser bridge pairing window. Run `/browser-bridge pair` in Pi first.")), false);
	assert.equal(shouldFallbackResumeToPairRequest(new Error("Could not connect to the Pi bridge.")), false);
});

test("connection helpers retry stale bridge URLs through the default gateway", () => {
	assert.equal(shouldFallbackBridgeUrlToDefault(new Error("Could not connect to the Pi bridge.")), true);
	assert.equal(shouldFallbackBridgeUrlToDefault(new Error("Pi bridge socket closed before connection completed.")), true);
	assert.equal(shouldFallbackBridgeUrlToDefault(new Error("No active browser bridge pairing window.")), false);
});

test("extension debug log helpers format and reject malformed rows", () => {
	const entries = appendExtensionDebugLog([], { at: 1234, source: "background", level: "info", event: "connect-start", data: { url: "ws://127.0.0.1:43871", hasToken: false } });
	assert.match(formatExtensionDebugLog(entries), /background:connect-start/);
	assert.equal(parseStoredDebugLog([...entries, { event: "bad" }]).length, 1);
});

test("connection close helper preserves server close reasons", () => {
	assert.equal(
		bridgeCloseBeforeAcceptMessage({ code: 4005, reason: "resume failed" }),
		"Pi bridge rejected the connection before it accepted the browser: resume failed.",
	);
	assert.equal(
		bridgeCloseBeforeAcceptMessage({ code: 1006 }, "Could not connect to the Pi bridge."),
		"Could not connect to the Pi bridge.",
	);
	assert.equal(
		bridgeCloseBeforeAcceptMessage({ code: 4003 }),
		"Pi bridge socket closed before connection completed with close code 4003.",
	);
});

test("injected content script is built as a classic single-file bundle", () => {
	const tsconfig = JSON.parse(readBrowserExtensionFile("tsconfig.content.json"));
	assert.equal(tsconfig.compilerOptions.module, "None");
	assert.equal(tsconfig.compilerOptions.outFile, "dist/content.js");
	assert.deepEqual(tsconfig.files.slice(-10), [
		"src/content/share-context.ts",
		"src/content/selection.ts",
		"src/content/context-menu.ts",
		"src/content/drawing.ts",
		"src/content/overlay.ts",
		"src/content/style-inspection.ts",
		"src/content/design-preview.ts",
		"src/content/interact.ts",
		"src/content/clipboard.ts",
		"src/content.ts",
	]);
	for (const sourcePath of tsconfig.files.filter((path: string) => path.endsWith(".ts"))) {
		const source = readBrowserExtensionFile(sourcePath);
		assert.doesNotMatch(source, /^\s*import\s/m, `${sourcePath} must not emit module imports into injected content.js.`);
	}
});

test("popup exposes user-initiated selection and drawing sharing", () => {
	const popup = readBrowserExtensionFile("popup.html");
	const background = readBrowserExtensionFile("src/background.ts");
	const shareSelection = readBrowserExtensionFile("src/background/share-selection.ts");
	const shareDrawing = readBrowserExtensionFile("src/background/share-drawing.ts");
	assert.match(popup, /id="share-selection"/);
	assert.match(popup, /Select element for Pi/);
	assert.match(popup, /id="share-drawing"/);
	assert.match(popup, /Draw for Pi/);
	assert.match(background, /frameIds: \[MAIN_FRAME_ID\]/);
	assert.match(shareSelection, /frameId: activated\.frameId/);
	assert.match(shareDrawing, /frameId: activated\.frameId/);
});

test("manifest declares clipboard and context menu permissions", () => {
	const manifest = JSON.parse(readBrowserExtensionFile("manifest.json"));
	assert.ok(manifest.permissions.includes("clipboardWrite"));
	assert.ok(manifest.permissions.includes("contextMenus"));
});

test("manifest declares Pi action icons and dynamic icon states", () => {
	const manifest = JSON.parse(readBrowserExtensionFile("manifest.json"));
	assert.equal(manifest.action.default_icon[16], "icons/pi-yellow-16.png");
	assert.equal(manifest.icons[128], "icons/pi-yellow-128.png");
	assert.equal(actionIconStatus(true, undefined), "connected");
	assert.equal(actionIconStatus(true, undefined, true), "active");
	assert.equal(actionIconStatus(false, undefined), "disconnected");
	assert.equal(actionIconStatus(false, "boom", true), "error");
	assert.match(actionIconTitle("error", "boom"), /boom/);
	assert.match(actionIconTitle("active", undefined), /current tab active/);
	assert.equal(ACTION_ICON_PATHS.connected[16], "/icons/pi-blue-16.png");
	assert.equal(ACTION_ICON_PATHS.active[16], "/icons/pi-green-16.png");
	const iconPaths = ACTION_ICON_PATHS as Record<string, Record<number, string>>;
	for (const paths of Object.values(iconPaths)) {
		for (const path of Object.values(paths)) {
			assert.match(path, /^\/icons\//, "dynamic action icons should use extension-root absolute paths from the service worker");
			assert.equal(existsSync(new URL(`../browser-extension/${path.slice(1)}`, import.meta.url)), true, `${path} should exist`);
		}
	}
});

test("action icon updates are serialized so active tab wins after pairing", async () => {
	const originalChrome = (globalThis as Record<string, unknown>).chrome;
	let appliedIcon: string | undefined;
	(globalThis as Record<string, unknown>).chrome = {
		action: {
			async setIcon(details: { path: Record<number, string> }) {
				const icon = details.path[16];
				await new Promise((resolve) => setTimeout(resolve, icon.includes("yellow") ? 10 : 0));
				appliedIcon = icon;
			},
			async setTitle() {},
		},
	};
	try {
		await Promise.all([
			updateActionIcon({ connected: false }),
			updateActionIcon({ connected: true }),
			updateActionIcon({ connected: true, activeTab: true }),
		]);
		assert.equal(appliedIcon, "/icons/pi-green-16.png");
	} finally {
		if (originalChrome === undefined) delete (globalThis as Record<string, unknown>).chrome;
		else (globalThis as Record<string, unknown>).chrome = originalChrome;
	}
});

test("context menu sharing tracks and describes the right-clicked element", () => {
	const content = readBrowserExtensionFile("src/content/context-menu.ts");
	const background = readBrowserExtensionFile("src/background/context-menu.ts");
	assert.match(content, /addEventListener\("contextmenu"/);
	assert.match(content, /describeLastContextMenuTarget/);
	assert.match(background, /Share element with Pi/);
	assert.match(background, /pi-bridge:describe-context-menu-target/);
	assert.match(background, /elements:selected/);
});

test("drawing preview data URLs decode without fetch", async () => {
	const base64Blob = dataUrlToBlob("data:text/plain;base64,SGVsbG8=");
	assert.equal(base64Blob.type, "text/plain");
	assert.equal(await base64Blob.text(), "Hello");
	const plainBlob = dataUrlToBlob("data:text/plain,Hello%20Pi");
	assert.equal(await plainBlob.text(), "Hello Pi");
	assert.throws(() => dataUrlToBlob("https://example.test/image.png"), /Invalid preview data URL/);
});

test("shared artifacts prompt for notes and expose browser feedback", () => {
	const shareContext = readBrowserExtensionFile("src/content/share-context.ts");
	const drawing = readBrowserExtensionFile("src/content/drawing.ts");
	const shareDrawing = readBrowserExtensionFile("src/background/share-drawing.ts");
	assert.match(shareContext, /promptShareContext/);
	assert.match(shareContext, /showShareFeedback/);
	assert.match(drawing, /startDrawing/);
	assert.match(drawing, /nearbyElements/);
	assert.match(drawing, /pageBoundingBox/);
	assert.match(drawing, /strokeWithGeometry/);
	assert.match(drawing, /viewportToPageBox/);
	assert.match(drawing, /region/);
	assert.match(shareDrawing, /scale: \{ x: scaleX, y: scaleY \}/);
});

test("design preview uses a bounded content handler", () => {
	const content = readBrowserExtensionFile("src/content/design-preview.ts");
	const background = readBrowserExtensionFile("src/background/content-requests.ts");
	const capture = readBrowserExtensionFile("src/background/capture-preview.ts");
	assert.match(content, /runDesignPreview/);
	assert.match(content, /sanitizePreviewHtml/);
	assert.match(content, /copy-styles/);
	assert.match(content, /computedAfter/);
	assert.match(content, /resolveStyleInspectionElements\(command, command\.limit\)/);
	assert.doesNotMatch(content, /window\.prompt/);
	assert.doesNotMatch(content, /feedbackPrompt/);
	const serviceWorker = readBrowserExtensionFile("src/background.ts");
	assert.match(background, /pi-bridge:design-preview/);
	assert.match(background, /resolveTargetFrameId/);
	assert.match(background, /capturePreviewSnapshot/);
	assert.match(serviceWorker, /handleCaptureViewRequest/);
	assert.match(capture, /captureVisibleTab/);
	assert.match(capture, /captureTabSnapshot/);
	assert.match(capture, /chrome\.tabs\.update/);
	assert.match(capture, /collectAffectedBoxes/);
});

test("style inspection is available to content and background handlers", () => {
	const content = readBrowserExtensionFile("src/content.ts");
	const inspector = readBrowserExtensionFile("src/content/style-inspection.ts");
	const background = readBrowserExtensionFile("src/background/content-requests.ts");
	assert.match(content, /pi-bridge:style-inspection/);
	assert.match(inspector, /getComputedStyle/);
	assert.match(inspector, /includeCssVariables/);
	assert.match(inspector, /ancestorSummaries/);
	assert.match(background, /handleStyleInspectionRequest/);
	assert.match(background, /style-inspection:result/);
});

test("design preview replaces same-id patches before capturing restores", () => {
	const content = readBrowserExtensionFile("src/content/design-preview.ts");
	for (const fnName of ["applyStylePreview", "applyTextPreview", "applyHtmlPreview"]) {
		const start = content.indexOf(`function ${fnName}`);
		const end = content.indexOf("\n\tfunction ", start + 1);
		const body = content.slice(start, end);
		assert.ok(start >= 0, `${fnName} should exist`);
		assert.ok(body.indexOf("clearPatch(patchId)") < body.indexOf("const restores"), `${fnName} should clear existing patch before recording restore state`);
	}
});

test("background mirrors warning diagnostics to Pi", () => {
	const background = readBrowserExtensionFile("src/background.ts");
	const clientDebug = readBrowserExtensionFile("src/background/client-debug.ts");
	assert.match(background, /mirrorBrowserDebugToPi/);
	assert.match(clientDebug, /client:debug/);
});

test("background updates icon when the foreground tab changes", () => {
	const background = readBrowserExtensionFile("src/background.ts");
	const actionIconController = readBrowserExtensionFile("src/background/action-icon-controller.ts");
	assert.match(background, /createActionIconController/);
	assert.match(actionIconController, /chrome\.tabs\.onActivated/);
	assert.match(actionIconController, /chrome\.tabs\.onUpdated/);
	assert.match(actionIconController, /chrome\.windows\.onFocusChanged/);
	assert.match(actionIconController, /input\.isActivatedTab\(currentTabId\)/);
});
