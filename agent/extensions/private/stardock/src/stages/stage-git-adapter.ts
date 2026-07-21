import * as path from "node:path";
import {
	defaultArgumentProcessRunner,
	type ArgumentProcessResult,
	type ArgumentProcessRunner,
} from "./treehouse-adapter.ts";

const EXACT_SHA_PATTERN = /^[0-9a-f]{40}$/;

export interface GitWorktreeInspection {
	worktreePath: string;
	repositoryCommonDir: string;
	headCommit: string;
	branchRef?: string;
	clean: boolean;
}

export interface StageGitAdapter {
	inspectWorktree(worktreePath: string, signal?: AbortSignal): Promise<GitWorktreeInspection>;
	resolveBranch(worktreePath: string, branch: string, signal?: AbortSignal): Promise<string | undefined>;
	isAncestor(worktreePath: string, ancestor: string, descendant: string, signal?: AbortSignal): Promise<boolean>;
	commitParents(worktreePath: string, commit: string, signal?: AbortSignal): Promise<string[]>;
	firstParentCommits(worktreePath: string, base: string, head: string, signal?: AbortSignal): Promise<string[]>;
	changedPaths(worktreePath: string, base: string, head: string, signal?: AbortSignal): Promise<string[]>;
}

function exactSha(value: string, label: string): string {
	if (!EXACT_SHA_PATTERN.test(value)) throw new Error(`${label} must be an exact 40-character lowercase Git SHA; received "${value}".`);
	return value;
}

function nonEmpty(value: string, label: string): string {
	const trimmed = value.trim();
	if (!trimmed) throw new Error(`${label} must not be empty.`);
	return trimmed;
}

function lines(result: ArgumentProcessResult): string[] {
	return result.stdout.split(/\r?\n/).filter(Boolean);
}

function oneLine(result: ArgumentProcessResult, label: string): string {
	const values = lines(result);
	if (values.length !== 1) throw new Error(`${label} must return exactly one line; received ${values.length}.`);
	return values[0];
}

function describe(command: string, args: readonly string[]): string {
	return [command, ...args].map((value) => JSON.stringify(value)).join(" ");
}

export class DefaultStageGitAdapter implements StageGitAdapter {
	private readonly runner: ArgumentProcessRunner;
	private readonly gitCommand: string;

	constructor(options: { runner?: ArgumentProcessRunner; gitCommand?: string } = {}) {
		this.runner = options.runner ?? defaultArgumentProcessRunner;
		this.gitCommand = options.gitCommand ?? "git";
	}

	private async run(worktreePath: string, args: readonly string[], signal?: AbortSignal, allowedExitCodes: number[] = [0]): Promise<ArgumentProcessResult> {
		signal?.throwIfAborted();
		const cwd = path.resolve(nonEmpty(worktreePath, "worktreePath"));
		const options: { cwd: string; signal?: AbortSignal } = { cwd };
		if (signal) options.signal = signal;
		const result = await this.runner(this.gitCommand, ["-C", cwd, ...args], options);
		signal?.throwIfAborted();
		if (!allowedExitCodes.includes(result.exitCode)) {
			const detail = result.stderr.trim() || result.stdout.trim() || "no output";
			throw new Error(`Git inspection failed (${describe(this.gitCommand, ["-C", cwd, ...args])}): ${detail}.`);
		}
		return result;
	}

	async inspectWorktree(worktreePath: string, signal?: AbortSignal): Promise<GitWorktreeInspection> {
		const resolved = path.resolve(nonEmpty(worktreePath, "worktreePath"));
		const managed = await this.run(resolved, ["rev-parse", "--is-inside-work-tree"], signal);
		if (oneLine(managed, "Git worktree inspection") !== "true") throw new Error(`Path "${resolved}" is not a Git worktree.`);
		const common = oneLine(await this.run(resolved, ["rev-parse", "--path-format=absolute", "--git-common-dir"], signal), "Git common-directory inspection");
		const headCommit = oneLine(await this.run(resolved, ["rev-parse", "--verify", "HEAD^{commit}"], signal), "Git HEAD inspection");
		const status = await this.run(resolved, ["status", "--porcelain=v1", "--untracked-files=all"], signal);
		const symbolic = await this.run(resolved, ["symbolic-ref", "--quiet", "HEAD"], signal, [0, 1]);
		let branchRef: string | undefined;
		if (symbolic.exitCode === 0) branchRef = oneLine(symbolic, "Git branch inspection");
		return {
			worktreePath: resolved,
			repositoryCommonDir: path.resolve(resolved, common),
			headCommit,
			branchRef,
			clean: status.stdout.length === 0,
		};
	}

	async resolveBranch(worktreePath: string, branch: string, signal?: AbortSignal): Promise<string | undefined> {
		const ref = `refs/heads/${nonEmpty(branch, "branch")}`;
		const result = await this.run(worktreePath, ["rev-parse", "--verify", `${ref}^{commit}`], signal, [0, 1, 128]);
		if (result.exitCode !== 0) return undefined;
		return oneLine(result, `Git branch ${ref} inspection`);
	}

	async isAncestor(worktreePath: string, ancestor: string, descendant: string, signal?: AbortSignal): Promise<boolean> {
		const args = ["merge-base", "--is-ancestor", exactSha(ancestor, "ancestor"), exactSha(descendant, "descendant")];
		const result = await this.run(worktreePath, args, signal, [0, 1]);
		return result.exitCode === 0;
	}

	async commitParents(worktreePath: string, commit: string, signal?: AbortSignal): Promise<string[]> {
		const result = await this.run(worktreePath, ["show", "-s", "--format=%P", exactSha(commit, "commit")], signal);
		const value = oneLine(result, "Git commit parent inspection");
		if (!value) return [];
		return value.split(" ").filter(Boolean);
	}

	async firstParentCommits(worktreePath: string, base: string, head: string, signal?: AbortSignal): Promise<string[]> {
		const range = `${exactSha(base, "base")}..${exactSha(head, "head")}`;
		const result = await this.run(worktreePath, ["log", "--first-parent", "--reverse", "--format=%H", range], signal);
		return lines(result);
	}

	async changedPaths(worktreePath: string, base: string, head: string, signal?: AbortSignal): Promise<string[]> {
		const result = await this.run(worktreePath, ["diff", "--name-only", `${exactSha(base, "base")}..${exactSha(head, "head")}`], signal);
		return lines(result);
	}
}
