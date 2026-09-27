import assert from "node:assert/strict";
import { test } from "node:test";
import { buildExecutionDependencyHandoffs, classifyWorkerReportStatus, classifyWorkerRunStatus, modelWithThinkingSuffix, normalizeWorkerThinking, workerInstructions, workerOutputContract } from "../src/worker-role-registry.ts";

const noChanges: never[] = [];

test("worker thinking levels are normalized and encoded as model suffixes", () => {
	assert.equal(normalizeWorkerThinking("none"), "off");
	assert.equal(modelWithThinkingSuffix("openai-codex/gpt-5.5", "xhigh"), "openai-codex/gpt-5.5:xhigh");
	assert.equal(modelWithThinkingSuffix("openai-codex/gpt-5.5:medium", "high"), "openai-codex/gpt-5.5:high");
	assert.equal(modelWithThinkingSuffix("amazon-bedrock/anthropic.claude-opus-4-6-v1:0", "off"), "amazon-bedrock/anthropic.claude-opus-4-6-v1:0:off");
	assert.equal(modelWithThinkingSuffix(undefined, "low", "openai-codex/gpt-5.5"), "openai-codex/gpt-5.5:low");
});

test("read-only Stardock worker roles explicitly forbid edits", () => {
	for (const role of ["explorer", "test_runner", "governor", "auditor", "researcher", "reviewer"] as const) {
		assert.match(workerInstructions(role), /Do not edit files/);
	}
	assert.match(workerInstructions("implementer"), /Edit only files necessary/);
});

test("explorer and reviewer prompts enforce bounded non-duplicative work", () => {
	assert.match(workerInstructions("explorer"), /exact files, symbols, tests, and validation are already named/);
	assert.match(workerInstructions("explorer"), /entire report at 4,000 characters/);
	assert.match(workerOutputContract("explorer"), /likelyFiles \(max 12\)/);
	assert.match(workerInstructions("reviewer"), /concrete uncertainty or required independent evidence/);
	assert.match(workerInstructions("reviewer"), /Do not reconstruct the entire brief/);
});

test("execution workers receive bounded dependency handoffs with reusable refs", () => {
	const state = {
		executionPlan: { nodes: [
			{ id: "research", status: "accepted", dependsOn: [], currentExecutionNodeId: "exec-research" },
			{ id: "decide", status: "pending", dependsOn: ["research"], currentExecutionNodeId: "exec-decide" },
		] },
		executionGraph: {
			nodes: [{
				id: "exec-research",
				attempts: [{
					status: "needs_review",
					workerRunId: "run-1",
					workerReportId: "report-1",
					branchRef: "lane-research",
					laneCommits: ["abc123"],
				}],
			}],
		},
		workerRuns: [{ id: "run-1", status: "accepted" }],
		workerReports: [{ id: "report-1", summary: "Compared both designs.", artifactIds: ["artifact-1"], changedFiles: [], openQuestions: ["Which compatibility window applies?"] }],
	} as any;
	const handoffs = buildExecutionDependencyHandoffs(state, "exec-decide").join("\n");
	assert.match(handoffs, /research \[accepted\]: Compared both designs/);
	assert.match(handoffs, /branch=lane-research; commits=abc123/);
	assert.match(handoffs, /artifacts: artifact-1/);
	assert.match(handoffs, /compatibility window/);
});

test("worker role classification treats advisory no-edit output as success", () => {
	const output = "## Explorer WorkerReport\n- likelyFiles: src/example.ts\n- validationPlan: npm test";
	assert.equal(classifyWorkerRunStatus({ role: "explorer", output, isError: false, changedFiles: noChanges }), "succeeded");
	assert.equal(classifyWorkerReportStatus({ role: "explorer", output, isError: false, changedFiles: noChanges }), "submitted");
});

test("worker role classification escalates failed bounded validation", () => {
	const output = "## Test Runner WorkerReport\n- validation:\n  - command: npm test\n    result: failed\n    summary: assertion failed";
	assert.equal(classifyWorkerRunStatus({ role: "test_runner", output, isError: false, changedFiles: noChanges }), "needs_review");
	assert.equal(classifyWorkerReportStatus({ role: "test_runner", output, isError: false, changedFiles: noChanges }), "needs_review");
});

test("worker role classification requires governance status fields", () => {
	assert.equal(classifyWorkerRunStatus({ role: "governor", output: "## Governor Decision\n- verdict: continue\n- rationale: enough evidence", isError: false, changedFiles: noChanges }), "succeeded");
	assert.equal(classifyWorkerRunStatus({ role: "governor", output: "looks fine", isError: false, changedFiles: noChanges }), "needs_review");
	assert.equal(classifyWorkerRunStatus({ role: "auditor", output: "## Auditor Review\n- status: concerns\n- summary: evidence gap", isError: false, changedFiles: noChanges }), "needs_review");
});

test("worker role classification never silently accepts implementer no-edit output", () => {
	assert.equal(classifyWorkerRunStatus({ role: "implementer", output: "Implemented successfully.", isError: false, changedFiles: noChanges }), "needs_review");
	assert.equal(classifyWorkerRunStatus({ role: "implementer", output: "Blocked: unsafe workspace.", isError: false, changedFiles: noChanges }), "needs_review");
	assert.equal(classifyWorkerRunStatus({ role: "implementer", output: "Bridge failed.", isError: true, changedFiles: noChanges }), "failed");
});
