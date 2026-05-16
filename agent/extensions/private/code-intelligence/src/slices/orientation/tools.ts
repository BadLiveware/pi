import { Type } from "@earendil-works/pi-ai";
import { compactCodeIntelOutput } from "../../compact-output.ts";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../../config.ts";
import { runFileOutline, runRepoOverview, runTestMap } from "./run.ts";
import { runRepoRoute } from "../repo-route/run.ts";
import { resolveRepoRoots } from "../../repo.ts";
import type { CodeIntelFileOutlineParams, CodeIntelRepoOverviewParams, CodeIntelRepoRouteParams, CodeIntelTestMapParams } from "../../types.ts";

const repoRootParam = Type.Optional(Type.String({ description: "Repository or directory to inspect. Defaults to the current working directory." }));
const timeoutParam = Type.Optional(Type.Number({ description: "Command timeout in milliseconds. Defaults to config queryTimeoutMs." }));
const maxResultsParam = Type.Optional(Type.Number({ description: "Maximum results returned. Defaults to config maxResults." }));
const detailParam = Type.Optional(Type.Union([Type.Literal("locations"), Type.Literal("snippets")], { description: "Output detail. Use 'locations' when you plan to read/edit returned files; use 'snippets' for small inline context." }));

export function registerOrientationTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "code_intel_repo_overview",
		label: "Code Intelligence Repo Overview",
		description: "Build a deterministic large-repo-safe orientation map. Shape tier summarizes directories; files tier adds capped top-level declarations for scoped paths.",
		promptSnippet: "Use first in large unfamiliar repositories to see objective structure before broad searches.",
		promptGuidelines: [
			"Use code_intel_repo_overview to answer what exists and where to start before global rg/find in large repos.",
			"Start with tier:'shape' at broad scope, then tier:'files' for an explicit subtree; do not request file declarations for an entire large repo by default.",
			"Treat paths, counts, languages, declarations, and truncation as navigation evidence only; there are no semantic role summaries.",
		],
		parameters: Type.Object({
			repoRoot: repoRootParam,
			paths: Type.Optional(Type.Array(Type.String(), { description: "Repo-relative directories or files to summarize. Defaults to repository root." })),
			tier: Type.Optional(Type.Union([Type.Literal("shape"), Type.Literal("files")], { description: "shape summarizes directory counts; files adds capped file declarations for scoped paths. Default shape." })),
			maxDepth: Type.Optional(Type.Number({ description: "Maximum directory depth. Defaults to 2 for shape, 3 for files." })),
			maxDirs: Type.Optional(Type.Number({ description: "Maximum directories to visit before truncating." })),
			maxFilesPerDir: Type.Optional(Type.Number({ description: "Maximum files listed per directory. Defaults low for shape, higher for files." })),
			maxSymbolsPerFile: Type.Optional(Type.Number({ description: "Maximum declarations shown per file in files tier. Default 8." })),
			includeGlobs: Type.Optional(Type.Array(Type.String(), { description: "Additional glob-like include patterns." })),
			excludeGlobs: Type.Optional(Type.Array(Type.String(), { description: "Additional glob-like exclude patterns. Leading ! is optional." })),
			includeGenerated: Type.Optional(Type.Boolean({ description: "Include generated-looking directories. Default false." })),
			includeVendor: Type.Optional(Type.Boolean({ description: "Include vendor/contrib/dependency directories. Default false." })),
			timeoutMs: timeoutParam,
		}),
		async execute(_toolCallId: string, params: CodeIntelRepoOverviewParams, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			const loadedConfig = loadConfig(ctx);
			const roots = await resolveRepoRoots(ctx, params.repoRoot);
			const payload = await runRepoOverview(params, roots.repoRoot, loadedConfig.config, signal);
			return { content: [{ type: "text", text: compactCodeIntelOutput("overview", payload) }], details: payload };
		},
	});

	pi.registerTool({
		name: "code_intel_file_outline",
		label: "Code Intelligence File Outline",
		description: "Parse one source file and return imports/includes plus language-native top-level declarations with locations.",
		promptSnippet: "Use to inspect what is inside a file before reading the full source.",
		promptGuidelines: [
			"Use code_intel_file_outline after repo overview points at a candidate file and before reading a very large source file.",
			"Output is deterministic syntax structure: imports/includes, declaration names/kinds, and line ranges; infer meaning from repository names and source reads.",
			"Use this for orientation, not exact references or architecture claims.",
		],
		parameters: Type.Object({
			repoRoot: repoRootParam,
			path: Type.String({ description: "Repo-relative file to outline." }),
			includeImports: Type.Optional(Type.Boolean({ description: "Include imports/includes when available. Default true." })),
			includeNonExported: Type.Optional(Type.Boolean({ description: "Reserved for language-specific filtering; current output is syntax declarations with exported markers where available." })),
			maxSymbols: Type.Optional(Type.Number({ description: "Maximum declarations returned. Default 250." })),
			timeoutMs: timeoutParam,
			detail: detailParam,
		}),
		async execute(_toolCallId: string, params: CodeIntelFileOutlineParams, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			const loadedConfig = loadConfig(ctx);
			const roots = await resolveRepoRoots(ctx, params.repoRoot);
			const payload = await runFileOutline(params, roots.repoRoot, loadedConfig.config, signal);
			return { content: [{ type: "text", text: compactCodeIntelOutput("outline", payload) }], details: payload };
		},
	});

	pi.registerTool({
		name: "code_intel_repo_route",
		label: "Code Intelligence Repo Route",
		description: "Rank likely files for concept or API terms using bounded path and literal evidence without dumping raw search output.",
		promptSnippet: "Use when you need to find where a concept is implemented before choosing files to read.",
		promptGuidelines: [
			"Use code_intel_repo_route after broad overview when you have concept terms such as API names, feature names, or function names but no exact anchor file yet.",
			"Scope paths for large repositories; route output ranks files by path and literal evidence, not semantic proof.",
			"Use returned files with code_intel_file_outline, source reads, impact maps, or test maps before making claims.",
		],
		parameters: Type.Object({
			repoRoot: repoRootParam,
			terms: Type.Array(Type.String(), { description: "Concept, API, symbol, or domain terms to route, e.g. ['promql', 'over_time']." }),
			paths: Type.Optional(Type.Array(Type.String(), { description: "Repo-relative files or directories to search. Scope this in large repos." })),
			maxResults: maxResultsParam,
			maxFiles: Type.Optional(Type.Number({ description: "Maximum files to scan before truncating. Default 20000." })),
			maxMatchesPerFile: Type.Optional(Type.Number({ description: "Maximum literal evidence rows per file. Default 5." })),
			timeoutMs: timeoutParam,
		}),
		async execute(_toolCallId: string, params: CodeIntelRepoRouteParams, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			const loadedConfig = loadConfig(ctx);
			const roots = await resolveRepoRoots(ctx, params.repoRoot);
			const payload = await runRepoRoute(params, roots.repoRoot, loadedConfig.config, signal);
			return { content: [{ type: "text", text: compactCodeIntelOutput("route", payload) }], details: payload };
		},
	});

	pi.registerTool({
		name: "code_intel_test_map",
		label: "Code Intelligence Test Map",
		description: "Find evidence-ranked test candidates for a file or symbols using bounded test-root discovery, path/name evidence, and literal matches.",
		promptSnippet: "Use to find likely tests to run or inspect for a scoped file/symbol.",
		promptGuidelines: [
			"Use code_intel_test_map to answer which tests likely exercise this file or symbol; results are candidates, not coverage proof.",
			"Provide path plus symbols or domain names when possible, especially for non-code tests such as SQL fixtures.",
			"Inspect evidence and read candidate tests before claiming coverage or choosing validation commands.",
		],
		parameters: Type.Object({
			repoRoot: repoRootParam,
			path: Type.Optional(Type.String({ description: "Repo-relative source file to find related tests for." })),
			symbols: Type.Optional(Type.Array(Type.String(), { description: "Symbols to use as test search terms." })),
			names: Type.Optional(Type.Array(Type.String(), { description: "Domain names, strings, APIs, table names, or other literals to use as test search terms." })),
			testPaths: Type.Optional(Type.Array(Type.String(), { description: "Explicit repo-relative test directories/files to search. Defaults to discovered test roots." })),
			maxResults: maxResultsParam,
			maxLiteralMatches: Type.Optional(Type.Number({ description: "Maximum literal evidence rows per candidate. Default 5." })),
			confirmReferences: Type.Optional(Type.Union([Type.Literal("gopls"), Type.Literal("typescript"), Type.Literal("clangd")], { description: "Optional exact-reference confirmation for matching source-code tests when applicable." })),
			maxReferenceRoots: Type.Optional(Type.Number({ description: "Maximum roots to confirm when confirmReferences is set." })),
			maxReferenceResults: Type.Optional(Type.Number({ description: "Maximum reference rows returned when confirmReferences is set." })),
			timeoutMs: timeoutParam,
			detail: detailParam,
		}),
		async execute(_toolCallId: string, params: CodeIntelTestMapParams, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			const loadedConfig = loadConfig(ctx);
			const roots = await resolveRepoRoots(ctx, params.repoRoot);
			const payload = await runTestMap(params, roots.repoRoot, loadedConfig.config, signal);
			return { content: [{ type: "text", text: compactCodeIntelOutput("tests", payload) }], details: payload };
		},
	});
}
