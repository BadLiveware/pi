import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createCodeIntelEnv } from "code-intel/pi-integration";
import { codeIntelEnvForPiContext } from "../src/pi-tool-adapter.ts";

test("Pi environment includes canonical dependency defaults and preserves host policies", () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-code-intel-adapter-"));
	try {
		const ctx = { cwd } as ExtensionContext;
		const env = codeIntelEnvForPiContext(ctx);
		assert.deepEqual(env, createCodeIntelEnv({ cwd, mutationPolicy: "enabled", pathBase: "repo", persistentLsp: true }));
		assert.equal(env.structuredContent, false);
		assert.equal(env.pathBase, "repo");
		assert.equal(env.persistentLsp, true);
		assert.equal(codeIntelEnvForPiContext(ctx, "disabled").mutationPolicy, "disabled");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
