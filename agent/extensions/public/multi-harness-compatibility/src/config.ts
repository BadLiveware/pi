import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ancestorDirs, findRepoRoot } from "./path-utils.ts";
import type { CompatConfig, CompatProfileConfig, LoadedCompatConfig } from "./types.ts";

function agentDir(): string {
	return process.env.PI_CODING_AGENT_DIR ?? process.env.PI_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
}

function readJson(filePath: string): unknown {
	return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function bool(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

function strings(value: unknown): string[] | undefined {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}

function normalizeProfile(value: unknown): CompatProfileConfig {
	if (!isRecord(value)) return {};
	const match = isRecord(value.match) ? {
		paths: strings(value.match.paths),
		gitRemotes: strings(value.match.gitRemotes),
		markerFiles: strings(value.match.markerFiles),
	} : undefined;
	return {
		match,
		roots: strings(value.roots),
		pi: bool(value.pi),
		claude: bool(value.claude),
		cursor: bool(value.cursor),
		agents: bool(value.agents),
		includeGlobalPiContext: bool(value.includeGlobalPiContext),
		contextFiles: strings(value.contextFiles),
		skillDirs: strings(value.skillDirs),
		cursorRuleDirs: strings(value.cursorRuleDirs),
	};
}

function normalizeConfig(value: unknown): CompatConfig {
	if (!isRecord(value)) return {};
	const profiles: Record<string, CompatProfileConfig> = {};
	if (isRecord(value.profiles)) {
		for (const [name, profile] of Object.entries(value.profiles)) profiles[name] = normalizeProfile(profile);
	}
	return {
		defaultProfile: typeof value.defaultProfile === "string" ? value.defaultProfile : undefined,
		profiles,
	};
}

export function defaultCompatConfig(): CompatConfig {
	return {
		defaultProfile: "private",
		profiles: {
			private: { pi: true, claude: true, cursor: true, agents: true },
		},
	};
}

export function loadCompatConfig(cwd: string): LoadedCompatConfig {
	const repoRoot = findRepoRoot(cwd);
	const localDirs = repoRoot ? ancestorDirs(cwd, repoRoot) : [cwd];
	const localCandidates = localDirs.map((dir) => path.join(dir, ".pi", "multi-harness-compatibility.json"));
	const candidates = [
		path.join(agentDir(), "multi-harness-compatibility.json"),
		...localCandidates,
	];
	const diagnostics: string[] = [];
	let merged = defaultCompatConfig();
	const loadedPaths: string[] = [];
	for (const candidate of candidates) {
		if (!fs.existsSync(candidate)) continue;
		try {
			const config = normalizeConfig(readJson(candidate));
			merged = {
				...merged,
				...config,
				profiles: { ...(merged.profiles ?? {}), ...(config.profiles ?? {}) },
			};
			loadedPaths.push(candidate);
		} catch (error) {
			diagnostics.push(`Failed to read ${candidate}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return { config: merged, paths: loadedPaths, diagnostics, repoRoot };
}
