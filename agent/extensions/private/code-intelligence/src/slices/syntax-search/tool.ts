import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { compactCodeIntelOutput } from "../../compact-output.ts";
import { loadConfig } from "../../config.ts";
import { resolveRepoRoots } from "../../repo.ts";
import { runSyntaxSearch } from "./run.ts";
import { appendExpandHint, asArray, asNumber, asRecord, asString, compactPath, compactTopFiles, firstLine, renderBold, renderColor, renderLines, renderStatus, renderToolCall } from "../../core/tool-render.ts";
import type { CodeIntelSyntaxSearchParams } from "../../types.ts";

const repoRootParam = Type.Optional(Type.String({ description: "Repository or directory to inspect. Defaults to the current working directory." }));
const timeoutParam = Type.Optional(Type.Number({ description: "Command timeout in milliseconds. Defaults to config queryTimeoutMs." }));
const maxResultsParam = Type.Optional(Type.Number({ description: "Maximum results returned. Defaults to config maxResults." }));
const strictnessParam = Type.Union([Type.Literal("cst"), Type.Literal("smart"), Type.Literal("ast"), Type.Literal("relaxed"), Type.Literal("signature"), Type.Literal("template")], { description: "Compatibility hint for ast-grep-style patterns; ignored by the in-process Tree-sitter runner." });
const detailParam = Type.Optional(Type.Union([Type.Literal("locations"), Type.Literal("snippets")], { description: "Output detail. Use 'locations' when you plan to read/edit returned files; use 'snippets' for small inline context." }));

function renderSyntaxResult(details: Record<string, unknown>, expanded: boolean, theme: any) {
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

function renderSyntaxToolResult(result: unknown, options: { expanded?: boolean; isPartial?: boolean } | undefined, theme: any) {
	if (options?.isPartial) return renderLines([renderColor(theme, "accent", "code-intel working…")]);
	return renderSyntaxResult(asRecord(asRecord(result).details), options?.expanded === true, theme);
}

export function registerSyntaxSearchTool(pi: ExtensionAPI): void {
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
		renderResult: renderSyntaxToolResult,
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
