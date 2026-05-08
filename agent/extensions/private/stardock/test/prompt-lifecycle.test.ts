import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { makeHarness,statePath } from "./test-harness.ts";

test("unsupported mode does not create a loop", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { tools, commands, messages, notifications, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		assert.ok(start);

		const toolResult = await start.execute(
			"tool-unsupported",
			{
				name: "Evolve Loop",
				mode: "evolve",
				taskContent: "# Task\n",
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(toolResult.content[0].text, /planned but not implemented/);
		assert.equal(messages.length, 0);
		assert.equal(fs.existsSync(statePath(cwd, "Evolve_Loop")), false);

		const stardock = commands.get("stardock");
		assert.ok(stardock);
		await stardock.handler("start cmd-evolve --mode evolve", ctx);
		assert.ok(notifications.some((message) => message.includes('Stardock mode "evolve" is planned but not implemented yet.')));
		assert.equal(fs.existsSync(statePath(cwd, "cmd-evolve")), false);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("checklist prompt includes ledger summary when brief has linked criteria", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { tools, messages, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const ledger = tools.get("stardock_ledger");
		const brief = tools.get("stardock_brief");
		const done = tools.get("stardock_done");
		assert.ok(start);
		assert.ok(ledger);
		assert.ok(brief);
		assert.ok(done);

		await start.execute("tool-start", {
			name: "Ledger_Summary_Loop",
			mode: "checklist",
			taskContent: "# Task\n\n## Checklist\n- [ ] Test criteria in prompt\n",
			maxIterations: 3,
		}, undefined, undefined, ctx);

		// Add two criteria
		await ledger.execute("tool-c1", { action: "upsertCriterion", loopName: "Ledger_Summary_Loop", id: "c-summary-01", description: "First criterion", passCondition: "Tests pass", status: "pending" }, undefined, undefined, ctx);
		await ledger.execute("tool-c2", { action: "upsertCriterion", loopName: "Ledger_Summary_Loop", id: "c-summary-02", description: "Second criterion", passCondition: "Coverage ok", status: "pending" }, undefined, undefined, ctx);

		// Advance to iteration 2 (the first prompt after iteration 1)
		const doneResult = await done.execute("tool-done", {}, undefined, undefined, ctx);
		assert.match(doneResult.content[0].text, /Iteration 1 complete/);

		// Iteration 2 prompt should have no criteria section (no brief)
		assert.equal(messages.length, 2);
		assert.match(messages[1].content, /No active brief/);

		// Create a brief linking the two criteria
		await brief.execute("tool-brief", {
			action: "upsert",
			loopName: "Ledger_Summary_Loop",
			id: "b-summary",
			objective: "Test ledger summary",
			task: "Verify criteria appear in the prompt",
			criterionIds: ["c-summary-01", "c-summary-02"],
			activate: true,
		}, undefined, undefined, ctx);

		// Advance again — iteration 3 prompt should include criteria
		const done2 = await done.execute("tool-done2", {}, undefined, undefined, ctx);
		assert.match(done2.content[0].text, /Iteration 2 complete/);

		// Iteration 3 prompt should have criteria section
		assert.equal(messages.length, 3);
		const prompt3 = messages[2].content;
		assert.match(prompt3, /## Criteria/);
		assert.match(prompt3, /c-summary-01/);
		assert.match(prompt3, /c-summary-02/);
		assert.match(prompt3, /First criterion/);
		assert.match(prompt3, /Second criterion/);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("ledger summary without brief omits passed criteria", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { tools, messages, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const ledger = tools.get("stardock_ledger");
		const done = tools.get("stardock_done");
		assert.ok(start);
		assert.ok(ledger);
		assert.ok(done);

		await start.execute("tool-start", {
			name: "Filtered_Ledger_Loop",
			mode: "checklist",
			taskContent: "# Task\n\n## Checklist\n- [ ] Test criteria filtering\n",
			maxIterations: 3,
		}, undefined, undefined, ctx);

		// Add one passed and one pending criterion
		await ledger.execute("tool-c1", { action: "upsertCriterion", loopName: "Filtered_Ledger_Loop", id: "c-filter-01", description: "Passed criterion", passCondition: "Done", status: "passed" }, undefined, undefined, ctx);
		await ledger.execute("tool-c2", { action: "upsertCriterion", loopName: "Filtered_Ledger_Loop", id: "c-filter-02", description: "Pending criterion", passCondition: "Not done", status: "pending" }, undefined, undefined, ctx);

		// Advance to iteration 2
		await done.execute("tool-done", {}, undefined, undefined, ctx);
		assert.equal(messages.length, 2);

		// Without a brief, only pending/failed/blocked criteria should appear
		const promptText = messages[1].content;
		assert.match(promptText, /## Criteria/);
		assert.match(promptText, /Pending criterion/);
		assert.equal(promptText.includes("Passed criterion"), false, "passed criteria should be omitted when no brief is active");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("recursive prompt without brief shows reference-only task source", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { tools, messages, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		assert.ok(start);

		await start.execute("tool-start", {
			name: "Recursive_Task_Source_Loop",
			mode: "recursive",
			objective: "Improve search ranking",
			taskContent: "# Recursive task\n\nBackground context for the recursive loop.\n",
			maxIterations: 3,
		}, undefined, undefined, ctx);

		assert.equal(messages.length, 1);
		const promptText = messages[0].content;
		// Should NOT show "No active brief" checklist guidance
		assert.equal(promptText.includes("No active brief"), false, "recursive mode should not show checklist brief guidance");
		// Should show reference-only task source
		assert.match(promptText, /reference only/);
		// Should reference the recursive objective
		assert.match(promptText, /recursive objective/);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
