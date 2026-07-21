import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import {
	canonicalDigest,
	createEmptyExecutionGraph,
	digestExecutionNodeContract,
	digestExecutionStageContract,
	readPersistedExecutionGraph,
} from "../src/stages/contracts.ts";
import {
	evaluateExecutionGraphLifecycle,
	initializeExecutionGraph,
	normalizeWriteClaim,
	readyExecutionNodeIds,
	summarizeExecutionGraph,
	validateExecutionGraph,
} from "../src/stages/graph.ts";
import { readStateFile } from "../src/state/store.ts";
import {
	crossStageFixture,
	fiveNodeWaveFixture,
	fixtureGraph,
	fixtureNode,
	largeHistoryFixture,
	refreshStageDigests,
	serialChainFixture,
} from "./fixtures/execution-graphs.ts";
import { makeHarness, statePath } from "./test-harness.ts";

test("canonical node and stage digests are deterministic across set-like input order", () => {
	const graph = fiveNodeWaveFixture();
	const node = graph.nodes.find((candidate) => candidate.id === "wave-a");
	assert.ok(node);
	node.dependsOn.push("wave-contract");
	node.writes = ["src/z", "src/a", "src/z"];
	node.reads = ["src/read-b", "src/read-a"];
	node.resourceClaims = [
		{ key: "cache:npm", mode: "shared", value: "cache-a" },
		{ key: "db:test", mode: "exclusive" },
	];
	const first = digestExecutionNodeContract(node);
	node.dependsOn.reverse();
	node.writes.reverse();
	node.reads.reverse();
	node.resourceClaims.reverse();
	assert.equal(digestExecutionNodeContract(node), first);
	const stage = graph.stages[0];
	const stageDigest = digestExecutionStageContract(graph, stage);
	graph.nodes.reverse();
	assert.equal(digestExecutionStageContract(graph, stage), stageDigest);
	assert.equal(stageDigest.length, 64);
});

test("new loops persist a complete empty execution graph and populated graphs round-trip", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-stage-state-"));
	try {
		const { tools, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		assert.ok(start);
		await start.execute("stage-state", { name: "Stage State", taskContent: "# Stage state\n" }, undefined, undefined, ctx);
		const filePath = statePath(cwd, "Stage_State");
		const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
		assert.deepEqual(raw.executionGraph, createEmptyExecutionGraph("Stage_State:execution", raw.executionGraph.createdAt));

		const populated = crossStageFixture();
		const populatedLane = populated.nodes.find((node) => node.id === "stage-a-implementation");
		assert.ok(populatedLane);
		populatedLane.resourceClaims = [{ key: "db:stage-a", mode: "exclusive", value: "stage-a-db" }];
		populatedLane.attempts.push({
			id: "attempt-stage-a-1",
			workerRunId: "worker-stage-a-1",
			baseCommit: populated.stages.find((stage) => stage.id === "stage-a")?.contractCommit ?? "",
			branchRef: "stardock/stage-a/implementation/1",
			laneCommits: ["2".repeat(40)],
			headCommit: "2".repeat(40),
			validation: [{ command: "npm test", result: "passed", summary: "Stage lane passed." }],
			startedAt: populated.createdAt,
			completedAt: populated.updatedAt,
		});
		const populatedStage = populated.stages.find((stage) => stage.id === "stage-a");
		assert.ok(populatedStage);
		populatedStage.integration = {
			status: "prepared",
			expectedParentHead: populatedStage.integrationBaseCommit,
			integrationBranch: populatedStage.integrationBranch,
			laneMerges: [{ nodeId: populatedLane.id, sourceHeadCommit: "2".repeat(40), mergeCommit: "3".repeat(40) }],
			fanInCommits: ["4".repeat(40)],
			integrationHeadCommit: "4".repeat(40),
			prepareTokenDigest: canonicalDigest({ stage: populatedStage.id }),
			preparedAt: populated.updatedAt,
			validation: [{ command: "npm test", result: "passed", summary: "Integration passed." }],
		};
		refreshStageDigests(populated);
		raw.executionGraph = populated;
		fs.writeFileSync(filePath, JSON.stringify(raw, null, 2));
		const reloaded = readStateFile(filePath);
		assert.deepEqual(reloaded?.executionGraph, populated);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("persisted graph parsing rejects incomplete nested execution shapes", () => {
	const valid = crossStageFixture();
	assert.deepEqual(readPersistedExecutionGraph(valid), valid);

	const incompleteNode = structuredClone(valid) as unknown as { nodes: Array<Record<string, unknown>> };
	delete incompleteNode.nodes[0].resourceClaims;
	assert.equal(readPersistedExecutionGraph(incompleteNode), undefined);

	const incompleteClaim = structuredClone(valid) as unknown as { nodes: Array<{ resourceClaims: Array<Record<string, unknown>> }> };
	incompleteClaim.nodes[0].resourceClaims.push({ key: "port:test" });
	assert.equal(readPersistedExecutionGraph(incompleteClaim), undefined);

	const incompleteAttempt = structuredClone(valid) as unknown as { nodes: Array<{ attempts: Array<Record<string, unknown>> }> };
	incompleteAttempt.nodes[0].attempts.push({ id: "attempt-1", baseCommit: "1".repeat(40), branchRef: "branch", laneCommits: [], startedAt: valid.createdAt });
	assert.equal(readPersistedExecutionGraph(incompleteAttempt), undefined);

	const incompleteStage = structuredClone(valid) as unknown as { stages: Array<Record<string, unknown>> };
	delete incompleteStage.stages[0].integrationOrder;
	assert.equal(readPersistedExecutionGraph(incompleteStage), undefined);

	const incompleteIntegration = structuredClone(valid) as unknown as { stages: Array<Record<string, unknown>> };
	incompleteIntegration.stages[0].integration = { status: "prepared", expectedParentHead: "1".repeat(40), integrationBranch: "integration", integrationHeadCommit: "2".repeat(40), fanInCommits: [], validation: [] };
	assert.equal(readPersistedExecutionGraph(incompleteIntegration), undefined);
});

test("initialization derives ready and blocked statuses instead of trusting caller strings", () => {
	const graph = serialChainFixture();
	for (const node of graph.nodes) {
		node.status = "integrated";
		node.attempts.push({ id: `${node.id}-old`, baseCommit: "1".repeat(40), branchRef: "old", laneCommits: [], validation: [], startedAt: graph.createdAt });
	}
	const initialized = initializeExecutionGraph(graph);
	assert.deepEqual(initialized.nodes.map((node) => [node.id, node.status]), [
		["serial-a", "ready"],
		["serial-b", "blocked"],
		["serial-c", "blocked"],
	]);
	assert.ok(initialized.nodes.every((node) => node.attempts.length === 0));
});

test("graph validation reports exact missing dependency and cycle diagnostics", () => {
	const missing = fixtureGraph("missing", [fixtureNode("consumer", "serial", ["absent"])]);
	assert.deepEqual(validateExecutionGraph(missing).errors, ['Node "consumer" depends on missing node "absent".']);

	const cycle = fixtureGraph("cycle", [fixtureNode("a", "serial", ["b"]), fixtureNode("b", "serial", ["c"]), fixtureNode("c", "serial", ["a"])]);
	assert.deepEqual(validateExecutionGraph(cycle).errors, ["Execution graph contains a dependency cycle: a -> b -> c -> a."]);
});

test("graph validation rejects empty graph, node, stage, and attempt identifiers", () => {
	const emptyGraphId = fixtureGraph("", []);
	assert.deepEqual(validateExecutionGraph(emptyGraphId).errors, ["Execution graph id must not be empty."]);

	const emptyNodeId = fixtureGraph("empty-node-id", [fixtureNode("", "serial")]);
	assert.deepEqual(validateExecutionGraph(emptyNodeId).errors, ["Execution node id must not be empty."]);

	const emptyStageId = fiveNodeWaveFixture();
	emptyStageId.stages[0].id = "";
	refreshStageDigests(emptyStageId);
	assert.deepEqual(validateExecutionGraph(emptyStageId).errors, ["Execution stage id must not be empty."]);

	const emptyAttemptId = fixtureGraph("empty-attempt-id", [fixtureNode("attempt-owner", "serial")]);
	emptyAttemptId.nodes[0].attempts.push({
		id: "",
		baseCommit: "1".repeat(40),
		branchRef: "stardock/attempt-owner/1",
		laneCommits: [],
		validation: [],
		startedAt: emptyAttemptId.createdAt,
	});
	assert.deepEqual(validateExecutionGraph(emptyAttemptId).errors, ['Execution attempt id for node "attempt-owner" must not be empty.']);
});

test("graph validation rejects duplicate node, stage, and cross-graph attempt identifiers", () => {
	const duplicateNode = fixtureGraph("duplicate-node-id", [fixtureNode("node-a", "serial"), fixtureNode("node-a", "serial")]);
	assert.deepEqual(validateExecutionGraph(duplicateNode).errors, ['Duplicate execution node id "node-a".']);

	const duplicateStage = crossStageFixture();
	for (const stage of duplicateStage.stages) stage.id = "stage";
	refreshStageDigests(duplicateStage);
	assert.deepEqual(validateExecutionGraph(duplicateStage).errors, ['Duplicate execution stage id "stage".']);

	const duplicateAttempt = fixtureGraph("duplicate-attempt-id", [fixtureNode("node-a", "serial"), fixtureNode("node-b", "serial")]);
	for (const node of duplicateAttempt.nodes) {
		node.attempts.push({
			id: "attempt-1",
			baseCommit: "1".repeat(40),
			branchRef: `stardock/${node.id}/1`,
			laneCommits: [],
			validation: [],
			startedAt: duplicateAttempt.createdAt,
		});
	}
	assert.deepEqual(validateExecutionGraph(duplicateAttempt).errors, ['Duplicate execution attempt id "attempt-1".']);
});

test("graph validation reports exact stage role and cross-stage edge diagnostics", () => {
	const role = fiveNodeWaveFixture();
	const contract = role.nodes.find((node) => node.id === "wave-contract");
	assert.ok(contract);
	contract.kind = "serial";
	refreshStageDigests(role);
	assert.deepEqual(validateExecutionGraph(role).errors, ['Stage "wave-stage" contract node "wave-contract" must have kind "contract", not "serial".']);

	const crossStage = crossStageFixture();
	const secondContract = crossStage.nodes.find((node) => node.id === "stage-b-contract");
	assert.ok(secondContract);
	secondContract.dependsOn = ["stage-a-implementation"];
	refreshStageDigests(crossStage);
	assert.deepEqual(validateExecutionGraph(crossStage).errors, ['Cross-stage dependency from node "stage-b-contract" to "stage-a-implementation" must target the prerequisite stage fan-in node.']);
});

test("graph validation reports exact write, resource, and immutable-base diagnostics", () => {
	const writes = fiveNodeWaveFixture();
	const waveA = writes.nodes.find((node) => node.id === "wave-a");
	const waveB = writes.nodes.find((node) => node.id === "wave-b");
	assert.ok(waveA);
	assert.ok(waveB);
	waveA.writes = ["src/shared"];
	waveB.writes = ["src/shared/file.ts"];
	refreshStageDigests(writes);
	assert.deepEqual(validateExecutionGraph(writes).errors, ['Stage "wave-stage" parallel write overlap: node "wave-a" claims "src/shared" and node "wave-b" claims "src/shared/file.ts".']);

	const resources = fiveNodeWaveFixture();
	const resourceA = resources.nodes.find((node) => node.id === "wave-a");
	const resourceB = resources.nodes.find((node) => node.id === "wave-b");
	assert.ok(resourceA);
	assert.ok(resourceB);
	resourceA.resourceClaims = [{ key: "port:4317", mode: "exclusive", value: "4317" }];
	resourceB.resourceClaims = [{ key: "port:4317", mode: "exclusive", value: "4317" }];
	refreshStageDigests(resources);
	assert.deepEqual(validateExecutionGraph(resources).errors, ['Stage "wave-stage" resource conflict between nodes "wave-a" and "wave-b": exclusive key "port:4317".']);

	const base = fiveNodeWaveFixture();
	base.stages[0].contractCommit = "2".repeat(40);
	refreshStageDigests(base);
	assert.deepEqual(validateExecutionGraph(base).errors, ['Stage "wave-stage" immutable base mismatch: integrationBaseCommit must equal contractCommit.']);
});

test("write normalization validates every node while overlap checks stay limited to parallel implementation siblings", () => {
	assert.equal(normalizeWriteClaim("/repo", "./src/feature"), "src/feature");
	assert.throws(() => normalizeWriteClaim("/repo", "src/../outside"), /traverses outside/);

	const invalid = fiveNodeWaveFixture();
	const invalidContract = invalid.nodes.find((node) => node.id === "wave-contract");
	const invalidImplementation = invalid.nodes.find((node) => node.id === "wave-a");
	const invalidFanIn = invalid.nodes.find((node) => node.id === "wave-fan-in");
	assert.ok(invalidContract);
	assert.ok(invalidImplementation);
	assert.ok(invalidFanIn);
	invalidContract.writes = ["/contract-output"];
	invalidImplementation.writes = ["../implementation-output"];
	invalidFanIn.writes = ["C:/fan-in-output"];
	refreshStageDigests(invalid);
	assert.deepEqual(validateExecutionGraph(invalid).errors, [
		'Node "wave-a" has invalid write claim: write claim "../implementation-output" traverses outside the repository root.',
		'Node "wave-contract" has invalid write claim: write claim "/contract-output" must be relative to the repository root.',
		'Node "wave-fan-in" has invalid write claim: write claim "C:/fan-in-output" must be relative to the repository root.',
	]);

	const sharedOwnership = fiveNodeWaveFixture();
	const contract = sharedOwnership.nodes.find((node) => node.id === "wave-contract");
	const fanIn = sharedOwnership.nodes.find((node) => node.id === "wave-fan-in");
	assert.ok(contract);
	assert.ok(fanIn);
	contract.writes = ["src/wave-a"];
	fanIn.writes = ["src/wave-a"];
	refreshStageDigests(sharedOwnership);
	assert.equal(validateExecutionGraph(sharedOwnership).ok, true);
});

test("resource claims require nonempty keys and every shared claim requires a nonblank explicit value", () => {
	const emptyKey = fixtureGraph("empty-resource-key", [fixtureNode("resource-owner", "serial")]);
	emptyKey.nodes[0].resourceClaims = [{ key: "  ", mode: "exclusive" }];
	assert.deepEqual(validateExecutionGraph(emptyKey).errors, ['Node "resource-owner" resource claim key must not be empty.']);

	const missingSharedValue = fixtureGraph("missing-shared-value", [fixtureNode("resource-owner", "serial")]);
	missingSharedValue.nodes[0].resourceClaims = [{ key: "cache:npm", mode: "shared" }];
	assert.deepEqual(validateExecutionGraph(missingSharedValue).errors, ['Node "resource-owner" shared resource claim "cache:npm" must have a nonblank explicit value.']);

	const blankSharedValue = fixtureGraph("blank-shared-value", [fixtureNode("resource-owner", "serial")]);
	blankSharedValue.nodes[0].resourceClaims = [{ key: "cache:npm", mode: "shared", value: "  " }];
	assert.deepEqual(validateExecutionGraph(blankSharedValue).errors, ['Node "resource-owner" shared resource claim "cache:npm" must have a nonblank explicit value.']);
});

test("parallel shared claims require explicit matching values and allocated values are unique", () => {
	const shared = fiveNodeWaveFixture();
	const sharedA = shared.nodes.find((node) => node.id === "wave-a");
	const sharedB = shared.nodes.find((node) => node.id === "wave-b");
	assert.ok(sharedA);
	assert.ok(sharedB);
	sharedA.resourceClaims = [{ key: "cache:npm", mode: "shared", value: "safe-cache" }];
	sharedB.resourceClaims = [{ key: "cache:npm", mode: "shared", value: "safe-cache" }];
	refreshStageDigests(shared);
	assert.equal(validateExecutionGraph(shared).ok, true);
	sharedB.resourceClaims = [{ key: "cache:npm", mode: "shared" }];
	refreshStageDigests(shared);
	assert.deepEqual(validateExecutionGraph(shared).errors, ['Node "wave-b" shared resource claim "cache:npm" must have a nonblank explicit value.']);

	const allocations = [
		{ leftKey: "port:otlp", rightKey: "port:metrics", value: "4317", type: "port" },
		{ leftKey: "db:primary", rightKey: "database:analytics", value: "test-db", type: "database" },
		{ leftKey: "cache:npm", rightKey: "cache:typescript", value: "/tmp/shared-cache", type: "cache" },
	];
	for (const allocation of allocations) {
		const graph = fiveNodeWaveFixture();
		const waveA = graph.nodes.find((node) => node.id === "wave-a");
		const waveB = graph.nodes.find((node) => node.id === "wave-b");
		assert.ok(waveA);
		assert.ok(waveB);
		waveA.resourceClaims = [{ key: allocation.leftKey, mode: "shared", value: allocation.value }];
		waveB.resourceClaims = [{ key: allocation.rightKey, mode: "shared", value: allocation.value }];
		refreshStageDigests(graph);
		assert.deepEqual(validateExecutionGraph(graph).errors, [`Stage "wave-stage" resource conflict between nodes "wave-a" and "wave-b": duplicate ${allocation.type} allocation value "${allocation.value}" for keys "${allocation.leftKey}" and "${allocation.rightKey}".`]);
	}
});

test("contract digest mismatch reports the exact canonical digest", () => {
	const graph = fiveNodeWaveFixture();
	graph.stages[0].contractDigest = canonicalDigest({ stale: true });
	const expected = digestExecutionStageContract(graph, graph.stages[0]);
	assert.deepEqual(validateExecutionGraph(graph).errors, [`Stage "wave-stage" contractDigest mismatch: expected ${expected}, received ${canonicalDigest({ stale: true })}.`]);
});

test("ready sets are deterministic for serial, wave, and cross-stage progression", () => {
	const serial = serialChainFixture();
	assert.deepEqual(readyExecutionNodeIds(serial), ["serial-a"]);
	serial.nodes[0].status = "succeeded";
	assert.deepEqual(readyExecutionNodeIds(serial), ["serial-b"]);

	const wave = fiveNodeWaveFixture();
	assert.deepEqual(readyExecutionNodeIds(wave), ["wave-a", "wave-b", "wave-c", "wave-d", "wave-e"]);
	wave.nodes.reverse();
	assert.deepEqual(readyExecutionNodeIds(wave), ["wave-a", "wave-b", "wave-c", "wave-d", "wave-e"]);

	const crossStage = crossStageFixture();
	assert.deepEqual(readyExecutionNodeIds(crossStage), ["stage-a-fan-in"]);
	const firstFanIn = crossStage.nodes.find((node) => node.id === "stage-a-fan-in");
	assert.ok(firstFanIn);
	firstFanIn.status = "succeeded";
	assert.deepEqual(readyExecutionNodeIds(crossStage), []);
	firstFanIn.status = "integrated";
	assert.deepEqual(readyExecutionNodeIds(crossStage), ["stage-b-contract"]);
});

test("large histories produce bounded summaries without serializing attempt history", () => {
	const graph = largeHistoryFixture();
	const summary = summarizeExecutionGraph(graph);
	const serialized = JSON.stringify(summary);
	assert.equal(summary.nodeCount, 120);
	assert.equal(summary.attemptCount, 4800);
	assert.equal(summary.nodePreview.length, 8);
	assert.equal(summary.truncatedNodes, 112);
	assert.equal(serialized.includes("large-000-attempt-0"), false);
	assert.ok(serialized.length < 5000);
});

test("execution lifecycle policy returns exact nonterminal, review, fan-in, reconcile, and release actions", () => {
	const ready = serialChainFixture();
	assert.deepEqual(evaluateExecutionGraphLifecycle(ready), { blocked: true, state: "nonterminal", nextAction: 'Run ready execution node "serial-a".' });

	const review = serialChainFixture();
	review.nodes[0].status = "needs_review";
	assert.deepEqual(evaluateExecutionGraphLifecycle(review), { blocked: true, state: "review", nextAction: 'Review execution node "serial-a" before integration.' });

	const fanIn = fiveNodeWaveFixture();
	fanIn.stages[0].status = "awaiting_integration";
	assert.deepEqual(evaluateExecutionGraphLifecycle(fanIn), { blocked: true, state: "fan_in", nextAction: 'Prepare fan-in integration for execution stage "wave-stage".' });

	const prepared = fiveNodeWaveFixture();
	prepared.stages[0].status = "integration_prepared";
	assert.deepEqual(evaluateExecutionGraphLifecycle(prepared), { blocked: true, state: "fan_in", nextAction: 'Finalize prepared integration for execution stage "wave-stage".' });

	const reconcile = serialChainFixture();
	reconcile.nodes[0].status = "detached";
	assert.deepEqual(evaluateExecutionGraphLifecycle(reconcile), { blocked: true, state: "reconcile", nextAction: 'Reconcile execution node "serial-a" before continuing.' });

	const release = fiveNodeWaveFixture();
	for (const node of release.nodes) node.status = "integrated";
	release.stages[0].status = "integrated";
	assert.deepEqual(evaluateExecutionGraphLifecycle(release), { blocked: true, state: "release", nextAction: 'Release resources for integrated execution stage "wave-stage", then complete the graph.' });

	const inconsistentCompleted = serialChainFixture();
	inconsistentCompleted.status = "completed";
	assert.deepEqual(evaluateExecutionGraphLifecycle(inconsistentCompleted), { blocked: true, state: "nonterminal", nextAction: 'Run ready execution node "serial-a".' });

	const inconsistentStage = fiveNodeWaveFixture();
	inconsistentStage.status = "completed";
	for (const node of inconsistentStage.nodes) node.status = "integrated";
	inconsistentStage.stages[0].status = "integration_prepared";
	assert.deepEqual(evaluateExecutionGraphLifecycle(inconsistentStage), { blocked: true, state: "fan_in", nextAction: 'Finalize prepared integration for execution stage "wave-stage".' });

	const inconsistentAbandoned = fiveNodeWaveFixture();
	inconsistentAbandoned.status = "abandoned";
	inconsistentAbandoned.nodes.find((node) => node.id === "wave-a")!.status = "needs_review";
	inconsistentAbandoned.stages[0].status = "abandoned";
	assert.deepEqual(evaluateExecutionGraphLifecycle(inconsistentAbandoned), { blocked: true, state: "review", nextAction: 'Review execution node "wave-a" before integration.' });

	const completed = serialChainFixture();
	completed.status = "completed";
	for (const node of completed.nodes) node.status = "succeeded";
	assert.deepEqual(evaluateExecutionGraphLifecycle(completed), { blocked: false, state: "clear" });

	const abandoned = fiveNodeWaveFixture();
	abandoned.status = "abandoned";
	for (const node of abandoned.nodes) node.status = "abandoned";
	abandoned.stages[0].status = "abandoned";
	assert.deepEqual(evaluateExecutionGraphLifecycle(abandoned), { blocked: false, state: "clear" });

	release.status = "completed";
	assert.deepEqual(evaluateExecutionGraphLifecycle(release), { blocked: false, state: "clear" });
});
