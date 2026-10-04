import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("Lean checks lifecycle counterexamples, repaired progress, and recovery safety", (t) => {
	const model = fileURLToPath(new URL("../models/StardockRetryRecovery.lean", import.meta.url));
	const result = spawnSync("lean", [model], { encoding: "utf8", timeout: 30_000 });
	if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
		t.skip("Lean is optional; install Lean 4 and run the documented model command.");
		return;
	}
	assert.equal(result.error, undefined);
	assert.equal(result.status, 0, result.stdout + result.stderr);
	assert.doesNotMatch(result.stdout + result.stderr, /declaration uses ['"]sorry['"]/);
	assert.match(result.stdout, /StardockRepair\.takeover_preserves_lease/);
});
