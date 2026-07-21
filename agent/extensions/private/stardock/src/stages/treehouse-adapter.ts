import { randomUUID } from "node:crypto";
import * as path from "node:path";
import {
	defaultArgumentProcessRunner,
	type ArgumentProcessResult,
	type ArgumentProcessRunner,
} from "./argument-process.ts";
import { commandDescription, failureMessage, processOptions } from "./treehouse-process.ts";
import {
	inspectLeaseReservationStatus,
	type LeaseReservationInspection,
	type TreehouseStatusEntry,
} from "./treehouse-status.ts";

export {
	defaultArgumentProcessRunner,
	type ArgumentProcessOptions,
	type ArgumentProcessResult,
	type ArgumentProcessRunner,
} from "./argument-process.ts";

const EXACT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const DEFAULT_BRANCH_ATTEMPTS = 20;
const BRANCH_SEGMENT_LIMIT = 80;

export interface ParentPreflightInput {
	parentRepositoryPath: string;
	parentBranch: string;
	parentHeadCommit: string;
	integrationBaseCommit: string;
	contractCommit: string;
	signal?: AbortSignal;
}

export interface ParentPreflightResult {
	repositoryCommonDir: string;
	parentBranch: string;
	parentHeadCommit: string;
	contractCommit: string;
}

export interface LaneIdentity {
	loopId: string;
	stageId: string;
	nodeId: string;
	attemptId: string;
}

export interface LeaseAndAnchorInput extends ParentPreflightInput, LaneIdentity {
	leaseHolder: string;
}

export interface PartialTreehouseLease {
	worktreePath?: string;
	repositoryCommonDir?: string;
	statusContextCwd?: string;
	contractCommit: string;
	branchRef?: string;
	leaseHolder?: string;
}

export interface TreehouseLease extends PartialTreehouseLease {
	worktreePath: string;
	repositoryCommonDir: string;
	branchRef: string;
	leaseHolder: string;
}

export interface LeaseInspectionInput {
	worktreePath: string;
	expectedRepositoryCommonDir: string;
	expectedHeadCommit?: string;
	expectedBranchRef?: string;
	signal?: AbortSignal;
}

export interface LeaseInspection {
	worktreePath: string;
	repositoryCommonDir: string;
	headCommit: string;
	branchRef?: string;
	clean: boolean;
}

export interface ReturnLeaseInput {
	lease: TreehouseLease;
	expectedHeadCommit: string;
	signal?: AbortSignal;
}

export interface LaneCompletionEvidence {
	headCommit: string;
	branchRef?: string;
	clean: boolean;
	baseIsAncestor: boolean;
	laneCommits: string[];
	changedPaths: string[];
}

export interface LaneValidationEvidence {
	command: string;
	result: "passed" | "failed";
	summary: string;
}

export type { LeaseReservationInspection, TreehouseStatusEntry } from "./treehouse-status.ts";

export interface TreehouseAdapterOptions {
	runner?: ArgumentProcessRunner;
	treehouseCommand?: string;
	gitCommand?: string;
	idFactory?: () => string;
	maxBranchAttempts?: number;
}

export class TreehouseAdapterError extends Error {
	readonly command?: string;
	readonly args?: readonly string[];
	readonly result?: ArgumentProcessResult;

	constructor(message: string, details?: { command: string; args: readonly string[]; result: ArgumentProcessResult }) {
		super(message);
		this.name = "TreehouseAdapterError";
		if (details) {
			this.command = details.command;
			this.args = details.args;
			this.result = details.result;
		}
	}
}

export class TreehouseLeaseSetupError extends Error {
	readonly partialLease: PartialTreehouseLease;

	constructor(message: string, partialLease: PartialTreehouseLease) {
		super(message);
		this.name = "TreehouseLeaseSetupError";
		this.partialLease = structuredClone(partialLease);
	}
}

export function partialLeaseFromError(error: unknown): PartialTreehouseLease | undefined {
	if (error instanceof TreehouseLeaseSetupError) return structuredClone(error.partialLease);
	return undefined;
}

function nonEmpty(value: string, label: string): string {
	const trimmed = value.trim();
	if (!trimmed) throw new TreehouseAdapterError(`${label} must not be empty.`);
	return trimmed;
}

function exactSha(value: string, label: string): string {
	if (!EXACT_SHA_PATTERN.test(value)) {
		throw new TreehouseAdapterError(`${label} must be an exact 40-character lowercase Git SHA; received "${value}".`);
	}
	return value;
}

function singleLine(result: ArgumentProcessResult, label: string): string {
	const lines = result.stdout.split(/\r?\n/).filter((line) => line.length > 0);
	if (lines.length !== 1) {
		throw new TreehouseAdapterError(`${label} must produce exactly one non-empty stdout line; received ${lines.length}.`);
	}
	return lines[0];
}

function normalizeCommonDir(worktreePath: string, value: string): string {
	const trimmed = nonEmpty(value, "Git common directory");
	return path.resolve(worktreePath, trimmed);
}

function branchSegment(value: string, label: string): string {
	const trimmed = nonEmpty(value, label);
	let segment = trimmed.replace(/[^a-zA-Z0-9._-]+/g, "-");
	segment = segment.replace(/^[-.]+|[-.]+$/g, "");
	segment = segment.replace(/\.\.+/g, "-");
	segment = segment.slice(0, BRANCH_SEGMENT_LIMIT);
	if (!segment) throw new TreehouseAdapterError(`${label} does not contain characters safe for a Git branch.`);
	if (segment.endsWith(".lock")) segment = `${segment.slice(0, -5)}-lock`;
	return segment;
}

function defaultIdFactory(): string {
	return randomUUID().replaceAll("-", "").slice(0, 12);
}

export class TreehouseAdapter {
	private readonly runner: ArgumentProcessRunner;
	private readonly treehouseCommand: string;
	private readonly gitCommand: string;
	private readonly idFactory: () => string;
	private readonly maxBranchAttempts: number;

	constructor(options: TreehouseAdapterOptions = {}) {
		this.runner = options.runner ?? defaultArgumentProcessRunner;
		this.treehouseCommand = options.treehouseCommand ?? "treehouse";
		this.gitCommand = options.gitCommand ?? "git";
		this.idFactory = options.idFactory ?? defaultIdFactory;
		this.maxBranchAttempts = options.maxBranchAttempts ?? DEFAULT_BRANCH_ATTEMPTS;
		if (!Number.isInteger(this.maxBranchAttempts) || this.maxBranchAttempts < 1) {
			throw new TreehouseAdapterError("maxBranchAttempts must be a positive integer.");
		}
	}

	private async checked(command: string, args: readonly string[], cwd: string, label: string, signal?: AbortSignal): Promise<ArgumentProcessResult> {
		signal?.throwIfAborted();
		const result = await this.runner(command, args, processOptions(cwd, signal));
		signal?.throwIfAborted();
		if (result.exitCode !== 0) {
			throw new TreehouseAdapterError(failureMessage(label, command, args, result), { command, args, result });
		}
		return result;
	}

	private async git(worktreePath: string, args: readonly string[], label: string, signal?: AbortSignal): Promise<ArgumentProcessResult> {
		return this.checked(this.gitCommand, ["-C", worktreePath, ...args], worktreePath, label, signal);
	}

	async version(cwd: string, signal?: AbortSignal): Promise<ArgumentProcessResult> {
		return this.checked(this.treehouseCommand, ["--version"], cwd, "Treehouse version inspection", signal);
	}

	async status(cwd: string, signal?: AbortSignal): Promise<ArgumentProcessResult> {
		return this.checked(this.treehouseCommand, ["status"], cwd, "Treehouse status inspection", signal);
	}

	async inspectLeaseReservation(lease: PartialTreehouseLease, signal?: AbortSignal): Promise<LeaseReservationInspection> {
		let statusCwd: string | undefined;
		if (lease.statusContextCwd) {
			statusCwd = path.resolve(nonEmpty(lease.statusContextCwd, "statusContextCwd"));
		} else if (lease.repositoryCommonDir) {
			const repositoryCommonDir = path.resolve(lease.repositoryCommonDir);
			statusCwd = repositoryCommonDir;
			if (path.basename(repositoryCommonDir) === ".git") statusCwd = path.dirname(repositoryCommonDir);
		} else if (lease.worktreePath) {
			statusCwd = path.resolve(nonEmpty(lease.worktreePath, "worktreePath"));
		}
		if (!statusCwd) {
			return {
				state: "ambiguous",
				reason: "Lease reservation inspection requires an exact worktree path, lease holder, or parent repository context.",
				entries: [],
				holderEntries: [],
				statusStdout: "",
			};
		}
		const statusLease: PartialTreehouseLease = { ...lease, statusContextCwd: statusCwd };
		const status = await this.status(statusCwd, signal);
		return inspectLeaseReservationStatus(statusLease, status.stdout);
	}

	async preflightParent(input: ParentPreflightInput): Promise<ParentPreflightResult> {
		const parentPath = path.resolve(nonEmpty(input.parentRepositoryPath, "parentRepositoryPath"));
		const parentBranch = nonEmpty(input.parentBranch, "parentBranch");
		const parentHead = exactSha(input.parentHeadCommit, "parentHeadCommit");
		const integrationBase = exactSha(input.integrationBaseCommit, "integrationBaseCommit");
		const contractCommit = exactSha(input.contractCommit, "contractCommit");
		if (parentHead !== integrationBase || parentHead !== contractCommit) {
			throw new TreehouseAdapterError(
				`Immutable parent preflight mismatch: parentHeadCommit (${parentHead}), integrationBaseCommit (${integrationBase}), and contractCommit (${contractCommit}) must be identical before leasing.`,
			);
		}

		await this.assertManagedWorktree(parentPath, "Parent repository", input.signal);
		const branchResult = await this.git(parentPath, ["symbolic-ref", "--quiet", "HEAD"], "Parent branch inspection", input.signal);
		const actualBranchRef = singleLine(branchResult, "Parent branch inspection");
		const expectedBranchRef = `refs/heads/${parentBranch}`;
		if (actualBranchRef !== expectedBranchRef) {
			throw new TreehouseAdapterError(`Parent branch mismatch: expected "${expectedBranchRef}", received "${actualBranchRef}". No lease was acquired.`);
		}
		const headResult = await this.git(parentPath, ["rev-parse", "--verify", "HEAD^{commit}"], "Parent HEAD inspection", input.signal);
		const actualHead = singleLine(headResult, "Parent HEAD inspection");
		if (actualHead !== parentHead) {
			throw new TreehouseAdapterError(`Parent HEAD mismatch: expected ${parentHead}, received ${actualHead}. No lease was acquired.`);
		}
		await this.assertClean(parentPath, "Parent repository", input.signal);
		const repositoryCommonDir = await this.readCommonDir(parentPath, "Parent repository", input.signal);
		return { repositoryCommonDir, parentBranch, parentHeadCommit: parentHead, contractCommit };
	}

	async inspectLease(input: LeaseInspectionInput): Promise<LeaseInspection> {
		const worktreePath = path.resolve(nonEmpty(input.worktreePath, "worktreePath"));
		await this.assertManagedWorktree(worktreePath, "Leased worktree", input.signal);
		const repositoryCommonDir = await this.readCommonDir(worktreePath, "Leased worktree", input.signal);
		const expectedCommonDir = path.resolve(nonEmpty(input.expectedRepositoryCommonDir, "expectedRepositoryCommonDir"));
		if (repositoryCommonDir !== expectedCommonDir) {
			throw new TreehouseAdapterError(`Leased worktree repository mismatch: expected Git common directory "${expectedCommonDir}", received "${repositoryCommonDir}". Keep the lease for inspection.`);
		}
		const status = await this.git(worktreePath, ["status", "--porcelain=v1", "--untracked-files=all"], "Leased worktree cleanliness inspection", input.signal);
		const headResult = await this.git(worktreePath, ["rev-parse", "--verify", "HEAD^{commit}"], "Leased worktree HEAD inspection", input.signal);
		const headCommit = singleLine(headResult, "Leased worktree HEAD inspection");
		if (input.expectedHeadCommit !== undefined) {
			const expectedHead = exactSha(input.expectedHeadCommit, "expectedHeadCommit");
			if (headCommit !== expectedHead) {
				throw new TreehouseAdapterError(`Leased worktree HEAD mismatch: expected ${expectedHead}, received ${headCommit}. Keep the lease for inspection.`);
			}
		}
		let branchRef: string | undefined;
		const branchResult = await this.runner(this.gitCommand, ["-C", worktreePath, "symbolic-ref", "--quiet", "HEAD"], processOptions(worktreePath, input.signal));
		input.signal?.throwIfAborted();
		if (branchResult.exitCode === 0) branchRef = singleLine(branchResult, "Leased worktree branch inspection");
		else if (branchResult.exitCode !== 1) {
			throw new TreehouseAdapterError(failureMessage("Leased worktree branch inspection", this.gitCommand, ["-C", worktreePath, "symbolic-ref", "--quiet", "HEAD"], branchResult));
		}
		if (input.expectedBranchRef !== undefined) {
			const expectedBranchRef = `refs/heads/${nonEmpty(input.expectedBranchRef, "expectedBranchRef")}`;
			if (branchRef !== expectedBranchRef) {
				throw new TreehouseAdapterError(`Leased worktree branch mismatch: expected "${expectedBranchRef}", received "${branchRef ?? "detached HEAD"}". Keep the lease for inspection.`);
			}
		}
		return { worktreePath, repositoryCommonDir, headCommit, branchRef, clean: status.stdout.length === 0 };
	}

	async leaseAndAnchor(input: LeaseAndAnchorInput): Promise<TreehouseLease> {
		const preflight = await this.preflightParent(input);
		const leaseHolder = nonEmpty(input.leaseHolder, "leaseHolder");
		const getResult = await this.checked(
			this.treehouseCommand,
			["get", "--lease", "--lease-holder", leaseHolder],
			path.resolve(input.parentRepositoryPath),
			"Treehouse lease acquisition",
			input.signal,
		);
		const rawWorktreePath = singleLine(getResult, "Treehouse lease acquisition");
		const partialLease: PartialTreehouseLease = {
			worktreePath: rawWorktreePath,
			contractCommit: preflight.contractCommit,
			leaseHolder,
		};
		try {
			if (!path.isAbsolute(rawWorktreePath)) {
				throw new TreehouseAdapterError(`Treehouse lease acquisition returned a non-absolute path "${rawWorktreePath}". Keep any created lease for inspection.`);
			}
			const worktreePath = path.normalize(rawWorktreePath);
			partialLease.worktreePath = worktreePath;
			partialLease.repositoryCommonDir = preflight.repositoryCommonDir;
			const acquiredInspection = await this.inspectLease({ worktreePath, expectedRepositoryCommonDir: preflight.repositoryCommonDir, signal: input.signal });
			if (!acquiredInspection.clean) throw new TreehouseAdapterError(`Leased worktree at "${worktreePath}" is dirty immediately after acquisition. Keep the lease for inspection.`);
			await this.git(worktreePath, ["switch", "--detach", preflight.contractCommit], "Lease base checkout", input.signal);
			const detachedInspection = await this.inspectLease({
				worktreePath,
				expectedRepositoryCommonDir: preflight.repositoryCommonDir,
				expectedHeadCommit: preflight.contractCommit,
				signal: input.signal,
			});
			if (!detachedInspection.clean) throw new TreehouseAdapterError(`Leased worktree at "${worktreePath}" became dirty while anchoring. Keep the lease for inspection.`);
			const branchRef = await this.createUniqueBranch(worktreePath, input, preflight.contractCommit, input.signal);
			partialLease.branchRef = branchRef;
			const anchoredInspection = await this.inspectLease({
				worktreePath,
				expectedRepositoryCommonDir: preflight.repositoryCommonDir,
				expectedHeadCommit: preflight.contractCommit,
				expectedBranchRef: branchRef,
				signal: input.signal,
			});
			if (!anchoredInspection.clean) throw new TreehouseAdapterError(`Leased worktree at "${worktreePath}" became dirty while creating its branch. Keep the lease for inspection.`);
			return {
				worktreePath,
				repositoryCommonDir: preflight.repositoryCommonDir,
				contractCommit: preflight.contractCommit,
				branchRef,
				leaseHolder,
			};
		} catch (error) {
			let message = String(error);
			if (error instanceof Error) message = error.message;
			throw new TreehouseLeaseSetupError(message, partialLease);
		}
	}

	async inspectLaneCompletion(lease: TreehouseLease, signal?: AbortSignal): Promise<LaneCompletionEvidence> {
		const worktreePath = path.resolve(lease.worktreePath);
		await this.assertManagedWorktree(worktreePath, "Leased worktree", signal);
		const repositoryCommonDir = await this.readCommonDir(worktreePath, "Leased worktree", signal);
		if (repositoryCommonDir !== path.resolve(lease.repositoryCommonDir)) {
			throw new TreehouseAdapterError(`Leased worktree repository mismatch: expected Git common directory "${path.resolve(lease.repositoryCommonDir)}", received "${repositoryCommonDir}". Keep the lease for inspection.`);
		}
		const status = await this.git(worktreePath, ["status", "--porcelain=v1", "--untracked-files=all"], "Lane cleanliness inspection", signal);
		const head = singleLine(await this.git(worktreePath, ["rev-parse", "--verify", "HEAD^{commit}"], "Lane HEAD inspection", signal), "Lane HEAD inspection");
		const branchResult = await this.runner(this.gitCommand, ["-C", worktreePath, "symbolic-ref", "--quiet", "HEAD"], processOptions(worktreePath, signal));
		signal?.throwIfAborted();
		let branchRef: string | undefined;
		if (branchResult.exitCode === 0) branchRef = singleLine(branchResult, "Lane branch inspection");
		else if (branchResult.exitCode !== 1) throw new TreehouseAdapterError(failureMessage("Lane branch inspection", this.gitCommand, ["-C", worktreePath, "symbolic-ref", "--quiet", "HEAD"], branchResult));
		const ancestryArgs = ["-C", worktreePath, "merge-base", "--is-ancestor", lease.contractCommit, head];
		const ancestry = await this.runner(this.gitCommand, ancestryArgs, processOptions(worktreePath, signal));
		signal?.throwIfAborted();
		if (ancestry.exitCode !== 0 && ancestry.exitCode !== 1) {
			throw new TreehouseAdapterError(failureMessage("Lane base ancestry inspection", this.gitCommand, ancestryArgs, ancestry), { command: this.gitCommand, args: ancestryArgs, result: ancestry });
		}
		const commitsResult = await this.git(worktreePath, ["log", "--reverse", "--format=%H", `${lease.contractCommit}..${head}`], "Lane commit inspection", signal);
		const pathsResult = await this.git(worktreePath, ["diff", "--name-only", `${lease.contractCommit}...${head}`], "Lane changed-path inspection", signal);
		return {
			headCommit: head,
			branchRef,
			clean: status.stdout.length === 0,
			baseIsAncestor: ancestry.exitCode === 0,
			laneCommits: commitsResult.stdout.split(/\r?\n/).filter(Boolean),
			changedPaths: pathsResult.stdout.split(/\r?\n/).filter(Boolean),
		};
	}

	async runValidationCommands(worktreePath: string, commands: string[], signal?: AbortSignal): Promise<LaneValidationEvidence[]> {
		const results: LaneValidationEvidence[] = [];
		for (const command of commands) {
			signal?.throwIfAborted();
			const result = await this.runner("/bin/sh", ["-lc", command], processOptions(worktreePath, signal));
			signal?.throwIfAborted();
			const output = (result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`).slice(0, 500);
			let validationResult: LaneValidationEvidence["result"] = "failed";
			if (result.exitCode === 0) validationResult = "passed";
			results.push({ command, result: validationResult, summary: output });
		}
		return results;
	}

	async returnLease(input: ReturnLeaseInput): Promise<ArgumentProcessResult> {
		const expectedHead = exactSha(input.expectedHeadCommit, "expectedHeadCommit");
		const inspection = await this.inspectLease({
			worktreePath: input.lease.worktreePath,
			expectedRepositoryCommonDir: input.lease.repositoryCommonDir,
			expectedHeadCommit: expectedHead,
			expectedBranchRef: input.lease.branchRef,
			signal: input.signal,
		});
		if (!inspection.clean) throw new TreehouseAdapterError(`Leased worktree at "${inspection.worktreePath}" is dirty. Preserve it and inspect before return.`);
		return this.checked(
			this.treehouseCommand,
			["return", input.lease.worktreePath],
			input.lease.worktreePath,
			"Treehouse lease return",
			input.signal,
		);
	}

	private async assertManagedWorktree(worktreePath: string, label: string, signal?: AbortSignal): Promise<void> {
		const result = await this.git(worktreePath, ["rev-parse", "--is-inside-work-tree"], `${label} management inspection`, signal);
		if (singleLine(result, `${label} management inspection`) !== "true") {
			throw new TreehouseAdapterError(`${label} at "${worktreePath}" is not a managed Git worktree.`);
		}
	}

	private async assertClean(worktreePath: string, label: string, signal?: AbortSignal): Promise<void> {
		const result = await this.git(worktreePath, ["status", "--porcelain=v1", "--untracked-files=all"], `${label} cleanliness inspection`, signal);
		if (result.stdout.length > 0) {
			throw new TreehouseAdapterError(`${label} at "${worktreePath}" is dirty. Preserve it and inspect: ${result.stdout.trim()}`);
		}
	}

	private async readCommonDir(worktreePath: string, label: string, signal?: AbortSignal): Promise<string> {
		const result = await this.git(worktreePath, ["rev-parse", "--path-format=absolute", "--git-common-dir"], `${label} identity inspection`, signal);
		return normalizeCommonDir(worktreePath, singleLine(result, `${label} identity inspection`));
	}

	private lanePrefix(identity: LaneIdentity): string {
		return [
			"stardock",
			branchSegment(identity.loopId, "loopId"),
			branchSegment(identity.stageId, "stageId"),
			branchSegment(identity.nodeId, "nodeId"),
			branchSegment(identity.attemptId, "attemptId"),
		].join("/");
	}

	private async branchExists(worktreePath: string, branchRef: string, signal?: AbortSignal): Promise<boolean> {
		const args = ["-C", worktreePath, "show-ref", "--verify", "--quiet", `refs/heads/${branchRef}`];
		const result = await this.runner(this.gitCommand, args, processOptions(worktreePath, signal));
		signal?.throwIfAborted();
		if (result.exitCode === 0) return true;
		if (result.exitCode === 1) return false;
		throw new TreehouseAdapterError(failureMessage("Lane branch collision inspection", this.gitCommand, args, result), {
			command: this.gitCommand,
			args,
			result,
		});
	}

	private async createUniqueBranch(worktreePath: string, identity: LaneIdentity, contractCommit: string, signal?: AbortSignal): Promise<string> {
		const prefix = this.lanePrefix(identity);
		for (let attempt = 0; attempt < this.maxBranchAttempts; attempt++) {
			signal?.throwIfAborted();
			const suffix = branchSegment(this.idFactory(), "generated branch suffix");
			const branchRef = `${prefix}-${suffix}`;
			if (await this.branchExists(worktreePath, branchRef, signal)) continue;
			const args = ["-C", worktreePath, "switch", "-c", branchRef, contractCommit];
			const result = await this.runner(this.gitCommand, args, processOptions(worktreePath, signal));
			signal?.throwIfAborted();
			if (result.exitCode === 0) return branchRef;
			if (await this.branchExists(worktreePath, branchRef, signal)) continue;
			throw new TreehouseAdapterError(failureMessage("Lane branch creation", this.gitCommand, args, result), {
				command: this.gitCommand,
				args,
				result,
			});
		}
		throw new TreehouseAdapterError(`Could not allocate a unique lane branch after ${this.maxBranchAttempts} collision-safe attempts. Existing refs were preserved.`);
	}
}
