import * as fs from "node:fs";
import { runReadyStage, type RunReadyAdapter } from "../src/stages/run-ready.ts";
import type { TreehouseLease } from "../src/stages/treehouse-adapter.ts";
import { loadState } from "../src/state/store.ts";
import { FakeAdapter, startFiveLane } from "./stage-run-ready-test-support.ts";
import { statePath } from "./test-harness.ts";

export async function completeFakeWave(cwd: string) {
	const harness = await startFiveLane(cwd);
	const setupAdapter = new FakeAdapter();
	let id = 0;
	await runReadyStage({ events: harness.events } as any, harness.ctx, {
		loopName: harness.loopName,
		graphId: harness.graph.id,
		stageId: harness.graph.stages[0].id,
		expectedGraphRevision: harness.graph.revision,
		sessionId: "reconcile-test",
	}, undefined, undefined, {
		adapter: setupAdapter,
		idFactory: () => `reconcile${++id}`,
		invokeWorker: async ({ node }) => ({ response: { requestId: node.id, result: { details: { results: [{ finalOutput: "done" }] } }, isError: false } }),
	});
	return { harness, setupAdapter };
}

export function reservationKey(lease: { worktreePath?: string; repositoryCommonDir?: string; statusContextCwd?: string; leaseHolder?: string }): string {
	if (lease.worktreePath) return lease.worktreePath;
	return `${lease.statusContextCwd ?? lease.repositoryCommonDir ?? "no-repo"}::${lease.leaseHolder ?? "no-holder"}`;
}

export class EvidenceAdapter implements RunReadyAdapter {
	readonly returned: string[] = [];
	readonly modes = new Map<string, "committed" | "unchanged" | "dirty" | "missing">();
	readonly reservations = new Map<string, "held" | "absent" | "ambiguous">();
	private readonly attempts: Map<string, { base: string; head: string; branch: string; commits: string[]; changedPaths: string[] }>;

	constructor(attempts: Map<string, { base: string; head: string; branch: string; commits: string[]; changedPaths: string[] }>) {
		this.attempts = attempts;
	}

	async leaseAndAnchor(): Promise<TreehouseLease> {
		throw new Error("not used");
	}

	async inspectLaneCompletion(lease: TreehouseLease) {
		const evidence = this.attempts.get(lease.worktreePath);
		if (!evidence || this.modes.get(lease.worktreePath) === "missing") throw new Error("worktree missing");
		const mode = this.modes.get(lease.worktreePath) ?? "committed";
		let headCommit = evidence.head;
		let laneCommits = evidence.commits;
		let changedPaths = evidence.changedPaths;
		if (mode === "unchanged") {
			headCommit = evidence.base;
			laneCommits = [];
			changedPaths = [];
		}
		return { headCommit, branchRef: `refs/heads/${evidence.branch}`, clean: mode !== "dirty", baseIsAncestor: true, laneCommits, changedPaths };
	}

	async inspectLeaseReservation(lease: { worktreePath?: string; repositoryCommonDir?: string; statusContextCwd?: string; leaseHolder?: string }) {
		const state = this.reservations.get(reservationKey(lease)) ?? "held";
		let reason = "fake pool still reports the exact worktree lease";
		if (!lease.worktreePath && lease.leaseHolder) reason = `fake pool still reports the exact holder ${lease.leaseHolder}`;
		if (state === "absent") reason = "fake pool is empty for the exact holder/path evidence";
		if (state === "ambiguous") reason = "fake pool still has conflicting holder/path evidence";
		return {
			state,
			poolPath: "/fake/pool",
			reason,
			entries: [],
			holderEntries: [],
			statusStdout: "",
		};
	}

	async runValidationCommands() {
		return [];
	}

	async returnLease(input: { lease: TreehouseLease }): Promise<void> {
		this.returned.push(input.lease.worktreePath);
	}
}

export function evidenceAdapter(cwd: string, loopName: string): EvidenceAdapter {
	const state = loadState({ cwd } as any, loopName);
	const attempts = new Map<string, { base: string; head: string; branch: string; commits: string[]; changedPaths: string[] }>();
	for (const attempt of state?.executionGraph?.nodes.flatMap((node) => node.attempts) ?? []) {
		if (!attempt.worktreePath || !attempt.headCommit) continue;
		attempts.set(attempt.worktreePath, { base: attempt.baseCommit, head: attempt.headCommit, branch: attempt.branchRef, commits: attempt.laneCommits, changedPaths: attempt.changedPaths ?? [] });
	}
	return new EvidenceAdapter(attempts);
}

export function rewriteState(cwd: string, loopName: string, update: (raw: any) => void): void {
	const filePath = statePath(cwd, loopName);
	const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
	update(raw);
	fs.writeFileSync(filePath, JSON.stringify(raw, null, 2));
}
