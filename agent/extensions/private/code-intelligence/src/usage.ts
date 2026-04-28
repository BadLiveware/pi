import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { isRecord, normalizePositiveInteger } from "./util.ts";

export interface CodeIntelUsageSummaryParams {
	repoRoot?: string;
	allRepos?: boolean;
	sinceHours?: number;
	includeRecentEvents?: boolean;
	maxRecentEvents?: number;
}

type UsageKind = "tool_call" | "tool_result";

type UsageEvent = {
	version: 1;
	timestamp: string;
	kind: UsageKind;
	sessionId: string;
	repoRoot?: string;
	cwd?: string;
	toolName: string;
	category: string;
	inputShape?: Record<string, unknown>;
	resultShape?: Record<string, unknown>;
	durationMs?: number;
};

type PendingToolCall = {
	startedAt: number;
	sessionId: string;
	repoRoot?: string;
	cwd?: string;
	toolName: string;
	category: string;
	inputShape?: Record<string, unknown>;
};

const pendingToolCalls = new Map<string, PendingToolCall>();
const codeIntelPrefix = "code_intel_";
const actionCodeIntelTools = new Set([
	"code_intel_symbol_context",
	"code_intel_references",
	"code_intel_impact_map",
	"code_intel_syntax_search",
]);

function usageLogDir(): string {
	return process.env.PI_CODE_INTEL_USAGE_DIR ?? path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"), "pi-code-intelligence", "usage");
}

function safeSessionPathSegment(sessionId: string): string {
	return sessionId.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 160) || "unknown";
}

export function usageLogPath(sessionId = "unknown"): string {
	return process.env.PI_CODE_INTEL_USAGE_LOG ?? path.join(usageLogDir(), `${safeSessionPathSegment(sessionId)}.jsonl`);
}

function sessionIdFromContext(ctx: ExtensionContext): string {
	const manager = ctx.sessionManager as unknown as { getSessionId?: () => string; getLeafId?: () => string | null } | undefined;
	try {
		const sessionId = manager?.getSessionId?.();
		if (sessionId) return sessionId;
	} catch {
		// Fall through to deterministic process-local fallback.
	}
	return `process:${process.pid}:${ctx.cwd}`;
}

function nowIso(): string {
	return new Date().toISOString();
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

function arrayLength(value: unknown): number {
	return Array.isArray(value) ? value.length : 0;
}

function bucketCount(value: unknown): string | undefined {
	const count = arrayLength(value);
	if (count === 0) return undefined;
	if (count === 1) return "1";
	if (count <= 5) return "2-5";
	if (count <= 20) return "6-20";
	return ">20";
}

function classifyPath(inputPath: unknown): string | undefined {
	const rawPath = stringValue(inputPath);
	if (!rawPath) return undefined;
	const normalized = rawPath.split(path.sep).join(path.posix.sep);
	if (/code-intelligence\/skills\/code-intelligence\/SKILL\.md$/.test(normalized)) return "code-intel-skill";
	if (/code-intelligence\/README\.md$/.test(normalized)) return "code-intel-readme";
	if (normalized.includes("/code-intelligence/")) return "code-intel-source";
	if (/(^|\/)AGENTS\.md$/.test(normalized)) return "project-guidance";
	if (/(^|\/)CLAUDE\.md$/.test(normalized)) return "project-guidance";
	if (/(^|\/)README\.md$/.test(normalized)) return "readme";
	return "other";
}

function classifyBashCommand(command: unknown): string | undefined {
	const text = stringValue(command)?.trim();
	if (!text) return undefined;
	if (/\b(rg|grep|fd|find|ag)\b/.test(text)) return "search";
	if (/\b(git\s+(diff|status|show|log|grep|check-ignore)|gh\s+)/.test(text)) return "vcs";
	if (/\b(npm|pnpm|yarn|bun)\s+(test|run\s+test|run\s+typecheck)|\b(pytest|go\s+test|cargo\s+test|dotnet\s+test)\b/.test(text)) return "test";
	if (/\b(tsc|npm\s+run\s+build|pnpm\s+build|yarn\s+build|cargo\s+build|go\s+build|dotnet\s+build)\b/.test(text)) return "build";
	return "other";
}

function toolCategory(toolName: string, input: unknown): string {
	if (toolName.startsWith(codeIntelPrefix)) return "code-intel";
	if (toolName === "read") return classifyPath(isRecord(input) ? input.path : undefined) ?? "read";
	if (toolName === "bash") return `bash:${classifyBashCommand(isRecord(input) ? input.command : undefined) ?? "unknown"}`;
	if (toolName === "code_search" || toolName === "web_search" || toolName === "greedy_search") return "external-info-search";
	return "other";
}

function shouldRecordToolCall(toolName: string): boolean {
	return toolName.startsWith(codeIntelPrefix) || toolName === "read" || toolName === "bash" || toolName === "code_search" || toolName === "web_search" || toolName === "greedy_search";
}

function codeIntelInputShape(toolName: string, input: Record<string, unknown>): Record<string, unknown> | undefined {
	if (toolName === "code_intel_state") return { includeDiagnostics: booleanValue(input.includeDiagnostics) === true, hasRepoRoot: typeof input.repoRoot === "string" };
	if (toolName === "code_intel_update") return { backend: stringValue(input.backend) ?? "auto", force: booleanValue(input.force) === true, hasRepoArtifactOverride: typeof input.allowRepoArtifacts === "string", hasRepoRoot: typeof input.repoRoot === "string" };
	if (toolName === "code_intel_symbol_context") return { hasSymbol: typeof input.symbol === "string" && input.symbol.trim().length > 0, symbolLength: stringValue(input.symbol)?.length, maxCallers: numberValue(input.maxCallers), hasRepoRoot: typeof input.repoRoot === "string" };
	if (toolName === "code_intel_references") return { hasQuery: typeof input.query === "string" && input.query.trim().length > 0, queryLength: stringValue(input.query)?.length, relation: stringValue(input.relation) ?? "refs", detail: stringValue(input.detail) ?? "locations", pathCount: arrayLength(input.paths), excludeGlobCount: arrayLength(input.excludeGlobs), maxResults: numberValue(input.maxResults), hasRepoRoot: typeof input.repoRoot === "string" };
	if (toolName === "code_intel_impact_map") return { symbolCount: arrayLength(input.symbols), changedFileCount: arrayLength(input.changedFiles), hasBaseRef: typeof input.baseRef === "string", detail: stringValue(input.detail) ?? "locations", maxDepth: numberValue(input.maxDepth), maxResults: numberValue(input.maxResults), hasRepoRoot: typeof input.repoRoot === "string" };
	if (toolName === "code_intel_syntax_search") return { hasPattern: typeof input.pattern === "string" && input.pattern.trim().length > 0, patternLength: stringValue(input.pattern)?.length, hasLanguage: typeof input.language === "string", detail: stringValue(input.detail) ?? "snippets", pathCount: arrayLength(input.paths), includeGlobCount: arrayLength(input.includeGlobs), excludeGlobCount: arrayLength(input.excludeGlobs), hasStrictness: typeof input.strictness === "string", maxResults: numberValue(input.maxResults), hasRepoRoot: typeof input.repoRoot === "string" };
	if (toolName === "code_intel_usage") return { allRepos: booleanValue(input.allRepos) === true, includeRecentEvents: booleanValue(input.includeRecentEvents) === true, sinceHours: numberValue(input.sinceHours), hasRepoRoot: typeof input.repoRoot === "string" };
	return undefined;
}

function inputShape(toolName: string, input: unknown): Record<string, unknown> | undefined {
	if (!isRecord(input)) return undefined;
	if (toolName.startsWith(codeIntelPrefix)) return codeIntelInputShape(toolName, input);
	if (toolName === "read") return { pathKind: classifyPath(input.path), hasRange: typeof input.offset === "number" || typeof input.limit === "number" };
	if (toolName === "bash") return { commandKind: classifyBashCommand(input.command), hasTimeout: typeof input.timeout === "number" };
	if (toolName === "code_search") return { hasQuery: typeof input.query === "string", maxTokens: numberValue(input.maxTokens) };
	if (toolName === "web_search" || toolName === "greedy_search") return { hasQuery: typeof input.query === "string", queryCount: arrayLength(input.queries) };
	return undefined;
}

function errorKindFromText(text: string): string | undefined {
	const lower = text.toLowerCase();
	if (/eacces|permission denied|operation not permitted|owned by root|access denied/.test(lower)) return "permission";
	if (/enoent|not found|no such file/.test(lower)) return "missing";
	if (/timed out|timeout/.test(lower)) return "timeout";
	if (/parse|json|syntax/.test(lower)) return "parse";
	return undefined;
}

function resultErrorKind(details: Record<string, unknown>, isError: boolean): string | undefined {
	if (isError) return "tool-error";
	const command = isRecord(details.command) ? details.command : undefined;
	if (command?.timedOut === true) return "timeout";
	if (command?.outputTruncated === true) return "output-truncated";
	if (typeof command?.error === "string") return errorKindFromText(command.error) ?? "command-error";
	if (typeof command?.stderr === "string") return errorKindFromText(command.stderr);
	if (typeof details.reason === "string") return errorKindFromText(details.reason) ?? "policy";
	if (typeof details.diagnostic === "string") return errorKindFromText(details.diagnostic);
	return undefined;
}

function codeIntelResultShape(toolName: string, details: Record<string, unknown>, isError: boolean): Record<string, unknown> {
	const ok = details.ok === true || (details.ok !== false && !isError);
	const shape: Record<string, unknown> = {
		ok,
		isError,
		backend: stringValue(details.backend),
		errorKind: ok ? undefined : resultErrorKind(details, isError) ?? "unknown",
	};
	if (toolName === "code_intel_state") {
		shape.hasRuntimeDiagnostics = isRecord(details.runtimeDiagnostics);
		shape.diagnosticCount = Array.isArray(details.diagnostics) ? details.diagnostics.length : 0;
		const backends = isRecord(details.backends) ? details.backends : undefined;
		if (backends) {
			shape.backendStates = Object.fromEntries(Object.entries(backends).map(([name, status]) => [name, isRecord(status) ? status.indexStatus : undefined]));
		}
	}
	if (toolName === "code_intel_update") {
		shape.backendCount = arrayLength(details.backends);
		shape.resultCount = arrayLength(details.results);
		shape.skippedCount = Array.isArray(details.results) ? details.results.filter((item) => isRecord(item) && item.skipped === true).length : 0;
	}
	if (toolName === "code_intel_symbol_context") {
		shape.hasResolved = isRecord(details.resolved);
		shape.callerCount = arrayLength(details.callers);
		shape.matchCount = numberValue(details.matchCount);
	}
	if (toolName === "code_intel_references" || toolName === "code_intel_syntax_search") {
		shape.relation = stringValue(details.relation);
		shape.matchCount = numberValue(details.matchCount);
		shape.returned = numberValue(details.returned);
		shape.truncated = booleanValue(details.truncated) === true;
	}
	if (toolName === "code_intel_impact_map") {
		shape.rootCount = arrayLength(details.rootSymbols);
		shape.relatedCount = arrayLength(details.related);
		shape.truncated = isRecord(details.coverage) ? details.coverage.truncated === true : undefined;
	}
	return Object.fromEntries(Object.entries(shape).filter(([, value]) => value !== undefined));
}

function resultShape(toolName: string, details: unknown, isError: boolean): Record<string, unknown> | undefined {
	if (!toolName.startsWith(codeIntelPrefix)) return undefined;
	return codeIntelResultShape(toolName, isRecord(details) ? details : {}, isError);
}

function repoRootFromInput(input: unknown, ctx: ExtensionContext): string | undefined {
	if (isRecord(input) && typeof input.repoRoot === "string") return input.repoRoot;
	return ctx.cwd;
}

function appendUsageEvent(event: UsageEvent): void {
	try {
		const logPath = usageLogPath(event.sessionId);
		fs.mkdirSync(path.dirname(logPath), { recursive: true });
		fs.appendFileSync(logPath, `${JSON.stringify(event)}\n`);
	} catch {
		// Usage tracking must never affect tool execution.
	}
}

export function recordUsageToolCall(event: unknown, ctx: ExtensionContext): void {
	if (!isRecord(event)) return;
	const toolName = stringValue(event.toolName);
	if (!toolName || !shouldRecordToolCall(toolName)) return;
	const input = event.input;
	const sessionId = sessionIdFromContext(ctx);
	const repoRoot = repoRootFromInput(input, ctx);
	const shape = inputShape(toolName, input);
	const entry: UsageEvent = {
		version: 1,
		timestamp: nowIso(),
		kind: "tool_call",
		sessionId,
		repoRoot,
		cwd: ctx.cwd,
		toolName,
		category: toolCategory(toolName, input),
		inputShape: shape,
	};
	const toolCallId = stringValue(event.toolCallId);
	if (toolCallId) pendingToolCalls.set(toolCallId, { startedAt: Date.now(), sessionId, repoRoot, cwd: ctx.cwd, toolName, category: entry.category, inputShape: shape });
	appendUsageEvent(entry);
}

export function recordUsageToolResult(event: unknown, ctx: ExtensionContext): void {
	if (!isRecord(event)) return;
	const toolName = stringValue(event.toolName);
	if (!toolName?.startsWith(codeIntelPrefix)) return;
	const toolCallId = stringValue(event.toolCallId);
	const pending = toolCallId ? pendingToolCalls.get(toolCallId) : undefined;
	if (toolCallId) pendingToolCalls.delete(toolCallId);
	const details = isRecord(event.details) ? event.details : {};
	const sessionId = pending?.sessionId ?? sessionIdFromContext(ctx);
	const repoRoot = stringValue(details.repoRoot) ?? pending?.repoRoot ?? ctx.cwd;
	appendUsageEvent({
		version: 1,
		timestamp: nowIso(),
		kind: "tool_result",
		sessionId,
		repoRoot,
		cwd: pending?.cwd ?? ctx.cwd,
		toolName,
		category: "code-intel",
		inputShape: pending?.inputShape,
		resultShape: resultShape(toolName, details, booleanValue(event.isError) === true),
		durationMs: pending ? Date.now() - pending.startedAt : undefined,
	});
}

function usageLogFiles(): string[] {
	if (process.env.PI_CODE_INTEL_USAGE_LOG) return [process.env.PI_CODE_INTEL_USAGE_LOG];
	try {
		return fs.readdirSync(usageLogDir())
			.filter((entry) => entry.endsWith(".jsonl"))
			.map((entry) => path.join(usageLogDir(), entry));
	} catch {
		return [];
	}
}

function readUsageEvents(options?: { allRepos?: boolean; repoRoot?: string; sinceMs?: number }): UsageEvent[] {
	const lines = usageLogFiles().flatMap((logPath) => {
		try {
			return fs.readFileSync(logPath, "utf-8").trim().split(/\r?\n/).filter(Boolean);
		} catch {
			return [];
		}
	});
	const events = lines.flatMap((line) => {
		try {
			const parsed = JSON.parse(line) as UsageEvent;
			return parsed?.version === 1 && typeof parsed.timestamp === "string" && typeof parsed.toolName === "string" ? [parsed] : [];
		} catch {
			return [];
		}
	}).sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
	return events.filter((event) => {
		if (options?.sinceMs && Date.parse(event.timestamp) < options.sinceMs) return false;
		if (!options?.allRepos && options?.repoRoot && event.repoRoot !== options.repoRoot && event.cwd !== options.repoRoot) return false;
		return true;
	});
}

function increment(record: Record<string, number>, key: string | undefined): void {
	record[key ?? "unknown"] = (record[key ?? "unknown"] ?? 0) + 1;
}

function rate(count: number, total: number): number | null {
	return total === 0 ? null : Number((count / total).toFixed(3));
}

function eventIsCodeIntelCall(event: UsageEvent): boolean {
	return event.kind === "tool_call" && event.toolName.startsWith(codeIntelPrefix);
}

function eventIsCodeIntelResult(event: UsageEvent): boolean {
	return event.kind === "tool_result" && event.toolName.startsWith(codeIntelPrefix);
}

function eventIsActionCodeIntelCall(event: UsageEvent): boolean {
	return event.kind === "tool_call" && actionCodeIntelTools.has(event.toolName);
}

function eventIsDiagnosticsStateCall(event: UsageEvent): boolean {
	return event.kind === "tool_call" && event.toolName === "code_intel_state" && event.inputShape?.includeDiagnostics === true;
}

function eventIsCodeIntelDocRead(event: UsageEvent): boolean {
	return event.kind === "tool_call" && event.toolName === "read" && (event.inputShape?.pathKind === "code-intel-skill" || event.inputShape?.pathKind === "code-intel-readme");
}

function eventIsRead(event: UsageEvent): boolean {
	return event.kind === "tool_call" && event.toolName === "read";
}

function eventIsInfoSearch(event: UsageEvent): boolean {
	return event.kind === "tool_call" && (event.toolName === "code_search" || event.toolName === "web_search" || event.toolName === "greedy_search");
}

function summarizeSessionBehavior(events: UsageEvent[]): Record<string, unknown> {
	const bySession = new Map<string, UsageEvent[]>();
	for (const event of events) {
		const sessionEvents = bySession.get(event.sessionId) ?? [];
		sessionEvents.push(event);
		bySession.set(event.sessionId, sessionEvents);
	}
	const firstCodeIntelToolBySession: Record<string, number> = {};
	let sessionsWithCodeIntel = 0;
	let sessionsWithDocReadBeforeFirstUse = 0;
	let sessionsWithAnyReadBeforeFirstUse = 0;
	let sessionsWithInfoSearchBeforeFirstUse = 0;
	let stateBeforeActionCount = 0;
	let actionCount = 0;
	let diagnosticsAfterErrorCount = 0;
	let errorResultCount = 0;
	let readAfterCodeIntelResultCount = 0;
	let codeIntelResultCount = 0;

	for (const sessionEvents of bySession.values()) {
		const firstCodeIntelIndex = sessionEvents.findIndex(eventIsCodeIntelCall);
		if (firstCodeIntelIndex >= 0) {
			sessionsWithCodeIntel += 1;
			increment(firstCodeIntelToolBySession, sessionEvents[firstCodeIntelIndex].toolName);
			const before = sessionEvents.slice(0, firstCodeIntelIndex);
			if (before.some(eventIsCodeIntelDocRead)) sessionsWithDocReadBeforeFirstUse += 1;
			if (before.some(eventIsRead)) sessionsWithAnyReadBeforeFirstUse += 1;
			if (before.some(eventIsInfoSearch)) sessionsWithInfoSearchBeforeFirstUse += 1;
		}

		let sawState = false;
		for (let index = 0; index < sessionEvents.length; index += 1) {
			const event = sessionEvents[index];
			if (event.kind === "tool_call" && event.toolName === "code_intel_state") sawState = true;
			if (eventIsActionCodeIntelCall(event)) {
				actionCount += 1;
				if (sawState) stateBeforeActionCount += 1;
			}
			if (eventIsCodeIntelResult(event) && event.toolName !== "code_intel_state" && event.toolName !== "code_intel_usage") {
				codeIntelResultCount += 1;
				if (sessionEvents.slice(index + 1, index + 6).some(eventIsRead)) readAfterCodeIntelResultCount += 1;
				if (event.resultShape?.ok === false) {
					errorResultCount += 1;
					if (sessionEvents.slice(index + 1).some(eventIsDiagnosticsStateCall)) diagnosticsAfterErrorCount += 1;
				}
			}
		}
	}

	return {
		sessionsWithCodeIntel,
		firstCodeIntelToolBySession,
		docReadBeforeFirstUse: { count: sessionsWithDocReadBeforeFirstUse, total: sessionsWithCodeIntel, rate: rate(sessionsWithDocReadBeforeFirstUse, sessionsWithCodeIntel) },
		anyReadBeforeFirstUse: { count: sessionsWithAnyReadBeforeFirstUse, total: sessionsWithCodeIntel, rate: rate(sessionsWithAnyReadBeforeFirstUse, sessionsWithCodeIntel) },
		infoSearchBeforeFirstUse: { count: sessionsWithInfoSearchBeforeFirstUse, total: sessionsWithCodeIntel, rate: rate(sessionsWithInfoSearchBeforeFirstUse, sessionsWithCodeIntel) },
		stateBeforeActionUse: { count: stateBeforeActionCount, total: actionCount, rate: rate(stateBeforeActionCount, actionCount) },
		diagnosticsAfterError: { count: diagnosticsAfterErrorCount, total: errorResultCount, rate: rate(diagnosticsAfterErrorCount, errorResultCount) },
		readAfterCodeIntelResult: { count: readAfterCodeIntelResultCount, total: codeIntelResultCount, rate: rate(readAfterCodeIntelResultCount, codeIntelResultCount) },
	};
}

function summarizeParameterShapes(events: UsageEvent[]): Record<string, unknown> {
	const syntax = { total: 0, withLanguage: 0, withPaths: 0, withGlobs: 0, unscoped: 0 };
	const impact = { total: 0, withSymbols: 0, withChangedFiles: 0, withBaseRef: 0 };
	const updates: Record<string, number> = {};
	let diagnosticsStateCalls = 0;
	for (const event of events) {
		if (event.kind !== "tool_call") continue;
		const shape = event.inputShape ?? {};
		if (event.toolName === "code_intel_state" && shape.includeDiagnostics === true) diagnosticsStateCalls += 1;
		if (event.toolName === "code_intel_update") increment(updates, typeof shape.backend === "string" ? shape.backend : "auto");
		if (event.toolName === "code_intel_syntax_search") {
			syntax.total += 1;
			if (shape.hasLanguage === true) syntax.withLanguage += 1;
			if (typeof shape.pathCount === "number" && shape.pathCount > 0) syntax.withPaths += 1;
			if ((typeof shape.includeGlobCount === "number" && shape.includeGlobCount > 0) || (typeof shape.excludeGlobCount === "number" && shape.excludeGlobCount > 0)) syntax.withGlobs += 1;
			if (shape.hasLanguage !== true && !(typeof shape.pathCount === "number" && shape.pathCount > 0) && !(typeof shape.includeGlobCount === "number" && shape.includeGlobCount > 0) && !(typeof shape.excludeGlobCount === "number" && shape.excludeGlobCount > 0)) syntax.unscoped += 1;
		}
		if (event.toolName === "code_intel_impact_map") {
			impact.total += 1;
			if (typeof shape.symbolCount === "number" && shape.symbolCount > 0) impact.withSymbols += 1;
			if (typeof shape.changedFileCount === "number" && shape.changedFileCount > 0) impact.withChangedFiles += 1;
			if (shape.hasBaseRef === true) impact.withBaseRef += 1;
		}
	}
	return {
		diagnosticsStateCalls,
		updates,
		syntaxSearch: { ...syntax, unscopedRate: rate(syntax.unscoped, syntax.total) },
		impactMap: impact,
	};
}

function summarizeResults(events: UsageEvent[]): Record<string, unknown> {
	const byTool: Record<string, number> = {};
	const errorsByTool: Record<string, number> = {};
	const errorsByKind: Record<string, number> = {};
	let truncatedResults = 0;
	let totalDurationMs = 0;
	let durationCount = 0;
	for (const event of events.filter(eventIsCodeIntelResult)) {
		increment(byTool, event.toolName);
		if (event.durationMs !== undefined) {
			totalDurationMs += event.durationMs;
			durationCount += 1;
		}
		if (event.resultShape?.truncated === true) truncatedResults += 1;
		if (event.resultShape?.ok === false) {
			increment(errorsByTool, event.toolName);
			increment(errorsByKind, typeof event.resultShape.errorKind === "string" ? event.resultShape.errorKind : "unknown");
		}
	}
	return {
		byTool,
		errorsByTool,
		errorsByKind,
		truncatedResults,
		averageDurationMs: durationCount === 0 ? null : Math.round(totalDurationMs / durationCount),
	};
}

function summarizeCalls(events: UsageEvent[]): Record<string, unknown> {
	const byTool: Record<string, number> = {};
	const adjacentByCategory: Record<string, number> = {};
	for (const event of events) {
		if (eventIsCodeIntelCall(event)) increment(byTool, event.toolName);
		else if (event.kind === "tool_call") increment(adjacentByCategory, event.category);
	}
	return { byTool, adjacentByCategory };
}

function sanitizedRecentEvents(events: UsageEvent[], maxRecentEvents: number): UsageEvent[] {
	return events.slice(-maxRecentEvents);
}

export function usageSummary(params: CodeIntelUsageSummaryParams, repoRoot: string): Record<string, unknown> {
	const sinceHours = normalizePositiveInteger(params.sinceHours, 24 * 7, 1, 24 * 365);
	const sinceMs = Date.now() - sinceHours * 60 * 60 * 1000;
	const allRepos = params.allRepos === true;
	const events = readUsageEvents({ repoRoot, allRepos, sinceMs });
	const maxRecentEvents = normalizePositiveInteger(params.maxRecentEvents, 25, 1, 200);
	const codeIntelCallCount = events.filter(eventIsCodeIntelCall).length;
	const codeIntelResultCount = events.filter(eventIsCodeIntelResult).length;
	return {
		logPath: process.env.PI_CODE_INTEL_USAGE_LOG ?? usageLogDir(),
		scope: { repoRoot: allRepos ? undefined : repoRoot, allRepos, sinceHours },
		totals: {
			events: events.length,
			sessions: new Set(events.map((event) => event.sessionId)).size,
			codeIntelCalls: codeIntelCallCount,
			codeIntelResults: codeIntelResultCount,
		},
		calls: summarizeCalls(events),
		results: summarizeResults(events),
		behavior: summarizeSessionBehavior(events),
		parameterShapes: summarizeParameterShapes(events),
		recentEvents: params.includeRecentEvents === true ? sanitizedRecentEvents(events, maxRecentEvents) : undefined,
		privacy: {
			recorded: "Tool names, timestamps, repo/cwd, sanitized parameter shapes, result counts/status, and coarse adjacent-tool categories.",
			notRecorded: "Prompts, full tool outputs, file contents, raw shell commands, raw search queries, and raw code-intel symbol/query/pattern values.",
		},
		limitations: [
			"Usage data captures observable tool calls only; it cannot show tools the agent considered but did not call.",
			"Adjacent read/search correlations are coarse and do not prove the agent inspected every returned candidate.",
		],
	};
}
