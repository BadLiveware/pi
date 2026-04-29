import { createRequire } from "node:module";
import type { BackendName, BackendStatus, CodeIntelConfig, LoadedConfig, RepoRoots } from "./types.ts";
import { commandDiagnostic, findExecutable, firstLine, runCommand } from "./exec.ts";

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

export async function backendStatuses(repoRoot: string, config: CodeIntelConfig): Promise<Record<BackendName, BackendStatus>> {
	const rg = await rgStatus(repoRoot, config);
	return { "tree-sitter": treeSitterStatus(), rg };
}

export function statePayload(roots: RepoRoots, loadedConfig: LoadedConfig, statuses: Record<BackendName, BackendStatus>, includeDiagnostics: boolean): Record<string, unknown> {
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
		],
	};
	if (includeDiagnostics) payload.diagnostics = [...roots.diagnostics, ...loadedConfig.diagnostics, ...Object.values(statuses).flatMap((status) => status.diagnostics)];
	return payload;
}
