import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { EVOLVE_IMPLEMENTATION_GATES } from "../src/state/core.ts";
import { MAX_EVOLVE_ARCHIVE_SIZE, MAX_EVOLVE_CANDIDATE_BUDGET, MAX_EVOLVE_OUTPUT_BYTES, MAX_EVOLVE_PROMPT_CANDIDATES, MAX_EVOLVE_TIMEOUT_MS } from "../src/state/evolve.ts";
import { migrateState } from "../src/state/migration.ts";
import { makeHarness,statePath } from "./test-harness.ts";

test("evolve mode state normalizes future candidate metadata without enabling execution", () => {
	const migrated = migrateState({
		name: "Evolve Fixture",
		mode: "evolve",
		modeState: {
			kind: "evolve",
			setup: {
				seedFiles: ["src/a.ts", "src/a.ts", "src/b.ts"],
				evaluatorCommand: "npm run bench:evolve",
				primaryMetric: "score",
				metricGoal: "minimize",
				archiveSize: 500,
				candidateBudget: 500,
				patience: 3,
				mutationPolicy: "rewrite_candidate",
				timeoutMs: 999_999,
				maxEvaluatorOutputBytes: 9_999_999,
				maxPromptCandidates: 100,
				isolation: "worktree",
			},
			candidates: [
				{
					id: "best-1",
					iteration: 1,
					summary: `${"candidate summary ".repeat(80)}done`,
					changedFiles: ["src/a.ts", "src/a.ts"],
					metrics: { score: 1.25, note: "baseline", ignored: { nested: true } },
					primaryScore: 1.25,
					criterionIds: ["c1", "c1"],
					verificationArtifacts: [{ kind: "benchmark", path: "artifacts/bench.log", summary: `${"benchmark output ".repeat(80)}done` }],
					status: "best",
					createdAt: "2026-05-08T00:00:00.000Z",
				},
			],
			bestCandidateId: "best-1",
			archive: Array.from({ length: 80 }, (_, index) => `archive ${index}`),
			consecutiveNonImproving: 999,
			implementationGates: ["evaluator_contract", "unknown_gate"],
		},
	} as any);

	assert.equal(migrated.mode, "evolve");
	assert.equal(migrated.modeState.kind, "evolve");
	assert.equal(migrated.modeState.setup?.archiveSize, MAX_EVOLVE_ARCHIVE_SIZE);
	assert.equal(migrated.modeState.setup?.candidateBudget, MAX_EVOLVE_CANDIDATE_BUDGET);
	assert.equal(migrated.modeState.setup?.timeoutMs, MAX_EVOLVE_TIMEOUT_MS);
	assert.equal(migrated.modeState.setup?.maxEvaluatorOutputBytes, MAX_EVOLVE_OUTPUT_BYTES);
	assert.equal(migrated.modeState.setup?.maxPromptCandidates, MAX_EVOLVE_PROMPT_CANDIDATES);
	assert.deepEqual(migrated.modeState.setup?.seedFiles, ["src/a.ts", "src/b.ts"]);
	assert.equal(migrated.modeState.bestCandidateId, "best-1");
	assert.equal(migrated.modeState.candidates.length, 1);
	assert.equal(migrated.modeState.candidates[0].summary.length, 500);
	assert.deepEqual(migrated.modeState.candidates[0].changedFiles, ["src/a.ts"]);
	assert.deepEqual(migrated.modeState.candidates[0].metrics, { score: 1.25, note: "baseline" });
	assert.equal(migrated.modeState.candidates[0].verificationArtifacts[0].summary.length, 500);
	assert.equal(migrated.modeState.archive.length, MAX_EVOLVE_ARCHIVE_SIZE);
	assert.equal(migrated.modeState.consecutiveNonImproving, MAX_EVOLVE_CANDIDATE_BUDGET);
	assert.deepEqual(migrated.modeState.implementationGates, ["evaluator_contract"]);
});

test("evolve startup remains reserved and does not write loop state", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-evolve-test-"));
	try {
		const { tools, commands, messages, notifications, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		assert.ok(start);

		const toolResult = await start.execute("tool-evolve-reserved", { name: "Evolve Reserved", mode: "evolve", taskContent: "# Task\n" }, undefined, undefined, ctx);
		assert.match(toolResult.content[0].text, /planned but not implemented yet/);
		for (const gate of EVOLVE_IMPLEMENTATION_GATES) assert.match(toolResult.content[0].text, new RegExp(gate));
		assert.equal(messages.length, 0);
		assert.equal(fs.existsSync(statePath(cwd, "Evolve_Reserved")), false);

		const stardock = commands.get("stardock");
		assert.ok(stardock);
		await stardock.handler("start cmd-evolve-reserved --mode evolve", ctx);
		assert.ok(notifications.some((message) => message.includes('Stardock mode "evolve" is planned but not implemented yet.')));
		assert.equal(fs.existsSync(statePath(cwd, "cmd-evolve-reserved")), false);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
