import * as os from "node:os";
import * as path from "node:path";
import {
	SQRY_POLICY_ARTIFACTS,
	SQRY_REPO_ARTIFACTS,
	type ArtifactIgnoreEntry,
	type ArtifactPolicyState,
	type BackendName,
	type BackendStatus,
	type CodeIntelConfig,
	type CommandResult,
	type LoadedConfig,
	type RepoArtifactPolicy,
	type RepoRoots,
	type UpdateBackend,
	type IndexStatus,
} from "./types.ts";
import { commandDiagnostic, findExecutable, firstLine, parseJson, runCommand, summarizeCommand } from "./exec.ts";
import { realPathOrSelf } from "./repo.ts";

async function versionFor(binary: BackendName, executable: string, repoRoot: string, config: CodeIntelConfig): Promise<{ version?: string; diagnostic?: string }> {
	if (binary === "cymbal") {
		const result = await runCommand(executable, ["version", "--json"], { cwd: repoRoot, timeoutMs: 10_000, maxOutputBytes: config.maxOutputBytes });
		const parsed = parseJson<{ results?: { version?: string }; version?: string }>(result.stdout);
		return { version: parsed?.results?.version ?? parsed?.version ?? firstLine(result.stdout), diagnostic: commandDiagnostic(result) };
	}
	const result = await runCommand(executable, ["--version"], { cwd: repoRoot, timeoutMs: 10_000, maxOutputBytes: config.maxOutputBytes });
	return { version: firstLine(result.stdout || result.stderr), diagnostic: commandDiagnostic(result) };
}

async function cymbalStatus(repoRoot: string, config: CodeIntelConfig): Promise<BackendStatus> {
	const executable = findExecutable("cymbal");
	const diagnostics: string[] = [];
	if (!executable) {
		return { backend: "cymbal", available: "missing", indexStatus: "unknown", writesToRepo: false, artifacts: [], diagnostics: ["cymbal not found on PATH"] };
	}
	const version = await versionFor("cymbal", executable, repoRoot, config);
	if (version.diagnostic) diagnostics.push(version.diagnostic);
	const repos = await runCommand(executable, ["--json", "ls", "--repos"], { cwd: repoRoot, timeoutMs: config.queryTimeoutMs, maxOutputBytes: config.maxOutputBytes });
	const parsed = parseJson<{ results?: Array<{ path?: string; file_count?: number; symbol_count?: number; db_path?: string }> }>(repos.stdout);
	if (commandDiagnostic(repos)) diagnostics.push(commandDiagnostic(repos) as string);
	const currentReal = realPathOrSelf(repoRoot);
	const match = parsed?.results?.find((entry) => entry.path && realPathOrSelf(entry.path) === currentReal);
	return {
		backend: "cymbal",
		available: repos.error === "ENOENT" ? "missing" : diagnostics.length > 0 && !parsed ? "error" : "available",
		executable,
		version: version.version,
		indexStatus: match ? "present" : "missing",
		writesToRepo: false,
		artifacts: match?.db_path ? [match.db_path] : [path.join(os.homedir(), ".cache", "cymbal", "repos", "<repo-hash>", "index.db")],
		diagnostics,
		details: match ? { fileCount: match.file_count, symbolCount: match.symbol_count, dbPath: match.db_path } : undefined,
	};
}

async function astGrepStatus(repoRoot: string, config: CodeIntelConfig): Promise<BackendStatus> {
	const executable = findExecutable("ast-grep");
	const diagnostics: string[] = [];
	if (!executable) {
		return { backend: "ast-grep", available: "missing", indexStatus: "not-required", writesToRepo: false, artifacts: [], diagnostics: ["ast-grep not found on PATH"] };
	}
	const version = await versionFor("ast-grep", executable, repoRoot, config);
	if (version.diagnostic) diagnostics.push(version.diagnostic);
	return { backend: "ast-grep", available: diagnostics.length > 0 ? "error" : "available", executable, version: version.version, indexStatus: "not-required", writesToRepo: false, artifacts: [], diagnostics };
}

async function sqryStatus(repoRoot: string, config: CodeIntelConfig): Promise<BackendStatus> {
	const executable = findExecutable("sqry");
	const diagnostics: string[] = [];
	if (!executable) {
		return { backend: "sqry", available: "missing", indexStatus: "unknown", writesToRepo: true, artifacts: [...SQRY_REPO_ARTIFACTS], diagnostics: ["sqry not found on PATH"] };
	}
	const version = await versionFor("sqry", executable, repoRoot, config);
	if (version.diagnostic) diagnostics.push(version.diagnostic);
	const status = await runCommand(executable, ["--json", "index", "--status", "."], { cwd: repoRoot, timeoutMs: config.queryTimeoutMs, maxOutputBytes: config.maxOutputBytes });
	const parsed = parseJson<{ exists?: boolean; stale?: boolean; path?: string; symbol_count?: number; file_count?: number; age_seconds?: number; supports_relations?: boolean; supports_fuzzy?: boolean }>(status.stdout);
	if (commandDiagnostic(status)) diagnostics.push(commandDiagnostic(status) as string);
	let indexStatus: IndexStatus = "unknown";
	if (parsed?.exists === false) indexStatus = "missing";
	else if (parsed?.exists === true) indexStatus = parsed.stale ? "stale" : "fresh";
	else if (diagnostics.length > 0) indexStatus = "error";
	return {
		backend: "sqry",
		available: status.error === "ENOENT" ? "missing" : diagnostics.length > 0 && !parsed ? "error" : "available",
		executable,
		version: version.version,
		indexStatus,
		writesToRepo: true,
		artifacts: parsed?.path ? [parsed.path] : [...SQRY_REPO_ARTIFACTS],
		diagnostics,
		details: parsed
			? {
				path: parsed.path,
				fileCount: parsed.file_count,
				symbolCount: parsed.symbol_count,
				ageSeconds: parsed.age_seconds,
				supportsRelations: parsed.supports_relations,
				supportsFuzzy: parsed.supports_fuzzy,
			}
			: undefined,
	};
}

function gitIgnoreTargets(artifact: string): string[] {
	const targets = [artifact];
	if (artifact.endsWith("/")) targets.push(artifact.slice(0, -1));
	else targets.push(`${artifact}/`);
	return [...new Set(targets)];
}

async function gitIgnoreEntry(repoRoot: string, artifact: string): Promise<ArtifactIgnoreEntry> {
	const diagnostics: string[] = [];
	for (const target of gitIgnoreTargets(artifact)) {
		const result = await runCommand("git", ["check-ignore", "-v", "--", target], { cwd: repoRoot, timeoutMs: 5_000, maxOutputBytes: 200_000 });
		if (result.exitCode === 0) return { artifact, ignored: true, source: firstLine(result.stdout) };
		if (result.exitCode === 1) continue;
		diagnostics.push(commandDiagnostic(result) ?? "git check-ignore failed");
	}
	return diagnostics.length > 0 ? { artifact, ignored: "unknown", diagnostic: diagnostics.join("; ") } : { artifact, ignored: false };
}

export async function artifactPolicyState(repoRoot: string, policy: RepoArtifactPolicy): Promise<ArtifactPolicyState> {
	const artifacts = await Promise.all(SQRY_REPO_ARTIFACTS.map((artifact) => gitIgnoreEntry(repoRoot, artifact)));
	const policyArtifactNames = [...SQRY_POLICY_ARTIFACTS];
	const policyArtifactsIgnored = policyArtifactNames.every((artifact) => artifacts.find((entry) => entry.artifact === artifact)?.ignored === true);
	if (policy === "always") return { policy, artifacts, policyArtifacts: policyArtifactNames, policyArtifactsIgnored, allowed: true, reason: "Repo-local artifacts explicitly allowed." };
	if (policy === "never") return { policy, artifacts, policyArtifacts: policyArtifactNames, policyArtifactsIgnored, allowed: false, reason: "Repo-local artifacts are disabled by policy." };
	if (policyArtifactsIgnored) return { policy, artifacts, policyArtifacts: policyArtifactNames, policyArtifactsIgnored, allowed: true, reason: "Known sqry repo-local index directories are ignored by git." };
	const missing = policyArtifactNames.filter((artifact) => artifacts.find((entry) => entry.artifact === artifact)?.ignored !== true);
	return { policy, artifacts, policyArtifacts: policyArtifactNames, policyArtifactsIgnored, allowed: false, reason: `Repo-local sqry artifacts are not confirmed ignored by git: ${missing.join(", ")}.` };
}

export async function backendStatuses(repoRoot: string, config: CodeIntelConfig): Promise<Record<BackendName, BackendStatus>> {
	const [cymbal, astGrep, sqry] = await Promise.all([cymbalStatus(repoRoot, config), astGrepStatus(repoRoot, config), sqryStatus(repoRoot, config)]);
	return { cymbal, "ast-grep": astGrep, sqry };
}

export function requestedUpdateBackend(value: unknown): UpdateBackend | undefined {
	return value === "auto" || value === "cymbal" || value === "ast-grep" || value === "sqry" ? value : undefined;
}

export function chooseUpdateBackend(requested: UpdateBackend | undefined, statuses: Record<BackendName, BackendStatus>, config: CodeIntelConfig): BackendName {
	if (requested && requested !== "auto") return requested;
	for (const backend of config.backendOrder) {
		if (backend === "ast-grep") continue;
		if (statuses[backend].available === "available") return backend;
	}
	return "cymbal";
}

export async function runIndexUpdate(backend: BackendName, repoRoot: string, force: boolean, timeoutMs: number, config: CodeIntelConfig, signal?: AbortSignal): Promise<CommandResult | undefined> {
	if (backend === "ast-grep") return undefined;
	const executable = findExecutable(backend);
	if (!executable) return { command: backend, args: [], cwd: repoRoot, exitCode: null, signal: null, stdout: "", stderr: "", timedOut: false, outputTruncated: false, error: "ENOENT" };
	if (backend === "cymbal") {
		const args = ["index", "."];
		if (force) args.push("--force");
		return await runCommand(executable, args, { cwd: repoRoot, timeoutMs, maxOutputBytes: config.maxOutputBytes, signal });
	}
	const args = ["index", "."];
	if (force) args.push("--force");
	return await runCommand(executable, args, { cwd: repoRoot, timeoutMs, maxOutputBytes: config.maxOutputBytes, signal });
}

export function statePayload(roots: RepoRoots, loadedConfig: LoadedConfig, statuses: Record<BackendName, BackendStatus>, sqryArtifacts: ArtifactPolicyState, includeDiagnostics: boolean): Record<string, unknown> {
	const payload: Record<string, unknown> = {
		repoRoot: roots.repoRoot,
		requestedRoot: roots.requestedRoot,
		config: loadedConfig.config,
		configPaths: loadedConfig.paths,
		loadedConfig: loadedConfig.loaded,
		backends: statuses,
		sqryArtifactPolicy: sqryArtifacts,
		limitations: [
			"Results from code-intelligence backends are advisory read-next routing evidence, not exact references or proof of complete impact.",
			"Backend indexes can be stale or best-effort; verify important candidates against current source files.",
		],
	};
	if (includeDiagnostics) payload.diagnostics = [...roots.diagnostics, ...loadedConfig.diagnostics, ...Object.values(statuses).flatMap((status) => status.diagnostics), ...sqryArtifacts.artifacts.flatMap((entry) => entry.diagnostic ? [entry.diagnostic] : [])];
	return payload;
}

export { summarizeCommand } from "./exec.ts";
