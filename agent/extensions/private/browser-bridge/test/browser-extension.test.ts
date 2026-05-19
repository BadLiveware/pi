import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { bridgeCloseBeforeAcceptMessage, shouldFallbackBridgeUrlToDefault, shouldFallbackResumeToPairRequest } from "../browser-extension/src/shared/connection-plan.ts";
import { appendExtensionDebugLog, formatExtensionDebugLog, parseStoredDebugLog } from "../browser-extension/src/shared/debug-log.ts";
import { parsePairingDetails } from "../browser-extension/src/shared/pairing-details.ts";

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
	assert.deepEqual(tsconfig.files.slice(-5), [
		"src/content/selection.ts",
		"src/content/overlay.ts",
		"src/content/interact.ts",
		"src/content/clipboard.ts",
		"src/content.ts",
	]);
	for (const sourcePath of tsconfig.files.filter((path: string) => path.endsWith(".ts"))) {
		const source = readBrowserExtensionFile(sourcePath);
		assert.doesNotMatch(source, /^\s*import\s/m, `${sourcePath} must not emit module imports into injected content.js.`);
	}
});

test("manifest declares clipboard write permission", () => {
	const manifest = JSON.parse(readBrowserExtensionFile("manifest.json"));
	assert.ok(manifest.permissions.includes("clipboardWrite"));
});
