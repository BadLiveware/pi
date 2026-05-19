import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
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

test("injected content script is built as a classic single-file bundle", () => {
	const tsconfig = JSON.parse(readBrowserExtensionFile("tsconfig.content.json"));
	assert.equal(tsconfig.compilerOptions.module, "None");
	assert.equal(tsconfig.compilerOptions.outFile, "dist/content.js");
	assert.deepEqual(tsconfig.files.slice(-4), [
		"src/content/selection.ts",
		"src/content/overlay.ts",
		"src/content/interact.ts",
		"src/content.ts",
	]);
	for (const sourcePath of tsconfig.files.filter((path: string) => path.endsWith(".ts"))) {
		const source = readBrowserExtensionFile(sourcePath);
		assert.doesNotMatch(source, /^\s*import\s/m, `${sourcePath} must not emit module imports into injected content.js.`);
	}
});
