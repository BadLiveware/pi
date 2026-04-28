import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { runImpactMap, runReferences, runSymbolContext } from "./src/cymbal.ts";
import { loadConfig } from "./src/config.ts";
import { summarizeCommand } from "./src/exec.ts";
import { resolveRepoRoots } from "./src/repo.ts";
import { artifactPolicyState, backendStatuses, requestedUpdateBackend, runIndexUpdate, statePayload } from "./src/state.ts";
import { runSyntaxSearch } from "./src/syntax.ts";
import { SQRY_REPO_ARTIFACTS, type ArtifactPolicyState, type BackendName, type BackendStatus, type CodeIntelConfig, type CodeIntelStateParams, type CodeIntelSyntaxSearchParams, type CodeIntelUpdateParams, type CymbalImpactMapParams, type CymbalReferencesParams, type CymbalSymbolContextParams } from "./src/types.ts";
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
	const lines = [`${renderStatus(theme, details.ok)} ${renderBold(theme, "symbol context")} ${renderColor(theme, "muted", asString(details.symbol) ?? "")} · ${location} · callers ${callers.length}`];
	if (expanded) {
		for (const caller of callers.slice(0, 8)) lines.push(`${renderColor(theme, "muted", "caller")} ${compactPath(caller.file)}${caller.line ? `:${caller.line}` : ""} ${asString(caller.name) ?? ""}`.trim());
		if (callers.length > 8) lines.push(renderColor(theme, "dim", `… ${callers.length - 8} more caller(s)`));
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
	const lines = [`${renderStatus(theme, details.ok)} ${renderBold(theme, "references")} ${renderColor(theme, "muted", asString(details.relation) ?? "refs")} ${renderColor(theme, "dim", asString(details.query) ?? "")} · ${returned}/${matchCount}${fileCount !== undefined ? ` · ${fileCount} file(s)` : ""}${truncated}`];
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

function renderGenericCodeIntelResult(kind: "state" | "update" | "symbol" | "references" | "impact" | "syntax") {
	return (result: unknown, options: { expanded?: boolean; isPartial?: boolean } | undefined, theme: any) => {
		if (options?.isPartial) return renderLines([renderColor(theme, "accent", "code-intel working…")]);
		const details = asRecord(asRecord(result).details);
		if (kind === "state") return renderStateResult(details, options?.expanded === true, theme);
		if (kind === "update") return renderUpdateResult(details, options?.expanded === true, theme);
		if (kind === "symbol") return renderSymbolContextResult(details, options?.expanded === true, theme);
		if (kind === "references") return renderReferencesResult(details, options?.expanded === true, theme);
		if (kind === "impact") return renderImpactResult(details, options?.expanded === true, theme);
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
			"Treat code_intel output as advisory routing evidence, not proof of complete impact.",
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
		description: "Get compact Cymbal-backed context for a symbol: definition, source, callers, imports, and alternate matches.",
		promptSnippet: "Use nav/Cymbal symbol context for one unfamiliar or changed symbol before editing or reviewing callers.",
		promptGuidelines: [
			"Best for one symbol; use code_intel_references or code_intel_impact_map for broader blast-radius checks.",
			"If results look stale or fail, inspect code_intel_state or refresh nav with code_intel_update.",
			"Read returned source files before turning context into a finding or fix.",
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

function registerReferencesTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "code_intel_references",
		label: "Code Intelligence References",
		description: "Find Cymbal-backed references, callers, callees, impact rows, implementers, implemented interfaces, or importers.",
		promptSnippet: "Use nav/Cymbal references for callers, callees, implementers, importers, or refs of a known symbol/type/file.",
		promptGuidelines: [
			"Choose the narrowest relation and bounded maxResults; add path filters when reviewing scoped changes.",
			"Use code_intel_references detail:'locations' when you expect to read or edit returned files; use detail:'snippets' only for small inline context.",
			"Use impact_map when starting from changed files or multiple root symbols.",
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

function registerImpactMapTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "code_intel_impact_map",
		label: "Code Intelligence Impact Map",
		description: "Build a compact Cymbal-backed impact map from queried symbols, changed files, or a git base ref.",
		promptSnippet: "Use nav/Cymbal impact maps before reviewing changed symbols, changed files, or public API blast radius.",
		promptGuidelines: [
			"Start with symbols, changedFiles, or baseRef; inspect rootSymbols, related rows, coverage, and truncation.",
			"Use code_intel_impact_map detail:'locations' for routing to files; use detail:'snippets' only when inline context helps avoid extra reads.",
			"Impact maps are a candidate file list, not exhaustive proof of all callers or safe compatibility.",
			"Follow up by reading returned files and running project-native validation when relevant.",
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
		description: "Run a read-only ast-grep syntax-pattern search with scoped, normalized candidate results.",
		promptSnippet: "Use ast/ast-grep for narrow, explicit syntax-shape searches with scoped paths; no rewrites.",
		promptGuidelines: [
			"Provide a concrete pattern and language when possible; scope paths/globs to avoid broad noisy scans.",
			"Use code_intel_syntax_search detail:'locations' when matches are just read/edit targets; default snippets are for judging match relevance.",
			"Use this for candidate matching, API-shape checks, or pattern-specific review, not general linting.",
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
	registerReferencesTool(pi);
	registerImpactMapTool(pi);
	registerSyntaxSearchTool(pi);
	registerUpdateTool(pi);
}
