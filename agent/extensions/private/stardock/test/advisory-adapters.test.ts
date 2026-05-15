import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { makeHarness } from "./test-harness.ts";

test("stardock_advisory_adapter builds parent-owned explorer and test-runner invocations", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-adapter-test-"));
	try {
		const { tools, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const ledger = tools.get("stardock_ledger");
		const brief = tools.get("stardock_brief");
		const adapter = tools.get("stardock_advisory_adapter");
		assert.ok(start);
		assert.ok(ledger);
		assert.ok(brief);
		assert.ok(adapter);

		await start.execute("tool-adapter-start", { name: "Adapter Payload", mode: "checklist", taskContent: "# Adapter task\n", maxIterations: 3 }, undefined, undefined, ctx);
		await ledger.execute("tool-adapter-criterion", { action: "upsertCriterion", loopName: "Adapter_Payload", id: "c-adapter", description: "Adapter payload is provider neutral.", passCondition: "Suggested invocation is parent-owned and advisory.", testMethod: "Inspect payload output." }, undefined, undefined, ctx);
		await brief.execute("tool-adapter-brief", { action: "upsert", loopName: "Adapter_Payload", id: "b-adapter", objective: "Prepare advisory worker.", task: "Map files and validation for the next bounded move.", criterionIds: ["c-adapter"], verificationRequired: ["Run focused Stardock tests."], constraints: ["No provider execution inside Stardock."], avoid: ["Do not edit files."], activate: true }, undefined, undefined, ctx);

		const explorer = await adapter.execute("tool-adapter-explorer", { action: "payload", loopName: "Adapter_Payload", role: "explorer" }, undefined, undefined, ctx);
		assert.match(explorer.content[0].text, /Parent-owned explorer adapter payload/);
		assert.match(explorer.content[0].text, /Stardock does not execute it/);
		assert.match(explorer.content[0].text, /"agent": "scout"/);
		assert.match(explorer.content[0].text, /Adapter role: explorer/);
		assert.match(explorer.content[0].text, /Do not edit files, run broad validation, spawn agents, or change Stardock state/);
		assert.equal(explorer.details.invocation.cwd, cwd);
		assert.equal(Object.hasOwn(explorer.details.invocation, "output"), false);

		const testRunner = await adapter.execute("tool-adapter-test-runner", { action: "payload", loopName: "Adapter_Payload", role: "test_runner", agentName: "delegate", model: "test/worker-model", thinking: "high", context: "fork" }, undefined, undefined, ctx);
		assert.match(testRunner.content[0].text, /Parent-owned test_runner adapter payload/);
		assert.match(testRunner.content[0].text, /"agent": "delegate"/);
		assert.match(testRunner.content[0].text, /"model": "test\/worker-model:high"/);
		assert.match(testRunner.content[0].text, /"context": "fork"/);
		assert.equal(testRunner.details.invocation.model, "test/worker-model:high");
		assert.match(testRunner.content[0].text, /Adapter role: test_runner/);
		assert.match(testRunner.content[0].text, /Run only bounded validation commands/);
		assert.match(testRunner.content[0].text, /stardock_ledger recordArtifact\(s\)/);
		assert.match(testRunner.content[0].text, /c-adapter \[pending\]/);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
