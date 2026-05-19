import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const backgroundSource = () => readFileSync(new URL("../browser-extension/src/background.ts", import.meta.url), "utf8");

test("background service worker avoids the page window global", () => {
	assert.doesNotMatch(
		backgroundSource(),
		/\bwindow\./,
		"MV3 background service workers do not define window; use globalThis for timers and worker globals.",
	);
});
