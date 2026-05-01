import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

export type FeedbackMode = "off" | "passive" | "ask-agent" | "both";
export type FeedbackHelped = "yes" | "no" | "mixed" | "unknown";
export type FeedbackOutcome = "chose_files" | "found_issue" | "reduced_uncertainty" | "not_useful" | "blocked" | "other";
export type MissedImportantContext = "yes" | "no" | "unknown";
export type FeedbackImprovement = "better_ranking" | "higher_cap" | "better_summary" | "better_docs" | "less_noise" | "faster" | "other";

export interface WatchRule {
	name?: string;
	prefix?: string;
}

export interface ToolFeedbackConfig {
	mode: FeedbackMode;
	watch: WatchRule[];
	excludeTools: string[];
	cooldownTurns: number;
	skipWhenPendingMessages: boolean;
	appendSessionEntries: boolean;
	log: boolean;
	taskPrompt: string;
}

export interface LoadedConfig {
	config: ToolFeedbackConfig;
	paths: string[];
	diagnostics: string[];
}

export interface WatchedToolCall {
	toolName: string;
	toolCallId: string;
	category: string;
	confirmReferences?: string;
	turnIndex: number;
	sequence: number;
}

export interface WatchedToolResult extends WatchedToolCall {
	ok: boolean;
	isError: boolean;
	truncated: boolean;
	errorKind?: string;
	durationMs?: number;
}

export interface TurnUsage {
	turnIndex: number;
	startedAt: number;
	toolCalls: Array<{ toolName: string; category: string; sequence: number }>;
	watchedCalls: WatchedToolCall[];
	watchedResults: WatchedToolResult[];
}

export interface AgentUsage {
	startedAt: number;
	watchedCalls: WatchedToolCall[];
	watchedResults: WatchedToolResult[];
	feedbackRecorded: boolean;
	lastWatchedSequence?: number;
	afterWatchedCategories: string[];
	turnSummaries: TurnSummary[];
}

export interface TurnSummary {
	version: 1;
	kind: "turn_summary";
	timestamp: string;
	sessionId: string;
	repoRoot: string;
	turnIndex: number;
	watchedTools: string[];
	watchedCallCount: number;
	watchedResultCount: number;
	anyTruncated: boolean;
	anyError: boolean;
	confirmReferences: string[];
	toolCategories: string[];
	categoriesAfterFirstWatchedCall: string[];
}

export interface FeedbackRecord {
	version: 1;
	kind: "agent_feedback";
	timestamp: string;
	sessionId: string;
	repoRoot: string;
	watchedTools: string[];
	helped: FeedbackHelped;
	outcome: FeedbackOutcome;
	neededFollowupSearch?: boolean;
	readReturnedFiles?: boolean;
	outputTooNoisy?: boolean;
	truncationHurt?: boolean;
	missedImportantContext?: MissedImportantContext;
	improvement?: FeedbackImprovement;
	note?: string;
	noteLength?: number;
	noteHash?: string;
}

const CONFIG_FILE_NAME = "tool-feedback.json";
const DEFAULT_TASK_PROMPT = [
	"You used watched tools in the previous prompt. Please call `tool_feedback` once with concise structured feedback.",
	"Focus on whether the tool helped the task, whether follow-up search/read work was still needed, whether output was too noisy or truncated, and what one improvement would help most.",
	"This is a dogfood feedback request, not new implementation work.",
].join("\n\n");

export const DEFAULT_CONFIG: ToolFeedbackConfig = {
	mode: "passive",
	watch: [],
	excludeTools: ["tool_feedback", "tool_feedback_state"],
	cooldownTurns: 0,
	skipWhenPendingMessages: true,
	appendSessionEntries: true,
	log: true,
	taskPrompt: DEFAULT_TASK_PROMPT,
};

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeMode(value: unknown, fallback: FeedbackMode): FeedbackMode {
	return value === "off" || value === "passive" || value === "ask-agent" || value === "both" ? value : fallback;
}

export function normalizeStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
}

function normalizeWatchRules(value: unknown): WatchRule[] {
	if (!Array.isArray(value)) return [];
	const rules: WatchRule[] = [];
	for (const item of value) {
		if (!isRecord(item)) continue;
		const name = stringValue(item.name)?.trim();
		const prefix = stringValue(item.prefix)?.trim();
		if (!name && !prefix) continue;
		rules.push({ name, prefix });
	}
	return rules;
}

function agentDir(): string {
	return process.env.PI_CODING_AGENT_DIR ?? process.env.PI_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
}

function configPaths(ctx: ExtensionContext): string[] {
	const paths: string[] = [];
	if (process.env.PI_TOOL_FEEDBACK_CONFIG) paths.push(process.env.PI_TOOL_FEEDBACK_CONFIG);
	paths.push(path.join(agentDir(), CONFIG_FILE_NAME));
	paths.push(path.join(ctx.cwd, ".pi", CONFIG_FILE_NAME));
	return [...new Set(paths)];
}

function normalizeConfigPatch(input: unknown, base: ToolFeedbackConfig, source: string, diagnostics: string[]): ToolFeedbackConfig {
	if (!isRecord(input)) {
		diagnostics.push(`${source}: expected a JSON object`);
		return base;
	}
	const next: ToolFeedbackConfig = { ...base };
	next.mode = normalizeMode(input.mode, base.mode);
	if ("watch" in input) next.watch = normalizeWatchRules(input.watch);
	if ("excludeTools" in input) next.excludeTools = normalizeStringArray(input.excludeTools);
	next.cooldownTurns = Math.max(0, Math.min(100, Math.floor(numberValue(input.cooldownTurns) ?? base.cooldownTurns)));
	next.skipWhenPendingMessages = booleanValue(input.skipWhenPendingMessages) ?? base.skipWhenPendingMessages;
	next.appendSessionEntries = booleanValue(input.appendSessionEntries) ?? base.appendSessionEntries;
	next.log = booleanValue(input.log) ?? base.log;
	next.taskPrompt = stringValue(input.taskPrompt)?.trim() || base.taskPrompt;
	return next;
}

export function loadToolFeedbackConfig(ctx: ExtensionContext): LoadedConfig {
	let config = { ...DEFAULT_CONFIG };
	const loaded: string[] = [];
	const diagnostics: string[] = [];
	for (const configPath of configPaths(ctx)) {
		if (!fs.existsSync(configPath)) continue;
		try {
			const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8")) as unknown;
			config = normalizeConfigPatch(parsed, config, configPath, diagnostics);
			loaded.push(configPath);
		} catch (error) {
			diagnostics.push(`${configPath}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return { config, paths: loaded, diagnostics };
}

export function sessionIdFromContext(ctx: ExtensionContext): string {
	const manager = ctx.sessionManager as unknown as { getSessionId?: () => string } | undefined;
	try {
		const sessionId = manager?.getSessionId?.();
		if (sessionId) return sessionId;
	} catch {
		// Fall through.
	}
	return `process:${process.pid}:${ctx.cwd}`;
}

function feedbackLogDir(): string {
	return process.env.PI_TOOL_FEEDBACK_DIR ?? path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"), "pi-tool-feedback");
}

function safeSessionPathSegment(sessionId: string): string {
	return sessionId.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 160) || "unknown";
}

export function feedbackLogPath(sessionId = "unknown"): string {
	return process.env.PI_TOOL_FEEDBACK_LOG ?? path.join(feedbackLogDir(), `${safeSessionPathSegment(sessionId)}.jsonl`);
}

export function nowIso(): string {
	return new Date().toISOString();
}

function shortHash(value: string): string {
	return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function unique(items: Array<string | undefined>): string[] {
	return [...new Set(items.filter((item): item is string => typeof item === "string" && item.length > 0))];
}

export function categoryForTool(toolName: string, input: unknown): string {
	if (toolName === "read") return "read";
	if (toolName === "edit" || toolName === "write") return "edit";
	if (toolName === "bash") {
		const command = isRecord(input) ? stringValue(input.command)?.trim() : undefined;
		if (!command) return "bash:unknown";
		if (/\b(rg|grep|fd|find|ag)\b/.test(command)) return "bash:search";
		if (/\b(npm|pnpm|yarn|bun)\s+(test|run\s+test|run\s+typecheck)|\b(pytest|go\s+test|cargo\s+test|dotnet\s+test)\b/.test(command)) return "bash:test";
		if (/\b(git\s+(diff|status|show|log|grep)|gh\s+)/.test(command)) return "bash:vcs";
		return "bash:other";
	}
	return toolName.startsWith("code_intel_") ? "code-intel" : "other";
}

export function matchesWatch(toolName: string, config: ToolFeedbackConfig): boolean {
	if (config.excludeTools.includes(toolName)) return false;
	return config.watch.some((rule) => rule.name === toolName || (rule.prefix !== undefined && toolName.startsWith(rule.prefix)));
}

export function resultOk(details: unknown, isError: boolean): boolean {
	if (isError) return false;
	if (isRecord(details) && details.ok === false) return false;
	return true;
}

export function resultTruncated(details: unknown): boolean {
	if (!isRecord(details)) return false;
	if (details.truncated === true) return true;
	return isRecord(details.coverage) && details.coverage.truncated === true;
}

export function resultErrorKind(details: unknown, isError: boolean): string | undefined {
	if (isError) return "tool-error";
	if (!isRecord(details)) return undefined;
	if (typeof details.reason === "string") return "reason";
	if (typeof details.diagnostic === "string") return "diagnostic";
	return undefined;
}

export function appendLog(config: ToolFeedbackConfig, sessionId: string, event: Record<string, unknown>): void {
	if (!config.log) return;
	try {
		const logPath = feedbackLogPath(sessionId);
		fs.mkdirSync(path.dirname(logPath), { recursive: true });
		fs.appendFileSync(logPath, `${JSON.stringify(event)}\n`);
	} catch {
		// Feedback logging must never affect tool execution.
	}
}

export function makeTurnSummary(turn: TurnUsage, ctx: ExtensionContext): TurnSummary {
	const firstWatchedSequence = Math.min(...turn.watchedCalls.map((call) => call.sequence));
	return {
		version: 1,
		kind: "turn_summary",
		timestamp: nowIso(),
		sessionId: sessionIdFromContext(ctx),
		repoRoot: ctx.cwd,
		turnIndex: turn.turnIndex,
		watchedTools: unique(turn.watchedCalls.map((call) => call.toolName)),
		watchedCallCount: turn.watchedCalls.length,
		watchedResultCount: turn.watchedResults.length,
		anyTruncated: turn.watchedResults.some((result) => result.truncated),
		anyError: turn.watchedResults.some((result) => !result.ok || result.isError),
		confirmReferences: unique(turn.watchedCalls.map((call) => call.confirmReferences)),
		toolCategories: unique(turn.toolCalls.map((call) => call.category)),
		categoriesAfterFirstWatchedCall: unique(turn.toolCalls.filter((call) => call.sequence > firstWatchedSequence).map((call) => call.category)),
	};
}

export function modeIncludesPassive(mode: FeedbackMode): boolean {
	return mode === "passive" || mode === "both";
}

export function modeIncludesAsk(mode: FeedbackMode): boolean {
	return mode === "ask-agent" || mode === "both";
}

export function feedbackPrompt(config: ToolFeedbackConfig, usage: AgentUsage): string {
	const watchedTools = unique(usage.watchedCalls.map((call) => call.toolName)).join(", ");
	const flags = [
		usage.watchedResults.some((result) => result.truncated) ? "some watched results were truncated" : undefined,
		usage.afterWatchedCategories.includes("bash:search") ? "follow-up search happened after watched tool use" : undefined,
		usage.afterWatchedCategories.includes("read") ? "source reads happened after watched tool use" : undefined,
	].filter(Boolean).join("; ");
	return `${config.taskPrompt}\n\nWatched tools used: ${watchedTools || "unknown"}.${flags ? `\nObserved follow-up signals: ${flags}.` : ""}`;
}

function feedbackHelped(value: unknown): FeedbackHelped {
	return value === "yes" || value === "no" || value === "mixed" || value === "unknown" ? value : "unknown";
}

function feedbackOutcome(value: unknown): FeedbackOutcome {
	return value === "chose_files" || value === "found_issue" || value === "reduced_uncertainty" || value === "not_useful" || value === "blocked" || value === "other" ? value : "other";
}

function missedContext(value: unknown): MissedImportantContext | undefined {
	return value === "yes" || value === "no" || value === "unknown" ? value : undefined;
}

function improvement(value: unknown): FeedbackImprovement | undefined {
	return value === "better_ranking" || value === "higher_cap" || value === "better_summary" || value === "better_docs" || value === "less_noise" || value === "faster" || value === "other" ? value : undefined;
}

export function feedbackRecord(input: Record<string, unknown>, ctx: ExtensionContext): FeedbackRecord {
	const note = stringValue(input.note)?.trim();
	return {
		version: 1,
		kind: "agent_feedback",
		timestamp: nowIso(),
		sessionId: sessionIdFromContext(ctx),
		repoRoot: ctx.cwd,
		watchedTools: normalizeStringArray(input.watchedTools),
		helped: feedbackHelped(input.helped),
		outcome: feedbackOutcome(input.outcome),
		neededFollowupSearch: booleanValue(input.neededFollowupSearch),
		readReturnedFiles: booleanValue(input.readReturnedFiles),
		outputTooNoisy: booleanValue(input.outputTooNoisy),
		truncationHurt: booleanValue(input.truncationHurt),
		missedImportantContext: missedContext(input.missedImportantContext),
		improvement: improvement(input.improvement),
		note,
		noteLength: note ? note.length : undefined,
		noteHash: note ? shortHash(note) : undefined,
	};
}

export function logSafeFeedbackRecord(record: FeedbackRecord): Record<string, unknown> {
	const { note: _note, ...safe } = record;
	return safe;
}
