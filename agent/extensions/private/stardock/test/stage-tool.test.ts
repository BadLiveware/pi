import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { digestExecutionStageContract, digestIterationBriefContract, type ExecutionGraph } from "../src/stages/contracts.ts";
import { makeHarness, statePath } from "./test-harness.ts";

const SHA = "1".repeat(40);
const UPSERT_CHILD_FIXTURE = fileURLToPath(new URL("./fixtures/stage-upsert-child.ts", import.meta.url));

type UpsertChildResult = {
	ok: boolean;
	marker: string;
	code?: string;
	message?: string;
	revision?: number;
	objective?: string;
	contractDigest?: string;
};

function runUpsertChild(args: string[]): Promise<{ exitCode: number | null; result: UpsertChildResult }> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ["--experimental-strip-types", UPSERT_CHILD_FIXTURE, ...args], { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => { stdout += String(chunk); });
		child.stderr.on("data", (chunk) => { stderr += String(chunk); });
		child.on("error", reject);
		child.on("close", (exitCode) => {
			if (!stdout) {
				reject(new Error(`Upsert child emitted no result: ${stderr}`));
				return;
			}
			resolve({ exitCode, result: JSON.parse(stdout) });
		});
	});
}

async function waitForFile(filePath: string): Promise<void> {
	const deadline = Date.now() + 5_000;
	while (!fs.existsSync(filePath)) {
		if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${filePath}`);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

function graphAndBrief(id: string) {
	const now = "2026-07-21T00:00:00.000Z";
	const brief = {
		id: "lane-brief", status: "pending", source: "manual", objective: "Implement lane", task: "Implement the lane.", criterionIds: [], acceptanceCriteria: ["committed"], verificationRequired: ["test"], requiredContext: [], constraints: [], avoid: [], outputContract: "report", sourceRefs: [], createdAt: now, updatedAt: now,
	};
	const graph: ExecutionGraph = {
		id,
		revision: 0,
		status: "completed",
		nodes: [
			{ id: "fan", kind: "fan_in", objective: "fan in", dependsOn: ["lane"], writes: [], reads: [], resourceClaims: [], validationCommands: [], status: "integrated", attempts: [] },
			{ id: "lane", kind: "implementation", objective: "lane", dependsOn: ["contract"], briefId: brief.id, briefDigest: digestIterationBriefContract(brief as any), writes: ["src/lane"], reads: [], resourceClaims: [], validationCommands: ["npm test"], status: "integrated", attempts: [] },
			{ id: "contract", kind: "contract", objective: "contract", dependsOn: [], writes: [], reads: [], resourceClaims: [], validationCommands: [], status: "failed", attempts: [] },
		],
		stages: [{ id: "stage", contractNodeId: "contract", implementationNodeIds: ["lane"], fanInNodeId: "fan", status: "integrated", parentBranch: "main", integrationBaseCommit: SHA, contractCommit: SHA, contractDigest: "", integrationBranch: "stardock/stage/integration", maxConcurrency: 1, integrationOrder: ["lane"] }],
		createdAt: now,
		updatedAt: now,
	};
	graph.stages[0].contractDigest = digestExecutionStageContract(graph, graph.stages[0]);
	return { graph, brief };
}

test("two simultaneous initial upserts persist exactly one complete winning graph", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stage-upsert-race-"));
	try {
		const harness = makeHarness(cwd);
		await harness.tools.get("stardock_start").execute("start", { name: "Stage Upsert Race", taskContent: "# Stage race\n" }, undefined, undefined, harness.ctx);
		const loopName = "Stage_Upsert_Race";
		const { graph: alphaGraph, brief } = graphAndBrief(`${loopName}:execution`);
		alphaGraph.nodes.find((node) => node.id === "lane")!.objective = "alpha lane objective";
		alphaGraph.stages[0].contractDigest = digestExecutionStageContract(alphaGraph, alphaGraph.stages[0]);
		const betaGraph = structuredClone(alphaGraph);
		betaGraph.nodes.find((node) => node.id === "lane")!.objective = "beta lane objective";
		betaGraph.stages[0].contractDigest = digestExecutionStageContract(betaGraph, betaGraph.stages[0]);

		const raw = JSON.parse(fs.readFileSync(statePath(cwd, loopName), "utf-8"));
		raw.briefs.push(brief);
		fs.writeFileSync(statePath(cwd, loopName), JSON.stringify(raw, null, 2));
		const alphaPath = path.join(cwd, "alpha-graph.json");
		const betaPath = path.join(cwd, "beta-graph.json");
		const alphaReady = path.join(cwd, "alpha-ready");
		const betaReady = path.join(cwd, "beta-ready");
		const gatePath = path.join(cwd, "upsert-go");
		fs.writeFileSync(alphaPath, JSON.stringify(alphaGraph));
		fs.writeFileSync(betaPath, JSON.stringify(betaGraph));

		const alpha = runUpsertChild([cwd, loopName, alphaPath, "alpha", alphaReady, gatePath]);
		const beta = runUpsertChild([cwd, loopName, betaPath, "beta", betaReady, gatePath]);
		await Promise.all([waitForFile(alphaReady), waitForFile(betaReady)]);
		fs.writeFileSync(gatePath, "go");
		const results = await Promise.all([alpha, beta]);
		const winners = results.filter(({ result }) => result.ok);
		const losers = results.filter(({ result }) => !result.ok);
		assert.equal(winners.length, 1);
		assert.equal(losers.length, 1);
		assert.equal(winners[0].exitCode, 0);
		assert.equal(winners[0].result.revision, 1);
		assert.equal(losers[0].exitCode, 2);
		assert.equal(losers[0].result.code, "stale_revision");
		assert.match(losers[0].result.message ?? "", /Stale execution graph revision/);

		let winningGraph = alphaGraph;
		if (winners[0].result.marker === "beta") winningGraph = betaGraph;
		const durable = JSON.parse(fs.readFileSync(statePath(cwd, loopName), "utf-8")).executionGraph;
		assert.equal(durable.revision, 1);
		assert.equal(durable.nodes.find((node: any) => node.id === "lane").objective, winningGraph.nodes.find((node) => node.id === "lane")!.objective);
		assert.equal(durable.stages.find((stage: any) => stage.id === "stage").contractDigest, winningGraph.stages[0].contractDigest);
		assert.equal(durable.nodes.find((node: any) => node.id === "lane").objective, winners[0].result.objective);
		assert.equal(durable.stages.find((stage: any) => stage.id === "stage").contractDigest, winners[0].result.contractDigest);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("stardock_stage upsert derives initial state, lists bounded details, and rejects stale updates", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stage-tool-"));
	try {
		const harness = makeHarness(cwd);
		await harness.tools.get("stardock_start").execute("start", { name: "Stage Tool", taskContent: "# Stage\n" }, undefined, undefined, harness.ctx);
		const loopName = "Stage_Tool";
		const { graph, brief } = graphAndBrief(`${loopName}:execution`);
		const raw = JSON.parse(fs.readFileSync(statePath(cwd, loopName), "utf-8"));
		raw.briefs.push(brief);
		fs.writeFileSync(statePath(cwd, loopName), JSON.stringify(raw, null, 2));
		const stage = harness.tools.get("stardock_stage");
		const created = await stage.execute("upsert", { action: "upsert", loopName, graph }, undefined, undefined, harness.ctx);
		assert.equal(created.details.ok, true);
		assert.equal(created.details.revision, 1);
		const listed = await stage.execute("list", { action: "list", loopName, graphId: graph.id, stageId: "stage", limit: 1 }, undefined, undefined, harness.ctx);
		assert.equal(listed.details.ok, true);
		assert.equal(listed.details.revision, 1);
		assert.equal(listed.details.nodes.length, 1);
		assert.equal(listed.details.page.nodes.total, 3);
		const allNodes = (await stage.execute("list", { action: "list", loopName, graphId: graph.id, stageId: "stage", limit: 10 }, undefined, undefined, harness.ctx)).details.nodes;
		assert.equal(allNodes.find((node: any) => node.id === "contract").status, "integrated");
		assert.equal(allNodes.find((node: any) => node.id === "lane").status, "ready");
		const withHistory = JSON.parse(fs.readFileSync(statePath(cwd, loopName), "utf-8"));
		const lane = withHistory.executionGraph.nodes.find((node: any) => node.id === "lane");
		lane.attempts = Array.from({ length: 150 }, (_, index) => ({
			id: `attempt-${index}`,
			baseCommit: SHA,
			branchRef: `stardock/lane/${index}`,
			laneCommits: Array.from({ length: 50 }, (_value, commitIndex) => String((commitIndex % 8) + 2).repeat(40)),
			changedPaths: Array.from({ length: 50 }, (_value, pathIndex) => `src/lane/${pathIndex}.ts`),
			violations: Array.from({ length: 50 }, (_value, violationIndex) => `violation-${violationIndex}`),
			validation: Array.from({ length: 50 }, (_value, validationIndex) => ({ command: `test-${validationIndex}`, result: "passed", summary: "passed" })),
			startedAt: "2026-07-21T00:00:00.000Z",
		}));
		fs.writeFileSync(statePath(cwd, loopName), JSON.stringify(withHistory, null, 2));
		const bounded = await stage.execute("list-bounded", { action: "list", loopName, graphId: graph.id, stageId: "stage", limit: 10 }, undefined, undefined, harness.ctx);
		assert.equal(bounded.details.attempts.length, 10);
		assert.equal(bounded.details.page.attempts.total, 150);
		assert.equal(bounded.details.nodes.find((node: any) => node.id === "lane").attempts, undefined);
		assert.equal(bounded.details.attempts[0].laneCommits.length, 20);
		assert.equal(bounded.details.attempts[0].changedPaths.length, 20);
		assert.equal(bounded.details.attempts[0].worktreePath, undefined);
		const stale = await stage.execute("upsert-stale", { action: "upsert", loopName, graph, expectedGraphRevision: 0 }, undefined, undefined, harness.ctx);
		assert.equal(stale.details.code, "stale_revision");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("stage lifecycle actions reject incomplete identity without mutating durable state", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stage-future-actions-"));
	try {
		const harness = makeHarness(cwd);
		await harness.tools.get("stardock_start").execute("start", { name: "Stage Future Actions", taskContent: "# Stage future actions\n" }, undefined, undefined, harness.ctx);
		const loopName = "Stage_Future_Actions";
		const { graph, brief } = graphAndBrief(`${loopName}:execution`);
		const raw = JSON.parse(fs.readFileSync(statePath(cwd, loopName), "utf-8"));
		raw.briefs.push(brief);
		fs.writeFileSync(statePath(cwd, loopName), JSON.stringify(raw, null, 2));
		const stage = harness.tools.get("stardock_stage");
		const created = await stage.execute("upsert", { action: "upsert", loopName, graph }, undefined, undefined, harness.ctx);
		assert.equal(created.details.ok, true);
		const before = fs.readFileSync(statePath(cwd, loopName));
		const actions = ["integrationPlan", "prepareIntegration", "recordIntegrated", "retry", "abandon", "release"];
		for (const action of actions) {
			const result = await stage.execute(`incomplete-${action}`, { action, loopName }, undefined, undefined, harness.ctx);
			assert.equal(result.isError, true);
			assert.equal(result.details.ok, false);
			assert.deepEqual(fs.readFileSync(statePath(cwd, loopName)), before);
		}
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("abandon requires nonblank rationale and approvalRef without mutating durable state", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stage-abandon-tool-"));
	try {
		const harness = makeHarness(cwd);
		await harness.tools.get("stardock_start").execute("start", { name: "Stage Abandon Tool", taskContent: "# Stage abandon\n" }, undefined, undefined, harness.ctx);
		const loopName = "Stage_Abandon_Tool";
		const { graph, brief } = graphAndBrief(`${loopName}:execution`);
		const raw = JSON.parse(fs.readFileSync(statePath(cwd, loopName), "utf-8"));
		raw.briefs.push(brief);
		fs.writeFileSync(statePath(cwd, loopName), JSON.stringify(raw, null, 2));
		const stage = harness.tools.get("stardock_stage");
		const created = await stage.execute("upsert", { action: "upsert", loopName, graph }, undefined, undefined, harness.ctx);
		assert.equal(created.details.ok, true);
		const before = fs.readFileSync(statePath(cwd, loopName));
		const missing = await stage.execute("abandon-missing", { action: "abandon", loopName, graphId: graph.id, stageId: "stage", expectedGraphRevision: 1 }, undefined, undefined, harness.ctx);
		assert.equal(missing.isError, true);
		assert.match(missing.content[0].text, /rationale and approvalRef/);
		assert.deepEqual(fs.readFileSync(statePath(cwd, loopName)), before);
		const blank = await stage.execute("abandon-blank", { action: "abandon", loopName, graphId: graph.id, stageId: "stage", expectedGraphRevision: 1, rationale: " ", approvalRef: "  " }, undefined, undefined, harness.ctx);
		assert.equal(blank.isError, true);
		assert.deepEqual(fs.readFileSync(statePath(cwd, loopName)), before);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
