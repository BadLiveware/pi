import * as fs from "node:fs";
import * as path from "node:path";
import type { CodeIntelConfig } from "./types.ts";
import { commandDiagnostic, findExecutable, runCommand } from "./exec.ts";
import { ensureInsideRoot } from "./repo.ts";
import { isRecord, normalizePositiveInteger, summarizeFileDistribution } from "./util.ts";

interface RootLike {
	name: string;
	file: string;
	line: number;
	column: number;
	language?: string;
	kind?: string;
}

interface GoplsConfirmationOptions {
	maxRoots?: number;
	maxResults?: number;
	timeoutMs?: number;
	includeDeclarations?: boolean;
}

function asRoot(value: unknown): RootLike | undefined {
	if (!isRecord(value)) return undefined;
	const name = typeof value.name === "string" ? value.name : typeof value.symbol === "string" ? value.symbol : undefined;
	const file = typeof value.file === "string" ? value.file : undefined;
	const line = typeof value.line === "number" ? value.line : undefined;
	if (!name || !file || !line || line <= 0) return undefined;
	return {
		name,
		file,
		line,
		column: typeof value.column === "number" && value.column > 0 ? value.column : 1,
		language: typeof value.language === "string" ? value.language : undefined,
		kind: typeof value.kind === "string" ? value.kind : undefined,
	};
}

function symbolColumn(repoRoot: string, root: RootLike): number {
	try {
		const safeFile = ensureInsideRoot(repoRoot, root.file);
		const absoluteFile = path.resolve(repoRoot, safeFile);
		const line = fs.readFileSync(absoluteFile, "utf-8").split(/\r?\n/)[root.line - 1];
		if (!line) return root.column;
		const index = line.indexOf(root.name);
		return index >= 0 ? index + 1 : root.column;
	} catch {
		return root.column;
	}
}

function parseGoplsReferenceLine(repoRoot: string, line: string): Record<string, unknown> | undefined {
	const match = /^(.*):(\d+):(\d+)(?:-(\d+))?$/.exec(line.trim());
	if (!match) return undefined;
	const absoluteFile = path.isAbsolute(match[1]) ? match[1] : path.resolve(repoRoot, match[1]);
	let file: string;
	try {
		file = ensureInsideRoot(repoRoot, absoluteFile);
	} catch {
		return undefined;
	}
	return {
		file,
		line: Number(match[2]),
		column: Number(match[3]),
		endColumn: match[4] ? Number(match[4]) : undefined,
	};
}

export async function runGoplsReferenceConfirmation(roots: unknown[], repoRoot: string, options: GoplsConfirmationOptions, config: CodeIntelConfig, signal?: AbortSignal): Promise<Record<string, unknown>> {
	const started = Date.now();
	const executable = findExecutable("gopls");
	const maxRoots = normalizePositiveInteger(options.maxRoots, 5, 1, 50);
	const maxResults = normalizePositiveInteger(options.maxResults, Math.min(config.maxResults, 25), 1, 500);
	const timeoutMs = normalizePositiveInteger(options.timeoutMs, config.queryTimeoutMs, 1_000, 600_000);
	const diagnostics: string[] = [];
	if (!executable) {
		return {
			ok: false,
			backend: "gopls",
			basis: "lspExactReferences",
			references: [],
			diagnostics: ["gopls not found on PATH"],
			limitations: ["gopls confirmation is opt-in and only runs for Go roots with current-source definition locations."],
			elapsedMs: Date.now() - started,
		};
	}

	const candidateRoots = roots.map(asRoot).filter((root): root is RootLike => root !== undefined && (root.language === undefined || root.language === "go"));
	const goRoots = candidateRoots.slice(0, maxRoots);
	if (goRoots.length === 0) {
		return {
			ok: false,
			backend: "gopls",
			basis: "lspExactReferences",
			references: [],
			diagnostics: ["No Go roots with current-source definition locations were available for gopls confirmation."],
			limitations: ["gopls confirmation is opt-in and only runs for Go roots with current-source definition locations."],
			elapsedMs: Date.now() - started,
		};
	}

	const confirmedRoots: Record<string, unknown>[] = [];
	const references: Record<string, unknown>[] = [];
	for (const root of goRoots) {
		if (references.length >= maxResults) break;
		let safeFile: string;
		try {
			safeFile = ensureInsideRoot(repoRoot, root.file);
		} catch (error) {
			diagnostics.push(`${root.name}: ${error instanceof Error ? error.message : String(error)}`);
			continue;
		}
		const column = symbolColumn(repoRoot, { ...root, file: safeFile });
		const position = `${safeFile}:${root.line}:${column}`;
		const args = ["references", ...(options.includeDeclarations === true ? ["-d"] : []), position];
		const result = await runCommand(executable, args, { cwd: repoRoot, timeoutMs, maxOutputBytes: Math.min(config.maxOutputBytes, 500_000), signal });
		const diagnostic = commandDiagnostic(result);
		confirmedRoots.push({ symbol: root.name, file: safeFile, line: root.line, column, kind: root.kind, position });
		if (diagnostic) {
			diagnostics.push(`${root.name}: ${diagnostic}`);
			continue;
		}
		for (const outputLine of result.stdout.split(/\r?\n/)) {
			if (references.length >= maxResults) break;
			const reference = parseGoplsReferenceLine(repoRoot, outputLine);
			if (!reference) continue;
			references.push({ ...reference, rootSymbol: root.name, evidence: "gopls:references" });
		}
	}

	return {
		ok: diagnostics.length === 0,
		backend: "gopls",
		basis: "lspExactReferences",
		executable,
		includeDeclarations: options.includeDeclarations === true,
		roots: confirmedRoots,
		references,
		summary: {
			rootCount: confirmedRoots.length,
			referenceCount: references.length,
			...summarizeFileDistribution(references),
		},
		coverage: {
			candidateRoots: candidateRoots.length,
			maxRoots,
			maxResults,
			truncated: candidateRoots.length > confirmedRoots.length || references.length >= maxResults,
		},
		diagnostics,
		limitations: [
			"gopls confirmation is opt-in and only runs for Go roots with current-source definition locations.",
			"The default routing map remains Tree-sitter syntax evidence; read the returned files before making compatibility or defect claims.",
		],
		elapsedMs: Date.now() - started,
	};
}
