import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RepoRoots } from "./types.ts";
import { commandDiagnostic, runCommand } from "./exec.ts";
import { normalizeStringArray } from "./util.ts";

export function normalizeToolPath(input: string): string {
	return input.startsWith("@") ? input.slice(1) : input;
}

export function resolveRequestedRoot(ctx: ExtensionContext, requested?: string): string {
	if (!requested?.trim()) return ctx.cwd;
	return path.resolve(ctx.cwd, normalizeToolPath(requested.trim()));
}

function rootInputDirectory(requestedRoot: string): string {
	try {
		const stat = fs.statSync(requestedRoot);
		return stat.isFile() ? path.dirname(requestedRoot) : requestedRoot;
	} catch {
		return requestedRoot;
	}
}

export function realPathOrSelf(target: string): string {
	try {
		return fs.realpathSync(target);
	} catch {
		return path.resolve(target);
	}
}

export async function resolveRepoRoots(ctx: ExtensionContext, requested?: string, timeoutMs = 5_000): Promise<RepoRoots> {
	const requestedRoot = resolveRequestedRoot(ctx, requested);
	const cwd = rootInputDirectory(requestedRoot);
	const diagnostics: string[] = [];
	if (!fs.existsSync(cwd)) diagnostics.push(`Path does not exist: ${cwd}`);
	const git = await runCommand("git", ["rev-parse", "--show-toplevel"], { cwd, timeoutMs, maxOutputBytes: 100_000 });
	if (git.exitCode === 0 && git.stdout.trim()) {
		return { requestedRoot, repoRoot: path.resolve(git.stdout.trim()), diagnostics };
	}
	if (git.error && git.error !== "ENOENT") diagnostics.push(`git repo detection failed: ${git.error}`);
	return { requestedRoot, repoRoot: path.resolve(cwd), diagnostics };
}

export function ensureInsideRoot(repoRoot: string, requestedPath: string): string {
	const resolved = path.resolve(repoRoot, normalizeToolPath(requestedPath));
	const relative = path.relative(repoRoot, resolved);
	if (relative === "") return ".";
	if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
		throw new Error(`Path is outside repository root: ${requestedPath}`);
	}
	return relative.split(path.sep).join(path.posix.sep);
}

export function pathArgsForRepo(repoRoot: string, requestedPaths: string[] | undefined): string[] {
	const paths = normalizeStringArray(requestedPaths);
	if (paths.length === 0) return ["."];
	return paths.map((item) => ensureInsideRoot(repoRoot, item));
}

export async function changedFilesFromBase(repoRoot: string, baseRef: string | undefined, queryTimeoutMs: number, maxOutputBytes: number): Promise<{ files: string[]; diagnostic?: string }> {
	if (!baseRef?.trim()) return { files: [] };
	const result = await runCommand("git", ["diff", "--name-only", baseRef.trim(), "--"], { cwd: repoRoot, timeoutMs: queryTimeoutMs, maxOutputBytes });
	if (result.exitCode !== 0) return { files: [], diagnostic: commandDiagnostic(result) };
	return { files: result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) };
}
