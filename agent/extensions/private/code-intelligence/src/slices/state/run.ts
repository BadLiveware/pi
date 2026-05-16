import { createRequire } from "node:module";
import type { BackendName, BackendStatus, CodeIntelConfig, LanguageServerName, LanguageServerStatus, LoadedConfig, RepoRoots } from "../../types.ts";
import { commandDiagnostic, findExecutable, firstLine, runCommand } from "../../exec.ts";

const TREE_SITTER_LANGUAGES = ["go", "typescript", "tsx", "javascript", "rust", "python", "java", "c", "cpp", "csharp", "ruby", "php", "bash", "css"];

function treeSitterStatus(): BackendStatus {
	try {
		const require = createRequire(import.meta.url);
		const packageJson = require("@vscode/tree-sitter-wasm/package.json") as { version?: string };
		return {
			backend: "tree-sitter",
			available: "available",
			version: packageJson.version,
			indexStatus: "not-required",
			writesToRepo: false,
			artifacts: [],
			diagnostics: [],
			details: { runtime: "@vscode/tree-sitter-wasm", languages: TREE_SITTER_LANGUAGES },
		};
	} catch (error) {
		return {
			backend: "tree-sitter",
			available: "error",
			indexStatus: "error",
			writesToRepo: false,
			artifacts: [],
			diagnostics: [error instanceof Error ? error.message : String(error)],
		};
	}
}

async function rgStatus(repoRoot: string, config: CodeIntelConfig): Promise<BackendStatus> {
	const executable = findExecutable("rg");
	if (!executable) {
		return { backend: "rg", available: "missing", indexStatus: "not-required", writesToRepo: false, artifacts: [], diagnostics: ["rg not found on PATH"] };
	}
	const result = await runCommand(executable, ["--version"], { cwd: repoRoot, timeoutMs: Math.min(config.queryTimeoutMs, 10_000), maxOutputBytes: config.maxOutputBytes });
	const diagnostic = commandDiagnostic(result);
	return {
		backend: "rg",
		available: diagnostic ? "error" : "available",
		executable,
		version: firstLine(result.stdout || result.stderr),
		indexStatus: diagnostic ? "error" : "not-required",
		writesToRepo: false,
		artifacts: [],
		diagnostics: diagnostic ? [diagnostic] : [],
	};
}

async function commandStatus(server: LanguageServerName, command: string, args: string[], repoRoot: string, config: CodeIntelConfig, missingDiagnostic?: string): Promise<LanguageServerStatus> {
	const executable = findExecutable(command);
	if (!executable) return { server, available: "missing", diagnostics: [missingDiagnostic ?? `${command} not found on PATH`] };
	const result = await runCommand(executable, args, { cwd: repoRoot, timeoutMs: Math.min(config.queryTimeoutMs, 10_000), maxOutputBytes: Math.min(config.maxOutputBytes, 200_000) });
	const diagnostic = commandDiagnostic(result);
	return {
		server,
		available: diagnostic ? "error" : "available",
		executable,
		version: firstLine(result.stdout || result.stderr),
		diagnostics: diagnostic ? [diagnostic] : [],
	};
}

async function typescriptStatus(repoRoot: string, config: CodeIntelConfig): Promise<LanguageServerStatus> {
	let library: { path?: string; version?: string; diagnostic?: string } = {};
	try {
		const require = createRequire(import.meta.url);
		const packageJsonPath = require.resolve("typescript/package.json");
		const packageJson = require(packageJsonPath) as { version?: string };
		library = { path: packageJsonPath, version: packageJson.version };
	} catch (error) {
		library = { diagnostic: `typescript package not available: ${error instanceof Error ? error.message : String(error)}` };
	}
	const tsserver = findExecutable("tsserver");
	if (tsserver) return { server: "typescript", available: "available", executable: tsserver, version: library.version, diagnostics: [], details: { command: "tsserver", libraryPath: library.path, versionProbe: "not-run" } };
	const tsls = findExecutable("typescript-language-server");
	if (!tsls) {
		if (library.path) return { server: "typescript", available: "available", version: library.version, diagnostics: [], details: { command: "typescript-language-service", libraryPath: library.path } };
		return { server: "typescript", available: "missing", diagnostics: ["tsserver or typescript-language-server not found on PATH", ...(library.diagnostic ? [library.diagnostic] : [])] };
	}
	const result = await runCommand(tsls, ["--version"], { cwd: repoRoot, timeoutMs: Math.min(config.queryTimeoutMs, 10_000), maxOutputBytes: Math.min(config.maxOutputBytes, 200_000) });
	const diagnostic = commandDiagnostic(result);
	return {
		server: "typescript",
		available: diagnostic ? "error" : "available",
		executable: tsls,
		version: firstLine(result.stdout || result.stderr) ?? library.version,
		diagnostics: diagnostic ? [diagnostic] : [],
		details: { command: "typescript-language-server", libraryPath: library.path },
	};
}

export async function languageServerStatuses(repoRoot: string, config: CodeIntelConfig): Promise<Record<LanguageServerName, LanguageServerStatus>> {
	const [gopls, rustAnalyzer, typescript, clangd] = await Promise.all([
		commandStatus("gopls", "gopls", ["version"], repoRoot, config),
		commandStatus("rust-analyzer", "rust-analyzer", ["--version"], repoRoot, config),
		typescriptStatus(repoRoot, config),
		commandStatus("clangd", "clangd", ["--version"], repoRoot, config),
	]);
	return { gopls, "rust-analyzer": rustAnalyzer, typescript, clangd };
}

export async function backendStatuses(repoRoot: string, config: CodeIntelConfig): Promise<Record<BackendName, BackendStatus>> {
	const rg = await rgStatus(repoRoot, config);
	return { "tree-sitter": treeSitterStatus(), rg };
}

export function statePayload(roots: RepoRoots, loadedConfig: LoadedConfig, statuses: Record<BackendName, BackendStatus>, includeDiagnostics: boolean, languageServers?: Record<LanguageServerName, LanguageServerStatus>): Record<string, unknown> {
	const payload: Record<string, unknown> = {
		repoRoot: roots.repoRoot,
		requestedRoot: roots.requestedRoot,
		config: loadedConfig.config,
		configPaths: loadedConfig.paths,
		loadedConfig: loadedConfig.loaded,
		backends: statuses,
		limitations: [
			"Tree-sitter rows are current-source syntax evidence for read-next routing, not exact semantic references or proof of complete impact.",
			"rg literal fallback is for text discovery only; use source reads and project-native validation before making claims.",
			"Impact maps currently route Go, TypeScript/TSX, JavaScript, Rust, Python, and C/C++; Tree-sitter rows remain candidate read-next evidence rather than semantic references.",
			"Language-server status is availability-only; default code-intel routing does not use LSPs unless explicit reference confirmation or post-edit touched-file diagnostics are requested.",
		],
	};
	if (languageServers) payload.languageServers = languageServers;
	if (includeDiagnostics) {
		payload.diagnostics = [
			...roots.diagnostics,
			...loadedConfig.diagnostics,
			...Object.values(statuses).flatMap((status) => status.diagnostics),
			...Object.values(languageServers ?? {}).flatMap((status) => status.diagnostics),
		];
	}
	return payload;
}
