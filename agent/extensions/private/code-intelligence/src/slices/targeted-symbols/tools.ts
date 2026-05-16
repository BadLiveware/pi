import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { compactCodeIntelOutput } from "../../compact-output.ts";
import { loadConfig } from "../../config.ts";
import { resolveRepoRoots } from "../../repo.ts";
import { runInsertRelative, runReplaceSymbol } from "../symbol-mutations/run.ts";
import { runPostEditMap, runReadSymbol } from "./run.ts";
import type { CodeIntelInsertRelativeParams, CodeIntelPostEditMapParams, CodeIntelReadSymbolParams, CodeIntelReplaceSymbolParams } from "../../types.ts";

const repoRootParam = Type.Optional(Type.String({ description: "Repository or directory to inspect. Defaults to the current working directory." }));
const timeoutParam = Type.Optional(Type.Number({ description: "Command timeout in milliseconds. Defaults to config queryTimeoutMs." }));
const targetParam = Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Symbol target object returned by locator-mode code-intel tools. Preferred over reconstructing path/symbol fields manually." }));
const sourceDetailParam = Type.Optional(Type.Union([Type.Literal("source"), Type.Literal("locations")], { description: "Output detail. source returns bounded source segments; locations returns target metadata only." }));

export function registerTargetedContextTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "code_intel_read_symbol",
		label: "Code Intelligence Read Symbol",
		description: "Read one symbol/declaration by a code-intel symbolTarget or explicit path/symbol selector, returning a complete bounded source segment when possible.",
		promptSnippet: "Use after locator-mode code-intel output when you need the exact source for one function, method, type, constant, variable, field, or property without reading the whole file.",
		promptGuidelines: [
			"Prefer passing a symbolTarget returned by code_intel_file_outline or another locator tool; do not reconstruct identity from prose when a target object is available.",
			"Treat a complete-segment source result as the source read; do not call generic read on the same range unless it was truncated, stale, ambiguous, or too narrow for the edit.",
			"For functions and methods, the tool returns the full declaration body by default. contextLines are mainly for small declarations and adjacent comments/attributes.",
			"Referenced-definition context is same-file, one-hop, and limited to constants, variables, fields/properties, and types; called functions/helpers are intentionally deferred.",
		],
		parameters: Type.Object({
			repoRoot: repoRootParam,
			target: targetParam,
			path: Type.Optional(Type.String({ description: "Repo-relative file path. Required when target is omitted." })),
			symbol: Type.Optional(Type.String({ description: "Symbol/declaration name. Prefer target when available." })),
			name: Type.Optional(Type.String({ description: "Alias for symbol." })),
			owner: Type.Optional(Type.String({ description: "Optional owner such as class, struct, receiver, impl, or namespace." })),
			kind: Type.Optional(Type.String({ description: "Optional declaration kind filter." })),
			signature: Type.Optional(Type.String({ description: "Optional signature text to disambiguate overload-like declarations." })),
			symbolRef: Type.Optional(Type.String({ description: "Stable symbolRef emitted by locator-mode code-intel tools." })),
			rangeId: Type.Optional(Type.String({ description: "Stable range id emitted by locator-mode code-intel tools." })),
			line: Type.Optional(Type.Number({ description: "Fallback: line whose enclosing declaration should be read, for diagnostic/location-originated workflows." })),
			column: Type.Optional(Type.Number({ description: "Fallback: column for enclosing-declaration lookup." })),
			contextLines: Type.Optional(Type.Number({ description: "Extra surrounding lines for small declarations. Function-like declarations are returned whole by default." })),
			include: Type.Optional(Type.Array(Type.Union([Type.Literal("referenced-constants"), Type.Literal("referenced-vars"), Type.Literal("referenced-types")]), { description: "Optional one-hop same-file referenced definitions to include. Functions/helpers are deferred." })),
			maxContextSegments: Type.Optional(Type.Number({ description: "Maximum referenced-definition segments returned. Default 8." })),
			maxBytes: Type.Optional(Type.Number({ description: "Maximum bytes per returned source segment. Default 30000." })),
			timeoutMs: timeoutParam,
			detail: sourceDetailParam,
		}),
		async execute(_toolCallId: string, params: CodeIntelReadSymbolParams, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			const loadedConfig = loadConfig(ctx);
			const roots = await resolveRepoRoots(ctx, params.repoRoot);
			const payload = await runReadSymbol(params, roots.repoRoot, loadedConfig.config, signal);
			return { content: [{ type: "text", text: compactCodeIntelOutput("read_symbol", payload) }], details: payload };
		},
	});

	pi.registerTool({
		name: "code_intel_replace_symbol",
		label: "Code Intelligence Replace Symbol",
		description: "Replace the current text of a resolved symbolTarget after verifying oldText or oldHash safety evidence.",
		promptSnippet: "Use when you already have a code-intel symbolTarget and need to replace that exact declaration without reconstructing line numbers after edits.",
		promptGuidelines: [
			"Prefer passing a symbolTarget from code_intel_read_symbol or code_intel_file_outline. The tool resolves stale targets using stable refs and relocation anchors before writing.",
			"Provide oldHash from code_intel_read_symbol for token-light safety, or oldText when exact reviewable replacement evidence is needed. If both are supplied, both must match.",
			"This tool mutates files. Use it only for the intended symbol replacement, and run validation or code_intel_post_edit_map afterward when follow-up context is needed.",
		],
		parameters: Type.Object({
			repoRoot: repoRootParam,
			target: targetParam,
			path: Type.Optional(Type.String({ description: "Repo-relative file path. Required when target is omitted." })),
			symbol: Type.Optional(Type.String({ description: "Symbol/declaration name. Prefer target when available." })),
			name: Type.Optional(Type.String({ description: "Alias for symbol." })),
			owner: Type.Optional(Type.String({ description: "Optional owner such as class, struct, receiver, impl, or namespace." })),
			kind: Type.Optional(Type.String({ description: "Optional declaration kind filter." })),
			signature: Type.Optional(Type.String({ description: "Optional signature text to disambiguate overload-like declarations." })),
			symbolRef: Type.Optional(Type.String({ description: "Stable symbolRef emitted by locator-mode code-intel tools." })),
			rangeId: Type.Optional(Type.String({ description: "Exact range id emitted by locator-mode code-intel tools." })),
			oldText: Type.Optional(Type.String({ description: "Exact expected current symbol text. If provided, it must match after fresh resolution." })),
			oldHash: Type.Optional(Type.String({ description: "Hash of the exact expected current symbol text, e.g. oldHash from code_intel_read_symbol." })),
			newText: Type.String({ description: "Replacement text for the resolved symbol range." }),
			normalizeEol: Type.Optional(Type.Boolean({ description: "Normalize newText line endings to the target file style. Default true." })),
			timeoutMs: timeoutParam,
		}),
		async execute(_toolCallId: string, params: CodeIntelReplaceSymbolParams, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			const loadedConfig = loadConfig(ctx);
			const roots = await resolveRepoRoots(ctx, params.repoRoot);
			const payload = await runReplaceSymbol(params, roots.repoRoot, loadedConfig.config, signal);
			return { content: [{ type: "text", text: compactCodeIntelOutput("replace_symbol", payload) }], details: payload };
		},
	});

	pi.registerTool({
		name: "code_intel_insert_relative",
		label: "Code Intelligence Insert Relative",
		description: "Insert text before or after a resolved symbolTarget anchor, using the same stale-target resolution as read_symbol.",
		promptSnippet: "Use with a symbolTarget from file outline or read_symbol to add a declaration before/after an existing symbol without reading the whole file.",
		promptGuidelines: [
			"Prefer anchor from code_intel_file_outline when you only need structural insertion; use code_intel_read_symbol first when the inserted code depends on the anchor body.",
			"The tool mutates files and inserts text verbatim except for default EOL normalization. Provide anchorHash when you want compact safety evidence from a prior read_symbol result.",
			"Run validation or code_intel_post_edit_map afterward when follow-up context is needed.",
		],
		parameters: Type.Object({
			repoRoot: repoRootParam,
			anchor: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Symbol target object to insert before/after. Usually from file outline or read_symbol." })),
			target: targetParam,
			path: Type.Optional(Type.String({ description: "Repo-relative file path. Required when anchor/target is omitted." })),
			symbol: Type.Optional(Type.String({ description: "Symbol/declaration name. Prefer anchor when available." })),
			name: Type.Optional(Type.String({ description: "Alias for symbol." })),
			owner: Type.Optional(Type.String({ description: "Optional owner such as class, struct, receiver, impl, or namespace." })),
			kind: Type.Optional(Type.String({ description: "Optional declaration kind filter." })),
			signature: Type.Optional(Type.String({ description: "Optional signature text to disambiguate overload-like declarations." })),
			symbolRef: Type.Optional(Type.String({ description: "Stable symbolRef emitted by locator-mode code-intel tools." })),
			rangeId: Type.Optional(Type.String({ description: "Exact range id emitted by locator-mode code-intel tools." })),
			position: Type.Union([Type.Literal("before"), Type.Literal("after")], { description: "Insert before or after the resolved anchor symbol." }),
			text: Type.String({ description: "Text to insert relative to the resolved anchor. A trailing newline is added when needed to avoid merging with following text." }),
			anchorHash: Type.Optional(Type.String({ description: "Hash of the exact expected current anchor text, e.g. oldHash from code_intel_read_symbol." })),
			normalizeEol: Type.Optional(Type.Boolean({ description: "Normalize inserted text line endings to the target file style. Default true." })),
			timeoutMs: timeoutParam,
		}),
		async execute(_toolCallId: string, params: CodeIntelInsertRelativeParams, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			const loadedConfig = loadConfig(ctx);
			const roots = await resolveRepoRoots(ctx, params.repoRoot);
			const payload = await runInsertRelative(params, roots.repoRoot, loadedConfig.config, signal);
			return { content: [{ type: "text", text: compactCodeIntelOutput("insert_relative", payload) }], details: payload };
		},
	});

	pi.registerTool({
		name: "code_intel_post_edit_map",
		label: "Code Intelligence Post-edit Map",
		description: "Build a read-only follow-up map after edits/writes: changed symbols, likely callers/tests, and optional diagnostic-focused locations.",
		promptSnippet: "Use after editing or writing files to decide what to inspect or validate next without re-reading complete segments unnecessarily.",
		promptGuidelines: [
			"Use this after edit/write when you need changed-symbol, caller, test, or diagnostic follow-up context. It is read-only and does not run tests or apply fixes.",
			"Treat results as locator-mode routing evidence. Use readHint or code_intel_read_symbol for source only when source is needed.",
			"Diagnostics, when supplied, prioritize enclosing declarations but are not auto-fix instructions.",
		],
		parameters: Type.Object({
			repoRoot: repoRootParam,
			changedFiles: Type.Optional(Type.Array(Type.String(), { description: "Files edited or written in the current task." })),
			baseRef: Type.Optional(Type.String({ description: "Optional git base ref for discovering changed files." })),
			includeChangedSymbols: Type.Optional(Type.Boolean({ description: "Include changed declaration ranges/read hints. Default true." })),
			includeCallers: Type.Optional(Type.Boolean({ description: "Include likely caller/consumer rows via impact map. Default true." })),
			includeTests: Type.Optional(Type.Boolean({ description: "Include likely test candidates. Default true." })),
			includeDiagnostics: Type.Optional(Type.Boolean({ description: "Use supplied or cheaply available diagnostics to prioritize follow-up locations. Default false unless diagnostics are supplied." })),
			diagnostics: Type.Optional(Type.Array(Type.Record(Type.String(), Type.Unknown()), { description: "Optional LSP/compiler diagnostics with path, line, column, severity, source, and code." })),
			avoidReReadingCompleteReturnedSegments: Type.Optional(Type.Boolean({ description: "Avoid re-suggesting exact complete source segments unless freshness or diagnostics make them relevant. Default true." })),
			maxResults: Type.Optional(Type.Number({ description: "Maximum related/test rows returned. Defaults to config maxResults." })),
			timeoutMs: timeoutParam,
		}),
		async execute(_toolCallId: string, params: CodeIntelPostEditMapParams, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			const loadedConfig = loadConfig(ctx);
			const roots = await resolveRepoRoots(ctx, params.repoRoot);
			const payload = await runPostEditMap(params, roots.repoRoot, loadedConfig.config, signal);
			return { content: [{ type: "text", text: compactCodeIntelOutput("post_edit", payload) }], details: payload };
		},
	});
}
