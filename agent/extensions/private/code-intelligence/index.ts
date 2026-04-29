import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "@mariozechner/pi-ai";
import { withFileMutationQueue, type ExtensionAPI, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { runImpactMap, runReferences, runSymbolContext } from "./src/cymbal.ts";
import { loadConfig } from "./src/config.ts";
import { summarizeCommand } from "./src/exec.ts";
import { runLocalMap } from "./src/local-map.ts";
import { ensureInsideRoot, resolveRepoRoots } from "./src/repo.ts";
import { artifactPolicyState, backendStatuses, requestedUpdateBackend, runIndexUpdate, statePayload } from "./src/state.ts";
import { runSyntaxSearch } from "./src/syntax.ts";
import { runReplaceSymbol, runSymbolSource } from "./src/symbol-source.ts";
import { SQRY_REPO_ARTIFACTS, type ArtifactPolicyState, type BackendName, type BackendStatus, type CodeIntelConfig, type CodeIntelLocalMapParams, type CodeIntelReplaceSymbolParams, type CodeIntelStateParams, type CodeIntelSymbolSourceParams, type CodeIntelSyntaxSearchParams, type CodeIntelUpdateParams, type CymbalImpactMapParams, type CymbalReferencesParams, type CymbalSymbolContextParams } from "./src/types.ts";
import { recordUsageToolCall, recordUsageToolResult } from "./src/usage.ts";
import { normalizePositiveInteger } from "./src/util.ts";

const extensionDir = path.dirname(fileURLToPath(import.meta.url));

const repoRootParam = Type.Optional(Type.String({ description: "Repository or directory to inspect. Defaults to the current working directory." }));
const timeoutParam = Type.Optional(Type.Number({ description: "Command timeout in milliseconds. Defaults to config queryTimeoutMs." }));
const maxResultsParam = Type.Optional(Type.Number({ description: "Maximum results returned. Defaults to config maxResults." }));
const repoArtifactPolicyParam = Type.Union([Type.Literal("never"), Type.Literal("ifIgnored"), Type.Literal("always")], { description: "Repo-local artifact policy for sqry. Default comes from config." });
const relationParam = Type.Union([Type.Literal("refs"), Type.Literal("callers"), Type.Literal("callees"), Type.Literal("impact"), Type.Literal("implementers"), Type.Literal("implementedBy"), Type.Literal("importers")], { description: "Relationship to query. Default refs." });
const strictnessParam = Type.Union([Type.Literal("cst"), Type.Literal("smart"), Type.Literal("ast"), Type.Literal("relaxed"), Type.Literal("signature"), Type.Literal("template")], { description: "ast-grep pattern strictness." });
const detailParam = Type.Optional(Type.Union([Type.Literal("locations"), Type.Literal("snippets")], { description: "Output detail. Use 'locations' when you plan to read/edit returned files; use 'snippets' for small inline context." }));

type StatusStyle = "dim" | "muted" | "accent" | "success" | "warning" | "error";
type RuntimeOperation = {
	timestamp: string;
	operation: "session_start" | "update";
	repoRoot?: string;
	ok: boolean;
	requested?: string;
	backends?: BackendName[];
	message?: string;
	results?: Record<string, unknown>[];
	error?: string;
};

const recentRuntimeOperations: RuntimeOperation[] = [];
const maxRuntimeOperations = 20;
const maxPersistedRuntimeOperations = 200;

function runtimeLogPath(): string {
	return process.env.PI_CODE_INTEL_RUNTIME_LOG ?? path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"), "pi-code-intelligence", "runtime.jsonl");
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.stack ?? error.message : String(error);
}

function readPersistedRuntimeOperations(): RuntimeOperation[] {
	try {
		const lines = fs.readFileSync(runtimeLogPath(), "utf-8").trim().split(/\r?\n/).filter(Boolean).slice(-maxPersistedRuntimeOperations);
		return lines.flatMap((line) => {
			try {
				return [JSON.parse(line) as RuntimeOperation];
			} catch {
				return [];
			}
		});
	} catch {
		return [];
	}
}

function persistRuntimeOperation(operation: RuntimeOperation): void {
	try {
		const logPath = runtimeLogPath();
		fs.mkdirSync(path.dirname(logPath), { recursive: true });
		fs.appendFileSync(logPath, `${JSON.stringify(operation)}\n`);
		const persisted = readPersistedRuntimeOperations();
		if (persisted.length >= maxPersistedRuntimeOperations) fs.writeFileSync(logPath, `${persisted.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
	} catch {
		// Runtime diagnostics should never break code-intelligence tools.
	}
}

function recordRuntimeOperation(operation: Omit<RuntimeOperation, "timestamp">): void {
	const entry = { ...operation, timestamp: new Date().toISOString() };
	recentRuntimeOperations.push(entry);
	if (recentRuntimeOperations.length > maxRuntimeOperations) recentRuntimeOperations.splice(0, recentRuntimeOperations.length - maxRuntimeOperations);
	persistRuntimeOperation(entry);
}

function runtimeDiagnostics(repoRoot: string): Record<string, unknown> {
	const seen = new Set<string>();
	const operations = [...readPersistedRuntimeOperations(), ...recentRuntimeOperations]
		.filter((operation) => !operation.repoRoot || operation.repoRoot === repoRoot)
		.filter((operation) => {
			const key = `${operation.timestamp}\u0000${operation.operation}\u0000${operation.repoRoot ?? ""}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		})
		.slice(-maxRuntimeOperations);
	return {
		logPath: runtimeLogPath(),
		recentOperations: operations,
		lastError: [...operations].reverse().find((operation) => !operation.ok),
	};
}

function statusColor(ctx: ExtensionContext, style: StatusStyle, text: string): string {
	const ui = ctx.ui as unknown as { theme?: { fg?: (style: string, text: string) => string } };
	return ui.theme?.fg ? ui.theme.fg(style, text) : text;
}

function setCodeIntelStatus(ctx: ExtensionContext, text: string, style?: StatusStyle): void {
	const ui = ctx.ui as unknown as { setStatus?: (key: string, value: string | undefined) => void };
	ui.setStatus?.("code-intel", style ? statusColor(ctx, style, text) : text);
}

function renderColor(theme: any, style: StatusStyle | "toolTitle", text: string): string {
	return typeof theme?.fg === "function" ? theme.fg(style, text) : text;
}

function renderBold(theme: any, text: string): string {
	return typeof theme?.bold === "function" ? theme.bold(text) : text;
}

function renderStatus(theme: any, ok: unknown): string {
	if (ok === true) return renderColor(theme, "success", "✓");
	if (ok === false) return renderColor(theme, "error", "×");
	return renderColor(theme, "warning", "?");
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function compactNumber(value: unknown): string | undefined {
	const number = asNumber(value);
	if (number === undefined) return undefined;
	if (Math.abs(number) >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}m`;
	if (Math.abs(number) >= 1_000) return `${(number / 1_000).toFixed(1)}k`;
	return String(number);
}

function compactPath(value: unknown): string {
	const text = asString(value) ?? "(unknown)";
	if (text.length <= 96) return text;
	const parts = text.split("/");
	return parts.length > 3 ? `…/${parts.slice(-3).join("/")}` : `…${text.slice(-92)}`;
}

function compactTopFiles(summary: Record<string, unknown>, limit = 3): string | undefined {
	const topFiles = asArray(summary.topFiles).map(asRecord).slice(0, limit);
	if (topFiles.length === 0) return undefined;
	return topFiles.map((file) => `${compactPath(file.file)}×${String(file.count ?? "?")}`).join(" · ");
}

function firstLine(value: unknown, maxLength = 100): string | undefined {
	const text = asString(value)?.trim().split(/\r?\n/).find(Boolean);
	if (!text) return undefined;
	return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function renderLines(lines: string[]): Text {
	return new Text(lines.join("\n"), 0, 0);
}

function renderToolCall(label: string, summarize: (args: Record<string, unknown>) => string | undefined) {
	return (args: unknown, theme: any) => {
		const summary = summarize(asRecord(args));
		return renderLines([`${renderColor(theme, "toolTitle", renderBold(theme, label))}${summary ? ` ${renderColor(theme, "muted", summary)}` : ""}`]);
	};
}

function appendExpandHint(lines: string[], expanded: boolean, theme: any): void {
	if (!expanded) lines.push(renderColor(theme, "dim", "expand for details"));
}

function renderStateResult(details: Record<string, unknown>, expanded: boolean, theme: any): Text {
	const backends = asRecord(details.backends);
	const sqry = asRecord(backends.sqry);
	const cymbal = asRecord(backends.cymbal);
	const ast = asRecord(backends["ast-grep"]);
	const policy = asRecord(details.sqryArtifactPolicy);
	const sem = `${renderColor(theme, "muted", "sem:")}${renderColor(theme, sqry.indexStatus === "fresh" ? "success" : "warning", String(sqry.indexStatus ?? "?"))}`;
	const nav = `${renderColor(theme, "muted", "nav:")}${renderColor(theme, cymbal.indexStatus === "present" ? "success" : "warning", String(cymbal.indexStatus ?? "?"))}`;
	const astText = `${renderColor(theme, "muted", "ast:")}${renderColor(theme, ast.available === "available" ? "success" : "error", ast.available === "available" ? "ok" : String(ast.available ?? "?"))}`;
	const lines = [`${renderStatus(theme, true)} ${renderBold(theme, "code-intel state")} ${sem} · ${nav} · ${astText}`];
	if (expanded) {
		const sqryDetails = asRecord(sqry.details);
		const cymDetails = asRecord(cymbal.details);
		lines.push(`${renderColor(theme, "muted", "repo")} ${compactPath(details.repoRoot)}`);
		lines.push(`${renderColor(theme, "muted", "sqry")} files ${compactNumber(sqryDetails.fileCount) ?? "?"} · symbols ${compactNumber(sqryDetails.symbolCount) ?? "?"} · artifacts ${policy.allowed === true ? renderColor(theme, "success", "allowed") : renderColor(theme, "warning", "blocked")}`);
		lines.push(`${renderColor(theme, "muted", "cymbal")} files ${compactNumber(cymDetails.fileCount) ?? "?"} · symbols ${compactNumber(cymDetails.symbolCount) ?? "?"}`);
		const diagnostics = asArray(details.diagnostics);
		if (diagnostics.length > 0) lines.push(`${renderColor(theme, "warning", "diagnostics")} ${diagnostics.length}`);
		const runtime = asRecord(details.runtimeDiagnostics);
		if (runtime.logPath) lines.push(`${renderColor(theme, "muted", "runtime log")} ${compactPath(runtime.logPath)}`);
	} else appendExpandHint(lines, expanded, theme);
	return renderLines(lines);
}

function renderUpdateResult(details: Record<string, unknown>, expanded: boolean, theme: any): Text {
	const results = asArray(details.results).map(asRecord);
	const parts = results.map((result) => `${backendRoleLabel(asString(result.backend) as BackendName)}:${result.ok === true ? renderColor(theme, "success", "ok") : renderColor(theme, "error", "fail")}`);
	const lines = [`${renderStatus(theme, details.ok)} ${renderBold(theme, "code-intel update")} ${parts.join(" · ") || asString(details.backend) || "auto"}`];
	if (expanded) {
		for (const result of results.slice(0, 8)) {
			const command = asRecord(result.command);
			const stderr = firstLine(command.stderr);
			lines.push(`${renderColor(theme, "muted", backendRoleLabel(asString(result.backend) as BackendName))} ${result.ok === true ? renderColor(theme, "success", "ok") : renderColor(theme, "error", "fail")} exit=${String(command.exitCode ?? "-")}${stderr ? ` · ${renderColor(theme, "dim", stderr)}` : ""}`);
		}
		if (results.length > 8) lines.push(renderColor(theme, "dim", `… ${results.length - 8} more backend result(s)`));
	} else appendExpandHint(lines, expanded, theme);
	return renderLines(lines);
}

function renderSymbolContextResult(details: Record<string, unknown>, expanded: boolean, theme: any): Text {
	const resolved = asRecord(details.resolved);
	const callers = asArray(details.callers).map(asRecord);
	const location = resolved.file ? `${compactPath(resolved.file)}${resolved.startLine ? `:${resolved.startLine}` : ""}` : "unresolved";
	const symbol = asString(details.symbol) ?? "";
	const lines = [`${renderStatus(theme, details.ok)} ${renderBold(theme, "symbol context")} ${renderColor(theme, "muted", symbol)} · ${location} · callsites ${callers.length}`];
	if (expanded) {
		for (const caller of callers.slice(0, 8)) {
			const name = asString(caller.name);
			const nameSuffix = name && name !== symbol ? ` ${name}` : "";
			lines.push(`${renderColor(theme, "muted", "callsite")} ${compactPath(caller.file)}${caller.line ? `:${caller.line}` : ""}${nameSuffix}`.trim());
		}
		if (callers.length > 8) lines.push(renderColor(theme, "dim", `… ${callers.length - 8} more callsite(s)`));
	} else appendExpandHint(lines, expanded, theme);
	return renderLines(lines);
}

function renderReferencesResult(details: Record<string, unknown>, expanded: boolean, theme: any): Text {
	const rows = asArray(details.results).map(asRecord);
	const summary = asRecord(details.summary);
	const returned = asNumber(details.returned) ?? rows.length;
	const matchCount = asNumber(details.matchCount) ?? returned;
	const fileCount = asNumber(summary.fileCount);
	const truncated = details.truncated === true ? renderColor(theme, "warning", " truncated") : "";
	const summaryBasis = asString(summary.basis);
	const fallback = asRecord(details.fallback);
	const fallbackText = summaryBasis === "textFallbackRows" ? ` ${renderColor(theme, "warning", "text fallback")}` : "";
	const fallbackReason = firstLine(fallback.reason, 140);
	const lines = [`${renderStatus(theme, details.ok)} ${renderBold(theme, "references")} ${renderColor(theme, "muted", asString(details.relation) ?? "refs")} ${renderColor(theme, "dim", asString(details.query) ?? "")} · ${returned}/${matchCount}${fileCount !== undefined ? ` · ${fileCount} file(s)` : ""}${truncated}${fallbackText}`];
	if (fallbackReason && (expanded || summaryBasis === "textFallbackRows")) lines.push(`${renderColor(theme, "warning", "fallback")} ${fallbackReason}`);
	if (expanded) {
		const topFiles = compactTopFiles(summary);
		if (topFiles) lines.push(`${renderColor(theme, "muted", "top files")} ${topFiles}`);
		for (const row of rows.slice(0, 10)) lines.push(`${compactPath(row.file)}${row.line ? `:${row.line}` : ""} ${asString(row.name) ?? ""}`.trim());
		if (rows.length > 10) lines.push(renderColor(theme, "dim", `… ${rows.length - 10} more row(s)`));
	} else appendExpandHint(lines, expanded, theme);
	return renderLines(lines);
}

function renderImpactResult(details: Record<string, unknown>, expanded: boolean, theme: any): Text {
	const roots = asArray(details.rootSymbols);
	const related = asArray(details.related).map(asRecord);
	const coverage = asRecord(details.coverage);
	const summary = asRecord(details.summary);
	const relatedFileCount = asNumber(summary.relatedFileCount);
	const truncated = coverage.truncated === true ? renderColor(theme, "warning", " truncated") : "";
	const lines = [`${renderStatus(theme, details.ok)} ${renderBold(theme, "impact map")} roots ${roots.length} · related ${related.length}${relatedFileCount !== undefined ? ` · ${relatedFileCount} file(s)` : ""}${truncated}`];
	if (expanded) {
		if (roots.length > 0) lines.push(`${renderColor(theme, "muted", "roots")} ${roots.slice(0, 8).join(", ")}${roots.length > 8 ? ", …" : ""}`);
		const topFiles = compactTopFiles({ topFiles: summary.topRelatedFiles });
		if (topFiles) lines.push(`${renderColor(theme, "muted", "top files")} ${topFiles}`);
		for (const row of related.slice(0, 10)) lines.push(`${compactPath(row.file)}${row.line ? `:${row.line}` : ""} ${asString(row.reason) ?? asString(row.name) ?? ""}`.trim());
		if (related.length > 10) lines.push(renderColor(theme, "dim", `… ${related.length - 10} more related row(s)`));
	} else appendExpandHint(lines, expanded, theme);
	return renderLines(lines);
}

function renderSyntaxResult(details: Record<string, unknown>, expanded: boolean, theme: any): Text {
	const matches = asArray(details.matches).map(asRecord);
	const summary = asRecord(details.summary);
	const returned = asNumber(details.returned) ?? matches.length;
	const matchCount = asNumber(details.matchCount) ?? returned;
	const fileCount = asNumber(summary.fileCount);
	const truncated = details.truncated === true ? renderColor(theme, "warning", " truncated") : "";
	const lines = [`${renderStatus(theme, details.ok)} ${renderBold(theme, "syntax search")} ${returned}/${matchCount}${fileCount !== undefined ? ` · ${fileCount} file(s)` : ""}${truncated} ${renderColor(theme, "muted", asString(details.language) ?? "")}`.trim()];
	if (expanded) {
		const topFiles = compactTopFiles(summary);
		if (topFiles) lines.push(`${renderColor(theme, "muted", "top files")} ${topFiles}`);
		for (const match of matches.slice(0, 10)) lines.push(`${compactPath(match.file)}${match.line ? `:${match.line}` : ""} ${firstLine(match.snippet ?? match.text, 90) ?? ""}`.trim());
		if (matches.length > 10) lines.push(renderColor(theme, "dim", `… ${matches.length - 10} more match(es)`));
	} else appendExpandHint(lines, expanded, theme);
	return renderLines(lines);
}

function renderSymbolSourceResult(details: Record<string, unknown>, expanded: boolean, theme: any): Text {
	const resolved = asRecord(details.resolved);
	const range = asRecord(details.range);
	const location = details.file ? `${compactPath(details.file)}${range.startLine ? `:${range.startLine}-${range.endLine}` : ""}` : "unresolved";
	const sourceBytes = asNumber(details.sourceBytes);
	const truncated = details.sourceTruncated === true ? renderColor(theme, "warning", " truncated") : "";
	const lines = [`${renderStatus(theme, details.ok)} ${renderBold(theme, "symbol source")} ${renderColor(theme, "muted", asString(details.symbol) ?? "")} · ${location}${sourceBytes !== undefined ? ` · ${compactNumber(sourceBytes)}B` : ""}${truncated}`];
	if (expanded) {
		if (resolved.kind) lines.push(`${renderColor(theme, "muted", "kind")} ${String(resolved.kind)}${resolved.language ? ` · ${String(resolved.language)}` : ""}`);
		if (details.reason) lines.push(`${renderColor(theme, "warning", "reason")} ${firstLine(details.reason, 120)}`);
		const matches = asArray(details.matches).map(asRecord);
		for (const match of matches.slice(0, 8)) lines.push(`${renderColor(theme, "muted", "match")} ${compactPath(match.file)}${match.startLine ? `:${match.startLine}` : ""} ${asString(match.kind) ?? ""}`.trim());
	} else appendExpandHint(lines, expanded, theme);
	return renderLines(lines);
}

function renderReplaceSymbolResult(details: Record<string, unknown>, expanded: boolean, theme: any): Text {
	const before = asRecord(details.rangeBefore);
	const after = asRecord(details.rangeAfter);
	const location = details.file ? `${compactPath(details.file)}${before.startLine ? `:${before.startLine}-${before.endLine}` : ""}` : "unknown";
	const afterText = after.startLine ? ` → ${after.startLine}-${after.endLine}` : "";
	const reverted = details.reverted === true ? renderColor(theme, "warning", " reverted") : "";
	const lines = [`${renderStatus(theme, details.ok)} ${renderBold(theme, "replace symbol")} ${renderColor(theme, "muted", asString(details.symbol) ?? "")} · ${location}${afterText}${reverted}`];
	if (expanded) {
		if (details.reason) lines.push(`${renderColor(theme, "warning", "reason")} ${firstLine(details.reason, 160)}`);
		const beforeLines = asNumber(details.lineCountBefore);
		const afterLines = asNumber(details.lineCountAfter);
		if (beforeLines !== undefined || afterLines !== undefined) lines.push(`${renderColor(theme, "muted", "lines")} ${String(beforeLines ?? "?")} → ${String(afterLines ?? "?")}`);
		const validation = asRecord(details.validation);
		if (Object.keys(validation).length > 0) lines.push(`${renderColor(theme, "muted", "validation")} ${validation.resolvedAfterReplacement === true ? "resolved" : "unresolved"} · ${validation.exactReplacementSpan === true ? "exact-span" : "span-check"}`);
	} else appendExpandHint(lines, expanded, theme);
	return renderLines(lines);
}

function renderLocalMapResult(details: Record<string, unknown>, expanded: boolean, theme: any): Text {
	const summary = asRecord(details.summary);
	const coverage = asRecord(details.coverage);
	const suggestedFiles = asArray(summary.suggestedFiles).map(asRecord);
	const sections = asRecord(details.sections);
	const contextCount = asArray(sections.symbolContexts).length;
	const refsCount = asArray(sections.references).length;
	const syntaxCount = asArray(sections.syntaxMatches).length;
	const literalCount = asArray(sections.literalMatches).length;
	const truncated = coverage.truncated === true ? renderColor(theme, "warning", " truncated") : "";
	const lines = [`${renderStatus(theme, details.ok)} ${renderBold(theme, "local map")} names ${asArray(details.names).length} · files ${suggestedFiles.length} · ctx/ref/syn/lit ${contextCount}/${refsCount}/${syntaxCount}/${literalCount}${truncated}`];
	if (expanded) {
		for (const file of suggestedFiles.slice(0, 10)) {
			const reasons = asArray(file.reasons).map((reason) => String(reason)).slice(0, 2).join(", ");
			lines.push(`${compactPath(file.file)}×${String(file.count ?? "?")}${reasons ? ` ${renderColor(theme, "dim", reasons)}` : ""}`);
		}
		if (suggestedFiles.length > 10) lines.push(renderColor(theme, "dim", `… ${suggestedFiles.length - 10} more suggested file(s)`));
	} else appendExpandHint(lines, expanded, theme);
	return renderLines(lines);
}

function renderGenericCodeIntelResult(kind: "state" | "update" | "symbol" | "source" | "replace" | "references" | "impact" | "syntax" | "local") {
	return (result: unknown, options: { expanded?: boolean; isPartial?: boolean } | undefined, theme: any) => {
		if (options?.isPartial) return renderLines([renderColor(theme, "accent", "code-intel working…")]);
		const details = asRecord(asRecord(result).details);
		if (kind === "state") return renderStateResult(details, options?.expanded === true, theme);
		if (kind === "update") return renderUpdateResult(details, options?.expanded === true, theme);
		if (kind === "symbol") return renderSymbolContextResult(details, options?.expanded === true, theme);
		if (kind === "source") return renderSymbolSourceResult(details, options?.expanded === true, theme);
		if (kind === "replace") return renderReplaceSymbolResult(details, options?.expanded === true, theme);
		if (kind === "references") return renderReferencesResult(details, options?.expanded === true, theme);
		if (kind === "impact") return renderImpactResult(details, options?.expanded === true, theme);
		if (kind === "local") return renderLocalMapResult(details, options?.expanded === true, theme);
		return renderSyntaxResult(details, options?.expanded === true, theme);
	};
}

function backendStatusText(backend: BackendName, status: BackendStatus, sqryArtifacts?: ArtifactPolicyState): { text: string; style: StatusStyle } {
	if (status.available === "missing") return { text: "missing", style: "error" };
	if (status.available === "error" || status.indexStatus === "error") return { text: "err", style: "error" };
	if (backend === "ast-grep") return { text: "ok", style: "success" };
	if (backend === "sqry" && !sqryArtifacts?.allowed && (status.indexStatus === "missing" || status.indexStatus === "unknown")) return { text: "blocked", style: "warning" };
	if (status.indexStatus === "fresh" || status.indexStatus === "present") return { text: "ok", style: "success" };
	if (status.indexStatus === "stale") return { text: "stale", style: "warning" };
	if (status.indexStatus === "missing") return { text: "noidx", style: "dim" };
	return { text: "?", style: "warning" };
}

function statusBackendOrder(config: CodeIntelConfig): BackendName[] {
	const order: BackendName[] = [];
	for (const backend of config.backendOrder) {
		if (!order.includes(backend)) order.push(backend);
	}
	if (!order.includes("ast-grep")) order.push("ast-grep");
	return order;
}

function backendRoleLabel(backend: BackendName): string {
	if (backend === "sqry") return "sem";
	if (backend === "cymbal") return "nav";
	return "ast";
}

function statusSummary(ctx: ExtensionContext, statuses: Record<BackendName, BackendStatus>, config: CodeIntelConfig, sqryArtifacts?: ArtifactPolicyState): string {
	const separator = statusColor(ctx, "dim", " · ");
	const colon = statusColor(ctx, "dim", ":");
	const parts = statusBackendOrder(config).map((backend) => {
		const state = backendStatusText(backend, statuses[backend], sqryArtifacts);
		return `${statusColor(ctx, "muted", backendRoleLabel(backend))}${colon}${statusColor(ctx, state.style, state.text)}`;
	});
	return `${statusColor(ctx, "muted", "ci")} ${parts.join(separator)}`;
}

function setStatusSummary(ctx: ExtensionContext, statuses: Record<BackendName, BackendStatus>, config: CodeIntelConfig, sqryArtifacts?: ArtifactPolicyState): void {
	setCodeIntelStatus(ctx, statusSummary(ctx, statuses, config, sqryArtifacts));
}

function indexedBackendsForUpdate(requested: ReturnType<typeof requestedUpdateBackend>, config: CodeIntelConfig): BackendName[] {
	if (requested && requested !== "auto") return requested === "ast-grep" ? [] : [requested];
	return config.backendOrder.filter((backend) => backend !== "ast-grep");
}

function shouldAutoIndex(backend: BackendName, status: BackendStatus, sqryArtifacts: ArtifactPolicyState): boolean {
	if (backend === "ast-grep" || status.available !== "available") return false;
	if (backend === "sqry" && !sqryArtifacts.allowed) return false;
	return status.indexStatus === "missing" || status.indexStatus === "stale" || status.indexStatus === "unknown";
}

async function runIndexBackends(ctx: ExtensionContext, repoRoot: string, backends: BackendName[], config: CodeIntelConfig, sqryArtifacts: ArtifactPolicyState, force: boolean, timeoutMs: number, signal?: AbortSignal): Promise<{ ok: boolean; results: Record<string, unknown>[]; statuses: Record<BackendName, BackendStatus> }> {
	const results: Record<string, unknown>[] = [];
	let ok = true;
	for (const backend of backends) {
		if (backend === "ast-grep") {
			results.push({ backend, ok: true, message: "ast-grep does not require an index." });
			continue;
		}
		if (backend === "sqry" && !sqryArtifacts.allowed) {
			ok = false;
			results.push({ backend, ok: false, skipped: true, reason: sqryArtifacts.reason, wouldCreateOrUpdate: SQRY_REPO_ARTIFACTS });
			continue;
		}
		setCodeIntelStatus(ctx, `ci:idx ${backendRoleLabel(backend)}…`, "accent");
		const result = await runIndexUpdate(backend, repoRoot, force, timeoutMs, config, signal);
		const backendOk = result ? result.exitCode === 0 && !result.timedOut && !result.outputTruncated && !result.error : true;
		if (!backendOk) ok = false;
		results.push({ backend, ok: backendOk, command: result ? summarizeCommand(result) : undefined });
	}
	const statuses = await backendStatuses(repoRoot, config);
	return { ok, results, statuses };
}

async function refreshFooterStatus(ctx: ExtensionContext): Promise<void> {
	setCodeIntelStatus(ctx, "ci:checking", "dim");
	try {
		const loadedConfig = loadConfig(ctx);
		const roots = await resolveRepoRoots(ctx);
		let statuses = await backendStatuses(roots.repoRoot, loadedConfig.config);
		const sqryArtifacts = await artifactPolicyState(roots.repoRoot, loadedConfig.config.allowRepoArtifacts);
		setStatusSummary(ctx, statuses, loadedConfig.config, sqryArtifacts);
		if (loadedConfig.config.autoIndexOnSessionStart) {
			const backends = loadedConfig.config.autoIndexBackends.filter((backend) => shouldAutoIndex(backend, statuses[backend], sqryArtifacts));
			if (backends.length > 0) {
				const indexed = await runIndexBackends(ctx, roots.repoRoot, backends, loadedConfig.config, sqryArtifacts, false, loadedConfig.config.indexTimeoutMs);
				recordRuntimeOperation({ operation: "session_start", repoRoot: roots.repoRoot, ok: indexed.ok, backends, results: indexed.results });
				statuses = indexed.statuses;
				if (indexed.ok) setStatusSummary(ctx, statuses, loadedConfig.config, sqryArtifacts);
				else setCodeIntelStatus(ctx, "ci:autoidx fail", "error");
			}
		}
	} catch (error) {
		recordRuntimeOperation({ operation: "session_start", ok: false, error: errorMessage(error) });
		setCodeIntelStatus(ctx, "ci:error", "error");
	}
}

function registerStateTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "code_intel_state",
		label: "Code Intelligence State",
		description: "Inspect local code-intelligence backend availability, config, artifact policy, and index status.",
		promptSnippet: "Inspect code-intel role status before relying on indexes: sem/sqry, nav/Cymbal, ast/ast-grep.",
		promptGuidelines: [
			"Treat code_intel output as advisory routing evidence for deciding what to read next, not proof of complete impact or exact references.",
			"Normal use should start from code_intel_impact_map for diffs/changed symbols or code_intel_local_map for a scoped subsystem; use lower-level tools only to explain or refine that map.",
			"Do not use Cymbal/sqry-backed rows as authoritative semantic truth; verify important candidates by reading current source and running project-native validation.",
			"Call code_intel_state before relying on availability, freshness, sqry artifact policy, or footer error state.",
			"For normal freshness checks, omit includeDiagnostics; use includeDiagnostics:true only to debug footer errors, stale output, or failed auto-index/update commands.",
		],
		renderCall: renderToolCall("code_intel_state", (args) => args.includeDiagnostics === true ? "diagnostics" : undefined),
		renderResult: renderGenericCodeIntelResult("state"),
		parameters: Type.Object({
			repoRoot: repoRootParam,
			includeDiagnostics: Type.Optional(Type.Boolean({ description: "Include command/config diagnostics and recent runtime errors. Default false; use for debugging failures, not routine freshness checks." })),
		}),
		async execute(_toolCallId: string, params: CodeIntelStateParams, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			const loadedConfig = loadConfig(ctx);
			const roots = await resolveRepoRoots(ctx, params.repoRoot);
			const statuses = await backendStatuses(roots.repoRoot, loadedConfig.config);
			const sqryArtifacts = await artifactPolicyState(roots.repoRoot, loadedConfig.config.allowRepoArtifacts);
			setStatusSummary(ctx, statuses, loadedConfig.config, sqryArtifacts);
			const payload = statePayload(roots, loadedConfig, statuses, sqryArtifacts, params.includeDiagnostics === true) as Record<string, unknown>;
			if (params.includeDiagnostics === true) payload.runtimeDiagnostics = runtimeDiagnostics(roots.repoRoot);
			return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], details: payload };
		},
	});
}

function registerSymbolContextTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "code_intel_symbol_context",
		label: "Code Intelligence Symbol Context",
		description: "Low-level Cymbal context for one symbol: definition, source, caller candidates, imports, and alternate matches.",
		promptSnippet: "Use sparingly to explain one symbol from an impact/local map; not a general reference engine.",
		promptGuidelines: [
			"Prefer code_intel_impact_map or code_intel_local_map for review/edit routing; use code_intel_symbol_context only when one returned symbol needs a quick source/callsite sketch.",
			"Treat caller rows as candidate callsites; backend row names and line metadata can be imprecise, so read current source before relying on them.",
			"If results look stale or fail, inspect code_intel_state or refresh nav with code_intel_update.",
			"Do not turn this output directly into a finding or compatibility claim.",
		],
		renderCall: renderToolCall("code_intel_symbol_context", (args) => asString(args.symbol)),
		renderResult: renderGenericCodeIntelResult("symbol"),
		parameters: Type.Object({
			repoRoot: repoRootParam,
			symbol: Type.String({ description: "Symbol name to inspect." }),
			maxCallers: Type.Optional(Type.Number({ description: "Maximum callers to include. Defaults to config maxResults." })),
			timeoutMs: timeoutParam,
		}),
		async execute(_toolCallId: string, params: CymbalSymbolContextParams, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			const loadedConfig = loadConfig(ctx);
			const roots = await resolveRepoRoots(ctx, params.repoRoot);
			const payload = await runSymbolContext(params, roots.repoRoot, loadedConfig.config, signal);
			return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], details: payload };
		},
	});
}

function registerSymbolSourceTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "code_intel_symbol_source",
		label: "Code Intelligence Symbol Source",
		description: "Low-level focused source span for one resolved symbol with file/range/hash preconditions.",
		promptSnippet: "Use only for focused source inspection after the surrounding impact/context is already understood.",
		promptGuidelines: [
			"Do not use code_intel_symbol_source as a general navigation substitute; prefer reading files from an impact/local map when behavior, imports, or callers matter.",
			"Use code_intel_symbol_source before code_intel_replace_symbol; pass file or paths when the symbol is ambiguous.",
			"Do not treat code_intel_symbol_source as enough context when imports, adjacent declarations, callers, or public contracts matter; read those files normally.",
		],
		renderCall: renderToolCall("code_intel_symbol_source", (args) => `${asString(args.symbol) ?? ""}${args.file ? ` · ${compactPath(args.file)}` : ""}`.trim()),
		renderResult: renderGenericCodeIntelResult("source"),
		parameters: Type.Object({
			repoRoot: repoRootParam,
			symbol: Type.String({ description: "Symbol name to resolve." }),
			file: Type.Optional(Type.String({ description: "Repo-relative file to disambiguate the symbol." })),
			paths: Type.Optional(Type.Array(Type.String(), { description: "Repo-relative path filters to disambiguate the symbol." })),
			maxSourceBytes: Type.Optional(Type.Number({ description: "Maximum symbol source bytes to return. Default 200000, max 2000000." })),
			timeoutMs: timeoutParam,
		}),
		async execute(_toolCallId: string, params: CodeIntelSymbolSourceParams, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			const loadedConfig = loadConfig(ctx);
			const roots = await resolveRepoRoots(ctx, params.repoRoot);
			const payload = await runSymbolSource(params, roots.repoRoot, loadedConfig.config, signal);
			return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], details: payload };
		},
	});
}

function registerReplaceSymbolTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "code_intel_replace_symbol",
		label: "Code Intelligence Replace Symbol",
		description: "Experimentally and guardedly replace exactly one resolved symbol span using code_intel_symbol_source preconditions. Use only for narrow symbol-local changes; not for signatures, imports, multi-symbol refactors, caller updates, generated files, or unknown surrounding invariants.",
		promptSnippet: "Guardedly replace one already-understood symbol span; prefer normal read/edit when surrounding context or imports may matter.",
		promptGuidelines: [
			"Use code_intel_replace_symbol only after code_intel_symbol_source has returned file, expectedRange, and expectedHash for the same symbol.",
			"Use code_intel_replace_symbol only for narrow symbol-local body/source changes where surrounding file context is already understood or irrelevant.",
			"Do not use code_intel_replace_symbol for signature changes, import changes, multi-symbol refactors, caller/test updates, generated files, or public contract changes whose callers were not inspected.",
			"If code_intel_replace_symbol fails or you need surrounding context, read the file and use normal edit instead; treat success as an edit, not validation.",
		],
		renderCall: renderToolCall("code_intel_replace_symbol", (args) => `${asString(args.symbol) ?? ""}${args.file ? ` · ${compactPath(args.file)}` : ""}`.trim()),
		renderResult: renderGenericCodeIntelResult("replace"),
		parameters: Type.Object({
			repoRoot: repoRootParam,
			symbol: Type.String({ description: "Symbol name from code_intel_symbol_source." }),
			file: Type.String({ description: "Repo-relative file from code_intel_symbol_source preconditions." }),
			expectedRange: Type.Object({
				startLine: Type.Number({ description: "Start line from code_intel_symbol_source preconditions." }),
				endLine: Type.Number({ description: "End line from code_intel_symbol_source preconditions." }),
			}),
			expectedHash: Type.String({ description: "sha256 source hash from code_intel_symbol_source preconditions." }),
			newSource: Type.String({ description: "Complete replacement source for exactly this symbol span." }),
			timeoutMs: timeoutParam,
		}),
		async execute(_toolCallId: string, params: CodeIntelReplaceSymbolParams, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			const loadedConfig = loadConfig(ctx);
			const roots = await resolveRepoRoots(ctx, params.repoRoot);
			const file = ensureInsideRoot(roots.repoRoot, params.file);
			const absoluteFile = path.resolve(roots.repoRoot, file);
			return withFileMutationQueue(absoluteFile, async () => {
				const payload = await runReplaceSymbol({ ...params, file }, roots.repoRoot, loadedConfig.config, signal);
				return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], details: payload };
			});
		},
	});
}

function registerReferencesTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "code_intel_references",
		label: "Code Intelligence References",
		description: "Low-level relationship candidate query for one known symbol/type/file/package; normally prefer impact_map or local_map first.",
		promptSnippet: "Use sparingly to refine an impact/local map; results are candidate relationships, not exact refs.",
		promptGuidelines: [
			"Do not use code_intel_references as a general exact-reference tool; prefer code_intel_impact_map for review/edit routing and code_intel_local_map for scoped subsystem mapping.",
			"Use this only when a specific relationship query will refine the candidate file map; keep maxResults bounded and add path filters.",
			"When refs returns rows marked kind:'text_fallback', treat them as Cymbal text-search candidate locations rather than symbol-proven references.",
			"Use detail:'locations' when returned files are read targets; use detail:'snippets' only for small inline triage.",
			"Treat missing or empty results as non-authoritative; verify important candidates in source.",
		],
		renderCall: renderToolCall("code_intel_references", (args) => `${asString(args.relation) ?? "refs"} ${asString(args.query) ?? ""}`.trim()),
		renderResult: renderGenericCodeIntelResult("references"),
		parameters: Type.Object({
			repoRoot: repoRootParam,
			query: Type.String({ description: "Symbol, type, file, or package query depending on relation." }),
			relation: Type.Optional(relationParam),
			maxResults: maxResultsParam,
			depth: Type.Optional(Type.Number({ description: "Traversal depth for callees, impact, or importers." })),
			paths: Type.Optional(Type.Array(Type.String(), { description: "Repo-relative path filters for refs/callers where supported." })),
			excludeGlobs: Type.Optional(Type.Array(Type.String(), { description: "Repo-relative path excludes for refs/callers where supported." })),
			timeoutMs: timeoutParam,
			detail: detailParam,
		}),
		async execute(_toolCallId: string, params: CymbalReferencesParams, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			const loadedConfig = loadConfig(ctx);
			const roots = await resolveRepoRoots(ctx, params.repoRoot);
			const payload = await runReferences(params, roots.repoRoot, loadedConfig.config, signal);
			return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], details: payload };
		},
	});
}

function registerLocalMapTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "code_intel_local_map",
		label: "Code Intelligence Local Map",
		description: "Build a scoped local read-next map from anchor names, related symbol/field names, optional path scope, and syntax/text candidates.",
		promptSnippet: "Map a local subsystem into candidate files to read next; not an exact reference report.",
		promptGuidelines: [
			"Use code_intel_local_map when a scoped edit/review has a central anchor plus related fields/types/API terms and you need a candidate file list.",
			"Use it to answer: which local files should I read next, and why are they candidates? Do not treat it as exhaustive usage proof.",
			"Provide anchors for central functions/types and names for related fields/types/API terms; add paths to keep the map local.",
			"Use detail:'locations' for routing to files; use standalone rg afterward for comments/docs/generated text beyond the returned cap or stale/empty backend results.",
		],
		renderCall: renderToolCall("code_intel_local_map", (args) => {
			const anchors = asArray(args.anchors).length;
			const names = asArray(args.names).length;
			const paths = asArray(args.paths).length;
			return [`${anchors} anchor(s)`, `${names} name(s)`, paths ? `${paths} path(s)` : undefined].filter(Boolean).join(" · ");
		}),
		renderResult: renderGenericCodeIntelResult("local"),
		parameters: Type.Object({
			repoRoot: repoRootParam,
			anchors: Type.Optional(Type.Array(Type.String(), { description: "Central function/type names that anchor the implementation area, e.g. lowerAggregation." })),
			names: Type.Optional(Type.Array(Type.String(), { description: "Related symbol, field, type, or API names to map, e.g. RequiredTagLabels." })),
			paths: Type.Optional(Type.Array(Type.String(), { description: "Repo-relative files or directories to keep the map local." })),
			language: Type.Optional(Type.String({ description: "Language for optional selector syntax matches, e.g. go, ts, python." })),
			includeSyntax: Type.Optional(Type.Boolean({ description: "Run optional selector syntax matches like $X.Name when language is provided. Default true." })),
			maxResults: Type.Optional(Type.Number({ description: "Maximum suggested files returned. Default min(config maxResults, 25)." })),
			maxPerName: Type.Optional(Type.Number({ description: "Maximum refs/syntax matches per name. Default min(config maxResults, 8)." })),
			timeoutMs: timeoutParam,
			detail: detailParam,
		}),
		async execute(_toolCallId: string, params: CodeIntelLocalMapParams, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			const loadedConfig = loadConfig(ctx);
			const roots = await resolveRepoRoots(ctx, params.repoRoot);
			const payload = await runLocalMap(params, roots.repoRoot, loadedConfig.config, signal);
			return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], details: payload };
		},
	});
}

function registerImpactMapTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "code_intel_impact_map",
		label: "Code Intelligence Impact Map",
		description: "Build the primary read-next impact map from edited files, queried symbols, or a git base ref.",
		promptSnippet: "Primary code-intel entry point: list candidate caller/consumer/test files to read before edits or reviews.",
		promptGuidelines: [
			"Use code_intel_impact_map as the default code-intel tool after seeing a diff or before editing exported functions/types, handlers, config/schema/protocol behavior, shared helpers, or multiple files.",
			"Use it to answer: which unchanged caller, consumer, or test files should I read before changing or reviewing this code, and what evidence made them candidates?",
			"Start with symbols, changedFiles, or baseRef; inspect rootSymbols, related rows, coverage, truncation, and backend limitations.",
			"Use detail:'locations' for routing to files; use detail:'snippets' only when inline context helps avoid extra reads.",
			"Impact maps are a candidate read list, not exhaustive proof of all callers or safe compatibility.",
			"When delegating review, run this in the parent and pass the candidate files/reasons to subagents unless the subagent is explicitly configured with code-intel tools.",
		],
		renderCall: renderToolCall("code_intel_impact_map", (args) => {
			const parts = [];
			if (asArray(args.symbols).length > 0) parts.push(`${asArray(args.symbols).length} symbol(s)`);
			if (asArray(args.changedFiles).length > 0) parts.push(`${asArray(args.changedFiles).length} file(s)`);
			if (asString(args.baseRef)) parts.push(`base ${asString(args.baseRef)}`);
			return parts.join(" · ") || undefined;
		}),
		renderResult: renderGenericCodeIntelResult("impact"),
		parameters: Type.Object({
			repoRoot: repoRootParam,
			symbols: Type.Optional(Type.Array(Type.String(), { description: "Symbols to treat as impact roots." })),
			changedFiles: Type.Optional(Type.Array(Type.String(), { description: "Repo-relative files whose defined symbols should be impact roots." })),
			baseRef: Type.Optional(Type.String({ description: "Optional git base ref for discovering changed files with git diff --name-only." })),
			maxDepth: Type.Optional(Type.Number({ description: "Maximum caller depth. Defaults to 2." })),
			maxResults: Type.Optional(Type.Number({ description: "Maximum related rows returned. Defaults to min(config maxResults, 25)." })),
			maxRootSymbols: Type.Optional(Type.Number({ description: "Maximum root symbols to query after expanding changed files. Default 20." })),
			timeoutMs: timeoutParam,
			detail: detailParam,
		}),
		async execute(_toolCallId: string, params: CymbalImpactMapParams, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			const loadedConfig = loadConfig(ctx);
			const roots = await resolveRepoRoots(ctx, params.repoRoot);
			const payload = await runImpactMap(params, roots.repoRoot, loadedConfig.config, signal);
			return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], details: payload };
		},
	});
}

function registerSyntaxSearchTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "code_intel_syntax_search",
		label: "Code Intelligence Syntax Search",
		description: "Run a read-only ast-grep syntax-pattern search for explicit scoped shapes, with normalized candidate locations.",
		promptSnippet: "Use for narrow current-source syntax shapes that impact/local maps cannot express; no rewrites.",
		promptGuidelines: [
			"Provide a concrete pattern and language; scope paths/globs to avoid broad noisy scans.",
			"Use selector when the searchable node is inside a wrapper pattern, such as Go selector_expression inside a dummy function.",
			"Use detail:'locations' when matches are read/edit targets; default snippets are for judging match relevance.",
			"Use this for candidate matching, API-shape checks, or pattern-specific review, not general linting or exact semantic references.",
			"Matches are not defects by themselves; inspect source and validate behavior before reporting.",
		],
		renderCall: renderToolCall("code_intel_syntax_search", (args) => `${asString(args.language) ?? ""} ${asString(args.pattern) ? "pattern" : ""}`.trim()),
		renderResult: renderGenericCodeIntelResult("syntax"),
		parameters: Type.Object({
			repoRoot: repoRootParam,
			pattern: Type.String({ description: "Explicit ast-grep pattern, e.g. 'foo($A)' or 'if ($COND) { $BODY }'. Required and read-only." }),
			language: Type.Optional(Type.String({ description: "ast-grep language, e.g. ts, javascript, go, python, rust. If omitted, ast-grep infers from searched files when possible." })),
			paths: Type.Optional(Type.Array(Type.String(), { description: "Repo-relative files or directories to search. Defaults to '.'. Paths outside the repo are rejected." })),
			includeGlobs: Type.Optional(Type.Array(Type.String(), { description: "Additional ast-grep --globs include patterns." })),
			excludeGlobs: Type.Optional(Type.Array(Type.String(), { description: "Additional ast-grep --globs exclude patterns. Leading '!' is optional." })),
			selector: Type.Optional(Type.String({ description: "Optional ast-grep --selector node kind to extract a sub-node from a wrapper pattern, e.g. selector_expression for Go field selections." })),
			maxResults: maxResultsParam,
			timeoutMs: timeoutParam,
			strictness: Type.Optional(strictnessParam),
			detail: detailParam,
		}),
		async execute(_toolCallId: string, params: CodeIntelSyntaxSearchParams, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			const loadedConfig = loadConfig(ctx);
			const roots = await resolveRepoRoots(ctx, params.repoRoot);
			const payload = await runSyntaxSearch(params, roots.repoRoot, loadedConfig.config, signal);
			return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], details: payload };
		},
	});
}

function registerUpdateTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "code_intel_update",
		label: "Code Intelligence Update",
		description: "Explicitly build or refresh local code-intelligence backend indexes with artifact-policy checks.",
		promptSnippet: "Refresh role indexes when needed: auto updates sem/sqry and nav/Cymbal; ast/ast-grep needs no index.",
		promptGuidelines: [
			"Usually unnecessary during normal work because session start auto-indexes missing or stale role backends.",
			"sqry writes repo-local artifacts; keep allowRepoArtifacts governed by policy unless the user approves otherwise.",
			"Use returned per-backend command summaries, or state with includeDiagnostics:true, to inspect failures.",
		],
		renderCall: renderToolCall("code_intel_update", (args) => asString(args.backend) ?? "auto"),
		renderResult: renderGenericCodeIntelResult("update"),
		parameters: Type.Object({
			backend: Type.Optional(Type.Union([Type.Literal("auto"), Type.Literal("cymbal"), Type.Literal("ast-grep"), Type.Literal("sqry")], { description: "Backend to update. Default auto updates all configured indexed role backends from backendOrder." })),
			repoRoot: repoRootParam,
			allowRepoArtifacts: Type.Optional(repoArtifactPolicyParam),
			force: Type.Optional(Type.Boolean({ description: "Force rebuild when the backend supports it. Default false." })),
			timeoutMs: Type.Optional(Type.Number({ description: "Index command timeout in milliseconds. Defaults to config indexTimeoutMs." })),
		}),
		async execute(_toolCallId: string, params: CodeIntelUpdateParams, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			const loadedConfig = loadConfig(ctx);
			const roots = await resolveRepoRoots(ctx, params.repoRoot);
			const statuses = await backendStatuses(roots.repoRoot, loadedConfig.config);
			const requested = requestedUpdateBackend(params.backend) ?? "auto";
			const policy = params.allowRepoArtifacts ?? loadedConfig.config.allowRepoArtifacts;
			const sqryArtifacts = await artifactPolicyState(roots.repoRoot, policy);
			const timeoutMs = normalizePositiveInteger(params.timeoutMs, loadedConfig.config.indexTimeoutMs, 1_000, 1_800_000);
			const backends = indexedBackendsForUpdate(requested, loadedConfig.config);

			if (requested === "ast-grep") {
				setStatusSummary(ctx, statuses, loadedConfig.config, sqryArtifacts);
				const payload: Record<string, unknown> = { ok: true, backend: "ast-grep", repoRoot: roots.repoRoot, message: "ast-grep does not require an index.", state: statePayload(roots, loadedConfig, statuses, sqryArtifacts, true) };
				return { content: [{ type: "text", text: String(payload.message) }], details: payload };
			}

			const indexed = await runIndexBackends(ctx, roots.repoRoot, backends, loadedConfig.config, sqryArtifacts, params.force === true, timeoutMs, signal);
			recordRuntimeOperation({ operation: "update", repoRoot: roots.repoRoot, ok: indexed.ok, requested, backends, results: indexed.results });
			if (indexed.ok) setStatusSummary(ctx, indexed.statuses, loadedConfig.config, sqryArtifacts);
			else setCodeIntelStatus(ctx, "ci:index fail", "error");
			const payload: Record<string, unknown> = {
				ok: indexed.ok,
				backend: requested,
				backends,
				repoRoot: roots.repoRoot,
				results: indexed.results,
				state: statePayload(roots, loadedConfig, indexed.statuses, sqryArtifacts, true),
			};
			return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], details: payload };
		},
	});
}

export default function codeIntelligence(pi: ExtensionAPI): void {
	pi.on("resources_discover", async () => ({ skillPaths: [path.join(extensionDir, "skills")] }));
	pi.on("tool_call", (event, ctx) => recordUsageToolCall(event, ctx));
	pi.on("tool_result", (event, ctx) => recordUsageToolResult(event, ctx));
	pi.on("session_start", (_event, ctx) => {
		void refreshFooterStatus(ctx);
	});
	registerStateTool(pi);
	registerSymbolContextTool(pi);
	registerSymbolSourceTool(pi);
	registerReplaceSymbolTool(pi);
	registerReferencesTool(pi);
	registerLocalMapTool(pi);
	registerImpactMapTool(pi);
	registerSyntaxSearchTool(pi);
	registerUpdateTool(pi);
}
