import * as path from "node:path";
import * as ts from "typescript";
import type { CodeIntelConfig } from "../../types.ts";
import { ensureInsideRoot } from "../../repo.ts";
import { isRecord } from "../../util.ts";

const TS_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);

type DiagnosticProvenance = "supplied" | "collected";

export type NormalizedPostEditDiagnostic = {
	path: string;
	line: number;
	column?: number;
	endLine?: number;
	endColumn?: number;
	severity?: string;
	source?: string;
	code?: string;
	message?: string;
	provenance: DiagnosticProvenance;
	freshness: string;
	baselineStatus: "not-compared";
};

export type DiagnosticCollectionResult = {
	diagnostics: NormalizedPostEditDiagnostic[];
	providerStatuses: Array<Record<string, unknown>>;
	toolDiagnostics: string[];
	limitations: string[];
};

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isTypeScriptLike(file: string): boolean {
	return TS_EXTENSIONS.has(path.extname(file));
}

function diagnosticCode(value: unknown): string | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return `TS${value}`;
	if (typeof value === "string" && value.trim()) return value.trim();
	return undefined;
}

function severityForCategory(category: ts.DiagnosticCategory): string {
	if (category === ts.DiagnosticCategory.Error) return "error";
	if (category === ts.DiagnosticCategory.Warning) return "warning";
	if (category === ts.DiagnosticCategory.Suggestion) return "hint";
	return "info";
}

function messageText(message: string | ts.DiagnosticMessageChain): string {
	return ts.flattenDiagnosticMessageText(message, "\n");
}

export function normalizePostEditDiagnostics(input: unknown, provenance: DiagnosticProvenance = "supplied"): NormalizedPostEditDiagnostic[] {
	if (!Array.isArray(input)) return [];
	const rows: NormalizedPostEditDiagnostic[] = [];
	for (const row of input) {
		if (!isRecord(row)) continue;
		const file = stringValue(row.path) ?? stringValue(row.file);
		const line = numberValue(row.line) ?? numberValue(row.startLine);
		if (!file || !line) continue;
		rows.push({
			path: file,
			line,
			column: numberValue(row.column) ?? numberValue(row.startColumn),
			endLine: numberValue(row.endLine),
			endColumn: numberValue(row.endColumn),
			severity: stringValue(row.severity),
			source: stringValue(row.source),
			code: diagnosticCode(row.code),
			message: stringValue(row.message) ?? stringValue(row.text),
			provenance: stringValue(row.provenance) === "collected" ? "collected" : provenance,
			freshness: stringValue(row.freshness) ?? (provenance === "collected" ? "current-workspace-files" : "caller-supplied"),
			baselineStatus: "not-compared",
		});
	}
	return rows;
}

function configPathForFiles(repoRoot: string, files: string[]): string | undefined {
	for (const file of files) {
		try {
			const safeFile = ensureInsideRoot(repoRoot, file);
			const configPath = ts.findConfigFile(path.dirname(path.resolve(repoRoot, safeFile)), ts.sys.fileExists, "tsconfig.json");
			if (configPath) {
				ensureInsideRoot(repoRoot, configPath);
				return configPath;
			}
		} catch {
			// Try the next touched file, then repo-root discovery.
		}
	}
	const repoConfigPath = ts.findConfigFile(repoRoot, ts.sys.fileExists, "tsconfig.json");
	if (!repoConfigPath) return undefined;
	try {
		ensureInsideRoot(repoRoot, repoConfigPath);
		return repoConfigPath;
	} catch {
		return undefined;
	}
}

function programInputs(repoRoot: string, files: string[]): { rootNames: string[]; options: ts.CompilerOptions; configPath?: string; diagnostics: string[] } {
	const diagnostics: string[] = [];
	const rootNames = files.map((file) => path.resolve(repoRoot, file));
	const configPath = configPathForFiles(repoRoot, files);
	if (configPath) {
		const config = ts.readConfigFile(configPath, ts.sys.readFile);
		if (config.error) diagnostics.push(messageText(config.error.messageText));
		else {
			const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
			diagnostics.push(...parsed.errors.map((diagnostic) => messageText(diagnostic.messageText)));
			return { rootNames, options: { ...parsed.options, allowJs: true, noEmit: true }, configPath, diagnostics };
		}
	}
	return {
		rootNames,
		options: {
			allowJs: true,
			checkJs: false,
			jsx: ts.JsxEmit.Preserve,
			module: ts.ModuleKind.ESNext,
			moduleResolution: ts.ModuleResolutionKind.Node10,
			noEmit: true,
			target: ts.ScriptTarget.ES2022,
		},
		configPath,
		diagnostics,
	};
}

function diagnosticLocation(repoRoot: string, diagnostic: ts.Diagnostic): NormalizedPostEditDiagnostic | undefined {
	if (!diagnostic.file || diagnostic.start === undefined) return undefined;
	let file: string;
	try {
		file = ensureInsideRoot(repoRoot, diagnostic.file.fileName);
	} catch {
		return undefined;
	}
	const start = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
	const end = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start + (diagnostic.length ?? 1));
	return {
		path: file,
		line: start.line + 1,
		column: start.character + 1,
		endLine: end.line + 1,
		endColumn: end.character + 1,
		severity: severityForCategory(diagnostic.category),
		source: "typescript",
		code: diagnosticCode(diagnostic.code),
		message: messageText(diagnostic.messageText),
		provenance: "collected",
		freshness: "current-workspace-files",
		baselineStatus: "not-compared",
	};
}

function dedupeDiagnostics(rows: NormalizedPostEditDiagnostic[]): NormalizedPostEditDiagnostic[] {
	const seen = new Set<string>();
	const output: NormalizedPostEditDiagnostic[] = [];
	for (const row of rows) {
		const key = [row.path, row.line, row.column ?? "", row.endLine ?? "", row.endColumn ?? "", row.severity ?? "", row.source ?? "", row.code ?? "", row.message ?? ""].join("\0");
		if (seen.has(key)) continue;
		seen.add(key);
		output.push(row);
	}
	return output;
}

export async function collectTouchedDiagnostics(repoRoot: string, changedFiles: string[], config: CodeIntelConfig, signal?: AbortSignal): Promise<DiagnosticCollectionResult> {
	const toolDiagnostics: string[] = [];
	const safeFiles = [...new Set(changedFiles.filter(isTypeScriptLike).slice(0, 50))];
	const providerStatuses: Array<Record<string, unknown>> = [{
		provider: "typescript",
		basis: "typescript-language-service-diagnostics",
		available: safeFiles.length > 0 ? "available" : "not-applicable",
		fileCount: safeFiles.length,
		freshness: "current-workspace-files",
		baselineStatus: "not-compared",
	}];
	const limitations = [
		"Collected diagnostics are current TypeScript language-service diagnostics for touched TypeScript/JavaScript files only; they are not a project-wide validation run.",
		"Diagnostics are not baseline-compared yet, so collected rows are current diagnostics in touched files rather than proven-new diagnostics.",
	];
	if (safeFiles.length === 0) return { diagnostics: [], providerStatuses, toolDiagnostics, limitations };
	if (signal?.aborted) return { diagnostics: [], providerStatuses: [{ ...providerStatuses[0], available: "error", diagnostic: "aborted" }], toolDiagnostics: ["TypeScript diagnostic collection aborted"], limitations };

	try {
		const inputs = programInputs(repoRoot, safeFiles);
		toolDiagnostics.push(...inputs.diagnostics.map((diagnostic) => `typescript config: ${diagnostic}`));
		providerStatuses[0] = { ...providerStatuses[0], configPath: inputs.configPath ? ensureInsideRoot(repoRoot, inputs.configPath) : undefined };
		const program = ts.createProgram({ rootNames: inputs.rootNames, options: inputs.options });
		const targetFiles = new Set(safeFiles);
		const rows: NormalizedPostEditDiagnostic[] = [];
		for (const file of safeFiles) {
			if (signal?.aborted) break;
			const absolute = path.resolve(repoRoot, file);
			const sourceFile = program.getSourceFile(absolute);
			if (!sourceFile) {
				toolDiagnostics.push(`typescript: source file not available for ${file}`);
				continue;
			}
			for (const diagnostic of [...program.getSyntacticDiagnostics(sourceFile), ...program.getSemanticDiagnostics(sourceFile)]) {
				const row = diagnosticLocation(repoRoot, diagnostic);
				if (row && targetFiles.has(row.path)) rows.push(row);
			}
		}
		const deduped = dedupeDiagnostics(rows);
		providerStatuses[0] = { ...providerStatuses[0], diagnosticCount: deduped.length };
		return { diagnostics: deduped, providerStatuses, toolDiagnostics, limitations };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			diagnostics: [],
			providerStatuses: [{ ...providerStatuses[0], available: "error", diagnostic: message }],
			toolDiagnostics: [`TypeScript diagnostic collection failed: ${message}`],
			limitations,
		};
	}
}

export function mergeDiagnostics(...groups: NormalizedPostEditDiagnostic[][]): NormalizedPostEditDiagnostic[] {
	return dedupeDiagnostics(groups.flat());
}
