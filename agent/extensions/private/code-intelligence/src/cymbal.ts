import * as path from "node:path";
import type {
	CodeIntelConfig,
	CymbalContextPayload,
	CymbalListPayload,
	CymbalReferencesParams,
	CymbalSymbol,
	CymbalSymbolContextParams,
	CommandResult,
	ResultDetail,
} from "./types.ts";
import { commandDiagnostic, findExecutable, parseJson, runCommand, summarizeCommandBrief } from "./exec.ts";
import { pathArgsForRepo } from "./repo.ts";
import { isRecord, normalizePositiveInteger, normalizeStringArray, summarizeFileDistribution } from "./util.ts";

function normalizeCymbalSymbol(symbol: CymbalSymbol | undefined, repoRoot: string): Record<string, unknown> | undefined {
	if (!symbol) return undefined;
	const file = symbol.rel_path ?? (symbol.file ? path.relative(repoRoot, symbol.file).split(path.sep).join(path.posix.sep) : undefined);
	return {
		name: symbol.name,
		kind: symbol.kind,
		file,
		absoluteFile: symbol.file,
		startLine: symbol.start_line,
		endLine: symbol.end_line,
		depth: symbol.depth,
		language: symbol.language,
	};
}

function normalizeCymbalLocation(row: unknown, repoRoot: string): Record<string, unknown> {
	if (!isRecord(row)) return { value: row };
	const fileValue = typeof row.file === "string" ? row.file : undefined;
	const relPath = typeof row.rel_path === "string" ? row.rel_path : fileValue ? path.relative(repoRoot, fileValue).split(path.sep).join(path.posix.sep) : undefined;
	return {
		...row,
		file: relPath,
		absoluteFile: fileValue,
		rel_path: undefined,
	};
}

function normalizeCymbalTextMatch(row: unknown, repoRoot: string, detail: ResultDetail): Record<string, unknown> {
	const normalized = normalizeCymbalLocation(row, repoRoot);
	const compact: Record<string, unknown> = { ...normalized, kind: "text_fallback" };
	if (isRecord(row) && typeof row.snippet === "string") compact.text = row.snippet;
	return applyLocationDetail(compact, detail);
}

async function runTextReferenceFallback(params: CymbalReferencesParams, query: string, repoRoot: string, config: CodeIntelConfig, maxResults: number, timeoutMs: number, detail: ResultDetail, signal?: AbortSignal): Promise<Record<string, unknown>> {
	const args = ["search", "--text", query, ...pathArgsForRepo(repoRoot, params.paths), "-n", String(maxResults)];
	for (const item of normalizeStringArray(params.excludeGlobs)) args.push("--exclude", item);
	const response = await runCymbalJson<CymbalListPayload<unknown>>(repoRoot, args, config, timeoutMs, signal);
	const rows = cymbalResultRows(response.parsed);
	const matches = rows.map((row) => normalizeCymbalTextMatch(row, repoRoot, detail)).slice(0, maxResults);
	return {
		used: true,
		ok: response.ok || response.result.exitCode === 0,
		reason: "cymbal refs returned no symbol references; used cymbal search --text for possible field/property/literal usages.",
		matches,
		matchCount: rows.length,
		returned: matches.length,
		truncated: response.result.outputTruncated || rows.length > matches.length,
		command: summarizeCommandBrief(response.result),
		diagnostic: response.diagnostic,
	};
}

function applyLocationDetail(record: Record<string, unknown>, detail: ResultDetail): Record<string, unknown> {
	const compact = { ...record };
	delete compact.absoluteFile;
	delete compact.rel_path;
	if (detail === "locations") {
		delete compact.context;
		delete compact.source;
		delete compact.text;
		delete compact.snippet;
		delete compact.lines;
	}
	return compact;
}

function cymbalOk(result: CommandResult): boolean {
	return result.exitCode === 0 && !result.error && !result.timedOut && !result.outputTruncated;
}

function cymbalResultRows(parsed: unknown): unknown[] {
	if (!isRecord(parsed)) return [];
	const results = parsed.results;
	if (Array.isArray(results)) return results;
	if (!isRecord(results) || !Array.isArray(results.results)) return [];
	return results.results.map((item) => {
		if (!isRecord(item) || !isRecord(item.row)) return item;
		return { ...item.row, hit_symbols: item.hit_symbols };
	});
}

async function runCymbalJson<T>(repoRoot: string, args: string[], config: CodeIntelConfig, timeoutMs?: number, signal?: AbortSignal): Promise<{ ok: boolean; parsed?: T; result: CommandResult; diagnostic?: string }> {
	const executable = findExecutable("cymbal");
	if (!executable) {
		const result: CommandResult = { command: "cymbal", args, cwd: repoRoot, exitCode: null, signal: null, stdout: "", stderr: "", timedOut: false, outputTruncated: false, error: "ENOENT" };
		return { ok: false, result, diagnostic: "cymbal not found on PATH" };
	}
	const result = await runCommand(executable, ["--json", ...args], { cwd: repoRoot, timeoutMs: timeoutMs ?? config.queryTimeoutMs, maxOutputBytes: config.maxOutputBytes, signal });
	const parsed = parseJson<T>(result.stdout);
	return { ok: cymbalOk(result) && parsed !== undefined, parsed, result, diagnostic: commandDiagnostic(result) };
}

export async function runSymbolContext(params: CymbalSymbolContextParams, repoRoot: string, config: CodeIntelConfig, signal?: AbortSignal): Promise<Record<string, unknown>> {
	const symbol = params.symbol?.trim();
	if (!symbol) throw new Error("code_intel_symbol_context requires a non-empty symbol");
	const maxCallers = normalizePositiveInteger(params.maxCallers, config.maxResults, 1, 500);
	const timeoutMs = normalizePositiveInteger(params.timeoutMs, config.queryTimeoutMs, 1_000, 600_000);
	const response = await runCymbalJson<CymbalContextPayload>(repoRoot, ["context", symbol, "-n", String(maxCallers)], config, timeoutMs, signal);
	const result = response.parsed?.results;
	return {
		ok: response.ok,
		backend: "cymbal",
		repoRoot,
		symbol,
		resolved: normalizeCymbalSymbol(result?.symbol, repoRoot),
		source: result?.source,
		callers: Array.isArray(result?.callers) ? result.callers.map((caller) => normalizeCymbalLocation(caller, repoRoot)) : [],
		typeReferences: result?.type_refs ?? [],
		fileImports: result?.file_imports ?? [],
		matches: Array.isArray(result?.matches) ? result.matches.map((match) => normalizeCymbalSymbol(match, repoRoot)) : [],
		matchCount: result?.match_count ?? 0,
		command: summarizeCommandBrief(response.result),
		diagnostic: response.diagnostic,
		limitations: ["Cymbal context is best-effort routing evidence; caller rows are callsites and backend row names may repeat the target symbol; verify enclosing functions in source when that matters."],
	};
}

export async function runReferences(params: CymbalReferencesParams, repoRoot: string, config: CodeIntelConfig, signal?: AbortSignal): Promise<Record<string, unknown>> {
	const query = params.query?.trim();
	if (!query) throw new Error("code_intel_references requires a non-empty query");
	const relation = params.relation ?? "refs";
	const maxResults = normalizePositiveInteger(params.maxResults, config.maxResults, 1, 500);
	const depth = normalizePositiveInteger(params.depth, 2, 1, 5);
	const timeoutMs = normalizePositiveInteger(params.timeoutMs, config.queryTimeoutMs, 1_000, 600_000);
	const detail: ResultDetail = params.detail === "snippets" ? "snippets" : "locations";
	const args: string[] = [];
	if (relation === "refs" || relation === "callers") {
		args.push("refs", query, "-n", String(maxResults));
		for (const item of pathArgsForRepo(repoRoot, params.paths).filter((item) => item !== ".")) args.push("--path", item);
		for (const item of normalizeStringArray(params.excludeGlobs)) args.push("--exclude", item);
	} else if (relation === "callees") {
		args.push("trace", query, "--depth", String(depth), "-n", String(maxResults));
	} else if (relation === "impact") {
		args.push("impact", query, "-D", String(depth), "-n", String(maxResults));
	} else if (relation === "implementers") {
		args.push("impls", query, "-n", String(maxResults));
	} else if (relation === "implementedBy") {
		args.push("impls", "--of", query, "-n", String(maxResults));
	} else {
		args.push("importers", query, "-D", String(Math.min(depth, 3)), "-n", String(maxResults));
	}
	const response = await runCymbalJson<CymbalListPayload<unknown>>(repoRoot, args, config, timeoutMs, signal);
	const rows = cymbalResultRows(response.parsed);
	let results = rows.map((row) => applyLocationDetail(normalizeCymbalLocation(row, repoRoot), detail)).slice(0, maxResults);
	const fallback = relation === "refs" && rows.length === 0 ? await runTextReferenceFallback(params, query, repoRoot, config, maxResults, timeoutMs, detail, signal) : undefined;
	if (results.length === 0 && Array.isArray(fallback?.matches) && fallback.matches.length > 0) {
		results = fallback.matches.filter(isRecord).slice(0, maxResults);
	}
	const usedFallback = fallback !== undefined && results.length > 0;
	return {
		ok: response.ok || (response.result.exitCode === 0 && rows.length === 0) || fallback?.ok === true,
		backend: "cymbal",
		backends: ["cymbal"],
		repoRoot,
		query,
		relation,
		detail,
		results,
		summary: {
			...summarizeFileDistribution(results),
			basis: usedFallback ? "textFallbackRows" : "returnedRows",
		},
		matchCount: usedFallback ? fallback?.matchCount ?? results.length : rows.length,
		symbolMatchCount: rows.length,
		returned: results.length,
		truncated: response.result.outputTruncated || rows.length > results.length || fallback?.truncated === true,
		fallback,
		command: summarizeCommandBrief(response.result),
		diagnostic: response.diagnostic,
		limitations: [
			"Reference results are index-supported routing evidence, not exact references or proof of complete usage.",
			...(usedFallback ? ["Rows marked kind=text_fallback come from Cymbal text search, not symbol-resolved references; read returned files before treating them as code relationships."] : []),
		],
	};
}
