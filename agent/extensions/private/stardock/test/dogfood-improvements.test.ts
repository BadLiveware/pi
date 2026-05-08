import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { promqlClickHouseDogfood } from "./fixtures/promql-clickhouse-dogfood.ts";
import { makeHarness } from "./test-harness.ts";

async function startLoop(name: string) {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-dogfood-test-"));
	const harness = makeHarness(cwd);
	const start = harness.tools.get("stardock_start");
	assert.ok(start);
	await start.execute("start-dogfood", { name, mode: "checklist", taskContent: `# ${name}\n`, maxIterations: 3 }, undefined, undefined, harness.ctx);
	return { cwd, ...harness };
}

test("dogfood evidence/status language records canonical Stardock state", async () => {
	const { cwd, tools, ctx } = await startLoop("Dogfood Enum Friction");
	try {
		const ledger = tools.get("stardock_ledger");
		const finalReport = tools.get("stardock_final_report");
		const breakout = tools.get("stardock_breakout");
		assert.ok(ledger);
		assert.ok(finalReport);
		assert.ok(breakout);

		await ledger.execute("criterion", { action: "upsertCriterion", loopName: "Dogfood_Enum_Friction", id: "c-one", description: "Record evidence aliases.", passCondition: "Aliases store canonical values.", status: "blocked" }, undefined, undefined, ctx);
		const artifactKinds = promqlClickHouseDogfood.enumFriction.artifactKinds;
		const artifacts = await ledger.execute(
			"artifacts",
			{
				action: "recordArtifacts",
				loopName: "Dogfood_Enum_Friction",
				artifacts: artifactKinds.map((kind) => ({ id: `a-${kind}`, kind, summary: `Dogfood ${kind} evidence.`, criterionIds: ["c-one"] })),
			},
			undefined,
			undefined,
			ctx,
		);
		assert.deepEqual(artifacts.details.artifacts.map((artifact: any) => artifact.kind), ["url", "other", "diff", "pr", "document", "command"]);

		const blockedReport = await finalReport.execute("blocked-report", { action: "record", loopName: "Dogfood_Enum_Friction", id: "fr-blocked", status: promqlClickHouseDogfood.enumFriction.finalReportStatuses[0], summary: "Blocked report is explicit.", criterionIds: ["c-one"] }, undefined, undefined, ctx);
		assert.equal(blockedReport.details.report.status, "blocked");
		const skippedReport = await finalReport.execute("skipped-report", { action: "record", loopName: "Dogfood_Enum_Friction", id: "fr-skipped", status: promqlClickHouseDogfood.enumFriction.finalReportStatuses[1], summary: "Skipped report is explicit.", criterionIds: ["c-one"] }, undefined, undefined, ctx);
		assert.equal(skippedReport.details.report.status, "skipped");

		const breakoutResult = await breakout.execute("blocked-breakout", { action: "record", loopName: "Dogfood_Enum_Friction", id: "bp-blocked", status: promqlClickHouseDogfood.enumFriction.breakoutStatusAlias, summary: "Blocked package should be open.", blockedCriterionIds: ["c-one"], requestedDecision: "Decide how to proceed." }, undefined, undefined, ctx);
		assert.equal(breakoutResult.details.breakout.status, "open");
		assert.deepEqual(breakoutResult.details.normalizedStatus, { from: "blocked", to: "open" });

		const badArtifact = await ledger.execute("bad-artifact", { action: "recordArtifact", loopName: "Dogfood_Enum_Friction", id: "a-bad", kind: "unknown-kind", summary: "Should fail clearly." }, undefined, undefined, ctx);
		assert.match(badArtifact.content[0].text, /Unsupported verification artifact kind/);
		const badReport = await finalReport.execute("bad-report", { action: "record", loopName: "Dogfood_Enum_Friction", id: "fr-bad", status: "waiting", summary: "Should fail clearly.", criterionIds: ["c-one"] }, undefined, undefined, ctx);
		assert.match(badReport.content[0].text, /Unsupported final verification status/);
		const badBreakout = await breakout.execute("bad-breakout", { action: "record", loopName: "Dogfood_Enum_Friction", id: "bp-bad", status: "waiting", summary: "Should fail clearly." }, undefined, undefined, ctx);
		assert.match(badBreakout.content[0].text, /Unsupported breakout package status/);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("completion policy accepts explicitly deferred dogfood blockers", async () => {
	const { cwd, tools, ctx } = await startLoop("Dogfood Accepted Blocker");
	try {
		const ledger = tools.get("stardock_ledger");
		const finalReport = tools.get("stardock_final_report");
		const breakout = tools.get("stardock_breakout");
		const auditor = tools.get("stardock_auditor");
		const policy = tools.get("stardock_policy");
		assert.ok(ledger);
		assert.ok(finalReport);
		assert.ok(breakout);
		assert.ok(auditor);
		assert.ok(policy);

		const ids = promqlClickHouseDogfood.acceptedDeferredCriterion;
		await ledger.execute("criteria", { action: "upsertCriteria", loopName: "Dogfood_Accepted_Blocker", criteria: [{ id: "c-done", description: "Non-histogram work is complete.", passCondition: "Evidence exists.", status: "passed" }, { id: ids.criterionId, description: "Native histogram prototype is gated.", passCondition: "Design agreement exists before prototype work starts.", status: "blocked" }] }, undefined, undefined, ctx);
		await ledger.execute("artifact", { action: "recordArtifact", loopName: "Dogfood_Accepted_Blocker", id: "a-pr15", kind: "document", summary: "PR15 deferred until native histogram design agreement.", criterionIds: [ids.criterionId] }, undefined, undefined, ctx);
		await finalReport.execute("done-report", { action: "record", loopName: "Dogfood_Accepted_Blocker", id: "fr-done", status: "passed", summary: "Completed non-histogram work has sufficient evidence.", criterionIds: ["c-done"], validation: [{ result: "passed", summary: "Final self-assurance passed." }] }, undefined, undefined, ctx);
		await finalReport.execute("blocked-report", { action: "record", loopName: "Dogfood_Accepted_Blocker", id: ids.finalReportId, status: "passed", summary: "PR15 was intentionally deferred until design agreement exists.", criterionIds: [ids.criterionId], artifactIds: ["a-pr15"], validation: [{ result: "passed", summary: "Confirmed no prototype branch exists.", artifactIds: ["a-pr15"] }], unresolvedGaps: ["Native histogram design agreement is still missing."] }, undefined, undefined, ctx);
		await breakout.execute("breakout", { action: "record", loopName: "Dogfood_Accepted_Blocker", id: ids.breakoutPackageId, status: "resolved", summary: "PR15 remains deferred pending design agreement.", blockedCriterionIds: [ids.criterionId], artifactIds: ["a-pr15"], finalReportIds: [ids.finalReportId], requestedDecision: "Keep PR15 deferred until native histogram representation and prototype boundary are agreed.", recommendedNextActions: ["Use discovery docs as the design handoff."] }, undefined, undefined, ctx);
		await auditor.execute("auditor", { action: "record", loopName: "Dogfood_Accepted_Blocker", id: ids.auditorReviewId, status: "passed", summary: "Accepted final status and PR15 deferral packaging.", criterionIds: [ids.criterionId], artifactIds: ["a-pr15"], finalReportIds: [ids.finalReportId], focus: "Accepted deferred blocker review" }, undefined, undefined, ctx);

		const result = await policy.execute("policy", { action: "completion", loopName: "Dogfood_Accepted_Blocker" }, undefined, undefined, ctx);
		assert.equal(result.details.policy.ready, true);
		assert.equal(result.details.policy.status, ids.expectedCompletionStatus);
		assert.match(result.content[0].text, /accepted-deferred-criteria/);
		assert.doesNotMatch(result.content[0].text, /unresolved-criteria/);
		assert.doesNotMatch(result.content[0].text, /needs-auditor-review/);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
