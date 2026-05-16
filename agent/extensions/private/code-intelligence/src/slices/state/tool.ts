import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { compactCodeIntelOutput } from "../../compact-output.ts";
import { loadConfig } from "../../config.ts";
import { setCodeIntelStatusSummary } from "./footer-status.ts";
import { resolveRepoRoots } from "../../repo.ts";
import { backendStatuses, languageServerStatuses, statePayload } from "./run.ts";
import { appendExpandHint, asRecord, backendAvailable, compactPath, renderBold, renderColor, renderLines, renderStatus, renderToolCall, type StatusStyle } from "../../core/tool-render.ts";
import type { CodeIntelStateParams } from "../../types.ts";

type RuntimeOperation = {
	timestamp: string;
	operation: "session_start";
	repoRoot?: string;
	ok: boolean;
	message?: string;
	results?: Record<string, unknown>;
	error?: string;
};

const repoRootParam = Type.Optional(Type.String({ description: "Repository or directory to inspect. Defaults to the current working directory." }));
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
		const loadedConfig = loadConfig(ctx);
		const roots = await resolveRepoRoots(ctx);
		const [statuses, languageServers] = await Promise.all([backendStatuses(roots.repoRoot, loadedConfig.config), languageServerStatuses(roots.repoRoot, loadedConfig.config)]);
		setCodeIntelStatusSummary(ctx, statuses, languageServers, roots.repoRoot);
		recordRuntimeOperation({ operation: "session_start", repoRoot: roots.repoRoot, ok: statuses["tree-sitter"].available === "available", results: { backends: statuses, languageServers } });
	} catch (error) {
		recordRuntimeOperation({ operation: "session_start", ok: false, error: errorMessage(error) });
		setCodeIntelStatus(ctx, "ci:error", "error");
	}
}

export function registerStateTool(pi: ExtensionAPI): void {
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
		renderResult: renderStateToolResult,
		parameters: Type.Object({
			repoRoot: repoRootParam,
			includeDiagnostics: Type.Optional(Type.Boolean({ description: "Include config diagnostics and recent runtime errors. Default false; use for debugging failures, not routine freshness checks." })),
		}),
		async execute(_toolCallId: string, params: CodeIntelStateParams, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			const loadedConfig = loadConfig(ctx);
			const roots = await resolveRepoRoots(ctx, params.repoRoot);
			const [statuses, languageServers] = await Promise.all([backendStatuses(roots.repoRoot, loadedConfig.config), languageServerStatuses(roots.repoRoot, loadedConfig.config)]);
			setCodeIntelStatusSummary(ctx, statuses, languageServers, roots.repoRoot);
			const payload = statePayload(roots, loadedConfig, statuses, params.includeDiagnostics === true, languageServers) as Record<string, unknown>;
			if (params.includeDiagnostics === true) payload.runtimeDiagnostics = runtimeDiagnostics(roots.repoRoot);
			return { content: [{ type: "text", text: compactCodeIntelOutput("state", payload) }], details: payload };
		},
	});
}
