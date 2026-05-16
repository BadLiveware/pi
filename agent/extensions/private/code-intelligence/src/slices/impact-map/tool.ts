import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { compactCodeIntelOutput } from "../../compact-output.ts";
import { loadConfig } from "../../config.ts";
import { runImpactMap } from "./run.ts";
import { resolveRepoRoots } from "../../repo.ts";
import { appendExpandHint, asArray, asNumber, asRecord, asString, compactPath, compactTopFiles, firstLine, renderBold, renderColor, renderLines, renderStatus, renderToolCall } from "../../core/tool-render.ts";
import type { CodeIntelImpactMapParams } from "../../types.ts";

const repoRootParam = Type.Optional(Type.String({ description: "Repository or directory to inspect. Defaults to the current working directory." }));
const timeoutParam = Type.Optional(Type.Number({ description: "Command timeout in milliseconds. Defaults to config queryTimeoutMs." }));
const detailParam = Type.Optional(Type.Union([Type.Literal("locations"), Type.Literal("snippets")], { description: "Output detail. Use 'locations' when you plan to read/edit returned files; use 'snippets' for small inline context." }));

function renderImpactResult(details: Record<string, unknown>, expanded: boolean, theme: any) {
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

function renderImpactToolResult(result: unknown, options: { expanded?: boolean; isPartial?: boolean } | undefined, theme: any) {
	if (options?.isPartial) return renderLines([renderColor(theme, "accent", "code-intel working…")]);
	return renderImpactResult(asRecord(asRecord(result).details), options?.expanded === true, theme);
}

export function registerImpactMapTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "code_intel_impact_map",
		label: "Code Intelligence Impact Map",
		description: "Build the primary Tree-sitter read-next impact map from edited files, queried symbols, or a git base ref. Impact routing currently supports Go, TypeScript/TSX, JavaScript, Rust, Python, and C/C++ source files.",
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
		renderResult: renderImpactToolResult,
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
