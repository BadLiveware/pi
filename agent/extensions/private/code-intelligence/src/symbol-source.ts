import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { CodeIntelConfig, CodeIntelReplaceSymbolParams, CodeIntelSymbolSourceParams, CommandResult, CymbalSymbol } from "./types.ts";
import { commandDiagnostic, findExecutable, parseJson, runCommand, summarizeCommandBrief } from "./exec.ts";
import { ensureInsideRoot, pathArgsForRepo } from "./repo.ts";
import { isRecord, normalizePositiveInteger, normalizeStringArray } from "./util.ts";

type ShowLine = { line?: number; content?: string };
type CymbalShowResult = { file?: string; lines?: ShowLine[]; symbol?: CymbalSymbol };
type CymbalShowPayload = { results?: CymbalShowResult | CymbalShowResult[] | Record<string, CymbalShowResult | CymbalShowResult[]>; version?: string };

type SourceRange = { startLine: number; endLine: number };

const DEFAULT_MAX_SYMBOL_SOURCE_BYTES = 200_000;
const MAX_SYMBOL_SOURCE_BYTES = 2_000_000;

function sha256(text: string): string {
	return `sha256:${crypto.createHash("sha256").update(text).digest("hex")}`;
}

function toRelativeFile(repoRoot: string, absoluteOrRelative: string | undefined): string | undefined {
	if (!absoluteOrRelative) return undefined;
	const resolved = path.isAbsolute(absoluteOrRelative) ? absoluteOrRelative : path.resolve(repoRoot, absoluteOrRelative);
	return path.relative(repoRoot, resolved).split(path.sep).join(path.posix.sep);
}

function normalizeSymbol(symbol: CymbalSymbol | undefined, repoRoot: string): Record<string, unknown> | undefined {
	if (!symbol) return undefined;
	const file = symbol.rel_path ?? toRelativeFile(repoRoot, symbol.file);
	return {
		name: symbol.name,
		kind: symbol.kind,
		file,
		startLine: symbol.start_line,
		endLine: symbol.end_line,
		depth: symbol.depth,
		language: symbol.language,
	};
}

function lineOffsets(text: string): number[] {
	const offsets = [0];
	for (let index = 0; index < text.length; index += 1) {
		if (text[index] === "\n") offsets.push(index + 1);
	}
	return offsets;
}

function rangeOffsets(text: string, range: SourceRange): { startOffset: number; endOffset: number; lineCount: number } {
	if (!Number.isInteger(range.startLine) || !Number.isInteger(range.endLine) || range.startLine < 1 || range.endLine < range.startLine) {
		throw new Error(`Invalid line range ${range.startLine}-${range.endLine}`);
	}
	const offsets = lineOffsets(text);
	if (range.startLine > offsets.length) throw new Error(`Start line ${range.startLine} is beyond file length ${offsets.length}`);
	const startOffset = offsets[range.startLine - 1];
	const endOffset = range.endLine < offsets.length ? offsets[range.endLine] : text.length;
	return { startOffset, endOffset, lineCount: range.endLine - range.startLine + 1 };
}

function extractRange(text: string, range: SourceRange): string {
	const offsets = rangeOffsets(text, range);
	return text.slice(offsets.startOffset, offsets.endOffset);
}

function normalizeReplacementSource(newSource: string, oldSource: string): string {
	if (oldSource.endsWith("\n") && !newSource.endsWith("\n")) return `${newSource}\n`;
	return newSource;
}

function sourceLineCount(source: string): number {
	if (source.length === 0) return 0;
	return source.endsWith("\n") ? source.split("\n").length - 1 : source.split("\n").length;
}

function commandOk(result: CommandResult): boolean {
	return result.exitCode === 0 && !result.error && !result.timedOut && !result.outputTruncated;
}

function showResults(payload: CymbalShowPayload | undefined): CymbalShowResult[] {
	const results = payload?.results;
	if (!results) return [];
	if (Array.isArray(results)) return results.filter(isRecord) as CymbalShowResult[];
	if (isRecord(results) && (Array.isArray(results.lines) || isRecord(results.symbol))) return [results as CymbalShowResult];
	if (isRecord(results)) {
		return Object.values(results).flatMap((value) => Array.isArray(value) ? value.filter(isRecord) as CymbalShowResult[] : isRecord(value) ? [value as CymbalShowResult] : []);
	}
	return [];
}

async function runCymbalShow(symbol: string, repoRoot: string, config: CodeIntelConfig, options: { file?: string; paths?: string[]; timeoutMs: number; signal?: AbortSignal }): Promise<{ ok: boolean; matches: CymbalShowResult[]; command: CommandResult; diagnostic?: string }> {
	const executable = findExecutable("cymbal");
	if (!executable) {
		const command: CommandResult = { command: "cymbal", args: ["--json", "show", "--all", symbol], cwd: repoRoot, exitCode: null, signal: null, stdout: "", stderr: "", timedOut: false, outputTruncated: false, error: "ENOENT" };
		return { ok: false, matches: [], command, diagnostic: "cymbal not found on PATH" };
	}
	const args = ["--json", "show", "--all", symbol];
	const pathFilters = options.file ? [ensureInsideRoot(repoRoot, options.file)] : pathArgsForRepo(repoRoot, options.paths).filter((item) => item !== ".");
	for (const item of pathFilters) args.push("--path", item);
	const command = await runCommand(executable, args, { cwd: repoRoot, timeoutMs: options.timeoutMs, maxOutputBytes: config.maxOutputBytes, signal: options.signal });
	const parsed = parseJson<CymbalShowPayload>(command.stdout);
	return { ok: commandOk(command) && parsed !== undefined, matches: showResults(parsed), command, diagnostic: commandDiagnostic(command) };
}

async function payloadFromMatch(match: CymbalShowResult, repoRoot: string, maxSourceBytes: number): Promise<Record<string, unknown>> {
	const symbol = match.symbol;
	const file = symbol?.rel_path ?? toRelativeFile(repoRoot, symbol?.file ?? match.file);
	if (!file) throw new Error("Cymbal did not return a file for the symbol.");
	const startLine = symbol?.start_line;
	const endLine = symbol?.end_line;
	if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) throw new Error("Cymbal did not return a concrete source range for the symbol.");
	const absoluteFile = path.resolve(repoRoot, ensureInsideRoot(repoRoot, file));
	const fileText = await fs.readFile(absoluteFile, "utf8");
	const range = { startLine: startLine as number, endLine: endLine as number };
	const source = extractRange(fileText, range);
	const sourceTruncated = Buffer.byteLength(source, "utf8") > maxSourceBytes;
	return {
		file,
		resolved: normalizeSymbol(symbol, repoRoot),
		range,
		lineCount: sourceLineCount(source),
		sourceBytes: Buffer.byteLength(source, "utf8"),
		sourceHash: sha256(source),
		source: sourceTruncated ? source.slice(0, maxSourceBytes) : source,
		sourceTruncated,
		preconditions: {
			file,
			expectedRange: range,
			expectedHash: sha256(source),
		},
	};
}

export async function runSymbolSource(params: CodeIntelSymbolSourceParams, repoRoot: string, config: CodeIntelConfig, signal?: AbortSignal): Promise<Record<string, unknown>> {
	const symbol = params.symbol?.trim();
	if (!symbol) throw new Error("code_intel_symbol_source requires a non-empty symbol");
	const timeoutMs = normalizePositiveInteger(params.timeoutMs, config.queryTimeoutMs, 1_000, 600_000);
	const maxSourceBytes = normalizePositiveInteger(params.maxSourceBytes, DEFAULT_MAX_SYMBOL_SOURCE_BYTES, 1_000, MAX_SYMBOL_SOURCE_BYTES);
	const paths = normalizeStringArray(params.paths);
	const response = await runCymbalShow(symbol, repoRoot, config, { file: params.file, paths, timeoutMs, signal });
	const matches = response.matches.map((match) => normalizeSymbol(match.symbol, repoRoot)).filter(Boolean);
	if (!response.ok) {
		return { ok: false, backend: "cymbal", repoRoot, symbol, matches, matchCount: matches.length, command: summarizeCommandBrief(response.command), diagnostic: response.diagnostic, limitations: ["Symbol source depends on Cymbal's best-effort symbol resolution."] };
	}
	if (response.matches.length === 0) {
		return { ok: false, backend: "cymbal", repoRoot, symbol, matches: [], matchCount: 0, reason: "No matching symbol source found.", command: summarizeCommandBrief(response.command), limitations: ["Try constraining file/paths or refreshing the Cymbal index if results look stale."] };
	}
	if (response.matches.length > 1) {
		return { ok: false, backend: "cymbal", repoRoot, symbol, matches, matchCount: matches.length, reason: "Symbol is ambiguous; pass file or paths to select one definition.", command: summarizeCommandBrief(response.command), limitations: ["Ambiguous symbols are not returned as editable source; constrain the query first."] };
	}
	const sourcePayload = await payloadFromMatch(response.matches[0], repoRoot, maxSourceBytes);
	return {
		ok: true,
		backend: "cymbal",
		repoRoot,
		symbol,
		matchCount: 1,
		...sourcePayload,
		command: summarizeCommandBrief(response.command),
		limitations: [
			"Symbol source is a focused source span, not a substitute for caller, import, or surrounding invariant review when those matter.",
			"Use the returned preconditions for guarded replacement; if imports or adjacent declarations matter, read the file and use normal edit.",
		],
	};
}

function normalizeRange(value: unknown): SourceRange | undefined {
	if (!isRecord(value)) return undefined;
	const startLine = value.startLine;
	const endLine = value.endLine;
	if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) return undefined;
	return { startLine: startLine as number, endLine: endLine as number };
}

function sameRange(left: SourceRange, right: SourceRange): boolean {
	return left.startLine === right.startLine && left.endLine === right.endLine;
}

export async function runReplaceSymbol(params: CodeIntelReplaceSymbolParams, repoRoot: string, config: CodeIntelConfig, signal?: AbortSignal): Promise<Record<string, unknown>> {
	const symbol = params.symbol?.trim();
	if (!symbol) throw new Error("code_intel_replace_symbol requires a non-empty symbol");
	if (!params.file?.trim()) throw new Error("code_intel_replace_symbol requires file from code_intel_symbol_source preconditions");
	if (typeof params.newSource !== "string" || params.newSource.length === 0) throw new Error("code_intel_replace_symbol requires non-empty newSource");
	if (typeof params.expectedHash !== "string" || !params.expectedHash.startsWith("sha256:")) throw new Error("code_intel_replace_symbol requires expectedHash from code_intel_symbol_source preconditions");
	const expectedRange = normalizeRange(params.expectedRange);
	if (!expectedRange) throw new Error("code_intel_replace_symbol requires expectedRange { startLine, endLine } from code_intel_symbol_source preconditions");
	const timeoutMs = normalizePositiveInteger(params.timeoutMs, config.queryTimeoutMs, 1_000, 600_000);
	const file = ensureInsideRoot(repoRoot, params.file);
	const absoluteFile = path.resolve(repoRoot, file);

	const before = await runSymbolSource({ symbol, file, timeoutMs, maxSourceBytes: MAX_SYMBOL_SOURCE_BYTES }, repoRoot, config, signal);
	const beforeRange = normalizeRange(before.range);
	if (before.ok !== true || !beforeRange) return { ok: false, backend: "cymbal", repoRoot, symbol, file, phase: "precondition", reason: "Could not resolve current symbol source before replacement.", current: before };
	if (!sameRange(beforeRange, expectedRange)) return { ok: false, backend: "cymbal", repoRoot, symbol, file, phase: "precondition", reason: "Current symbol range does not match expectedRange.", expectedRange, currentRange: beforeRange, currentHash: before.sourceHash };
	if (before.sourceHash !== params.expectedHash) return { ok: false, backend: "cymbal", repoRoot, symbol, file, phase: "precondition", reason: "Current symbol source hash does not match expectedHash.", expectedHash: params.expectedHash, currentHash: before.sourceHash };

	const oldFileText = await fs.readFile(absoluteFile, "utf8");
	const oldSource = extractRange(oldFileText, expectedRange);
	if (sha256(oldSource) !== params.expectedHash) return { ok: false, backend: "cymbal", repoRoot, symbol, file, phase: "precondition", reason: "File range hash does not match expectedHash.", expectedHash: params.expectedHash, currentHash: sha256(oldSource) };
	const replacement = normalizeReplacementSource(params.newSource, oldSource);
	const offsets = rangeOffsets(oldFileText, expectedRange);
	const nextFileText = `${oldFileText.slice(0, offsets.startOffset)}${replacement}${oldFileText.slice(offsets.endOffset)}`;
	await fs.writeFile(absoluteFile, nextFileText, "utf8");

	const post = await runSymbolSource({ symbol, file, timeoutMs, maxSourceBytes: MAX_SYMBOL_SOURCE_BYTES }, repoRoot, config, signal);
	const postRange = normalizeRange(post.range);
	const replacementHash = sha256(replacement);
	const validationProblems: string[] = [];
	if (post.ok !== true || !postRange) validationProblems.push("replacement no longer resolves to the requested symbol");
	else {
		if (postRange.startLine !== expectedRange.startLine) validationProblems.push("replacement changed the symbol start line");
		if (post.sourceHash !== replacementHash) validationProblems.push("resolved symbol source does not exactly match replacement text");
	}
	if (validationProblems.length > 0) {
		await fs.writeFile(absoluteFile, oldFileText, "utf8");
		return {
			ok: false,
			backend: "cymbal",
			repoRoot,
			symbol,
			file,
			phase: "postcondition",
			reverted: true,
			reason: validationProblems.join("; "),
			expectedRange,
			current: post,
			limitations: ["The file was restored because the replacement did not re-resolve as exactly the requested symbol span."],
		};
	}

	return {
		ok: true,
		backend: "cymbal",
		repoRoot,
		symbol,
		file,
		rangeBefore: expectedRange,
		rangeAfter: postRange,
		sourceHashBefore: params.expectedHash,
		sourceHashAfter: replacementHash,
		lineCountBefore: sourceLineCount(oldSource),
		lineCountAfter: sourceLineCount(replacement),
		bytesBefore: Buffer.byteLength(oldSource, "utf8"),
		bytesAfter: Buffer.byteLength(replacement, "utf8"),
		reverted: false,
		validation: {
			resolvedAfterReplacement: true,
			exactReplacementSpan: true,
		},
		limitations: [
			"This guarded edit only replaced one symbol span; it did not update imports, callers, docs, or tests.",
			"Treat success as a file edit, not validation. Run project-native checks and read surrounding context if imports or adjacent invariants matter.",
		],
	};
}
