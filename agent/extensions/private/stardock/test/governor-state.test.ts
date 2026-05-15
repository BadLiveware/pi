import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { buildPrompt } from "../src/runtime/prompts.ts";
import { loadState } from "../src/state/store.ts";
import { makeHarness, statePath } from "./test-harness.ts";

test("stardock_governor_state records durable governor memory", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-governor-test-"));
	try {
		const { tools, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const governor = tools.get("stardock_governor_state");
		assert.ok(start);
		assert.ok(governor);

		await start.execute("start", { name: "Governor Memory", mode: "checklist", taskContent: "# Governor memory\n", maxIterations: 3 }, undefined, undefined, ctx);
		const result = await governor.execute(
			"memory",
			{
				action: "append",
				loopName: "Governor_Memory",
				objective: "Make checklist mode preserve governor direction.",
				currentStrategy: "Harden bounded context routing before more automation.",
				completedMilestones: ["Criterion ledger exists."],
				activeConstraints: ["Do not auto-apply patches."],
				knownRisks: ["Implementer edits are not isolated yet."],
				evidenceGaps: ["Need dogfood evidence for automatic auditor gates."],
				rejectedPaths: [{ summary: "Jump straight to evolve mode", reason: "Evaluator and isolation gates are missing." }],
				nextContextHints: ["Dogfood implementer WorkerRuns."],
			},
			undefined,
			undefined,
			ctx,
		);

		assert.match(result.content[0].text, /Current strategy: Harden bounded context routing/);
		assert.match(result.content[0].text, /Do not auto-apply patches/);
		const raw = JSON.parse(fs.readFileSync(statePath(cwd, "Governor_Memory"), "utf-8"));
		assert.equal(raw.governorState.currentStrategy, "Harden bounded context routing before more automation.");
		assert.deepEqual(raw.governorState.activeConstraints, ["Do not auto-apply patches."]);
		assert.equal(raw.governorState.rejectedPaths[0].summary, "Jump straight to evolve mode");

		const state = loadState(ctx, "Governor_Memory");
		assert.ok(state);
		const prompt = buildPrompt(state, "# Governor memory\n", "iteration");
		assert.match(prompt, /## Governor Memory/);
		assert.match(prompt, /Current strategy: Harden bounded context routing before more automation\./);
		assert.match(prompt, /Rejected paths/);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("stardock_governor_state clears selected memory fields", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-governor-test-"));
	try {
		const { tools, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const governor = tools.get("stardock_governor_state");
		assert.ok(start);
		assert.ok(governor);

		await start.execute("start", { name: "Governor Clear", mode: "checklist", taskContent: "# Governor clear\n", maxIterations: 3 }, undefined, undefined, ctx);
		await governor.execute("memory", { action: "upsert", loopName: "Governor_Clear", currentStrategy: "Keep this.", activeConstraints: ["Clear this."] }, undefined, undefined, ctx);
		const cleared = await governor.execute("clear", { action: "clear", loopName: "Governor_Clear", fields: ["activeConstraints"] }, undefined, undefined, ctx);
		assert.match(cleared.content[0].text, /Current strategy: Keep this\./);
		assert.doesNotMatch(cleared.content[0].text, /Clear this/);
		const raw = JSON.parse(fs.readFileSync(statePath(cwd, "Governor_Clear"), "utf-8"));
		assert.equal(raw.governorState.currentStrategy, "Keep this.");
		assert.deepEqual(raw.governorState.activeConstraints, []);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
