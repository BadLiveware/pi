import * as fs from "node:fs";
import * as path from "node:path";
import { digestIterationBriefContract, type ExecutionGraph } from "../src/stages/contracts.ts";
import type { IterationBrief } from "../src/state/core.ts";
import type { RunReadyAdapter } from "../src/stages/run-ready.ts";
import { TreehouseLeaseSetupError, type TreehouseLease } from "../src/stages/treehouse-adapter.ts";
import { fiveNodeWaveFixture, refreshStageDigests } from "./fixtures/execution-graphs.ts";
import { makeHarness, statePath } from "./test-harness.ts";

function addBriefContracts(raw: any, graph: ExecutionGraph): void {
	for (const node of graph.nodes.filter((candidate) => candidate.kind === "implementation")) {
		const brief: IterationBrief = {
			id: node.briefId as string,
			status: "draft",
			source: "manual",
			objective: node.objective,
			task: `Implement ${node.id}.`,
			criterionIds: [],
			acceptanceCriteria: [`${node.id} committed`],
			verificationRequired: ["fake validation"],
			requiredContext: [],
			constraints: ["owned writes only"],
			avoid: ["integration"],
			outputContract: "Return lane evidence.",
			sourceRefs: [],
			createdAt: "2026-07-21T00:00:00.000Z",
			updatedAt: "2026-07-21T00:00:00.000Z",
		};
		node.briefDigest = digestIterationBriefContract(brief);
		raw.briefs.push(brief);
	}
	refreshStageDigests(graph);
}

export async function startFiveLane(cwd: string) {
	const harness = makeHarness(cwd);
	await harness.tools.get("stardock_start").execute("start", { name: "Run Ready", taskContent: "# Run Ready\n" }, undefined, undefined, harness.ctx);
	for (const handler of harness.handlers.get("session_start") ?? []) await handler({}, harness.ctx);
	const graph = fiveNodeWaveFixture();
	graph.stages[0].maxConcurrency = 2;
	const raw = JSON.parse(fs.readFileSync(statePath(cwd, "Run_Ready"), "utf-8"));
	addBriefContracts(raw, graph);
	raw.executionGraph = graph;
	fs.writeFileSync(statePath(cwd, "Run_Ready"), JSON.stringify(raw, null, 2));
	return { ...harness, graph, loopName: "Run_Ready" };
}

export class FakeAdapter implements RunReadyAdapter {
	readonly leases: TreehouseLease[] = [];
	readonly returned: string[] = [];
	failAt = -1;

	async leaseAndAnchor(input: any): Promise<TreehouseLease> {
		if (this.leases.length === this.failAt) throw new Error("fake acquisition failed");
		const lease = {
			worktreePath: path.join("/fake", input.nodeId),
			repositoryCommonDir: "/fake/repo/.git",
			contractCommit: input.contractCommit,
			branchRef: `stardock/${input.nodeId}/${input.attemptId}`,
			leaseHolder: input.leaseHolder,
		};
		this.leases.push(lease);
		return lease;
	}

	async returnLease(input: { lease: TreehouseLease }): Promise<void> {
		this.returned.push(input.lease.worktreePath);
	}

	async inspectLaneCompletion(lease: TreehouseLease) {
		const digit = String((this.leases.indexOf(lease) + 2) % 10);
		const headCommit = digit.repeat(40);
		return { headCommit, branchRef: `refs/heads/${lease.branchRef}`, clean: true, baseIsAncestor: true, laneCommits: [headCommit], changedPaths: [`src/${lease.worktreePath.split("/").at(-1)}/result.ts`] };
	}

	async runValidationCommands(_worktreePath: string, commands: string[]) {
		return commands.map((command) => ({ command, result: "passed" as const, summary: "fake validation passed" }));
	}
}

export class PartialSetupAdapter extends FakeAdapter {
	override async leaseAndAnchor(input: any): Promise<TreehouseLease> {
		throw new TreehouseLeaseSetupError("post-get inspection failed", {
			worktreePath: "/fake/partial-lease",
			repositoryCommonDir: "/fake/repo/.git",
			contractCommit: input.contractCommit,
			leaseHolder: input.leaseHolder,
		});
	}
}

export class DuplicateLeaseAdapter extends FakeAdapter {
	duplicatePath?: string;

	override async leaseAndAnchor(input: any): Promise<TreehouseLease> {
		const lease = await super.leaseAndAnchor(input);
		if (this.leases.length === 1) this.duplicatePath = lease.worktreePath;
		if (this.leases.length === 2) lease.worktreePath = this.leases[0].worktreePath;
		return lease;
	}
}

export class HungCleanupAdapter extends FakeAdapter {
	readonly cleanupSignals: AbortSignal[] = [];

	override async returnLease(input: { lease: TreehouseLease; signal?: AbortSignal }): Promise<void> {
		if (input.signal) this.cleanupSignals.push(input.signal);
		await new Promise<void>(() => undefined);
	}
}

export class BlockingSetupAdapter extends FakeAdapter {
	readonly setupStarted: Promise<void>;
	seenSignal?: AbortSignal;
	private resolveStarted: () => void = () => undefined;

	constructor() {
		super();
		this.setupStarted = new Promise((resolve) => { this.resolveStarted = resolve; });
	}

	override async leaseAndAnchor(input: any): Promise<TreehouseLease> {
		this.seenSignal = input.signal;
		this.resolveStarted();
		await new Promise<void>((_resolve, reject) => {
			const abort = () => reject(input.signal.reason ?? new Error("setup cancelled"));
			if (input.signal.aborted) abort();
			else input.signal.addEventListener("abort", abort, { once: true });
		});
		throw new Error("unreachable");
	}
}
