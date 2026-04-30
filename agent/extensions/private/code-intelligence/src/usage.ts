import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { isRecord } from "./util.ts";

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
	const manager = ctx.sessionManager as unknown as { getSessionId?: () => string } | undefined;
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

function shortHash(value: string): string {
	return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function lineCount(value: string): number {
	if (value.length === 0) return 0;
	return value.endsWith("\n") ? value.split("\n").length - 1 : value.split("\n").length;
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
	if (/(^|\/)AGENTS\.md$/.test(normalized) || /(^|\/)CLAUDE\.md$/.test(normalized)) return "project-guidance";
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
	if (toolName === "edit") return "edit";
	if (toolName === "bash") return `bash:${classifyBashCommand(isRecord(input) ? input.command : undefined) ?? "unknown"}`;
	if (toolName === "code_search" || toolName === "web_search" || toolName === "greedy_search") return "external-info-search";
	return "other";
}

function shouldRecordToolCall(toolName: string): boolean {
	return toolName.startsWith(codeIntelPrefix) || toolName === "read" || toolName === "edit" || toolName === "bash" || toolName === "code_search" || toolName === "web_search" || toolName === "greedy_search";
}

function codeIntelInputShape(toolName: string, input: Record<string, unknown>): Record<string, unknown> | undefined {
	if (toolName === "code_intel_state") return { includeDiagnostics: booleanValue(input.includeDiagnostics) === true, hasRepoRoot: typeof input.repoRoot === "string" };
	if (toolName === "code_intel_local_map") return { anchorCount: arrayLength(input.anchors), nameCount: arrayLength(input.names), pathCount: arrayLength(input.paths), hasLanguage: typeof input.language === "string", includeSyntax: booleanValue(input.includeSyntax), detail: stringValue(input.detail) ?? "locations", maxResults: numberValue(input.maxResults), maxPerName: numberValue(input.maxPerName), hasRepoRoot: typeof input.repoRoot === "string" };
	if (toolName === "code_intel_impact_map") return { symbolCount: arrayLength(input.symbols), changedFileCount: arrayLength(input.changedFiles), hasBaseRef: typeof input.baseRef === "string", detail: stringValue(input.detail) ?? "locations", maxResults: numberValue(input.maxResults), hasRepoRoot: typeof input.repoRoot === "string", confirmReferences: stringValue(input.confirmReferences), maxReferenceRoots: numberValue(input.maxReferenceRoots), maxReferenceResults: numberValue(input.maxReferenceResults), includeReferenceDeclarations: booleanValue(input.includeReferenceDeclarations) };
	if (toolName === "code_intel_syntax_search") return { hasPattern: typeof input.pattern === "string" && input.pattern.trim().length > 0, patternLength: stringValue(input.pattern)?.length, hasLanguage: typeof input.language === "string", detail: stringValue(input.detail) ?? "snippets", pathCount: arrayLength(input.paths), includeGlobCount: arrayLength(input.includeGlobs), excludeGlobCount: arrayLength(input.excludeGlobs), hasStrictness: typeof input.strictness === "string", maxResults: numberValue(input.maxResults), hasRepoRoot: typeof input.repoRoot === "string" };
	return undefined;
}

function editTextShape(edits: unknown): Record<string, unknown> {
	if (!Array.isArray(edits)) return { editCount: 0 };
	const oldText = edits.map((edit) => isRecord(edit) && typeof edit.oldText === "string" ? edit.oldText : "").join("\n---edit---\n");
	const newText = edits.map((edit) => isRecord(edit) && typeof edit.newText === "string" ? edit.newText : "").join("\n---edit---\n");
	return {
		editCount: edits.length,
		oldTextLineCount: lineCount(oldText),
		newTextLineCount: lineCount(newText),
		oldTextHash: oldText ? shortHash(oldText) : undefined,
		newTextHash: newText ? shortHash(newText) : undefined,
	};
}

function inputShape(toolName: string, input: unknown): Record<string, unknown> | undefined {
	if (!isRecord(input)) return undefined;
	if (toolName.startsWith(codeIntelPrefix)) return codeIntelInputShape(toolName, input);
	if (toolName === "read") return { pathKind: classifyPath(input.path), hasRange: typeof input.offset === "number" || typeof input.limit === "number" };
	if (toolName === "edit") return { pathKind: classifyPath(input.path), ...editTextShape(input.edits) };
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
		if (backends) shape.backendStates = Object.fromEntries(Object.entries(backends).map(([name, status]) => [name, isRecord(status) ? status.available : undefined]));
	}
	if (toolName === "code_intel_syntax_search") {
		shape.matchCount = numberValue(details.matchCount);
		shape.returned = numberValue(details.returned);
		shape.truncated = booleanValue(details.truncated) === true;
	}
	if (toolName === "code_intel_local_map") {
		shape.nameCount = arrayLength(details.names);
		shape.anchorCount = arrayLength(details.anchors);
		shape.suggestedFileCount = isRecord(details.summary) ? arrayLength(details.summary.suggestedFiles) : undefined;
		shape.truncated = isRecord(details.coverage) ? details.coverage.truncated === true : undefined;
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
	const toolCallId = stringValue(event.toolCallId);
	if (!toolName || !toolCallId || !shouldRecordToolCall(toolName)) return;
	const sessionId = sessionIdFromContext(ctx);
	const repoRoot = repoRootFromInput(event.input, ctx);
	const pending: PendingToolCall = {
		startedAt: Date.now(),
		sessionId,
		repoRoot,
		cwd: ctx.cwd,
		toolName,
		category: toolCategory(toolName, event.input),
		inputShape: inputShape(toolName, event.input),
	};
	pendingToolCalls.set(toolCallId, pending);
	appendUsageEvent({
		version: 1,
		timestamp: nowIso(),
		kind: "tool_call",
		sessionId,
		repoRoot,
		cwd: ctx.cwd,
		toolName,
		category: pending.category,
		inputShape: pending.inputShape,
	});
}

export function recordUsageToolResult(event: unknown, ctx: ExtensionContext): void {
	if (!isRecord(event)) return;
	const toolName = stringValue(event.toolName);
	const toolCallId = stringValue(event.toolCallId);
	if (!toolName || !toolCallId || !shouldRecordToolCall(toolName)) return;
	const pending = pendingToolCalls.get(toolCallId);
	pendingToolCalls.delete(toolCallId);
	const sessionId = pending?.sessionId ?? sessionIdFromContext(ctx);
	appendUsageEvent({
		version: 1,
		timestamp: nowIso(),
		kind: "tool_result",
		sessionId,
		repoRoot: pending?.repoRoot ?? repoRootFromInput(event.input, ctx),
		cwd: pending?.cwd ?? ctx.cwd,
		toolName,
		category: pending?.category ?? toolCategory(toolName, event.input),
		inputShape: pending?.inputShape,
		resultShape: resultShape(toolName, event.details, event.isError === true),
		durationMs: pending ? Date.now() - pending.startedAt : undefined,
	});
}

export function summarizeUsageEvents(events: UsageEvent[]): Record<string, unknown> {
	const byTool = new Map<string, number>();
	const byCategory = new Map<string, number>();
	for (const event of events) {
		byTool.set(event.toolName, (byTool.get(event.toolName) ?? 0) + 1);
		byCategory.set(event.category, (byCategory.get(event.category) ?? 0) + 1);
	}
	const toObject = (map: Map<string, number>) => Object.fromEntries([...map.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])));
	return {
		eventCount: events.length,
		byTool: toObject(byTool),
		byCategory: toObject(byCategory),
		codeIntelResultCount: events.filter((event) => event.kind === "tool_result" && event.toolName.startsWith(codeIntelPrefix)).length,
		searchAfterCodeIntelCount: events.filter((event) => event.kind === "tool_call" && event.category === "bash:search").length,
		detailBuckets: Object.fromEntries(Object.entries(events.reduce<Record<string, number>>((acc, event) => {
			const detail = isRecord(event.inputShape) ? stringValue(event.inputShape.detail) : undefined;
			if (detail) acc[detail] = (acc[detail] ?? 0) + 1;
			return acc;
		}, {}))),
		pathCountBuckets: Object.fromEntries(Object.entries(events.reduce<Record<string, number>>((acc, event) => {
			const bucket = isRecord(event.inputShape) ? bucketCount(Array.from({ length: typeof event.inputShape.pathCount === "number" ? event.inputShape.pathCount : 0 })) : undefined;
			if (bucket) acc[bucket] = (acc[bucket] ?? 0) + 1;
			return acc;
		}, {}))),
	};
}
