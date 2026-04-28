import * as path from "node:path";
import type {
	CodeIntelConfig,
	CymbalContextPayload,
	CymbalImpactMapParams,
	CymbalListPayload,
	CymbalReferencesParams,
	CymbalSymbol,
	CymbalSymbolContextParams,
	CommandResult,
	ResultDetail,
} from "./types.ts";
import { commandDiagnostic, findExecutable, parseJson, runCommand, summarizeCommandBrief } from "./exec.ts";
import { changedFilesFromBase, ensureInsideRoot, pathArgsForRepo } from "./repo.ts";
import { isRecord, normalizePositiveInteger, normalizeStringArray, summarizeFileDistribution } from "./util.ts";

const IMPACT_DEFAULT_MAX_RESULTS = 25;
const IMPACT_DEFAULT_MAX_ROOT_SYMBOLS = 20;
const IMPACT_CONTEXT_LINES = 2;
const IMPACT_CONTEXT_LINE_CHARS = 160;

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

function truncateText(text: string, maxChars: number): string {
	return text.length > maxChars ? `${text.slice(0, Math.max(0, maxChars - 1))}…` : text;
}

function compactImpactRecord(record: Record<string, unknown>): Record<string, unknown> {
	const compact = { ...record };
	delete compact.absoluteFile;
	delete compact.rel_path;
	if (Array.isArray(compact.context)) compact.context = compact.context.slice(0, IMPACT_CONTEXT_LINES).map((line) => typeof line === "string" ? truncateText(line, IMPACT_CONTEXT_LINE_CHARS) : line);
	for (const key of ["source", "text", "snippet"] as const) {
		if (typeof compact[key] === "string") compact[key] = truncateText(compact[key], IMPACT_CONTEXT_LINE_CHARS);
	}
	return compact;
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
		limitations: ["Cymbal context is best-effort routing evidence; verify important details in source."],
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
	const results = rows.map((row) => applyLocationDetail(normalizeCymbalLocation(row, repoRoot), detail)).slice(0, maxResults);
	return {
		ok: response.ok || (response.result.exitCode === 0 && rows.length === 0),
		backend: "cymbal",
		repoRoot,
		query,
		relation,
		detail,
		results,
		summary: {
			...summarizeFileDistribution(results),
			basis: "returnedRows",
		},
		matchCount: rows.length,
		returned: results.length,
		truncated: response.result.outputTruncated || rows.length > results.length,
		command: summarizeCommandBrief(response.result),
		diagnostic: response.diagnostic,
		limitations: ["Reference results are index-supported routing evidence, not proof of complete usage."],
	};
}

async function outlineFile(repoRoot: string, file: string, config: CodeIntelConfig, timeoutMs: number, signal?: AbortSignal): Promise<{ symbols: CymbalSymbol[]; diagnostic?: string }> {
	const response = await runCymbalJson<CymbalListPayload<CymbalSymbol>>(repoRoot, ["outline", file], config, timeoutMs, signal);
	return { symbols: Array.isArray(response.parsed?.results) ? response.parsed.results : [], diagnostic: response.diagnostic };
}

export async function runImpactMap(params: CymbalImpactMapParams, repoRoot: string, config: CodeIntelConfig, signal?: AbortSignal): Promise<Record<string, unknown>> {
	const maxResults = normalizePositiveInteger(params.maxResults, Math.min(config.maxResults, IMPACT_DEFAULT_MAX_RESULTS), 1, 500);
	const maxDepth = normalizePositiveInteger(params.maxDepth, 2, 1, 5);
	const maxRootSymbols = normalizePositiveInteger(params.maxRootSymbols, IMPACT_DEFAULT_MAX_ROOT_SYMBOLS, 1, 500);
	const timeoutMs = normalizePositiveInteger(params.timeoutMs, config.queryTimeoutMs, 1_000, 600_000);
	const detail: ResultDetail = params.detail === "snippets" ? "snippets" : "locations";
	const diagnostics: string[] = [];
	const base = await changedFilesFromBase(repoRoot, params.baseRef, config.queryTimeoutMs, config.maxOutputBytes);
	if (base.diagnostic) diagnostics.push(base.diagnostic);
	const changedFiles = [...new Set([...normalizeStringArray(params.changedFiles), ...base.files])];
	const roots: Record<string, unknown>[] = [];
	const rootNames: string[] = [];
	const discoveredRootNames = new Set<string>();
	const addRoot = (symbolName: string | undefined, root: Record<string, unknown>) => {
		if (!symbolName || discoveredRootNames.has(symbolName)) return;
		discoveredRootNames.add(symbolName);
		if (rootNames.length >= maxRootSymbols) return;
		rootNames.push(symbolName);
		roots.push(compactImpactRecord(root));
	};
	for (const symbol of normalizeStringArray(params.symbols)) addRoot(symbol, { kind: "queried_symbol", symbol });
	for (const file of changedFiles) {
		let safeFile: string;
		try {
			safeFile = ensureInsideRoot(repoRoot, file);
		} catch (error) {
			diagnostics.push(error instanceof Error ? error.message : String(error));
			continue;
		}
		const outline = await outlineFile(repoRoot, safeFile, config, timeoutMs, signal);
		if (outline.diagnostic) diagnostics.push(outline.diagnostic);
		for (const symbol of outline.symbols) {
			const normalized = normalizeCymbalSymbol(symbol, repoRoot);
			if (!normalized || typeof symbol.name !== "string") continue;
			addRoot(symbol.name, { kind: "changed_file_symbol", ...normalized, reason: `symbol defined in changed file ${safeFile}` });
		}
	}
	if (rootNames.length === 0) {
		return { ok: false, backend: "cymbal", repoRoot, roots, related: [], diagnostics, reason: "No symbols or changed-file symbols were available for impact mapping." };
	}
	const usedNames = rootNames;
	const response = await runCymbalJson<CymbalListPayload<unknown>>(repoRoot, ["impact", ...usedNames, "-D", String(maxDepth), "-n", String(maxResults)], config, timeoutMs, signal);
	if (response.diagnostic) diagnostics.push(response.diagnostic);
	const rows = cymbalResultRows(response.parsed);
	const related = rows.map((row) => {
		const normalized = applyLocationDetail(compactImpactRecord(normalizeCymbalLocation(row, repoRoot)), detail);
		const hitSymbols = isRecord(row) && Array.isArray(row.hit_symbols) ? row.hit_symbols : undefined;
		const symbol = isRecord(row) && typeof row.symbol === "string" ? row.symbol : undefined;
		return { kind: "caller", reason: `calls impacted symbol ${symbol ?? (hitSymbols ? hitSymbols.join(", ") : "(unknown)")}`, ...normalized };
	}).slice(0, maxResults);
	return {
		ok: response.ok,
		backend: "cymbal",
		repoRoot,
		detail,
		roots,
		rootSymbols: usedNames,
		related,
		summary: {
			rootFileCount: summarizeFileDistribution(roots).fileCount,
			relatedFileCount: summarizeFileDistribution(related).fileCount,
			topRelatedFiles: summarizeFileDistribution(related).topFiles,
			basis: "returnedRows",
		},
		coverage: {
			backendsUsed: ["cymbal"],
			truncated: response.result.outputTruncated || rows.length > related.length || discoveredRootNames.size > usedNames.length,
			rootSymbolsDiscovered: discoveredRootNames.size,
			rootSymbolsUsed: usedNames.length,
			defaultMaxResults: IMPACT_DEFAULT_MAX_RESULTS,
			defaultMaxRootSymbols: IMPACT_DEFAULT_MAX_ROOT_SYMBOLS,
			limitations: ["Impact maps are index-supported routing evidence, not proof of complete blast radius."],
		}, 
		diagnostics,
		command: summarizeCommandBrief(response.result),
	};
}
