import * as path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ensureInsideRoot } from "code-intel/pi-integration";

type TouchedFileRecord = {
	sessionId: string;
	absolutePath: string;
	toolName: string;
	timestampMs: number;
};

const touchedFiles: TouchedFileRecord[] = [];
const lastPostEditMapBySession = new Map<string, number>();
const lastDiagnosticSurfaceBySession = new Map<string, number>();
const maxTouchedFiles = 120;
const maxAgeMs = 2 * 60 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function sessionIdFromContext(ctx: ExtensionContext): string {
	const manager = ctx.sessionManager as unknown as { getSessionId?: () => string } | undefined;
	try {
		const sessionId = manager?.getSessionId?.();
		if (sessionId) return sessionId;
	} catch {
		// Fall through to deterministic process-local fallback.
	}
	return `process:${process.pid}:${ctx.cwd}`;
}

function compactOldRecords(now = Date.now()): void {
	while (touchedFiles.length > 0 && now - touchedFiles[0].timestampMs > maxAgeMs) touchedFiles.shift();
	while (touchedFiles.length > maxTouchedFiles) touchedFiles.shift();
	for (const [sessionId, timestamp] of lastPostEditMapBySession) if (now - timestamp > maxAgeMs) lastPostEditMapBySession.delete(sessionId);
	for (const [sessionId, timestamp] of lastDiagnosticSurfaceBySession) if (now - timestamp > maxAgeMs) lastDiagnosticSurfaceBySession.delete(sessionId);
}

function pathFromToolResult(event: Record<string, unknown>): string | undefined {
	const details = isRecord(event.details) ? event.details : undefined;
	const input = isRecord(event.input) ? event.input : undefined;
	const toolName = stringValue(event.toolName);
	if (toolName === "edit" || toolName === "write") return stringValue(input?.path)?.replace(/^@/, "");
	if ((toolName === "code_intel_replace_symbol" || toolName === "code_intel_insert_relative") && details && details.changed !== false) return stringValue(details.file);
	return undefined;
}

function repoRootFromToolResult(event: Record<string, unknown>): string | undefined {
	const details = isRecord(event.details) ? event.details : undefined;
	return stringValue(details?.repoRoot);
}

function absoluteTouchedPath(ctx: ExtensionContext, event: Record<string, unknown>, file: string): string {
	if (path.isAbsolute(file)) return path.resolve(file);
	return path.resolve(repoRootFromToolResult(event) ?? ctx.cwd, file);
}

export function recordTouchedFileFromToolResult(event: unknown, ctx: ExtensionContext): void {
	if (!isRecord(event) || event.isError === true) return;
	const toolName = stringValue(event.toolName);
	if (!toolName) return;
	const file = pathFromToolResult(event);
	if (!file) return;
	const now = Date.now();
	const sessionId = sessionIdFromContext(ctx);
	const absolutePath = absoluteTouchedPath(ctx, event, file);
	const existing = touchedFiles.find((record) => record.sessionId === sessionId && record.absolutePath === absolutePath);
	if (existing) {
		existing.timestampMs = now;
		existing.toolName = toolName;
	} else {
		touchedFiles.push({ sessionId, absolutePath, toolName, timestampMs: now });
	}
	compactOldRecords(now);
}

function recentTouchedFilesSince(ctx: ExtensionContext, repoRoot: string, max: number, sinceMs: number): string[] {
	compactOldRecords();
	const sessionId = sessionIdFromContext(ctx);
	const rows = touchedFiles
		.filter((record) => record.sessionId === sessionId && record.timestampMs > sinceMs)
		.sort((left, right) => right.timestampMs - left.timestampMs);
	const output: string[] = [];
	const seen = new Set<string>();
	for (const record of rows) {
		let file: string;
		try {
			file = ensureInsideRoot(repoRoot, record.absolutePath);
		} catch {
			continue;
		}
		if (seen.has(file)) continue;
		seen.add(file);
		output.push(file);
		if (output.length >= max) break;
	}
	return output;
}

export function recentTouchedFilesForContext(ctx: ExtensionContext, repoRoot: string, max = 50): string[] {
	return recentTouchedFilesSince(ctx, repoRoot, max, 0);
}

export function markPostEditMapForContext(ctx: ExtensionContext, now = Date.now()): void {
	compactOldRecords(now);
	lastPostEditMapBySession.set(sessionIdFromContext(ctx), now);
}

export function recentTouchedFilesNeedingDiagnosticsForContext(ctx: ExtensionContext, repoRoot: string, max = 50): string[] {
	compactOldRecords();
	const sessionId = sessionIdFromContext(ctx);
	const sinceMs = Math.max(lastPostEditMapBySession.get(sessionId) ?? 0, lastDiagnosticSurfaceBySession.get(sessionId) ?? 0);
	return recentTouchedFilesSince(ctx, repoRoot, max, sinceMs);
}

export function markDiagnosticsSurfacedForContext(ctx: ExtensionContext, now = Date.now()): void {
	compactOldRecords(now);
	lastDiagnosticSurfaceBySession.set(sessionIdFromContext(ctx), now);
}

export function clearTouchedFilesForContext(ctx: ExtensionContext): void {
	const sessionId = sessionIdFromContext(ctx);
	for (let index = touchedFiles.length - 1; index >= 0; index -= 1) {
		if (touchedFiles[index].sessionId === sessionId) touchedFiles.splice(index, 1);
	}
	lastPostEditMapBySession.delete(sessionId);
	lastDiagnosticSurfaceBySession.delete(sessionId);
}
