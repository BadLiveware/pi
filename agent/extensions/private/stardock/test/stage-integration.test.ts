import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import {
	digestExecutionStageContract,
	digestIterationBriefContract,
	type ExecutionGraph,
} from "../src/stages/contracts.ts";
import { createIntegrationPlan, prepareIntegration, recordIntegrated, reissuePreparedIntegrationToken } from "../src/stages/integration.ts";
import { makeHarness, statePath } from "./test-harness.ts";

function git(cwd: string, args: string[]): string {
	return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

function commitFile(cwd: string, branch: string, fileName: string, content: string): string {
	git(cwd, ["switch", "-c", branch]);
	const fullPath = path.join(cwd, fileName);
	fs.mkdirSync(path.dirname(fullPath), { recursive: true });
	fs.writeFileSync(fullPath, content);
	git(cwd, ["add", fileName]);
	git(cwd, ["commit", "-m", `Implement ${branch}`]);
	return git(cwd, ["rev-parse", "HEAD^{commit}"]);
}

test("integration plan, durable preparation, parent fast-forward, and idempotent finalization preserve no-ff evidence", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stage-integration-"));
	try {
		git(cwd, ["init", "-b", "main"]);
		git(cwd, ["config", "user.name", "Stage Integration Test"]);
		git(cwd, ["config", "user.email", "stage@example.invalid"]);
		fs.writeFileSync(path.join(cwd, "CONTRACT.md"), "immutable contract\n");
		git(cwd, ["add", "CONTRACT.md"]);
		git(cwd, ["commit", "-m", "Define contract"]);
		const base = git(cwd, ["rev-parse", "HEAD^{commit}"]);
		const laneAHead = commitFile(cwd, "lane-a", "a.txt", "a\n");
		git(cwd, ["switch", "main"]);
		const laneBHead = commitFile(cwd, "lane-b", "b.txt", "b\n");
		git(cwd, ["switch", "main"]);

		const harness = makeHarness(cwd);
		await harness.tools.get("stardock_start").execute("start", { name: "Integration Test", taskContent: "# Integration\n" }, undefined, undefined, harness.ctx);
		const loopName = "Integration_Test";
		const now = "2026-07-21T00:00:00.000Z";
		const briefs = ["a", "b"].map((id) => ({
			id: `brief-${id}`, status: "pending", source: "manual", objective: `Implement ${id}`, task: `Implement ${id}.`, criterionIds: [], acceptanceCriteria: ["committed"], verificationRequired: ["true"], requiredContext: [], constraints: [], avoid: [], outputContract: "report", sourceRefs: [], createdAt: now, updatedAt: now,
		}));
		const graph: ExecutionGraph = {
			id: "integration-graph",
			revision: 7,
			status: "running",
			nodes: [
				{ id: "contract", kind: "contract", objective: "contract", dependsOn: [], writes: [], reads: [], resourceClaims: [], validationCommands: [], status: "integrated", attempts: [] },
				{ id: "a", kind: "implementation", objective: "Implement a", dependsOn: ["contract"], briefId: "brief-a", briefDigest: digestIterationBriefContract(briefs[0] as any), writes: ["a.txt"], reads: [], resourceClaims: [], validationCommands: ["true"], status: "succeeded", attempts: [{ id: "attempt-a", workerRunId: "run-a", baseCommit: base, branchRef: "lane-a", laneCommits: [laneAHead], headCommit: laneAHead, clean: true, changedPaths: ["a.txt"], validation: [{ command: "true", result: "passed", summary: "passed" }], status: "needs_review", startedAt: now, completedAt: now }] },
				{ id: "b", kind: "implementation", objective: "Implement b", dependsOn: ["contract"], briefId: "brief-b", briefDigest: digestIterationBriefContract(briefs[1] as any), writes: ["b.txt"], reads: [], resourceClaims: [], validationCommands: ["true"], status: "succeeded", attempts: [{ id: "attempt-b", workerRunId: "run-b", baseCommit: base, branchRef: "lane-b", laneCommits: [laneBHead], headCommit: laneBHead, clean: true, changedPaths: ["b.txt"], validation: [{ command: "true", result: "passed", summary: "passed" }], status: "needs_review", startedAt: now, completedAt: now }] },
				{ id: "fan", kind: "fan_in", objective: "validate", dependsOn: ["a", "b"], writes: [], reads: [], resourceClaims: [], validationCommands: ["true"], status: "ready", attempts: [] },
			],
			stages: [{ id: "stage", contractNodeId: "contract", implementationNodeIds: ["a", "b"], fanInNodeId: "fan", status: "awaiting_integration", parentBranch: "main", integrationBaseCommit: base, contractCommit: base, contractDigest: "", integrationBranch: "stardock/integration-test", maxConcurrency: 2, integrationOrder: ["a", "b"] }],
			createdAt: now,
			updatedAt: now,
		};
		graph.stages[0].contractDigest = digestExecutionStageContract(graph, graph.stages[0]);
		const raw = JSON.parse(fs.readFileSync(statePath(cwd, loopName), "utf8"));
		raw.briefs.push(...briefs);
		raw.workerRuns.push(
			{ id: "run-a", role: "implementer", status: "accepted", scope: "brief", briefId: "brief-a", graphId: graph.id, stageId: "stage", nodeId: "a", attemptId: "attempt-a", isolation: "treehouse", requestId: "request-a", agentName: "implementer", context: "fresh", outputMode: "file-only", outputRefs: [], changedFiles: [], expectedMutation: true, allowDirtyWorkspace: false, startedAt: now, updatedAt: now },
			{ id: "run-b", role: "implementer", status: "accepted", scope: "brief", briefId: "brief-b", graphId: graph.id, stageId: "stage", nodeId: "b", attemptId: "attempt-b", isolation: "treehouse", requestId: "request-b", agentName: "implementer", context: "fresh", outputMode: "file-only", outputRefs: [], changedFiles: [], expectedMutation: true, allowDirtyWorkspace: false, startedAt: now, updatedAt: now },
		);
		raw.executionGraph = graph;
		fs.writeFileSync(statePath(cwd, loopName), JSON.stringify(raw, null, 2));

		const plan = await createIntegrationPlan(harness.ctx, { loopName, graphId: graph.id, stageId: "stage", expectedGraphRevision: 7 });
		assert.deepEqual(plan.acceptedLanes.map((lane) => lane.nodeId), ["a", "b"]);
		assert.deepEqual(plan.commands.map((command) => command.args.slice(2, 5)), [
			["switch", "-c", "stardock/integration-test"],
			["merge", "--no-ff", "--no-edit"],
			["merge", "--no-ff", "--no-edit"],
		]);
		assert.equal(git(cwd, ["rev-parse", "refs/heads/main^{commit}"]), base);

		git(cwd, plan.commands[0].args.slice(2));
		git(cwd, plan.commands[1].args.slice(2));
		const mergeA = git(cwd, ["rev-parse", "HEAD^{commit}"]);
		git(cwd, plan.commands[2].args.slice(2));
		const mergeB = git(cwd, ["rev-parse", "HEAD^{commit}"]);
		assert.deepEqual(git(cwd, ["show", "-s", "--format=%P", mergeA]).split(" "), [base, laneAHead]);
		assert.deepEqual(git(cwd, ["show", "-s", "--format=%P", mergeB]).split(" "), [mergeA, laneBHead]);

		await assert.rejects(() => prepareIntegration(harness.ctx, {
			loopName, graphId: graph.id, stageId: "stage", expectedGraphRevision: 7, integrationHeadCommit: mergeB,
			laneMerges: [{ nodeId: "a", sourceHeadCommit: laneBHead, mergeCommit: mergeA }, { nodeId: "b", sourceHeadCommit: laneBHead, mergeCommit: mergeB }],
			fanInCommits: [], validation: [{ command: "true", result: "passed", summary: "passed" }],
		}), /mappings/);
		assert.equal(git(cwd, ["rev-parse", "refs/heads/main^{commit}"]), base);

		const prepared = await prepareIntegration(harness.ctx, {
			loopName, graphId: graph.id, stageId: "stage", expectedGraphRevision: 7, integrationHeadCommit: mergeB,
			laneMerges: [{ nodeId: "a", sourceHeadCommit: laneAHead, mergeCommit: mergeA }, { nodeId: "b", sourceHeadCommit: laneBHead, mergeCommit: mergeB }],
			fanInCommits: [], validation: [{ command: "true", result: "passed", summary: "passed" }],
		});
		assert.equal(prepared.stateRevision, 8);
		assert.equal(prepared.expectedParentHead, base);
		assert.deepEqual(prepared.fastForwardCommands.map((command) => command.args.slice(2)), [
			["switch", "main"],
			["rev-parse", "--verify", "refs/heads/main^{commit}"],
			["merge", "--ff-only", mergeB],
		]);
		const recovered = await reissuePreparedIntegrationToken(harness.ctx, { loopName, graphId: graph.id, stageId: "stage" });
		assert.equal(recovered.stateRevision, 9);
		assert.notEqual(recovered.prepareToken, prepared.prepareToken);
		for (const command of recovered.fastForwardCommands) git(cwd, command.args.slice(2));
		assert.equal(git(cwd, ["rev-parse", "refs/heads/main^{commit}"]), mergeB);
		await assert.rejects(() => recordIntegrated(harness.ctx, { loopName, graphId: graph.id, stageId: "stage", expectedGraphRevision: 9, prepareToken: prepared.prepareToken, parentResultCommit: mergeB }), /prepareToken/);
		const finalized = await recordIntegrated(harness.ctx, { loopName, graphId: graph.id, stageId: "stage", expectedGraphRevision: 9, prepareToken: recovered.prepareToken, parentResultCommit: mergeB });
		assert.equal(finalized.idempotent, false);
		const replay = await recordIntegrated(harness.ctx, { loopName, graphId: graph.id, stageId: "stage", expectedGraphRevision: 9, prepareToken: recovered.prepareToken, parentResultCommit: mergeB });
		assert.equal(replay.idempotent, true);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("prepareIntegration rejects committed fan-in paths outside the fan-in node's owned writes", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stage-fan-in-owned-paths-"));
	try {
		git(cwd, ["init", "-b", "main"]);
		git(cwd, ["config", "user.name", "Stage Integration Test"]);
		git(cwd, ["config", "user.email", "stage@example.invalid"]);
		fs.writeFileSync(path.join(cwd, "CONTRACT.md"), "immutable contract\n");
		git(cwd, ["add", "CONTRACT.md"]);
		git(cwd, ["commit", "-m", "Define contract"]);
		const base = git(cwd, ["rev-parse", "HEAD^{commit}"]);
		const laneAHead = commitFile(cwd, "lane-a", "owned/a.txt", "a\n");
		git(cwd, ["switch", "main"]);
		const laneBHead = commitFile(cwd, "lane-b", "owned/b.txt", "b\n");
		git(cwd, ["switch", "main"]);

		const harness = makeHarness(cwd);
		await harness.tools.get("stardock_start").execute("start", { name: "Integration Owned Paths", taskContent: "# Integration\n" }, undefined, undefined, harness.ctx);
		const loopName = "Integration_Owned_Paths";
		const now = "2026-07-21T00:00:00.000Z";
		const briefA = { id: "brief-a", status: "pending", source: "manual", objective: "Implement a", task: "Implement a.", criterionIds: [], acceptanceCriteria: ["committed"], verificationRequired: ["true"], requiredContext: [], constraints: [], avoid: [], outputContract: "report", sourceRefs: [], createdAt: now, updatedAt: now };
		const briefB = { id: "brief-b", status: "pending", source: "manual", objective: "Implement b", task: "Implement b.", criterionIds: [], acceptanceCriteria: ["committed"], verificationRequired: ["true"], requiredContext: [], constraints: [], avoid: [], outputContract: "report", sourceRefs: [], createdAt: now, updatedAt: now };
		const graph: ExecutionGraph = {
			id: "integration-graph",
			revision: 3,
			status: "running",
			nodes: [
				{ id: "contract", kind: "contract", objective: "contract", dependsOn: [], writes: [], reads: [], resourceClaims: [], validationCommands: [], status: "integrated", attempts: [] },
				{ id: "a", kind: "implementation", objective: "Implement a", dependsOn: ["contract"], briefId: "brief-a", briefDigest: digestIterationBriefContract(briefA as any), writes: ["owned/a.txt"], reads: [], resourceClaims: [], validationCommands: ["true"], status: "succeeded", attempts: [{ id: "attempt-a", workerRunId: "run-a", baseCommit: base, branchRef: "lane-a", laneCommits: [laneAHead], headCommit: laneAHead, clean: true, changedPaths: ["owned/a.txt"], validation: [{ command: "true", result: "passed", summary: "passed" }], status: "needs_review", startedAt: now, completedAt: now }] },
				{ id: "b", kind: "implementation", objective: "Implement b", dependsOn: ["contract"], briefId: "brief-b", briefDigest: digestIterationBriefContract(briefB as any), writes: ["owned/b.txt"], reads: [], resourceClaims: [], validationCommands: ["true"], status: "succeeded", attempts: [{ id: "attempt-b", workerRunId: "run-b", baseCommit: base, branchRef: "lane-b", laneCommits: [laneBHead], headCommit: laneBHead, clean: true, changedPaths: ["owned/b.txt"], validation: [{ command: "true", result: "passed", summary: "passed" }], status: "needs_review", startedAt: now, completedAt: now }] },
				{ id: "fan", kind: "fan_in", objective: "validate", dependsOn: ["a", "b"], writes: ["fan-in"], reads: [], resourceClaims: [], validationCommands: ["true"], status: "ready", attempts: [] },
			],
			stages: [{ id: "stage", contractNodeId: "contract", implementationNodeIds: ["a", "b"], fanInNodeId: "fan", status: "awaiting_integration", parentBranch: "main", integrationBaseCommit: base, contractCommit: base, contractDigest: "", integrationBranch: "stardock/integration-test", maxConcurrency: 2, integrationOrder: ["a", "b"] }],
			createdAt: now,
			updatedAt: now,
		};
		graph.stages[0].contractDigest = digestExecutionStageContract(graph, graph.stages[0]);
		const raw = JSON.parse(fs.readFileSync(statePath(cwd, loopName), "utf8"));
		raw.briefs.push(briefA, briefB);
		raw.workerRuns.push(
			{ id: "run-a", role: "implementer", status: "accepted", scope: "brief", briefId: "brief-a", graphId: graph.id, stageId: "stage", nodeId: "a", attemptId: "attempt-a", isolation: "treehouse", requestId: "request-a", agentName: "implementer", context: "fresh", outputMode: "file-only", outputRefs: [], changedFiles: [], expectedMutation: true, allowDirtyWorkspace: false, startedAt: now, updatedAt: now },
			{ id: "run-b", role: "implementer", status: "accepted", scope: "brief", briefId: "brief-b", graphId: graph.id, stageId: "stage", nodeId: "b", attemptId: "attempt-b", isolation: "treehouse", requestId: "request-b", agentName: "implementer", context: "fresh", outputMode: "file-only", outputRefs: [], changedFiles: [], expectedMutation: true, allowDirtyWorkspace: false, startedAt: now, updatedAt: now },
		);
		raw.executionGraph = graph;
		fs.writeFileSync(statePath(cwd, loopName), JSON.stringify(raw, null, 2));

		const plan = await createIntegrationPlan(harness.ctx, { loopName, graphId: graph.id, stageId: "stage", expectedGraphRevision: 3 });
		for (const command of plan.commands) git(cwd, command.args.slice(2));
		const mergeA = git(cwd, ["rev-parse", "HEAD~1^{commit}"]);
		const mergeB = git(cwd, ["rev-parse", "HEAD^{commit}"]);
		fs.mkdirSync(path.join(cwd, "owned"), { recursive: true });
		fs.writeFileSync(path.join(cwd, "owned", "fan-in-outside.txt"), "not owned by fan-in\n");
		git(cwd, ["add", "owned/fan-in-outside.txt"]);
		git(cwd, ["commit", "-m", "Fan-in writes outside owned paths"]);
		const integrationHead = git(cwd, ["rev-parse", "HEAD^{commit}"]);

		await assert.rejects(() => prepareIntegration(harness.ctx, {
			loopName,
			graphId: graph.id,
			stageId: "stage",
			expectedGraphRevision: 3,
			integrationHeadCommit: integrationHead,
			laneMerges: [
				{ nodeId: "a", sourceHeadCommit: laneAHead, mergeCommit: mergeA },
				{ nodeId: "b", sourceHeadCommit: laneBHead, mergeCommit: mergeB },
			],
			fanInCommits: [integrationHead],
			validation: [{ command: "true", result: "passed", summary: "passed" }],
		}), /Fan-in changed paths must stay within node "fan" owned writes/);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
