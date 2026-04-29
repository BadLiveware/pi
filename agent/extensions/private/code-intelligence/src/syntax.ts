import * as path from "node:path";
import type { AstGrepMatch, CodeIntelConfig, CodeIntelSyntaxSearchParams, CommandResult, ResultDetail } from "./types.ts";
import { findExecutable, parseJson, runCommand, summarizeCommand } from "./exec.ts";
import { pathArgsForRepo } from "./repo.ts";
import { normalizePositiveInteger, normalizeStringArray, summarizeFileDistribution } from "./util.ts";

function normalizeAstGrepMetaVariables(input: AstGrepMatch["metaVariables"]): Record<string, unknown> | undefined {
	if (!input) return undefined;
	const single: Record<string, string> = {};
	for (const [name, value] of Object.entries(input.single ?? {})) {
		if (typeof value?.text === "string") single[name] = value.text;
	}
	const multi: Record<string, string[]> = {};
	for (const [name, values] of Object.entries(input.multi ?? {})) {
		if (Array.isArray(values)) multi[name] = values.map((value) => value.text).filter((text): text is string => typeof text === "string");
	}
	const output: Record<string, unknown> = {};
	if (Object.keys(single).length > 0) output.single = single;
	if (Object.keys(multi).length > 0) output.multi = multi;
	return Object.keys(output).length > 0 ? output : undefined;
}

function normalizeAstGrepMatch(match: AstGrepMatch, repoRoot: string, detail: ResultDetail): Record<string, unknown> {
	const rawFile = typeof match.file === "string" ? match.file : "";
	const absoluteFile = rawFile ? path.resolve(repoRoot, rawFile) : undefined;
	const relativeFile = absoluteFile ? path.relative(repoRoot, absoluteFile).split(path.sep).join(path.posix.sep) : rawFile;
	const start = match.range?.start;
	const end = match.range?.end;
	const output: Record<string, unknown> = {
		file: relativeFile,
		line: typeof start?.line === "number" ? start.line + 1 : undefined,
		column: typeof start?.column === "number" ? start.column + 1 : undefined,
		endLine: typeof end?.line === "number" ? end.line + 1 : undefined,
		endColumn: typeof end?.column === "number" ? end.column + 1 : undefined,
		language: match.language,
	};
	if (detail === "snippets") {
		output.text = match.text;
		output.snippet = match.lines;
		output.metaVariables = normalizeAstGrepMetaVariables(match.metaVariables);
	}
	return output;
}

function syntaxSearchOk(result: CommandResult, parsed: unknown): boolean {
	if (result.error || result.timedOut || result.outputTruncated) return false;
	if (result.exitCode === 0) return true;
	return result.exitCode === 1 && Array.isArray(parsed);
}

export async function runSyntaxSearch(params: CodeIntelSyntaxSearchParams, repoRoot: string, config: CodeIntelConfig, signal?: AbortSignal): Promise<Record<string, unknown>> {
	const pattern = params.pattern?.trim();
	if (!pattern) throw new Error("code_intel_syntax_search requires a non-empty pattern");
	const executable = findExecutable("ast-grep");
	if (!executable) return { ok: false, backend: "ast-grep", repoRoot, reason: "ast-grep not found on PATH", matches: [], truncated: false };
	const maxResults = normalizePositiveInteger(params.maxResults, config.maxResults, 1, 500);
	const timeoutMs = normalizePositiveInteger(params.timeoutMs, config.queryTimeoutMs, 1_000, 600_000);
	const detail: ResultDetail = params.detail === "locations" ? "locations" : "snippets";
	const args = ["run", "--json=compact", "--pattern", pattern];
	if (params.language?.trim()) args.push("--lang", params.language.trim());
	if (params.selector?.trim()) args.push("--selector", params.selector.trim());
	if (params.strictness) args.push("--strictness", params.strictness);
	for (const glob of normalizeStringArray(params.includeGlobs)) args.push("--globs", glob);
	for (const glob of normalizeStringArray(params.excludeGlobs)) args.push("--globs", glob.startsWith("!") ? glob : `!${glob}`);
	args.push(...pathArgsForRepo(repoRoot, params.paths));
	const result = await runCommand(executable, args, { cwd: repoRoot, timeoutMs, maxOutputBytes: config.maxOutputBytes, signal });
	const parsed = parseJson<AstGrepMatch[]>(result.stdout);
	const allMatches = Array.isArray(parsed) ? parsed.map((match) => normalizeAstGrepMatch(match, repoRoot, detail)) : [];
	const matches = allMatches.slice(0, maxResults);
	const ok = syntaxSearchOk(result, parsed);
	return {
		ok,
		backend: "ast-grep",
		repoRoot,
		pattern,
		detail,
		language: params.language,
		paths: pathArgsForRepo(repoRoot, params.paths),
		includeGlobs: normalizeStringArray(params.includeGlobs),
		excludeGlobs: normalizeStringArray(params.excludeGlobs),
		selector: params.selector?.trim() || undefined,
		matchCount: allMatches.length,
		returned: matches.length,
		truncated: result.outputTruncated || allMatches.length > matches.length,
		summary: {
			...summarizeFileDistribution(allMatches),
			returnedFileCount: summarizeFileDistribution(matches).fileCount,
			basis: "allMatches",
		},
		matches,
		command: summarizeCommand(result),
		limitations: ["Syntax search matches are current-source AST candidates, not semantic references, proof of a bug, or complete impact."],
	};
}
