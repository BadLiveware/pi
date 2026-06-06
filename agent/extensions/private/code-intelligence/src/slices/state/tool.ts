import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	backendStatuses,
	languageServerStatusesFromProviders,
	legacyLanguageServerSemanticProviderStatuses,
	loadStandaloneConfig,
	resolveRepoRootsFromCwd,
	stateToolSpec,
	type CodeIntelStateParams,
} from "code-intel/pi-integration";
import { registerCodeIntelSpecTool } from "../../pi-tool-adapter.ts";
import { setCodeIntelStatusSummary } from "./footer-status.ts";
import { appendExpandHint, asRecord, backendAvailable, compactPath, renderBold, renderColor, renderLines, renderStatus, renderToolCall, type StatusStyle } from "../../core/tool-render.ts";

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

function renderStateResult(details: Record<string, unknown>, expanded: boolean, theme: any) {
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
		const languages = asRecord(details.languages);
		const languageGroups = Object.entries(languages).reduce<Record<string, string[]>>((groups, [id, value]) => {
			const level = String(asRecord(value).supportLevel ?? "unknown");
			(groups[level] ??= []).push(id);
			return groups;
		}, {});
		const languageSummary = Object.entries(languageGroups).map(([level, ids]) => `${level}:${ids.join(",")}`).join(" · ");
		if (languageSummary) lines.push(`${renderColor(theme, "muted", "languages")} ${languageSummary}`);
		const diagnostics = Array.isArray(details.diagnostics) ? details.diagnostics : [];
		if (diagnostics.length > 0) lines.push(`${renderColor(theme, "warning", "diagnostics")} ${diagnostics.length}`);
		const runtime = asRecord(details.runtimeDiagnostics);
		if (runtime.logPath) lines.push(`${renderColor(theme, "muted", "runtime log")} ${compactPath(runtime.logPath)}`);
	} else appendExpandHint(lines, expanded, theme);
	return renderLines(lines);
}

function renderStateToolResult(result: unknown, options: { expanded?: boolean; isPartial?: boolean } | undefined, theme: any) {
	if (options?.isPartial) return renderLines([renderColor(theme, "accent", "code-intel working…")]);
	return renderStateResult(asRecord(asRecord(result).details), options?.expanded === true, theme);
}

export async function refreshFooterStatus(ctx: ExtensionContext): Promise<void> {
	setCodeIntelStatus(ctx, "ci:checking", "dim");
	try {
		const loadedConfig = loadStandaloneConfig(ctx.cwd);
		const roots = await resolveRepoRootsFromCwd(ctx.cwd);
		const [statuses, semanticProviders] = await Promise.all([backendStatuses(roots.repoRoot, loadedConfig.config), legacyLanguageServerSemanticProviderStatuses(roots.repoRoot, loadedConfig.config)]);
		const languageServers = languageServerStatusesFromProviders(semanticProviders);
		setCodeIntelStatusSummary(ctx, statuses, languageServers, roots.repoRoot);
		recordRuntimeOperation({ operation: "session_start", repoRoot: roots.repoRoot, ok: statuses["tree-sitter"].available === "available", results: { backends: statuses, languageServers, semanticProviders } });
	} catch (error) {
		recordRuntimeOperation({ operation: "session_start", ok: false, error: errorMessage(error) });
		setCodeIntelStatus(ctx, "ci:error", "error");
	}
}

export function registerStateTool(pi: ExtensionAPI): void {
	registerCodeIntelSpecTool(pi, stateToolSpec, {
		renderCall: renderToolCall("code_intel_state", (args) => args.includeDiagnostics === true ? "diagnostics" : undefined),
		renderResult: renderStateToolResult,
		afterResult: (result, params: CodeIntelStateParams, ctx) => {
			const repoRoot = String(result.details.repoRoot ?? ctx.cwd);
			setCodeIntelStatusSummary(ctx, asRecord(result.details.backends) as any, asRecord(result.details.languageServers) as any, repoRoot);
			if (params.includeDiagnostics === true) result.details.runtimeDiagnostics = runtimeDiagnostics(repoRoot);
		},
	});
}
