import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface TrackingConfig {
	enabled: boolean;
	appendSessionEntries: boolean;
	log: boolean;
	maxRecentEvents: number;
}

export interface CompactionContinueConfig {
	enabled: boolean;
	tracking: TrackingConfig;
}

export interface LoadedCompactionContinueConfig {
	config: CompactionContinueConfig;
	paths: string[];
	diagnostics: string[];
}

export const DEFAULT_CONFIG: CompactionContinueConfig = {
	enabled: true,
	tracking: { enabled: false, appendSessionEntries: true, log: true, maxRecentEvents: 20 },
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function booleanValue(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

function configPaths(ctx: ExtensionContext): string[] {
	const agentDir = process.env.PI_CODING_AGENT_DIR ?? process.env.PI_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
	return [...new Set([
		...(process.env.PI_COMPACTION_CONTINUE_CONFIG ? [process.env.PI_COMPACTION_CONTINUE_CONFIG] : []),
		path.join(agentDir, "compaction-continue.json"),
		path.join(ctx.cwd, ".pi", "compaction-continue.json"),
	])];
}

function normalizeConfigPatch(input: unknown, base: CompactionContinueConfig, source: string, diagnostics: string[]): CompactionContinueConfig {
	if (!isRecord(input)) {
		diagnostics.push(`${source}: expected a JSON object`);
		return base;
	}
	const tracking = isRecord(input.tracking) ? input.tracking : undefined;
	const maxRecentEvents = tracking?.maxRecentEvents ?? input.maxRecentEvents;
	return {
		enabled: booleanValue(input.enabled) ?? base.enabled,
		tracking: {
			enabled: booleanValue(tracking?.enabled) ?? base.tracking.enabled,
			appendSessionEntries: booleanValue(tracking?.appendSessionEntries) ?? booleanValue(input.appendSessionEntries) ?? base.tracking.appendSessionEntries,
			log: booleanValue(tracking?.log) ?? booleanValue(input.log) ?? base.tracking.log,
			maxRecentEvents: typeof maxRecentEvents === "number" && Number.isFinite(maxRecentEvents)
				? Math.max(1, Math.min(100, Math.floor(maxRecentEvents))) : base.tracking.maxRecentEvents,
		},
	};
}

export function loadCompactionContinueConfig(ctx: ExtensionContext): LoadedCompactionContinueConfig {
	let config = { ...DEFAULT_CONFIG, tracking: { ...DEFAULT_CONFIG.tracking } };
	const paths: string[] = [];
	const diagnostics: string[] = [];
	for (const file of configPaths(ctx)) {
		if (!fs.existsSync(file)) continue;
		try {
			config = normalizeConfigPatch(JSON.parse(fs.readFileSync(file, "utf8")), config, file, diagnostics);
			paths.push(file);
		} catch (error) {
			diagnostics.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return { config, paths, diagnostics };
}
