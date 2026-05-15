import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyWorkerReportStatus, classifyWorkerRunStatus, modelWithThinkingSuffix, normalizeWorkerThinking, workerInstructions } from "../src/worker-role-registry.ts";

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
