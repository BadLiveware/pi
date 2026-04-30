import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { makeHarness,statePath } from "./test-harness.ts";

test("stardock_breakout builds payloads and records compact decision packages", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { tools, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const stateTool = tools.get("stardock_state");
		const ledger = tools.get("stardock_ledger");
		const finalReport = tools.get("stardock_final_report");
		const auditor = tools.get("stardock_auditor");
		const handoff = tools.get("stardock_handoff");
		const govern = tools.get("stardock_govern");
		const breakout = tools.get("stardock_breakout");
		assert.ok(start);
		assert.ok(stateTool);
		assert.ok(ledger);
		assert.ok(finalReport);
		assert.ok(auditor);
		assert.ok(handoff);
		assert.ok(govern);
		assert.ok(breakout);

		await start.execute("tool-breakout-start", { name: "Breakout Loop", mode: "recursive", taskContent: "# Breakout task\n", objective: "Unstick a blocked loop", maxIterations: 3 }, undefined, undefined, ctx);
		const migratedState = JSON.parse(fs.readFileSync(statePath(cwd, "Breakout_Loop"), "utf-8"));
		delete migratedState.breakoutPackages;
		migratedState.modeState.attempts = [{ id: "ra1", iteration: 1, createdAt: "2026-01-01T00:00:00.000Z", status: "reported", result: "blocked", summary: "Attempt hit the same failure." }];
		fs.writeFileSync(statePath(cwd, "Breakout_Loop"), JSON.stringify(migratedState, null, 2), "utf-8");
		const defaulted = await stateTool.execute("tool-breakout-default-state", { loopName: "Breakout_Loop", includeDetails: true }, undefined, undefined, ctx);
		assert.deepEqual(defaulted.details.loop.breakoutPackages, []);

		await ledger.execute("tool-breakout-criterion", { action: "upsertCriterion", loopName: "Breakout_Loop", id: "c-blocked", description: "Resolve the blocking failure.", passCondition: "A decision identifies a safe resume path.", status: "blocked" }, undefined, undefined, ctx);
		await ledger.execute("tool-breakout-artifact", { action: "recordArtifact", loopName: "Breakout_Loop", id: "a-log", kind: "log", summary: `${"long failing log ".repeat(80)}done`, criterionIds: ["c-blocked"] }, undefined, undefined, ctx);
		await finalReport.execute("tool-breakout-final", { action: "record", loopName: "Breakout_Loop", id: "fr-gap", status: "partial", summary: "Validation remains blocked by missing decision.", criterionIds: ["c-blocked"], artifactIds: ["a-log"], unresolvedGaps: ["Need a user/governor choice before resuming."] }, undefined, undefined, ctx);
		await auditor.execute("tool-breakout-auditor", { action: "record", loopName: "Breakout_Loop", id: "ar-gap", status: "blocked", summary: "Auditor says completion would be premature.", criterionIds: ["c-blocked"], artifactIds: ["a-log"], finalReportIds: ["fr-gap"], focus: "Evidence gap" }, undefined, undefined, ctx);
		await handoff.execute("tool-breakout-handoff", { action: "record", loopName: "Breakout_Loop", id: "ah-gap", role: "reviewer", status: "answered", objective: "Review the blocked state.", summary: "Reviewer recommends narrowing scope.", criterionIds: ["c-blocked"], artifactIds: ["a-log"], finalReportIds: ["fr-gap"], resultSummary: "Narrow scope before continuing." }, undefined, undefined, ctx);
		await govern.execute("tool-breakout-govern", { loopName: "Breakout_Loop" }, undefined, undefined, ctx);

		const payload = await breakout.execute(
			"tool-breakout-payload",
			{
				action: "payload",
				loopName: "Breakout_Loop",
				status: "open",
				summary: "Loop is blocked after repeated validation failures.",
				blockedCriterionIds: ["c-blocked"],
				attemptIds: ["ra1"],
				artifactIds: ["a-log"],
				finalReportIds: ["fr-gap"],
				auditorReviewIds: ["ar-gap"],
				advisoryHandoffIds: ["ah-gap"],
				outsideRequestIds: ["governor-manual-1"],
				lastErrors: [`${"repeated error ".repeat(80)}done`],
				suspectedRootCauses: ["Scope is still too broad."],
				requestedDecision: "Choose resume, pivot, or stop.",
				resumeCriteria: ["A narrower next move is selected."],
				recommendedNextActions: ["Ask user to pick a scope boundary."],
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(payload.content[0].text, /Breakout package payload/);
		assert.match(payload.content[0].text, /Do not execute tools, call models, spawn agents, or apply edits/);
		assert.match(payload.content[0].text, /c-blocked \[blocked\]/);
		assert.match(payload.content[0].text, /a-log \[log\]/);
		assert.match(payload.content[0].text, /fr-gap \[partial\]/);
		assert.match(payload.content[0].text, /ar-gap \[blocked\]/);
		assert.match(payload.content[0].text, /ah-gap \[answered\/reviewer\]/);
		assert.match(payload.content[0].text, /governor-manual-1 \[requested\/governor_review\]/);
		assert.match(payload.content[0].text, /ra1 \[reported\/blocked\]/);
		assert.equal(payload.content[0].text.includes("long failing log ".repeat(20)), false);
		assert.equal(payload.content[0].text.includes("repeated error ".repeat(20)), false);

		const recorded = await breakout.execute(
			"tool-breakout-record",
			{
				action: "record",
				loopName: "Breakout_Loop",
				id: "bp-stuck",
				status: "open",
				summary: "Loop is blocked after repeated validation failures.",
				blockedCriterionIds: ["c-blocked"],
				attemptIds: ["ra1"],
				artifactIds: ["a-log"],
				finalReportIds: ["fr-gap"],
				auditorReviewIds: ["ar-gap"],
				advisoryHandoffIds: ["ah-gap"],
				outsideRequestIds: ["governor-manual-1"],
				lastErrors: [`${"recorded error ".repeat(80)}done`],
				suspectedRootCauses: ["Scope is still too broad."],
				requestedDecision: "Choose resume, pivot, or stop.",
				resumeCriteria: ["A narrower next move is selected."],
				recommendedNextActions: ["Ask user to pick a scope boundary."],
				includeState: true,
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(recorded.content[0].text, /Recorded breakout package bp-stuck/);
		assert.equal(recorded.details.breakout.lastErrors[0].length, 240);
		assert.equal(recorded.details.loop.breakoutPackages.length, 1);

		const listed = await breakout.execute("tool-breakout-list", { action: "list", loopName: "Breakout_Loop" }, undefined, undefined, ctx);
		assert.match(listed.content[0].text, /Packages: 1 total/);
		assert.match(listed.content[0].text, /bp-stuck \[open\]/);

		const missingPayload = await breakout.execute("tool-breakout-missing-payload", { action: "payload", loopName: "Breakout_Loop", artifactIds: ["missing-artifact"] }, undefined, undefined, ctx);
		assert.match(missingPayload.content[0].text, /Artifact "missing-artifact" not found/);
		const missingRecord = await breakout.execute("tool-breakout-missing-record", { action: "record", loopName: "Breakout_Loop", summary: "bad refs", advisoryHandoffIds: ["missing-handoff"] }, undefined, undefined, ctx);
		assert.match(missingRecord.content[0].text, /Advisory handoff "missing-handoff" not found/);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
