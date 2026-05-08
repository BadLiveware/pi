import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { makeHarness, taskPath } from "./test-harness.ts";

test("stardock_ledger records criteria and compact artifact refs", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { tools, messages, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const ledger = tools.get("stardock_ledger");
		const stateTool = tools.get("stardock_state");
		const done = tools.get("stardock_done");
		assert.ok(start);
		assert.ok(ledger);
		assert.ok(stateTool);
		assert.ok(done);

		await start.execute(
			"tool-ledger-start",
			{
				name: "Ledger Loop",
				mode: "checklist",
				taskContent: "# Ledger task\n",
				maxIterations: 3,
			},
			undefined,
			undefined,
			ctx,
		);

		const createCriterion = await ledger.execute(
			"tool-ledger-criterion-create",
			{
				action: "upsertCriterion",
				loopName: "Ledger_Loop",
				id: "c-build",
				requirement: "Validation is explicit",
				sourceRef: ".pi/plans/stardock-implementation-framework.md#criterion-ledger",
				description: "Run validation before claiming the loop slice complete.",
				passCondition: "Typecheck and focused tests pass with fresh output.",
				testMethod: "npm run typecheck --prefix agent/extensions && npm test --prefix agent/extensions -- private/stardock/index.test.ts",
				status: "failed",
				evidence: "Initial baseline has no criterion-ledger tests.",
				redEvidence: "No focused test asserted criterion persistence.",
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(createCriterion.content[0].text, /Created criterion c-build/);
		assert.equal(createCriterion.details.criterion.status, "failed");
		assert.deepEqual(createCriterion.details.criterionLedger.requirementTrace, [
			{ requirement: "Validation is explicit", criterionIds: ["c-build"] },
		]);

		const updateCriterion = await ledger.execute(
			"tool-ledger-criterion-update",
			{
				action: "upsertCriterion",
				loopName: "Ledger_Loop",
				id: "c-build",
				status: "passed",
				evidence: "Typecheck and focused tests passed after adding ledger coverage.",
				greenEvidence: "node --test private/stardock/index.test.ts passed.",
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(updateCriterion.content[0].text, /Updated criterion c-build/);
		assert.equal(updateCriterion.details.criterion.description, "Run validation before claiming the loop slice complete.");
		assert.equal(updateCriterion.details.criterion.status, "passed");
		assert.ok(updateCriterion.details.criterion.lastCheckedAt);

		const longSummary = `${"log line ".repeat(90)}final result passed`;
		const artifactResult = await ledger.execute(
			"tool-ledger-artifact",
			{
				action: "recordArtifact",
				loopName: "Ledger_Loop",
				id: "a-test",
				kind: "test",
				command: "npm test --prefix agent/extensions -- private/stardock/index.test.ts",
				path: "artifacts/stardock-ledger-test.txt",
				summary: longSummary,
				criterionIds: ["c-build"],
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(artifactResult.content[0].text, /Recorded artifact a-test/);
		assert.equal(artifactResult.details.artifact.summary.length, 500);
		assert.equal(artifactResult.details.artifact.summary.endsWith("…"), true);
		assert.deepEqual(artifactResult.details.artifact.criterionIds, ["c-build"]);

		const baselineResult = await ledger.execute(
			"tool-ledger-baseline",
			{
				action: "recordBaseline",
				loopName: "Ledger_Loop",
				id: "bv-pre",
				command: "npm test --prefix agent/extensions -- private/stardock/index.test.ts",
				result: "failed",
				summary: "Baseline failed before implementation, proving red evidence.",
				criterionIds: ["c-build"],
				artifactIds: ["a-test"],
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(baselineResult.content[0].text, /Recorded baseline validation bv-pre/);
		assert.equal(baselineResult.details.baselineValidations[0].result, "failed");

		const listResult = await ledger.execute("tool-ledger-list", { action: "list", loopName: "Ledger_Loop" }, undefined, undefined, ctx);
		assert.match(listResult.content[0].text, /Criteria: 1 total, 1 passed/);
		assert.match(listResult.content[0].text, /Artifacts: 1 total/);
		assert.match(listResult.content[0].text, /Baseline validations: 1 total/);
		assert.match(listResult.content[0].text, /a-test \[test\]/);
		assert.match(listResult.content[0].text, /bv-pre \[failed\]/);
		assert.equal(listResult.content[0].text.includes(longSummary), false);

		const summaryResult = await stateTool.execute("tool-ledger-state", { loopName: "Ledger_Loop", includeDetails: true }, undefined, undefined, ctx);
		assert.match(summaryResult.content[0].text, /Criteria: 1 total, 1 passed/);
		assert.match(summaryResult.content[0].text, /Verification artifacts: 1/);
		assert.match(summaryResult.content[0].text, /Baseline validations: 1/);
		assert.equal(summaryResult.details.loop.criteria.passed, 1);
		assert.equal(summaryResult.details.loop.verificationArtifacts.total, 1);
		assert.equal(summaryResult.details.loop.baselineValidations.failed, 1);
		assert.equal(summaryResult.details.loop.criterionLedger.criteria[0].id, "c-build");
		assert.equal(summaryResult.details.loop.baselineValidations.total, 1);

		await done.execute("tool-ledger-done", {}, undefined, undefined, ctx);
		assert.equal(messages.length, 2);
		assert.equal(messages[1].content.includes("c-build"), false);
		assert.equal(messages[1].content.includes(longSummary), false);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("stardock_ledger distills task checklist items into criteria without rewriting the task", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-ledger-distill-test-"));
	try {
		const { tools, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const ledger = tools.get("stardock_ledger");
		assert.ok(start);
		assert.ok(ledger);

		const taskContent = `# Distill task

## Goals
- Keep this as context, not a criterion while checklist exists.

## Checklist
- [ ] Add deterministic criterion distillation.
- [ ] Preserve the canonical task file.
`;
		await start.execute(
			"tool-ledger-distill-start",
			{
				name: "Distill Loop",
				mode: "checklist",
				taskContent,
				maxIterations: 1,
			},
			undefined,
			undefined,
			ctx,
		);
		const taskFile = taskPath(cwd, "Distill_Loop");
		const before = fs.readFileSync(taskFile, "utf-8");

		const distill = await ledger.execute("tool-ledger-distill", { action: "distillTaskCriteria", loopName: "Distill_Loop" }, undefined, undefined, ctx);
		assert.match(distill.content[0].text, /Distilled 2 task criteria/);
		assert.equal(distill.details.criteria.length, 2);
		assert.equal(distill.details.criteria[0].id, "c-task-01");
		assert.equal(distill.details.criteria[0].description, "Add deterministic criterion distillation.");
		assert.match(distill.details.criteria[0].sourceRef, /\.stardock\/runs\/Distill_Loop\/task\.md:L/);
		assert.equal(distill.details.criteria[1].id, "c-task-02");
		assert.equal(distill.details.criteria[1].description, "Preserve the canonical task file.");
		assert.equal(fs.readFileSync(taskFile, "utf-8"), before);

		await ledger.execute("tool-ledger-distill-update", { action: "upsertCriterion", loopName: "Distill_Loop", id: "c-task-01", status: "passed", evidence: "Focused test passed." }, undefined, undefined, ctx);
		const redistill = await ledger.execute("tool-ledger-redistill", { action: "distillTaskCriteria", loopName: "Distill_Loop" }, undefined, undefined, ctx);
		assert.match(redistill.content[0].text, /Distilled 2 task criteria/);
		assert.equal(redistill.details.criteria[0].status, "passed");
		assert.equal(redistill.details.criteria[0].evidence, "Focused test passed.");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
