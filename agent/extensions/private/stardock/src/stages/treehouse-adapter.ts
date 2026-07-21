import { execFile, type ExecFileException } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as path from "node:path";

const EXACT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const DEFAULT_BRANCH_ATTEMPTS = 20;
const BRANCH_SEGMENT_LIMIT = 80;

export interface ArgumentProcessOptions {
	cwd: string;
}

export interface ArgumentProcessResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

export type ArgumentProcessRunner = (
	command: string,
	args: readonly string[],
	options: ArgumentProcessOptions,
) => Promise<ArgumentProcessResult>;

export interface ParentPreflightInput {
	parentRepositoryPath: string;
	parentBranch: string;
	parentHeadCommit: string;
	integrationBaseCommit: string;
	contractCommit: string;
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

export interface TreehouseLease {
	worktreePath: string;
	repositoryCommonDir: string;
	contractCommit: string;
	branchRef: string;
	leaseHolder: string;
}

export interface LeaseInspectionInput {
	worktreePath: string;
	expectedRepositoryCommonDir: string;
	expectedHeadCommit?: string;
	expectedBranchRef?: string;
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
}

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

export const defaultArgumentProcessRunner: ArgumentProcessRunner = (
	command: string,
	args: readonly string[],
	options: ArgumentProcessOptions,
): Promise<ArgumentProcessResult> => new Promise<ArgumentProcessResult>((resolve) => {
	execFile(command, [...args], { cwd: options.cwd, encoding: "utf8" }, (error: ExecFileException | null, stdout: string, stderr: string) => {
		let exitCode = 0;
		if (error) {
			exitCode = 1;
			if (typeof error.code === "number") exitCode = error.code;
		}
		resolve({ exitCode, stdout, stderr });
	});
});

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

function commandDescription(command: string, args: readonly string[]): string {
	return [command, ...args].map((value) => JSON.stringify(value)).join(" ");
}

function failureMessage(label: string, command: string, args: readonly string[], result: ArgumentProcessResult): string {
	const stderr = result.stderr.trim();
	const stdout = result.stdout.trim();
	let detail = "no output";
	if (stderr) detail = `stderr: ${stderr}`;
	else if (stdout) detail = `stdout: ${stdout}`;
	return `${label} failed with exit code ${result.exitCode} (${commandDescription(command, args)}); ${detail}.`;
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

	private async checked(command: string, args: readonly string[], cwd: string, label: string): Promise<ArgumentProcessResult> {
		const result = await this.runner(command, args, { cwd });
		if (result.exitCode !== 0) {
			throw new TreehouseAdapterError(failureMessage(label, command, args, result), { command, args, result });
		}
		return result;
	}

	private async git(worktreePath: string, args: readonly string[], label: string): Promise<ArgumentProcessResult> {
		return this.checked(this.gitCommand, ["-C", worktreePath, ...args], worktreePath, label);
	}

	async version(cwd: string): Promise<ArgumentProcessResult> {
		return this.checked(this.treehouseCommand, ["--version"], cwd, "Treehouse version inspection");
	}

	async status(cwd: string): Promise<ArgumentProcessResult> {
		return this.checked(this.treehouseCommand, ["status"], cwd, "Treehouse status inspection");
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

		await this.assertManagedWorktree(parentPath, "Parent repository");
		const branchResult = await this.git(parentPath, ["symbolic-ref", "--quiet", "HEAD"], "Parent branch inspection");
		const actualBranchRef = singleLine(branchResult, "Parent branch inspection");
		const expectedBranchRef = `refs/heads/${parentBranch}`;
		if (actualBranchRef !== expectedBranchRef) {
			throw new TreehouseAdapterError(`Parent branch mismatch: expected "${expectedBranchRef}", received "${actualBranchRef}". No lease was acquired.`);
		}
		const headResult = await this.git(parentPath, ["rev-parse", "--verify", "HEAD^{commit}"], "Parent HEAD inspection");
		const actualHead = singleLine(headResult, "Parent HEAD inspection");
		if (actualHead !== parentHead) {
			throw new TreehouseAdapterError(`Parent HEAD mismatch: expected ${parentHead}, received ${actualHead}. No lease was acquired.`);
		}
		await this.assertClean(parentPath, "Parent repository");
		const repositoryCommonDir = await this.readCommonDir(parentPath, "Parent repository");
		return { repositoryCommonDir, parentBranch, parentHeadCommit: parentHead, contractCommit };
	}

	async inspectLease(input: LeaseInspectionInput): Promise<LeaseInspection> {
		const worktreePath = path.resolve(nonEmpty(input.worktreePath, "worktreePath"));
		await this.assertManagedWorktree(worktreePath, "Leased worktree");
		const repositoryCommonDir = await this.readCommonDir(worktreePath, "Leased worktree");
		const expectedCommonDir = path.resolve(nonEmpty(input.expectedRepositoryCommonDir, "expectedRepositoryCommonDir"));
		if (repositoryCommonDir !== expectedCommonDir) {
			throw new TreehouseAdapterError(`Leased worktree repository mismatch: expected Git common directory "${expectedCommonDir}", received "${repositoryCommonDir}". Keep the lease for inspection.`);
		}
		await this.assertClean(worktreePath, "Leased worktree");
		const headResult = await this.git(worktreePath, ["rev-parse", "--verify", "HEAD^{commit}"], "Leased worktree HEAD inspection");
		const headCommit = singleLine(headResult, "Leased worktree HEAD inspection");
		if (input.expectedHeadCommit !== undefined) {
			const expectedHead = exactSha(input.expectedHeadCommit, "expectedHeadCommit");
			if (headCommit !== expectedHead) {
				throw new TreehouseAdapterError(`Leased worktree HEAD mismatch: expected ${expectedHead}, received ${headCommit}. Keep the lease for inspection.`);
			}
		}
		let branchRef: string | undefined;
		const branchResult = await this.runner(this.gitCommand, ["-C", worktreePath, "symbolic-ref", "--quiet", "HEAD"], { cwd: worktreePath });
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
		return { worktreePath, repositoryCommonDir, headCommit, branchRef, clean: true };
	}

	async leaseAndAnchor(input: LeaseAndAnchorInput): Promise<TreehouseLease> {
		const preflight = await this.preflightParent(input);
		const leaseHolder = nonEmpty(input.leaseHolder, "leaseHolder");
		const getResult = await this.checked(
			this.treehouseCommand,
			["get", "--lease", "--lease-holder", leaseHolder],
			path.resolve(input.parentRepositoryPath),
			"Treehouse lease acquisition",
		);
		const rawWorktreePath = singleLine(getResult, "Treehouse lease acquisition");
		if (!path.isAbsolute(rawWorktreePath)) {
			throw new TreehouseAdapterError(`Treehouse lease acquisition returned a non-absolute path "${rawWorktreePath}". Keep any created lease for inspection.`);
		}
		const worktreePath = path.normalize(rawWorktreePath);
		await this.inspectLease({ worktreePath, expectedRepositoryCommonDir: preflight.repositoryCommonDir });
		await this.git(worktreePath, ["switch", "--detach", preflight.contractCommit], "Lease base checkout");
		await this.inspectLease({
			worktreePath,
			expectedRepositoryCommonDir: preflight.repositoryCommonDir,
			expectedHeadCommit: preflight.contractCommit,
		});
		const branchRef = await this.createUniqueBranch(worktreePath, input, preflight.contractCommit);
		await this.inspectLease({
			worktreePath,
			expectedRepositoryCommonDir: preflight.repositoryCommonDir,
			expectedHeadCommit: preflight.contractCommit,
			expectedBranchRef: branchRef,
		});
		return {
			worktreePath,
			repositoryCommonDir: preflight.repositoryCommonDir,
			contractCommit: preflight.contractCommit,
			branchRef,
			leaseHolder,
		};
	}

	async returnLease(input: ReturnLeaseInput): Promise<ArgumentProcessResult> {
		const expectedHead = exactSha(input.expectedHeadCommit, "expectedHeadCommit");
		await this.inspectLease({
			worktreePath: input.lease.worktreePath,
			expectedRepositoryCommonDir: input.lease.repositoryCommonDir,
			expectedHeadCommit: expectedHead,
			expectedBranchRef: input.lease.branchRef,
		});
		return this.checked(
			this.treehouseCommand,
			["return", input.lease.worktreePath],
			input.lease.worktreePath,
			"Treehouse lease return",
		);
	}

	private async assertManagedWorktree(worktreePath: string, label: string): Promise<void> {
		const result = await this.git(worktreePath, ["rev-parse", "--is-inside-work-tree"], `${label} management inspection`);
		if (singleLine(result, `${label} management inspection`) !== "true") {
			throw new TreehouseAdapterError(`${label} at "${worktreePath}" is not a managed Git worktree.`);
		}
	}

	private async assertClean(worktreePath: string, label: string): Promise<void> {
		const result = await this.git(worktreePath, ["status", "--porcelain=v1", "--untracked-files=all"], `${label} cleanliness inspection`);
		if (result.stdout.length > 0) {
			throw new TreehouseAdapterError(`${label} at "${worktreePath}" is dirty. Preserve it and inspect: ${result.stdout.trim()}`);
		}
	}

	private async readCommonDir(worktreePath: string, label: string): Promise<string> {
		const result = await this.git(worktreePath, ["rev-parse", "--path-format=absolute", "--git-common-dir"], `${label} identity inspection`);
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

	private async branchExists(worktreePath: string, branchRef: string): Promise<boolean> {
		const args = ["-C", worktreePath, "show-ref", "--verify", "--quiet", `refs/heads/${branchRef}`];
		const result = await this.runner(this.gitCommand, args, { cwd: worktreePath });
		if (result.exitCode === 0) return true;
		if (result.exitCode === 1) return false;
		throw new TreehouseAdapterError(failureMessage("Lane branch collision inspection", this.gitCommand, args, result), {
			command: this.gitCommand,
			args,
			result,
		});
	}

	private async createUniqueBranch(worktreePath: string, identity: LaneIdentity, contractCommit: string): Promise<string> {
		const prefix = this.lanePrefix(identity);
		for (let attempt = 0; attempt < this.maxBranchAttempts; attempt++) {
			const suffix = branchSegment(this.idFactory(), "generated branch suffix");
			const branchRef = `${prefix}-${suffix}`;
			if (await this.branchExists(worktreePath, branchRef)) continue;
			const args = ["-C", worktreePath, "switch", "-c", branchRef, contractCommit];
			const result = await this.runner(this.gitCommand, args, { cwd: worktreePath });
			if (result.exitCode === 0) return branchRef;
			if (await this.branchExists(worktreePath, branchRef)) continue;
			throw new TreehouseAdapterError(failureMessage("Lane branch creation", this.gitCommand, args, result), {
				command: this.gitCommand,
				args,
				result,
			});
		}
		throw new TreehouseAdapterError(`Could not allocate a unique lane branch after ${this.maxBranchAttempts} collision-safe attempts. Existing refs were preserved.`);
	}
}
