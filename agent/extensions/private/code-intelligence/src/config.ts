import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { CONFIG_FILE_NAME, DEFAULT_CONFIG, type CodeIntelConfig, type LoadedConfig } from "./types.ts";
import { isRecord, normalizePositiveInteger } from "./util.ts";

function agentDir(): string {
	return process.env.PI_CODING_AGENT_DIR ?? process.env.PI_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
}

function userConfigPath(): string {
	return path.join(agentDir(), CONFIG_FILE_NAME);
}

function projectConfigPath(ctx: ExtensionContext): string {
	return path.join(ctx.cwd, ".pi", CONFIG_FILE_NAME);
}

function normalizeConfigPatch(input: unknown, base: CodeIntelConfig, source: string, diagnostics: string[]): CodeIntelConfig {
	if (!isRecord(input)) {
		diagnostics.push(`${source}: expected a JSON object`);
		return base;
	}
	return {
		maxResults: normalizePositiveInteger(input.maxResults, base.maxResults, 1, 500),
		queryTimeoutMs: normalizePositiveInteger(input.queryTimeoutMs, base.queryTimeoutMs, 1_000, 600_000),
		maxOutputBytes: normalizePositiveInteger(input.maxOutputBytes, base.maxOutputBytes, 10_000, 50_000_000),
	};
}

export function loadConfig(ctx: ExtensionContext): LoadedConfig {
	let config: CodeIntelConfig = { ...DEFAULT_CONFIG };
	const paths = { user: userConfigPath(), project: projectConfigPath(ctx) };
	const loaded: string[] = [];
	const diagnostics: string[] = [];
	for (const configPath of [paths.user, paths.project]) {
		if (!fs.existsSync(configPath)) continue;
		try {
			const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8")) as unknown;
			config = normalizeConfigPatch(parsed, config, configPath, diagnostics);
			loaded.push(configPath);
		} catch (error) {
			diagnostics.push(`${configPath}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return { config, paths, loaded, diagnostics };
}
