import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const stateRoot = process.argv[2];
const contractSha = process.argv[3];
assert.ok(stateRoot, "Usage: assert-treehouse-dogfood.ts <stardock-state-dir> <contract-sha>");
assert.match(contractSha ?? "", /^[0-9a-f]{40}$/, "contract SHA must be exact");

function stateFiles(root: string): string[] {
	const files: string[] = [];
	for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
		const entryPath = path.join(root, entry.name);
		if (entry.isDirectory()) files.push(...stateFiles(entryPath));
		else if (entry.name === "state.json" || entry.name.endsWith(".state.json")) files.push(entryPath);
	}
	return files;
}

const files = stateFiles(path.resolve(stateRoot));
assert.equal(files.length, 1, `expected exactly one Stardock state file, found ${files.length}`);
const state = JSON.parse(fs.readFileSync(files[0], "utf8"));
const graph = state.executionGraph;
assert.ok(graph, "execution graph is required");
assert.equal(graph.ownership, undefined, "terminal dogfood graph must release ownership");
const stage = graph.stages.find((candidate: any) => candidate.id === "formatters");
assert.ok(stage, "formatters stage is required");
assert.equal(stage.contractCommit, contractSha);
assert.equal(stage.integrationBaseCommit, contractSha);
assert.equal(stage.status, "integrated");
assert.equal(stage.integration?.status, "integrated");
assert.equal(stage.integration?.expectedParentHead, contractSha);
assert.equal(stage.integration?.parentResultCommit, stage.integration?.integrationHeadCommit);
assert.deepEqual(stage.integrationOrder, ["upper", "lower"]);

const expectedPaths: Record<string, string[]> = {
	upper: ["test-upper.sh", "upper.sh"],
	lower: ["lower.sh", "test-lower.sh"],
};
const attempts = stage.implementationNodeIds.map((nodeId: string) => {
	const node = graph.nodes.find((candidate: any) => candidate.id === nodeId);
	assert.ok(node, `missing node ${nodeId}`);
	assert.equal(node.status, "integrated", `${nodeId} was not integrated`);
	assert.equal(node.attempts.length, 1, `${nodeId} must have exactly one dogfood attempt`);
	const attempt = node.attempts[0];
	assert.equal(attempt.baseCommit, contractSha, `${nodeId} used the wrong contract SHA`);
	assert.equal(attempt.clean, true, `${nodeId} did not finish cleanly`);
	assert.equal(attempt.leaseDisposition, "released", `${nodeId} lease was not released`);
	assert.ok(attempt.headCommit, `${nodeId} head is missing`);
	assert.ok(attempt.worktreePath, `${nodeId} worktree is missing`);
	assert.ok(attempt.leaseHolder, `${nodeId} lease holder is missing`);
	assert.ok(attempt.branchRef, `${nodeId} branch is missing`);
	assert.deepEqual([...attempt.changedPaths].sort(), expectedPaths[nodeId], `${nodeId} changed paths violate ownership`);
	const run = state.workerRuns.find((candidate: any) => candidate.id === attempt.workerRunId);
	assert.equal(run?.status, "accepted", `${nodeId} WorkerRun was not accepted`);
	assert.equal(run?.isolation, "treehouse", `${nodeId} did not run in Treehouse`);
	const mapping = stage.integration.laneMerges.find((candidate: any) => candidate.nodeId === nodeId);
	assert.equal(mapping?.sourceHeadCommit, attempt.headCommit, `${nodeId} integration mapping changed source head`);
	return { nodeId, attempt, run };
});

assert.notEqual(attempts[0].attempt.worktreePath, attempts[1].attempt.worktreePath, "lanes reused a worktree");
assert.notEqual(attempts[0].attempt.leaseHolder, attempts[1].attempt.leaseHolder, "lanes reused a lease holder");
assert.notEqual(attempts[0].attempt.branchRef, attempts[1].attempt.branchRef, "lanes reused a branch");
for (const left of attempts) {
	for (const right of attempts) {
		if (left === right) continue;
		assert.ok(Date.parse(left.run.startedAt) < Date.parse(right.run.completedAt), `${left.nodeId} and ${right.nodeId} did not overlap`);
	}
}

process.stdout.write(`Verified Treehouse dogfood state: ${files[0]}\n`);
