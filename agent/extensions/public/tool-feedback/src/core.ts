import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { BASE_FIELD_PROMPT, DEFAULT_TASK_PROMPT } from "./prompts.ts";

export type FeedbackMode = "off" | "passive" | "ask-agent" | "both";
export type PerceivedUsefulness = "high" | "medium" | "low" | "none" | "unknown";
export type YesNoUnknown = "yes" | "no" | "unknown";
export type WouldUseAgain = "yes" | "no" | "unsure" | "unknown";
export type FeedbackConfidence = "high" | "medium" | "low";
export type FeedbackImprovement = "better_ranking" | "higher_cap" | "better_summary" | "better_docs" | "less_noise" | "faster" | "other";
export type FeedbackFieldType = "enum" | "yes_no_unknown" | "boolean" | "number";

export interface WatchRule {
	name?: string;
	prefix?: string;
}

export interface FeedbackFieldConfig {
	name: string;
	type: FeedbackFieldType;
	description?: string;
	values?: string[];
	required: boolean;
}

export type FeedbackFieldValue = string | number | boolean;

export interface FeedbackFieldError {
	name: string;
	reason: string;
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
	feedbackFields: FeedbackFieldConfig[];
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
	perceivedUsefulness: PerceivedUsefulness;
	wouldUseAgainSameSituation: WouldUseAgain;
	followupWasRoutine?: YesNoUnknown;
	followupNeededBecauseToolWasInsufficient?: YesNoUnknown;
	outputSeemedTooNoisy?: YesNoUnknown;
	outputSeemedIncomplete?: YesNoUnknown;
	missedImportantContext?: YesNoUnknown;
	confidence: FeedbackConfidence;
	improvement?: FeedbackImprovement;
	fieldResponses?: Record<string, FeedbackFieldValue>;
	fieldResponseErrors?: FeedbackFieldError[];
	note?: string;
	noteLength?: number;
	noteHash?: string;
}

const CONFIG_FILE_NAME = "tool-feedback.json";

export const DEFAULT_CONFIG: ToolFeedbackConfig = {
	mode: "passive",
	watch: [],
	excludeTools: ["tool_feedback", "tool_feedback_state"],
	cooldownTurns: 0,
	skipWhenPendingMessages: true,
	appendSessionEntries: true,
	log: true,
	taskPrompt: DEFAULT_TASK_PROMPT,
	feedbackFields: [],
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

function isFeedbackFieldType(value: unknown): value is FeedbackFieldType {
	return value === "enum" || value === "yes_no_unknown" || value === "boolean" || value === "number";
}

function normalizeFieldName(value: unknown): string | undefined {
	const name = stringValue(value)?.trim();
	if (!name || name.length > 64) return undefined;
	return /^[a-zA-Z][a-zA-Z0-9_]*$/.test(name) ? name : undefined;
}

function normalizeFeedbackFields(value: unknown, source: string, diagnostics: string[]): FeedbackFieldConfig[] {
	if (!Array.isArray(value)) return [];
	const fields: FeedbackFieldConfig[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		if (!isRecord(item)) {
			diagnostics.push(`${source}: feedback field ignored because it is not an object`);
			continue;
		}
		const name = normalizeFieldName(item.name);
		if (!name) {
			diagnostics.push(`${source}: feedback field ignored because name must match /^[a-zA-Z][a-zA-Z0-9_]*$/ and be <=64 chars`);
			continue;
		}
		if (seen.has(name)) {
			diagnostics.push(`${source}: duplicate feedback field "${name}" ignored`);
			continue;
		}
		const type = isFeedbackFieldType(item.type) ? item.type : undefined;
		if (!type) {
			diagnostics.push(`${source}: feedback field "${name}" ignored because type is invalid`);
			continue;
		}
		const values = type === "enum" ? normalizeStringArray(item.values).slice(0, 20) : undefined;
		if (type === "enum" && (!values || values.length === 0)) {
			diagnostics.push(`${source}: enum feedback field "${name}" ignored because values are missing`);
			continue;
		}
		seen.add(name);
		fields.push({
			name,
			type,
			description: stringValue(item.description)?.trim().slice(0, 200) || undefined,
			values,
			required: booleanValue(item.required) ?? false,
		});
	}
	return fields;
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
	if ("feedbackFields" in input) next.feedbackFields = normalizeFeedbackFields(input.feedbackFields, source, diagnostics);
	if (isRecord(input.feedback) && "fields" in input.feedback) next.feedbackFields = normalizeFeedbackFields(input.feedback.fields, source, diagnostics);
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

function configuredFieldsPrompt(fields: FeedbackFieldConfig[]): string {
	if (fields.length === 0) return "";
	const lines = ["Configured extra feedback fields: answer these in `fieldResponses` using the exact field names and allowed values below."];
	for (const field of fields) {
		const required = field.required ? "required" : "optional";
		const allowed = field.type === "enum" ? (field.values ?? []).join(" | ") : field.type === "yes_no_unknown" ? "yes | no | unknown" : field.type;
		lines.push(`- ${field.name} (${required}, ${field.type}${field.description ? `, ${field.description}` : ""}): ${allowed}`);
	}
	return `\n\n${lines.join("\n")}`;
}

export function feedbackPrompt(config: ToolFeedbackConfig, usage: AgentUsage): string {
	const watchedTools = unique(usage.watchedCalls.map((call) => call.toolName)).join(", ");
	return `${config.taskPrompt}\n\nWatched tools used: ${watchedTools || "unknown"}.\n\n${BASE_FIELD_PROMPT}${configuredFieldsPrompt(config.feedbackFields)}`;
}

function perceivedUsefulness(value: unknown): PerceivedUsefulness {
	return value === "high" || value === "medium" || value === "low" || value === "none" || value === "unknown" ? value : "unknown";
}

function yesNoUnknown(value: unknown): YesNoUnknown | undefined {
	return value === "yes" || value === "no" || value === "unknown" ? value : undefined;
}

function wouldUseAgain(value: unknown): WouldUseAgain {
	return value === "yes" || value === "no" || value === "unsure" || value === "unknown" ? value : "unknown";
}

function confidence(value: unknown): FeedbackConfidence {
	return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function improvement(value: unknown): FeedbackImprovement | undefined {
	return value === "better_ranking" || value === "higher_cap" || value === "better_summary" || value === "better_docs" || value === "less_noise" || value === "faster" || value === "other" ? value : undefined;
}

function validateFieldValue(field: FeedbackFieldConfig, value: unknown): { value?: FeedbackFieldValue; error?: string } {
	if (value === undefined) return field.required ? { error: "required field missing" } : {};
	if (field.type === "enum") {
		if (typeof value === "string" && (field.values ?? []).includes(value)) return { value };
		return { error: `expected one of ${(field.values ?? []).join(" | ")}` };
	}
	if (field.type === "yes_no_unknown") {
		if (value === "yes" || value === "no" || value === "unknown") return { value };
		return { error: "expected yes | no | unknown" };
	}
	if (field.type === "boolean") {
		if (typeof value === "boolean") return { value };
		return { error: "expected boolean" };
	}
	if (field.type === "number") {
		if (typeof value === "number" && Number.isFinite(value)) return { value };
		return { error: "expected finite number" };
	}
	return { error: "unsupported field type" };
}

function validateFieldResponses(input: unknown, fields: FeedbackFieldConfig[]): { responses?: Record<string, FeedbackFieldValue>; errors?: FeedbackFieldError[] } {
	if (fields.length === 0) return {};
	const raw = isRecord(input) ? input : {};
	const responses: Record<string, FeedbackFieldValue> = {};
	const errors: FeedbackFieldError[] = [];
	for (const field of fields) {
		const result = validateFieldValue(field, raw[field.name]);
		if (result.value !== undefined) responses[field.name] = result.value;
		if (result.error) errors.push({ name: field.name, reason: result.error });
	}
	for (const name of Object.keys(raw)) {
		if (!fields.some((field) => field.name === name)) errors.push({ name, reason: "unknown configured field" });
	}
	return {
		responses: Object.keys(responses).length > 0 ? responses : undefined,
		errors: errors.length > 0 ? errors : undefined,
	};
}

export function feedbackRecord(input: Record<string, unknown>, ctx: ExtensionContext, config?: ToolFeedbackConfig): FeedbackRecord {
	const note = stringValue(input.note)?.trim();
	const fields = validateFieldResponses(input.fieldResponses, config?.feedbackFields ?? []);
	return {
		version: 1,
		kind: "agent_feedback",
		timestamp: nowIso(),
		sessionId: sessionIdFromContext(ctx),
		repoRoot: ctx.cwd,
		watchedTools: normalizeStringArray(input.watchedTools),
		perceivedUsefulness: perceivedUsefulness(input.perceivedUsefulness),
		wouldUseAgainSameSituation: wouldUseAgain(input.wouldUseAgainSameSituation),
		followupWasRoutine: yesNoUnknown(input.followupWasRoutine),
		followupNeededBecauseToolWasInsufficient: yesNoUnknown(input.followupNeededBecauseToolWasInsufficient),
		outputSeemedTooNoisy: yesNoUnknown(input.outputSeemedTooNoisy),
		outputSeemedIncomplete: yesNoUnknown(input.outputSeemedIncomplete),
		missedImportantContext: yesNoUnknown(input.missedImportantContext),
		confidence: confidence(input.confidence),
		improvement: improvement(input.improvement),
		fieldResponses: fields.responses,
		fieldResponseErrors: fields.errors,
		note,
		noteLength: note ? note.length : undefined,
		noteHash: note ? shortHash(note) : undefined,
	};
}

export function logSafeFeedbackRecord(record: FeedbackRecord): Record<string, unknown> {
	const { note: _note, ...safe } = record;
	return safe;
}
