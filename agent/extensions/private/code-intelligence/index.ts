import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { compactCodeIntelOutput } from "./src/compact-output.ts";
import { loadConfig } from "./src/config.ts";
import { runImpactMap } from "./src/impact.ts";
import { runLocalMap } from "./src/local-map.ts";
import { registerOrientationTools } from "./src/orientation-tools.ts";
import { resolveRepoRoots } from "./src/repo.ts";
import { backendStatuses, languageServerStatuses, statePayload } from "./src/state.ts";
import { runSyntaxSearch } from "./src/syntax.ts";
import type { BackendName, BackendStatus, CodeIntelImpactMapParams, CodeIntelLocalMapParams, CodeIntelStateParams, CodeIntelSyntaxSearchParams } from "./src/types.ts";
import { recordUsageToolCall, recordUsageToolResult } from "./src/usage.ts";

const extensionDir = path.dirname(fileURLToPath(import.meta.url));

const repoRootParam = Type.Optional(Type.String({ description: "Repository or directory to inspect. Defaults to the current working directory." }));
const timeoutParam = Type.Optional(Type.Number({ description: "Command timeout in milliseconds. Defaults to config queryTimeoutMs." }));
const maxResultsParam = Type.Optional(Type.Number({ description: "Maximum results returned. Defaults to config maxResults." }));
const strictnessParam = Type.Union([Type.Literal("cst"), Type.Literal("smart"), Type.Literal("ast"), Type.Literal("relaxed"), Type.Literal("signature"), Type.Literal("template")], { description: "Compatibility hint for ast-grep-style patterns; ignored by the in-process Tree-sitter runner." });
const detailParam = Type.Optional(Type.Union([Type.Literal("locations"), Type.Literal("snippets")], { description: "Output detail. Use 'locations' when you plan to read/edit returned files; use 'snippets' for small inline context." }));

type StatusStyle = "dim" | "muted" | "accent" | "success" | "warning" | "error";
type RuntimeOperation = {
	timestamp: string;
	operation: "session_start";
	repoRoot?: string;
	ok: boolean;
	message?: string;
	results?: Record<string, unknown>;
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

function backendAvailable(status: Record<string, unknown>): boolean {
	return status.available === "available";
}

function renderStateResult(details: Record<string, unknown>, expanded: boolean, theme: any): Text {
	const backends = asRecord(details.backends);
	const treeSitter = asRecord(backends["tree-sitter"]);
	const rg = asRecord(backends.rg);
	const syn = `${renderColor(theme, "muted", "syn:")}${renderColor(theme, backendAvailable(treeSitter) ? "success" : "error", backendAvailable(treeSitter) ? "ok" : String(treeSitter.available ?? "?"))}`;
	const literal = `${renderColor(theme, "muted", "rg:")}${renderColor(theme, backendAvailable(rg) ? "success" : "warning", backendAvailable(rg) ? "ok" : String(rg.available ?? "?"))}`;
	const languageServers = asRecord(details.languageServers);
	const availableLsps = (["gopls", "rust-analyzer", "typescript", "clangd"] as const).filter((server) => backendAvailable(asRecord(languageServers[server]))).length;
	const lsp = `${renderColor(theme, "muted", "lsp:")}${renderColor(theme, availableLsps > 0 ? "success" : "warning", `${availableLsps}/4`)}`;
	const lines = [`${renderStatus(theme, backendAvailable(treeSitter))} ${renderBold(theme, "code-intel state")} ${syn} · ${literal} · ${lsp}`];
	if (expanded) {
		const treeDetails = asRecord(treeSitter.details);
		lines.push(`${renderColor(theme, "muted", "repo")} ${compactPath(details.repoRoot)}`);
		lines.push(`${renderColor(theme, "muted", "tree-sitter")} ${String(treeDetails.runtime ?? "wasm")} ${treeSitter.version ? `v${String(treeSitter.version)}` : ""} · languages ${Array.isArray(treeDetails.languages) ? treeDetails.languages.length : "?"}`.trim());
		lines.push(`${renderColor(theme, "muted", "rg")} ${rg.version ? String(rg.version).split(/\s+/).slice(0, 2).join(" ") : String(rg.available ?? "?")}`);
		const lspSummary = (["gopls", "rust-analyzer", "typescript", "clangd"] as const).map((server) => `${server}:${String(asRecord(languageServers[server]).available ?? "?")}`).join(" · ");
		lines.push(`${renderColor(theme, "muted", "language servers")} ${lspSummary}`);
		const diagnostics = asArray(details.diagnostics);
		if (diagnostics.length > 0) lines.push(`${renderColor(theme, "warning", "diagnostics")} ${diagnostics.length}`);
		const runtime = asRecord(details.runtimeDiagnostics);
		if (runtime.logPath) lines.push(`${renderColor(theme, "muted", "runtime log")} ${compactPath(runtime.logPath)}`);
	} else appendExpandHint(lines, expanded, theme);
	return renderLines(lines);
}

function renderImpactResult(details: Record<string, unknown>, expanded: boolean, theme: any): Text {
	const roots = asArray(details.rootSymbols);
	const related = asArray(details.related).map(asRecord);
	const coverage = asRecord(details.coverage);
	const summary = asRecord(details.summary);
	const relatedFileCount = asNumber(summary.relatedFileCount);
	const confirmation = asRecord(details.referenceConfirmation);
	const referenceCount = asArray(confirmation.references).length;
	const confirmedRefs = confirmation.backend ? ` · ${String(confirmation.backend)} refs ${referenceCount}` : "";
	const truncated = coverage.truncated === true ? renderColor(theme, "warning", " truncated") : "";
	const reason = firstLine(details.reason, 72);
	const reasonText = details.ok === false && reason ? ` · ${renderColor(theme, "warning", reason)}` : "";
	const lines = [`${renderStatus(theme, details.ok)} ${renderBold(theme, "impact map")} roots ${roots.length} · related ${related.length}${relatedFileCount !== undefined ? ` · ${relatedFileCount} file(s)` : ""}${confirmedRefs}${truncated}${reasonText}`];
	if (expanded) {
		if (roots.length > 0) lines.push(`${renderColor(theme, "muted", "roots")} ${roots.slice(0, 8).join(", ")}${roots.length > 8 ? ", …" : ""}`);
		const topFiles = compactTopFiles({ topFiles: summary.topRelatedFiles });
		if (topFiles) lines.push(`${renderColor(theme, "muted", "top files")} ${topFiles}`);
		const unsupportedImpactFiles = asArray(coverage.unsupportedImpactFiles).map(asRecord);
		const nonSourceFiles = asArray(coverage.nonSourceFiles).map((file) => String(file));
		if (unsupportedImpactFiles.length > 0) lines.push(`${renderColor(theme, "warning", "unsupported impact files")} ${unsupportedImpactFiles.slice(0, 5).map((file) => compactPath(file.file)).join(", ")}${unsupportedImpactFiles.length > 5 ? ", …" : ""}`);
		if (nonSourceFiles.length > 0) lines.push(`${renderColor(theme, "dim", "non-source changed files")} ${nonSourceFiles.slice(0, 5).map(compactPath).join(", ")}${nonSourceFiles.length > 5 ? ", …" : ""}`);
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

function renderLocalMapResult(details: Record<string, unknown>, expanded: boolean, theme: any): Text {
	const summary = asRecord(details.summary);
	const coverage = asRecord(details.coverage);
	const suggestedFiles = asArray(summary.suggestedFiles).map(asRecord);
	const sections = asRecord(details.sections);
	const treeCount = asArray(sections.treeSitterMaps).length;
	const syntaxCount = asArray(sections.syntaxMatches).length;
	const literalCount = asArray(sections.literalMatches).length;
	const truncated = coverage.truncated === true ? renderColor(theme, "warning", " truncated") : "";
	const lines = [`${renderStatus(theme, details.ok)} ${renderBold(theme, "local map")} names ${asArray(details.names).length} · files ${suggestedFiles.length} · tree/syn/rg ${treeCount}/${syntaxCount}/${literalCount}${truncated}`];
	if (expanded) {
		for (const file of suggestedFiles.slice(0, 10)) {
			const reasons = asArray(file.reasons).map((reason) => String(reason)).slice(0, 2).join(", ");
			lines.push(`${compactPath(file.file)}×${String(file.count ?? "?")}${reasons ? ` ${renderColor(theme, "dim", reasons)}` : ""}`);
		}
		if (suggestedFiles.length > 10) lines.push(renderColor(theme, "dim", `… ${suggestedFiles.length - 10} more suggested file(s)`));
	} else appendExpandHint(lines, expanded, theme);
	return renderLines(lines);
}

function renderGenericCodeIntelResult(kind: "state" | "impact" | "syntax" | "local" | "overview" | "outline" | "tests") {
	return (result: unknown, options: { expanded?: boolean; isPartial?: boolean } | undefined, theme: any) => {
		if (options?.isPartial) return renderLines([renderColor(theme, "accent", "code-intel working…")]);
		const details = asRecord(asRecord(result).details);
		if (kind === "state") return renderStateResult(details, options?.expanded === true, theme);
		if (kind === "impact") return renderImpactResult(details, options?.expanded === true, theme);
		if (kind === "local") return renderLocalMapResult(details, options?.expanded === true, theme);
		return renderSyntaxResult(details, options?.expanded === true, theme);
	};
}

function statusText(backend: BackendName, status: BackendStatus): { text: string; style: StatusStyle } {
	if (status.available === "available") return { text: "ok", style: "success" };
	if (status.available === "missing") return { text: backend === "rg" ? "missing" : "err", style: backend === "rg" ? "warning" : "error" };
	return { text: "err", style: "error" };
}

function statusSummary(ctx: ExtensionContext, statuses: Record<BackendName, BackendStatus>): string {
	const separator = statusColor(ctx, "dim", " · ");
	const colon = statusColor(ctx, "dim", ":");
	return `${statusColor(ctx, "muted", "ci")} ${(["tree-sitter", "rg"] as BackendName[]).map((backend) => {
		const state = statusText(backend, statuses[backend]);
		const label = backend === "tree-sitter" ? "syn" : "rg";
		return `${statusColor(ctx, "muted", label)}${colon}${statusColor(ctx, state.style, state.text)}`;
	}).join(separator)}`;
}

function setStatusSummary(ctx: ExtensionContext, statuses: Record<BackendName, BackendStatus>): void {
	setCodeIntelStatus(ctx, statusSummary(ctx, statuses));
}

async function refreshFooterStatus(ctx: ExtensionContext): Promise<void> {
	setCodeIntelStatus(ctx, "ci:checking", "dim");
	try {
		const loadedConfig = loadConfig(ctx);
		const roots = await resolveRepoRoots(ctx);
		const statuses = await backendStatuses(roots.repoRoot, loadedConfig.config);
		setStatusSummary(ctx, statuses);
		recordRuntimeOperation({ operation: "session_start", repoRoot: roots.repoRoot, ok: statuses["tree-sitter"].available === "available", results: statuses });
	} catch (error) {
		recordRuntimeOperation({ operation: "session_start", ok: false, error: errorMessage(error) });
		setCodeIntelStatus(ctx, "ci:error", "error");
	}
}

function registerStateTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "code_intel_state",
		label: "Code Intelligence State",
		description: "Inspect local Tree-sitter parser, rg fallback, optional language-server availability, config, and runtime diagnostics.",
		promptSnippet: "Inspect code-intel status before debugging parser availability, rg fallback, config, or footer errors.",
		promptGuidelines: [
			"Treat code_intel output as advisory routing evidence for deciding what to read next, not proof of complete impact or exact references.",
			"Normal use should start from code_intel_impact_map for diffs/changed symbols or code_intel_local_map for a scoped subsystem; both are Tree-sitter/current-source first.",
			"Use rg fallback for literal text, comments/docs, generated files, or unsupported-language gaps, not as semantic proof.",
			"For normal freshness checks, omit includeDiagnostics; use includeDiagnostics:true only to debug footer errors or failed parser/fallback probes.",
		],
		renderCall: renderToolCall("code_intel_state", (args) => args.includeDiagnostics === true ? "diagnostics" : undefined),
		renderResult: renderGenericCodeIntelResult("state"),
		parameters: Type.Object({
			repoRoot: repoRootParam,
			includeDiagnostics: Type.Optional(Type.Boolean({ description: "Include config diagnostics and recent runtime errors. Default false; use for debugging failures, not routine freshness checks." })),
		}),
		async execute(_toolCallId: string, params: CodeIntelStateParams, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			const loadedConfig = loadConfig(ctx);
			const roots = await resolveRepoRoots(ctx, params.repoRoot);
			const statuses = await backendStatuses(roots.repoRoot, loadedConfig.config);
			const languageServers = await languageServerStatuses(roots.repoRoot, loadedConfig.config);
			setStatusSummary(ctx, statuses);
			const payload = statePayload(roots, loadedConfig, statuses, params.includeDiagnostics === true, languageServers) as Record<string, unknown>;
			if (params.includeDiagnostics === true) payload.runtimeDiagnostics = runtimeDiagnostics(roots.repoRoot);
			return { content: [{ type: "text", text: compactCodeIntelOutput("state", payload) }], details: payload };
		},
	});
}

function registerLocalMapTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "code_intel_local_map",
		label: "Code Intelligence Local Map",
		description: "Build a scoped local read-next map from anchor names, related symbol/field names, optional path scope, Tree-sitter candidates, and bounded rg literal fallback.",
		promptSnippet: "Map a local subsystem into candidate files to read next; not an exact reference report.",
		promptGuidelines: [
			"Use code_intel_local_map when a scoped edit/review has a central anchor plus related fields/types/API terms and you need a candidate file list.",
			"Use it to answer: which local files should I read next, and why are they candidates? Do not treat it as exhaustive usage proof.",
			"Provide anchors for central functions/types and names for related fields/types/API terms; add paths to keep the map local.",
			"Use detail:'locations' for routing to files; use standalone rg afterward for comments/docs/generated text beyond the returned cap or unsupported-language gaps.",
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
			maxPerName: Type.Optional(Type.Number({ description: "Maximum refs/syntax/literal matches per name. Default min(config maxResults, 8)." })),
			timeoutMs: timeoutParam,
			detail: detailParam,
		}),
		async execute(_toolCallId: string, params: CodeIntelLocalMapParams, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			const loadedConfig = loadConfig(ctx);
			const roots = await resolveRepoRoots(ctx, params.repoRoot);
			const payload = await runLocalMap(params, roots.repoRoot, loadedConfig.config, signal);
			return { content: [{ type: "text", text: compactCodeIntelOutput("local", payload) }], details: payload };
		},
	});
}

function registerImpactMapTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "code_intel_impact_map",
		label: "Code Intelligence Impact Map",
		description: "Build the primary Tree-sitter read-next impact map from edited files, queried symbols, or a git base ref. Impact routing currently supports Go, TypeScript/TSX, JavaScript, Python, and C/C++ source files.",
		promptSnippet: "Primary code-intel entry point: list candidate caller/consumer/test files to read before edits or reviews.",
		promptGuidelines: [
			"Use code_intel_impact_map as the default code-intel tool after seeing a diff or before editing exported functions/types, handlers, config/schema/protocol behavior, shared helpers, or multiple files.",
			"Use it to answer: which unchanged caller, consumer, or test files should I read before changing or reviewing this code, and what evidence made them candidates?",
			"Rows like syntax_call, syntax_selector, and syntax_keyed_field are current-source Tree-sitter candidates with real locations, not type-resolved references.",
			"Start with symbols, changedFiles, or baseRef; inspect rootSymbols, related rows, coverage, truncation, and limitations.",
			"If the map is empty or ok:false, inspect reason plus coverage.supportedImpactLanguages, unsupportedImpactFiles, and nonSourceFiles before falling back to syntax search, source reads, or bounded rg.",
			"Use detail:'locations' for routing to files; use detail:'snippets' only when inline context helps avoid extra reads.",
			"Impact maps are a candidate read list, not exhaustive proof of all callers or safe compatibility.",
			"Use confirmReferences only when exact-reference confirmation is worth the extra bounded LSP call; keep it opt-in.",
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
			maxResults: Type.Optional(Type.Number({ description: "Maximum related rows returned. Defaults to min(config maxResults, 125) for locations, or min(config maxResults, 25) for snippets." })),
			maxRootSymbols: Type.Optional(Type.Number({ description: "Maximum root symbols to query after expanding changed files. Default 20." })),
			timeoutMs: timeoutParam,
			detail: detailParam,
			confirmReferences: Type.Optional(Type.Union([Type.Literal("gopls"), Type.Literal("typescript"), Type.Literal("clangd")], { description: "Opt-in exact-reference confirmation for returned roots using gopls, the TypeScript language service, or clangd for C/C++ with compile_commands.json." })),
			maxReferenceRoots: Type.Optional(Type.Number({ description: "Maximum roots to confirm when confirmReferences is set. Default 5." })),
			maxReferenceResults: Type.Optional(Type.Number({ description: "Maximum reference rows returned when confirmReferences is set. Default min(config maxResults, 25)." })),
			includeReferenceDeclarations: Type.Optional(Type.Boolean({ description: "Include declarations in reference-confirmation output. Default false." })),
		}),
		async execute(_toolCallId: string, params: CodeIntelImpactMapParams, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			const loadedConfig = loadConfig(ctx);
			const roots = await resolveRepoRoots(ctx, params.repoRoot);
			const payload = await runImpactMap(params, roots.repoRoot, loadedConfig.config, signal);
			return { content: [{ type: "text", text: compactCodeIntelOutput("impact", payload) }], details: payload };
		},
	});
}

function registerSyntaxSearchTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "code_intel_syntax_search",
		label: "Code Intelligence Syntax Search",
		description: "Run a read-only in-process Tree-sitter syntax search for explicit scoped shapes, with normalized candidate locations.",
		promptSnippet: "Use for narrow current-source syntax shapes that impact/local maps cannot express; no rewrites.",
		promptGuidelines: [
			"Provide a concrete pattern and language; scope paths/globs to avoid broad noisy scans.",
			"Use supported ast-grep-style patterns such as foo($A), $OBJ.Field, Field: $VALUE, or wrapper patterns containing those shapes; advanced users can pass raw Tree-sitter S-expression queries.",
			"Use detail:'locations' when matches are read/edit targets; default snippets are for judging match relevance.",
			"Use this for candidate matching, API-shape checks, or pattern-specific review, not general linting or exact semantic references.",
			"Matches are not defects by themselves; inspect source and validate behavior before reporting.",
		],
		renderCall: renderToolCall("code_intel_syntax_search", (args) => `${asString(args.language) ?? ""} ${asString(args.pattern) ? "pattern" : ""}`.trim()),
		renderResult: renderGenericCodeIntelResult("syntax"),
		parameters: Type.Object({
			repoRoot: repoRootParam,
			pattern: Type.String({ description: "Explicit Tree-sitter query or supported ast-grep-style pattern, e.g. 'foo($A)', '$OBJ.Field', or 'Field: $VALUE'. Required and read-only." }),
			language: Type.Optional(Type.String({ description: "Tree-sitter language, e.g. ts, javascript, go, python, rust. If omitted, Go is used when paths are Go-scoped; otherwise provide a language." })),
			paths: Type.Optional(Type.Array(Type.String(), { description: "Repo-relative files or directories to search. Defaults to '.'. Paths outside the repo are rejected." })),
			includeGlobs: Type.Optional(Type.Array(Type.String(), { description: "Additional glob-like include patterns." })),
			excludeGlobs: Type.Optional(Type.Array(Type.String(), { description: "Additional glob-like exclude patterns. Leading '!' is optional." })),
			selector: Type.Optional(Type.String({ description: "Optional node kind or capture name to extract, e.g. selector_expression for Go field selections." })),
			maxResults: maxResultsParam,
			timeoutMs: timeoutParam,
			strictness: Type.Optional(strictnessParam),
			detail: detailParam,
		}),
		async execute(_toolCallId: string, params: CodeIntelSyntaxSearchParams, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			const loadedConfig = loadConfig(ctx);
			const roots = await resolveRepoRoots(ctx, params.repoRoot);
			const payload = await runSyntaxSearch(params, roots.repoRoot, loadedConfig.config, signal);
			return { content: [{ type: "text", text: compactCodeIntelOutput("syntax", payload) }], details: payload };
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
	registerOrientationTools(pi);
	registerLocalMapTool(pi);
	registerImpactMapTool(pi);
	registerSyntaxSearchTool(pi);
}
