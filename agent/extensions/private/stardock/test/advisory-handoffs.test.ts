import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { makeHarness,statePath } from "./test-harness.ts";

test("stardock_handoff builds provider-neutral payloads and records compact results", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { tools, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const ledger = tools.get("stardock_ledger");
		const finalReport = tools.get("stardock_final_report");
		const handoff = tools.get("stardock_handoff");
		const stateTool = tools.get("stardock_state");
		assert.ok(start);
		assert.ok(ledger);
		assert.ok(finalReport);
		assert.ok(handoff);
		assert.ok(stateTool);

		await start.execute("tool-handoff-start", { name: "Handoff Loop", mode: "checklist", taskContent: "# Handoff task\n", maxIterations: 3 }, undefined, undefined, ctx);
		const migratedState = JSON.parse(fs.readFileSync(statePath(cwd, "Handoff_Loop"), "utf-8"));
		delete migratedState.advisoryHandoffs;
		fs.writeFileSync(statePath(cwd, "Handoff_Loop"), JSON.stringify(migratedState, null, 2), "utf-8");
		const defaulted = await stateTool.execute("tool-handoff-default-state", { loopName: "Handoff_Loop", includeDetails: true }, undefined, undefined, ctx);
		assert.deepEqual(defaulted.details.loop.advisoryHandoffs, []);

		await ledger.execute("tool-handoff-criteria", { action: "upsertCriterion", loopName: "Handoff_Loop", id: "c-map", description: "Map risky files.", passCondition: "Explorer reports files and risks.", status: "pending" }, undefined, undefined, ctx);
		await ledger.execute("tool-handoff-artifact", { action: "recordArtifact", loopName: "Handoff_Loop", id: "a-context", kind: "log", summary: `${"large transcript ".repeat(80)}done`, criterionIds: ["c-map"] }, undefined, undefined, ctx);
		await finalReport.execute("tool-handoff-final", { action: "record", loopName: "Handoff_Loop", id: "fr-context", status: "partial", summary: "Context report for advisory handoff.", criterionIds: ["c-map"], artifactIds: ["a-context"], unresolvedGaps: ["Need independent file map."] }, undefined, undefined, ctx);

		const payload = await handoff.execute(
			"tool-handoff-payload",
			{
				action: "payload",
				loopName: "Handoff_Loop",
				role: "explorer",
				objective: "Identify likely files and tests for this change without editing.",
				criterionIds: ["c-map"],
				artifactIds: ["a-context"],
				finalReportIds: ["fr-context"],
				contextRefs: ["agent/extensions/private/stardock/src"],
				constraints: ["Do not edit files."],
				requestedOutput: "Return files, risks, tests, and gaps.",
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(payload.content[0].text, /Provider-neutral contract/);
		assert.match(payload.content[0].text, /Execute it with any appropriate human, agent, model, CLI, or future adapter/);
		assert.match(payload.content[0].text, /Role: explorer/);
		assert.match(payload.content[0].text, /c-map \[pending\]/);
		assert.match(payload.content[0].text, /a-context \[log\]/);
		assert.match(payload.content[0].text, /fr-context \[partial\]/);
		assert.equal(payload.content[0].text.includes("large transcript ".repeat(20)), false);

		const recorded = await handoff.execute(
			"tool-handoff-record",
			{
				action: "record",
				loopName: "Handoff_Loop",
				id: "ah-explorer",
				role: "explorer",
				status: "answered",
				objective: "Identify likely files and tests for this change without editing.",
				summary: "Explorer handoff for file/test mapping.",
				criterionIds: ["c-map"],
				artifactIds: ["a-context"],
				finalReportIds: ["fr-context"],
				contextRefs: ["agent/extensions/private/stardock/src"],
				constraints: ["Do not edit files."],
				requestedOutput: "Return files, risks, tests, and gaps.",
				provider: { implementation: "example-runner", sessionId: "opaque-session", nested: { retained: true } },
				resultSummary: `${"result summary ".repeat(80)}done`,
				concerns: ["Provider output mentioned a missing test."],
				recommendations: ["Read the named files before editing."],
				artifactRefs: ["/tmp/provider-transcript.txt"],
				includeState: true,
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(recorded.content[0].text, /Recorded advisory handoff ah-explorer/);
		assert.equal(recorded.details.handoff.provider.implementation, "example-runner");
		assert.equal(recorded.details.handoff.provider.sessionId, "opaque-session");
		assert.equal(recorded.details.handoff.resultSummary.length, 500);
		assert.equal(recorded.details.loop.advisoryHandoffs.length, 1);

		const listed = await handoff.execute("tool-handoff-list", { action: "list", loopName: "Handoff_Loop" }, undefined, undefined, ctx);
		assert.match(listed.content[0].text, /Handoffs: 1 total/);
		assert.match(listed.content[0].text, /ah-explorer \[answered\/explorer\]/);

		const missingPayload = await handoff.execute("tool-handoff-missing-payload", { action: "payload", loopName: "Handoff_Loop", objective: "bad payload refs", artifactIds: ["missing-artifact"] }, undefined, undefined, ctx);
		assert.match(missingPayload.content[0].text, /Artifact "missing-artifact" not found/);

		const missing = await handoff.execute("tool-handoff-missing", { action: "record", loopName: "Handoff_Loop", objective: "bad refs", criterionIds: ["missing"] }, undefined, undefined, ctx);
		assert.match(missing.content[0].text, /Criterion "missing" not found/);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
