import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { releaseSupersededPlanResources } from "../src/execution-plan/authoring.ts";
import { materializeExecutionPlanWave } from "../src/execution-plan/materialize.ts";
import { buildExecutionPlanSystemInstructions } from "../src/execution-plan/prompts.ts";
import { loadState, mutateState } from "../src/state/store.ts";
import { fanoutPlan, seedReviewWave } from "./execution-plan-fixtures.ts";
import { FakeAdapter } from "./stage-run-ready-test-support.ts";
import { makeHarness } from "./test-harness.ts";

function node(id: string, dependsOn: string[] = []) {
	return {
		id,
		objective: `Complete ${id}`,
		task: `Implement ${id}.`,
		dependsOn,
		acceptanceCriteria: [`${id} behavior is verified.`],
		writes: [`src/${id}`],
		validationCommands: [`test-${id}`],
	};
}

test("stardock_plan incrementally authors, persists, seals, and freezes a draft DAG", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-plan-authoring-"));
	try {
		const { tools, ctx } = makeHarness(cwd);
		const planTool = tools.get("stardock_plan");
		const draft = await planTool.execute("draft", {
			action: "draft",
			name: "incremental",
			objective: "Build an incremental DAG",
			integrationValidationCommands: ["test-all"],
		}, undefined, undefined, ctx);
		assert.equal(draft.isError, undefined);
		assert.equal((draft.details as any).plan.status, "draft");
		assert.equal((draft.details as any).plan.nextAction, "plan");
		const emptyDraftState = loadState(ctx, "incremental")!;
		assert.equal(emptyDraftState.executionPlan?.nodes.length, 0, "metadata-only drafts must survive persistence");
		assert.match(buildExecutionPlanSystemInstructions(emptyDraftState), /upsert[\s\S]*seal[\s\S]*Do not run the draft/i);
		await planTool.execute("upsert-forward-ref", { action: "upsert", name: "incremental", nodes: [node("leaf", ["contract"])] }, undefined, undefined, ctx);
		assert.equal(loadState(ctx, "incremental")?.executionPlan?.status, "draft", "drafts with forward dependency references must survive persistence");

		const prematureRun = await tools.get("stardock_run").execute("run-draft", { name: "incremental" }, undefined, undefined, ctx);
		assert.equal(prematureRun.isError, true);
		assert.match(prematureRun.content[0].text, /still a draft.*seal/i);

		const upsert = await planTool.execute("upsert", { action: "upsert", name: "incremental", nodes: [node("contract"), { ...node("leaf", ["contract"]), objective: "Complete the corrected leaf" }] }, undefined, undefined, ctx);
		assert.equal(upsert.isError, undefined);
		assert.equal((upsert.details as any).plan.revision, 3);
		assert.equal(loadState(ctx, "incremental")?.executionPlan?.nodes.find((item) => item.id === "leaf")?.objective, "Complete the corrected leaf");

		const sealed = await planTool.execute("seal", { action: "seal", name: "incremental" }, undefined, undefined, ctx);
		assert.equal(sealed.isError, undefined);
		assert.equal((sealed.details as any).plan.status, "running");
		assert.deepEqual((sealed.details as any).plan.readyNodeIds, ["contract"]);

		const mutation = await planTool.execute("late-upsert", { action: "upsert", name: "incremental", nodes: [node("late")] }, undefined, undefined, ctx);
		assert.equal(mutation.isError, true);
		assert.match(mutation.content[0].text, /sealed.*cannot be changed/i);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("sealing keeps an invalid draft mutable until missing dependencies are supplied", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-plan-seal-"));
	try {
		const { tools, ctx } = makeHarness(cwd);
		const planTool = tools.get("stardock_plan");
		await planTool.execute("draft", { action: "draft", name: "invalid-draft", objective: "Complete later", integrationValidationCommands: ["test-all"], nodes: [node("leaf", ["missing"])] }, undefined, undefined, ctx);
		const rejected = await planTool.execute("seal-invalid", { action: "seal", name: "invalid-draft" }, undefined, undefined, ctx);
		assert.equal(rejected.isError, true);
		assert.match(rejected.content[0].text, /depends on missing node "missing"/);
		assert.equal(loadState(ctx, "invalid-draft")?.executionPlan?.status, "draft");
		await planTool.execute("upsert-missing", { action: "upsert", name: "invalid-draft", nodes: [node("missing")] }, undefined, undefined, ctx);
		const sealed = await planTool.execute("seal-valid", { action: "seal", name: "invalid-draft" }, undefined, undefined, ctx);
		assert.equal(sealed.isError, undefined);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("the default stardock_plan action remains a one-call sealed plan", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-plan-replace-"));
	try {
		const { id: _id, ...input } = fanoutPlan();
		const { tools, ctx } = makeHarness(cwd);
		const result = await tools.get("stardock_plan").execute("replace", { ...input, name: "one-shot" }, undefined, undefined, ctx);
		assert.equal(result.isError, undefined);
		assert.equal((result.details as any).plan.status, "running");
		assert.equal((result.details as any).plan.nextAction, "run");
		const overwrite = await tools.get("stardock_plan").execute("overwrite", { ...input, name: "one-shot" }, undefined, undefined, ctx);
		assert.equal(overwrite.isError, true);
		assert.match(overwrite.content[0].text, /sealed.*cannot be replaced/i);
		const superseding = await tools.get("stardock_plan").execute("supersede", { ...input, name: "one-shot-v2", supersedesPlan: "one-shot", replanReason: "Requirements changed before execution." }, undefined, undefined, ctx);
		assert.equal(superseding.isError, undefined);
		assert.equal(loadState(ctx, "one-shot-v2")?.executionPlan?.supersedesPlan, "one-shot");
		assert.equal(loadState(ctx, "one-shot")?.executionPlan?.status, "superseded");
		assert.equal(loadState(ctx, "one-shot")?.executionPlan?.supersededBy, "one-shot-v2");
		const retiredRun = await tools.get("stardock_run").execute("run-retired", { name: "one-shot" }, undefined, undefined, ctx);
		assert.equal(retiredRun.isError, true);
		assert.match(retiredRun.content[0].text, /superseded.*no job wave/i);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("failed successor persistence leaves the predecessor runnable", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-plan-supersede-failure-"));
	try {
		const { id: _id, ...input } = fanoutPlan();
		const { tools, ctx } = makeHarness(cwd);
		await tools.get("stardock_plan").execute("old", { ...input, name: "old" }, undefined, undefined, ctx);
		const runsPath = path.join(cwd, ".stardock", "runs");
		fs.chmodSync(runsPath, 0o500);
		const failed = await tools.get("stardock_plan").execute("new", { ...input, name: "new", supersedesPlan: "old", replanReason: "Requirements changed." }, undefined, undefined, ctx);
		assert.equal(failed.isError, true);
		assert.equal(loadState(ctx, "old")?.executionPlan?.status, "running");
		assert.equal(loadState(ctx, "old")?.executionPlan?.supersededBy, undefined);
	} finally {
		const runsPath = path.join(cwd, ".stardock", "runs");
		if (fs.existsSync(runsPath)) fs.chmodSync(runsPath, 0o700);
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("superseded plans return clean inactive worktree leases", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-plan-supersede-release-"));
	try {
		const { id: _id, ...input } = fanoutPlan();
		input.nodes = [{ ...input.nodes[0] }];
		const { tools, ctx } = makeHarness(cwd);
		await tools.get("stardock_plan").execute("plan", { ...input, name: "release-old" }, undefined, undefined, ctx);
		await materializeExecutionPlanWave(ctx, "release-old", undefined, {
			inspectWorktree: async () => ({ worktreePath: cwd, repositoryCommonDir: path.join(cwd, ".git"), headCommit: "a".repeat(40), branchRef: "refs/heads/main", clean: true }),
		} as any);
		seedReviewWave(ctx, "release-old");
		const adapter = new class extends FakeAdapter {
			override async inspectLaneCompletion(lease: any) {
				return { headCommit: "a".repeat(40), branchRef: `refs/heads/${lease.branchRef}`, clean: true, baseIsAncestor: true, laneCommits: [], changedPaths: [] };
			}
		}();
		const lease = { worktreePath: "/fake/release-old", repositoryCommonDir: "/fake/repo/.git", contractCommit: "a".repeat(40), branchRef: "lane-1", leaseHolder: "holder" };
		adapter.leases.push(lease);
		mutateState(ctx, "release-old", (state) => {
			const plan = state.executionPlan!;
			const graph = state.executionGraph!;
			const wave = plan.waves[0];
			const stage = graph.stages[0];
			const executionNode = graph.nodes.find((candidate) => candidate.id === stage.implementationNodeIds[0])!;
			const attempt = executionNode.attempts[0];
			plan.status = "superseded";
			plan.supersededBy = "release-new";
			plan.nodes[0].status = "abandoned";
			wave.status = "abandoned";
			stage.status = "abandoned";
			executionNode.status = "abandoned";
			graph.status = "abandoned";
			attempt.worktreePath = lease.worktreePath;
			attempt.repositoryCommonDir = lease.repositoryCommonDir;
			attempt.leaseHolder = lease.leaseHolder;
			attempt.leaseDisposition = "held";
			attempt.clean = true;
		});
		const warnings = await releaseSupersededPlanResources(ctx, "release-old", undefined, adapter);
		assert.deepEqual(warnings, []);
		assert.deepEqual(adapter.returned, [lease.worktreePath]);
		const attempt = loadState(ctx, "release-old")!.executionGraph!.nodes.flatMap((candidate) => candidate.attempts)[0];
		assert.equal(attempt.leaseDisposition, "released");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("draft replacement prunes removed derived records", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-plan-prune-"));
	try {
		const { tools, ctx } = makeHarness(cwd);
		const planTool = tools.get("stardock_plan");
		await planTool.execute("draft", { action: "draft", name: "prune", objective: "Prune draft nodes", integrationValidationCommands: ["test-all"], nodes: [node("a"), node("b")] }, undefined, undefined, ctx);
		const before = loadState(ctx, "prune")!;
		const removed = before.executionPlan!.nodes.find((item) => item.id === "b")!;
		const replaced = await planTool.execute("replace-draft", { name: "prune", objective: "Prune draft nodes", integrationValidationCommands: ["test-all"], nodes: [node("a")] }, undefined, undefined, ctx);
		assert.equal(replaced.isError, undefined);
		const after = loadState(ctx, "prune")!;
		assert.equal(after.criterionLedger.criteria.some((item) => item.id === removed.criterionId), false);
		assert.equal(after.briefs.some((item) => item.id === removed.briefId), false);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("projection failure warns after canonical seal instead of reporting a retryable failure", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-plan-projection-"));
	try {
		const { tools, ctx } = makeHarness(cwd);
		const planTool = tools.get("stardock_plan");
		await planTool.execute("draft", { action: "draft", name: "projection", objective: "Keep canonical state authoritative", integrationValidationCommands: ["test-all"], nodes: [node("a")] }, undefined, undefined, ctx);
		const taskPath = path.resolve(cwd, loadState(ctx, "projection")!.taskFile);
		fs.rmSync(taskPath, { force: true });
		fs.mkdirSync(taskPath, { recursive: true });
		const sealed = await planTool.execute("seal", { action: "seal", name: "projection" }, undefined, undefined, ctx);
		assert.equal(sealed.isError, undefined);
		assert.match(sealed.content[0].text, /Canonical plan state was committed.*projection could not be updated/i);
		assert.equal((sealed.details as any).warnings.length, 1);
		assert.equal(loadState(ctx, "projection")?.executionPlan?.status, "running");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
