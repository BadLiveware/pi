import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { makeHarness, statePath } from "./test-harness.ts";

async function startLoop(name: string) {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	const harness = makeHarness(cwd);
	const start = harness.tools.get("stardock_start");
	assert.ok(start);
	await start.execute(`start-${name}`, { name, mode: "checklist", taskContent: `# ${name}\n`, maxIterations: 3 }, undefined, undefined, harness.ctx);
	return { cwd, ...harness };
}

test("stardock_policy recommends a final report when evidence exists without one", async () => {
	const { cwd, tools, ctx } = await startLoop("Policy Missing Final");
	try {
		const ledger = tools.get("stardock_ledger");
		const policy = tools.get("stardock_policy");
		assert.ok(ledger);
		assert.ok(policy);
		await ledger.execute("criteria", { action: "upsertCriterion", loopName: "Policy_Missing_Final", id: "c-ready", description: "Feature works.", passCondition: "Evidence exists.", status: "passed" }, undefined, undefined, ctx);
		await ledger.execute("artifact", { action: "recordArtifact", loopName: "Policy_Missing_Final", id: "a-test", kind: "test", summary: "Focused test passed.", criterionIds: ["c-ready"] }, undefined, undefined, ctx);

		const before = fs.readFileSync(statePath(cwd, "Policy_Missing_Final"), "utf-8");
		const result = await policy.execute("policy", { action: "completion", loopName: "Policy_Missing_Final" }, undefined, undefined, ctx);
		const after = fs.readFileSync(statePath(cwd, "Policy_Missing_Final"), "utf-8");
		assert.equal(after, before);
		assert.equal(result.details.policy.ready, false);
		assert.equal(result.details.policy.status, "needs_evidence");
		assert.match(result.content[0].text, /missing-final-report/);
		assert.match(result.content[0].text, /Suggested tool: stardock_final_report/);
		assert.deepEqual(result.details.policy.findings.find((finding: any) => finding.id === "missing-final-report").criterionIds, ["c-ready"]);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("stardock_policy recommends breakout packaging for unresolved criteria", async () => {
	const { cwd, tools, ctx } = await startLoop("Policy Breakout");
	try {
		const ledger = tools.get("stardock_ledger");
		const policy = tools.get("stardock_policy");
		assert.ok(ledger);
		assert.ok(policy);
		await ledger.execute("criteria", { action: "upsertCriteria", loopName: "Policy_Breakout", criteria: [{ id: "c-blocked", description: "Blocked work", passCondition: "Decision made.", status: "blocked" }, { id: "c-pending", description: "Pending work", passCondition: "Done.", status: "pending" }] }, undefined, undefined, ctx);

		const result = await policy.execute("policy", { action: "completion", loopName: "Policy_Breakout" }, undefined, undefined, ctx);
		assert.equal(result.details.policy.ready, false);
		assert.equal(result.details.policy.status, "needs_decision");
		assert.match(result.content[0].text, /unresolved-criteria/);
		assert.match(result.content[0].text, /Suggested tool: stardock_breakout/);
		assert.deepEqual(result.details.policy.findings.find((finding: any) => finding.id === "unresolved-criteria").criterionIds, ["c-blocked", "c-pending"]);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("stardock_policy recommends auditor review for skipped evidence and report gaps", async () => {
	const { cwd, tools, ctx } = await startLoop("Policy Auditor");
	try {
		const ledger = tools.get("stardock_ledger");
		const finalReport = tools.get("stardock_final_report");
		const policy = tools.get("stardock_policy");
		assert.ok(ledger);
		assert.ok(finalReport);
		assert.ok(policy);
		await ledger.execute("criteria", { action: "upsertCriteria", loopName: "Policy_Auditor", criteria: [{ id: "c-skipped", description: "Skipped check", passCondition: "Reviewed.", status: "skipped" }, { id: "c-pass", description: "Passing check", passCondition: "Passed.", status: "passed" }] }, undefined, undefined, ctx);
		await finalReport.execute("report", { action: "record", loopName: "Policy_Auditor", id: "fr-gap", status: "passed", summary: "Passed with an explicit gap.", criterionIds: ["c-pass"], unresolvedGaps: ["Skipped check needs review."] }, undefined, undefined, ctx);

		const result = await policy.execute("policy", { action: "completion", loopName: "Policy_Auditor" }, undefined, undefined, ctx);
		assert.equal(result.details.policy.ready, false);
		assert.equal(result.details.policy.status, "needs_review");
		assert.match(result.content[0].text, /needs-auditor-review/);
		assert.match(result.content[0].text, /Suggested tool: stardock_auditor/);
		const finding = result.details.policy.findings.find((item: any) => item.id === "needs-auditor-review");
		assert.deepEqual(finding.criterionIds, ["c-skipped"]);
		assert.deepEqual(finding.finalReportIds, ["fr-gap"]);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("stardock_policy reports ready when criteria and evidence are complete", async () => {
	const { cwd, tools, ctx } = await startLoop("Policy Ready");
	try {
		const ledger = tools.get("stardock_ledger");
		const finalReport = tools.get("stardock_final_report");
		const policy = tools.get("stardock_policy");
		assert.ok(ledger);
		assert.ok(finalReport);
		assert.ok(policy);
		await ledger.execute("criteria", { action: "upsertCriterion", loopName: "Policy_Ready", id: "c-pass", description: "Work complete.", passCondition: "Evidence exists.", status: "passed" }, undefined, undefined, ctx);
		await ledger.execute("artifact", { action: "recordArtifact", loopName: "Policy_Ready", id: "a-test", kind: "test", summary: "All tests pass.", criterionIds: ["c-pass"] }, undefined, undefined, ctx);
		await finalReport.execute("report", { action: "record", loopName: "Policy_Ready", id: "fr-pass", status: "passed", summary: "Completion evidence is sufficient.", criterionIds: ["c-pass"], artifactIds: ["a-test"], validation: [{ result: "passed", summary: "All checks passed.", artifactIds: ["a-test"] }] }, undefined, undefined, ctx);

		const result = await policy.execute("policy", { action: "completion", loopName: "Policy_Ready" }, undefined, undefined, ctx);
		assert.equal(result.details.policy.ready, true);
		assert.equal(result.details.policy.status, "ready");
		assert.match(result.content[0].text, /completion-ready/);
		assert.match(result.content[0].text, /recommendations are advisory/);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("stardock_policy recommends auditor review for risky worker reports", async () => {
	const { cwd, tools, ctx } = await startLoop("Policy Worker Auditor");
	try {
		const ledger = tools.get("stardock_ledger");
		const worker = tools.get("stardock_worker_report");
		const policy = tools.get("stardock_policy");
		assert.ok(ledger);
		assert.ok(worker);
		assert.ok(policy);
		await ledger.execute("criteria", { action: "upsertCriterion", loopName: "Policy_Worker_Auditor", id: "c-worker", description: "Worker result needs review.", passCondition: "Parent reviews hinted file.", status: "passed" }, undefined, undefined, ctx);
		await ledger.execute("artifact", { action: "recordArtifact", loopName: "Policy_Worker_Auditor", id: "a-worker", kind: "log", summary: "Worker transcript path.", criterionIds: ["c-worker"] }, undefined, undefined, ctx);
		await worker.execute("worker", { action: "record", loopName: "Policy_Worker_Auditor", id: "wr-risk", status: "needs_review", role: "reviewer", objective: "Review risky change.", summary: "Worker found a risk.", evaluatedCriterionIds: ["c-worker"], artifactIds: ["a-worker"], validation: [{ result: "skipped", summary: "Worker skipped validation.", artifactIds: ["a-worker"] }], risks: ["Potential contract drift."], openQuestions: ["Should parent inspect file?"], reviewHints: ["Read changed file before accepting."] }, undefined, undefined, ctx);

		const result = await policy.execute("policy", { action: "auditor", loopName: "Policy_Worker_Auditor" }, undefined, undefined, ctx);
		assert.equal(result.details.policy.recommended, true);
		assert.equal(result.details.policy.status, "review_recommended");
		assert.match(result.content[0].text, /worker-report-review/);
		assert.match(result.content[0].text, /Suggested tool: stardock_auditor/);
		assert.match(result.content[0].text, /workerReports=wr-risk/);
		assert.match(result.content[0].text, /does not create auditor reviews/);
		const finding = result.details.policy.findings.find((item: any) => item.id === "worker-report-review");
		assert.deepEqual(finding.workerReportIds, ["wr-risk"]);
		assert.deepEqual(finding.artifactIds, ["a-worker"]);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("stardock_policy recommends auditor review for automation and breakout gates", async () => {
	const { cwd, tools, ctx } = await startLoop("Policy Gate Auditor");
	try {
		const handoff = tools.get("stardock_handoff");
		const breakout = tools.get("stardock_breakout");
		const policy = tools.get("stardock_policy");
		assert.ok(handoff);
		assert.ok(breakout);
		assert.ok(policy);
		await handoff.execute("handoff", { action: "record", loopName: "Policy_Gate_Auditor", id: "ah-impl", role: "implementer", status: "answered", objective: "Implement a risky patch.", summary: "Implementer returned patch guidance." }, undefined, undefined, ctx);
		await breakout.execute("breakout", { action: "record", loopName: "Policy_Gate_Auditor", id: "bp-open", status: "open", summary: "Loop needs a decision.", requestedDecision: "Decide whether to continue." }, undefined, undefined, ctx);

		const result = await policy.execute("policy", { action: "auditor", loopName: "Policy_Gate_Auditor" }, undefined, undefined, ctx);
		assert.equal(result.details.policy.recommended, true);
		assert.equal(result.details.policy.status, "review_strongly_recommended");
		assert.match(result.content[0].text, /automation-gate-review/);
		assert.match(result.content[0].text, /open-breakout-review/);
		assert.match(result.content[0].text, /advisoryHandoffs=ah-impl/);
		assert.match(result.content[0].text, /breakoutPackages=bp-open/);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("stardock_policy reports no auditor trigger for clean evidence", async () => {
	const { cwd, tools, ctx } = await startLoop("Policy Auditor Clean");
	try {
		const ledger = tools.get("stardock_ledger");
		const finalReport = tools.get("stardock_final_report");
		const policy = tools.get("stardock_policy");
		assert.ok(ledger);
		assert.ok(finalReport);
		assert.ok(policy);
		await ledger.execute("criteria", { action: "upsertCriterion", loopName: "Policy_Auditor_Clean", id: "c-pass", description: "Clean check", passCondition: "Passed.", status: "passed" }, undefined, undefined, ctx);
		await finalReport.execute("report", { action: "record", loopName: "Policy_Auditor_Clean", id: "fr-pass", status: "passed", summary: "Clean evidence.", criterionIds: ["c-pass"], validation: [{ result: "passed", summary: "All checks passed." }] }, undefined, undefined, ctx);

		const result = await policy.execute("policy", { action: "auditor", loopName: "Policy_Auditor_Clean" }, undefined, undefined, ctx);
		assert.equal(result.details.policy.recommended, false);
		assert.equal(result.details.policy.status, "no_review_needed");
		assert.match(result.content[0].text, /no-auditor-trigger/);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
