import * as assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateWorkflowStatus } from "../src/workflow-status.ts";
import { defaultCriterionLedger } from "../src/state/migration.ts";
import { defaultModeState } from "../src/state/modes.ts";
import type { LoopState } from "../src/state/core.ts";

function baseState(overrides: Partial<LoopState> = {}): LoopState {
	return {
		schemaVersion: 3,
		name: "Workflow_Status",
		taskFile: ".stardock/runs/Workflow_Status/task.md",
		mode: "checklist",
		iteration: 1,
		maxIterations: 5,
		itemsPerIteration: 0,
		reflectEvery: 0,
		reflectInstructions: "",
		active: true,
		status: "active",
		startedAt: "2026-05-08T00:00:00.000Z",
		lastReflectionAt: 0,
		modeState: defaultModeState("checklist"),
		outsideRequests: [],
		criterionLedger: defaultCriterionLedger(),
		verificationArtifacts: [],
		baselineValidations: [],
		briefs: [],
		finalVerificationReports: [],
		auditorReviews: [],
		advisoryHandoffs: [],
		breakoutPackages: [],
		workerReports: [],
		...overrides,
	};
}

function criterion(status: "pending" | "passed" | "failed" | "skipped" | "blocked") {
	return { id: `c-${status}`, status, description: `${status} criterion`, passCondition: "condition", createdAt: "2026-05-08T00:00:00.000Z", updatedAt: "2026-05-08T00:00:00.000Z" };
}

test("workflow status is ready for clean checklist work", () => {
	const status = evaluateWorkflowStatus(baseState());
	assert.equal(status.state, "ready_for_work");
	assert.equal(status.severity, "info");
});

test("workflow status surfaces parent review for risky worker reports", () => {
	const status = evaluateWorkflowStatus(baseState({
		workerReports: [{ id: "wr1", status: "needs_review", role: "explorer", objective: "map files", summary: "found risk", advisoryHandoffIds: [], evaluatedCriterionIds: [], artifactIds: [], changedFiles: [], validation: [], risks: ["ambiguous file ownership"], openQuestions: [], reviewHints: ["Inspect parser.ts"], createdAt: "2026-05-08T00:00:00.000Z", updatedAt: "2026-05-08T00:00:00.000Z" }],
	}));
	assert.equal(status.state, "needs_parent_review");
	assert.equal(status.recommendedActions[0].tool, "stardock_policy");
	assert.equal(status.recommendedActions[0].args?.action, "parentReview");
});

test("workflow status surfaces auditor blockers before other work", () => {
	const status = evaluateWorkflowStatus(baseState({
		auditorReviews: [{ id: "ar1", status: "blocked", summary: "blocked", focus: "gate", criterionIds: [], artifactIds: [], finalReportIds: [], concerns: ["unsafe"], recommendations: [], requiredFollowups: ["ask user"], createdAt: "2026-05-08T00:00:00.000Z", updatedAt: "2026-05-08T00:00:00.000Z" }],
	}));
	assert.equal(status.state, "needs_auditor_review");
	assert.equal(status.severity, "blocked");
});

test("workflow status surfaces breakout decisions for unresolved criteria", () => {
	const state = baseState({ criterionLedger: { criteria: [criterion("failed")], requirementTrace: [] } });
	const status = evaluateWorkflowStatus(state);
	assert.equal(status.state, "needs_breakout_decision");
	assert.equal(status.recommendedActions[0].args?.action, "breakout");
});

test("workflow status surfaces final verification readiness", () => {
	const state = baseState({ criterionLedger: { criteria: [criterion("passed")], requirementTrace: [] } });
	const status = evaluateWorkflowStatus(state);
	assert.equal(status.state, "ready_for_final_verification");
	assert.equal(status.recommendedActions[0].tool, "stardock_final_report");
});

test("workflow status reports ready to complete after passing final report", () => {
	const state = baseState({
		criterionLedger: { criteria: [criterion("passed")], requirementTrace: [] },
		finalVerificationReports: [{ id: "fr1", status: "passed", summary: "done", criterionIds: ["c-passed"], artifactIds: [], validation: [{ result: "passed", summary: "ok" }], unresolvedGaps: [], compatibilityNotes: [], securityNotes: [], performanceNotes: [], createdAt: "2026-05-08T00:00:00.000Z", updatedAt: "2026-05-08T00:00:00.000Z" }],
	});
	const status = evaluateWorkflowStatus(state);
	assert.equal(status.state, "ready_to_complete");
	assert.equal(status.recommendedActions[0].command, "<promise>COMPLETE</promise>");
});

test("workflow status reports completed loops", () => {
	const status = evaluateWorkflowStatus(baseState({ status: "completed", active: false, completedAt: "2026-05-08T00:01:00.000Z" }));
	assert.equal(status.state, "completed");
});
