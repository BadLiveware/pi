import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { compactCodeIntelOutput } from "../../compact-output.ts";
import { loadConfig } from "../../config.ts";
import { runLocalMap } from "./run.ts";
import { resolveRepoRoots } from "../../repo.ts";
import { appendExpandHint, asArray, asRecord, compactPath, renderBold, renderColor, renderLines, renderStatus, renderToolCall } from "../../core/tool-render.ts";
import type { CodeIntelLocalMapParams } from "../../types.ts";

const repoRootParam = Type.Optional(Type.String({ description: "Repository or directory to inspect. Defaults to the current working directory." }));
const timeoutParam = Type.Optional(Type.Number({ description: "Command timeout in milliseconds. Defaults to config queryTimeoutMs." }));
const detailParam = Type.Optional(Type.Union([Type.Literal("locations"), Type.Literal("snippets")], { description: "Output detail. Use 'locations' when you plan to read/edit returned files; use 'snippets' for small inline context." }));

function renderLocalMapResult(details: Record<string, unknown>, expanded: boolean, theme: any) {
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

function renderLocalMapToolResult(result: unknown, options: { expanded?: boolean; isPartial?: boolean } | undefined, theme: any) {
	if (options?.isPartial) return renderLines([renderColor(theme, "accent", "code-intel working…")]);
	return renderLocalMapResult(asRecord(asRecord(result).details), options?.expanded === true, theme);
}

export function registerLocalMapTool(pi: ExtensionAPI): void {
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
		renderResult: renderLocalMapToolResult,
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
