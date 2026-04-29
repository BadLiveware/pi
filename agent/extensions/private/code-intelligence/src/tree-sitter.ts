import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import type { CodeIntelConfig, CodeIntelSyntaxSearchParams, ResultDetail } from "./types.ts";
import { ensureInsideRoot } from "./repo.ts";
import { normalizePositiveInteger, normalizeStringArray, summarizeFileDistribution } from "./util.ts";

const EXCLUDED_DIRS = new Set([".git", ".hg", ".svn", "node_modules", "vendor", "dist", "build", "target", ".cache"]);
const IMPACT_LANGUAGES = ["go", "typescript", "tsx", "javascript", "python"];
const IMPACT_LANGUAGE_SET = new Set(IMPACT_LANGUAGES);

interface TreeSitterPoint {
	row: number;
	column: number;
}

export interface TreeSitterNode {
	type: string;
	startIndex: number;
	endIndex: number;
	startPosition: TreeSitterPoint;
	endPosition: TreeSitterPoint;
	namedChildCount: number;
	namedChild(index: number): TreeSitterNode | null;
	childForFieldName?(name: string): TreeSitterNode | null;
}

interface LanguageSpec {
	id: string;
	wasm: string;
	extensions: string[];
}

interface ParserBundle {
	parser: any;
	language: any;
	spec: LanguageSpec;
	Query?: any;
}

interface ParsedFile {
	file: string;
	absoluteFile: string;
	source: string;
	sourceLines?: string[];
	language: string;
	root: TreeSitterNode;
	bundle: ParserBundle;
}

interface SymbolRecord {
	kind: string;
	name: string;
	file: string;
	language?: string;
	line: number;
	column: number;
	endLine: number;
	endColumn: number;
	text?: string;
	owner?: string;
	type?: string;
	symbol?: string;
	reason?: string;
	evidence?: string;
	rootSymbol?: string;
	inFunction?: string;
	metaVariables?: Record<string, unknown>;
	snippet?: string;
	exported?: boolean;
}

export interface TreeSitterImpactParams {
	symbols?: string[];
	changedFiles?: string[];
	paths?: string[];
	maxRootSymbols: number;
	maxResults: number;
	timeoutMs: number;
	detail: ResultDetail;
}

export interface TreeSitterSelectorBatchParams {
	names: string[];
	language: string;
	paths?: string[];
	maxPerName: number;
	timeoutMs: number;
	detail: ResultDetail;
}

const LANGUAGE_SPECS: LanguageSpec[] = [
	{ id: "go", wasm: "tree-sitter-go.wasm", extensions: [".go"] },
	{ id: "typescript", wasm: "tree-sitter-typescript.wasm", extensions: [".ts", ".mts", ".cts"] },
	{ id: "tsx", wasm: "tree-sitter-tsx.wasm", extensions: [".tsx"] },
	{ id: "javascript", wasm: "tree-sitter-javascript.wasm", extensions: [".js", ".mjs", ".cjs", ".jsx"] },
	{ id: "rust", wasm: "tree-sitter-rust.wasm", extensions: [".rs"] },
	{ id: "python", wasm: "tree-sitter-python.wasm", extensions: [".py"] },
	{ id: "java", wasm: "tree-sitter-java.wasm", extensions: [".java"] },
	{ id: "cpp", wasm: "tree-sitter-cpp.wasm", extensions: [".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".hxx"] },
	{ id: "csharp", wasm: "tree-sitter-c-sharp.wasm", extensions: [".cs"] },
	{ id: "ruby", wasm: "tree-sitter-ruby.wasm", extensions: [".rb"] },
	{ id: "php", wasm: "tree-sitter-php.wasm", extensions: [".php"] },
	{ id: "bash", wasm: "tree-sitter-bash.wasm", extensions: [".sh", ".bash", ".zsh"] },
	{ id: "css", wasm: "tree-sitter-css.wasm", extensions: [".css"] },
];

const LANGUAGE_ALIASES = new Map<string, string>([
	["golang", "go"],
	["ts", "typescript"],
	["typescript", "typescript"],
	["tsx", "tsx"],
	["js", "javascript"],
	["jsx", "javascript"],
	["javascript", "javascript"],
	["rust", "rust"],
	["rs", "rust"],
	["python", "python"],
	["py", "python"],
	["java", "java"],
	["c", "cpp"],
	["cpp", "cpp"],
	["c++", "cpp"],
	["csharp", "csharp"],
	["c#", "csharp"],
	["ruby", "ruby"],
	["rb", "ruby"],
	["php", "php"],
	["bash", "bash"],
	["sh", "bash"],
	["css", "css"],
]);

function languageSpec(language: string): LanguageSpec | undefined {
	const normalized = LANGUAGE_ALIASES.get(language.trim().toLowerCase()) ?? language.trim().toLowerCase();
	return LANGUAGE_SPECS.find((spec) => spec.id === normalized);
}

let initPromise: Promise<any> | undefined;
const parserPromises = new Map<string, Promise<ParserBundle>>();

async function loadTreeSitter(): Promise<{ module: any; wasmDir: string }> {
	if (!initPromise) {
		initPromise = (async () => {
			const require = createRequire(import.meta.url);
			const packageJson = require.resolve("@vscode/tree-sitter-wasm/package.json");
			const wasmDir = path.join(path.dirname(packageJson), "wasm");
			const module = await import("@vscode/tree-sitter-wasm");
			const treeSitter: any = (module as any).default ?? module;
			await treeSitter.Parser.init({ locateFile: (scriptName: string) => path.join(wasmDir, scriptName) });
			return { module: treeSitter, wasmDir };
		})();
	}
	return initPromise;
}

async function parserFor(spec: LanguageSpec): Promise<ParserBundle> {
	const existing = parserPromises.get(spec.id);
	if (existing) return existing;
	const promise = (async () => {
		const loaded = await loadTreeSitter();
		const language = await loaded.module.Language.load(path.join(loaded.wasmDir, spec.wasm));
		const parser = new loaded.module.Parser();
		parser.setLanguage(language);
		return { parser, language, spec, Query: loaded.module.Query };
	})();
	parserPromises.set(spec.id, promise);
	return promise;
}

export function nodeText(source: string, node: TreeSitterNode): string {
	return source.slice(node.startIndex, node.endIndex);
}

function location(node: TreeSitterNode): Pick<SymbolRecord, "line" | "column" | "endLine" | "endColumn"> {
	return {
		line: node.startPosition.row + 1,
		column: node.startPosition.column + 1,
		endLine: node.endPosition.row + 1,
		endColumn: node.endPosition.column + 1,
	};
}

function namedChildren(node: TreeSitterNode): TreeSitterNode[] {
	const children: TreeSitterNode[] = [];
	for (let index = 0; index < node.namedChildCount; index++) {
		const child = node.namedChild(index);
		if (child) children.push(child);
	}
	return children;
}

function childForField(node: TreeSitterNode, name: string): TreeSitterNode | null {
	try {
		return node.childForFieldName?.(name) ?? null;
	} catch {
		return null;
	}
}

function compactText(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function firstSourceLine(parsed: ParsedFile, node: TreeSitterNode): string {
	parsed.sourceLines ??= parsed.source.split(/\r?\n/);
	const line = parsed.sourceLines[node.startPosition.row] ?? nodeText(parsed.source, node);
	return line.trimEnd();
}

function withoutSnippet(row: SymbolRecord, detail: ResultDetail): SymbolRecord {
	const compact = { ...row };
	if (compact.file === "") delete (compact as Partial<SymbolRecord>).file;
	if (detail === "snippets") return compact;
	delete compact.text;
	delete compact.snippet;
	delete compact.metaVariables;
	return compact;
}

function simpleName(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const trimmed = value.trim();
	const parts = trimmed.split(".");
	return parts.at(-1) || trimmed;
}

function isIgnoredDir(name: string): boolean {
	return EXCLUDED_DIRS.has(name) || name.startsWith("externals.");
}

function repoRelative(repoRoot: string, absoluteFile: string): string {
	return path.relative(repoRoot, absoluteFile).split(path.sep).join(path.posix.sep);
}

function globToRegExp(glob: string): RegExp {
	const normalized = glob.startsWith("!") ? glob.slice(1) : glob;
	let output = "^";
	for (let index = 0; index < normalized.length; index++) {
		const char = normalized[index];
		const next = normalized[index + 1];
		if (char === "*" && next === "*") {
			output += ".*";
			index++;
		} else if (char === "*") output += "[^/]*";
		else if (char === "?") output += "[^/]";
		else output += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
	}
	return new RegExp(`${output}$`);
}

function matchesGlob(file: string, globs: string[]): boolean {
	return globs.some((glob) => globToRegExp(glob).test(file));
}

function shouldIncludeFile(file: string, includeGlobs: string[], excludeGlobs: string[]): boolean {
	const normalizedExcludes = excludeGlobs.map((glob) => glob.startsWith("!") ? glob.slice(1) : glob);
	if (includeGlobs.length > 0 && !matchesGlob(file, includeGlobs)) return false;
	if (normalizedExcludes.length > 0 && matchesGlob(file, normalizedExcludes)) return false;
	return true;
}

function specsForLanguages(languages: string[], diagnostics: string[]): LanguageSpec[] {
	const specs: LanguageSpec[] = [];
	const seen = new Set<string>();
	for (const language of languages) {
		const spec = languageSpec(language);
		if (!spec) {
			diagnostics.push(`Unsupported Tree-sitter language: ${language}`);
			continue;
		}
		if (seen.has(spec.id)) continue;
		seen.add(spec.id);
		specs.push(spec);
	}
	return specs;
}

function extensionSpecMap(specs: LanguageSpec[]): Map<string, LanguageSpec[]> {
	const extensions = new Map<string, LanguageSpec[]>();
	for (const spec of specs) {
		for (const extension of spec.extensions) {
			const bucket = extensions.get(extension) ?? [];
			bucket.push(spec);
			extensions.set(extension, bucket);
		}
	}
	return extensions;
}

function emptyFileGroups(specs: LanguageSpec[]): Map<string, Set<string>> {
	return new Map(specs.map((spec) => [spec.id, new Set<string>()]));
}

function collectFilesForSpecs(repoRoot: string, specs: LanguageSpec[], paths: string[], includeGlobs: string[] = [], excludeGlobs: string[] = []): Map<string, string[]> {
	const filesBySpec = emptyFileGroups(specs);
	const specsByExtension = extensionSpecMap(specs);
	const roots = paths.length > 0 ? paths : ["."];
	const stack: string[] = [];

	const addFile = (absoluteFile: string): void => {
		const matchingSpecs = specsByExtension.get(path.extname(absoluteFile));
		if (!matchingSpecs) return;
		const relative = repoRelative(repoRoot, absoluteFile);
		if (!shouldIncludeFile(relative, includeGlobs, excludeGlobs)) return;
		for (const spec of matchingSpecs) filesBySpec.get(spec.id)?.add(absoluteFile);
	};

	for (const inputPath of roots) {
		const safe = ensureInsideRoot(repoRoot, inputPath);
		const absolute = path.resolve(repoRoot, safe);
		if (!fs.existsSync(absolute)) continue;
		const stat = fs.statSync(absolute);
		if (stat.isDirectory()) stack.push(absolute);
		else if (stat.isFile()) addFile(absolute);
	}

	while (stack.length > 0) {
		const current = stack.pop() as string;
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(current, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const absolute = path.join(current, entry.name);
			if (entry.isDirectory()) {
				if (!isIgnoredDir(entry.name)) stack.push(absolute);
			} else if (entry.isFile()) addFile(absolute);
		}
	}

	return new Map([...filesBySpec.entries()].map(([language, files]) => [language, [...files].sort()]));
}

async function parseFiles(repoRoot: string, languages: string[], paths: string[] = [], includeGlobs: string[] = [], excludeGlobs: string[] = [], timeoutMs = 30_000, signal?: AbortSignal): Promise<{ parsedFiles: ParsedFile[]; diagnostics: string[]; filesByLanguage: Record<string, number>; parsedByLanguage: Record<string, number> }> {
	const started = Date.now();
	const diagnostics: string[] = [];
	const parsedFiles: ParsedFile[] = [];
	const filesByLanguage: Record<string, number> = {};
	const parsedByLanguage: Record<string, number> = {};
	const specs = specsForLanguages(languages, diagnostics);
	const filesBySpec = collectFilesForSpecs(repoRoot, specs, paths, includeGlobs, excludeGlobs);
	for (const spec of specs) {
		let bundle: ParserBundle;
		try {
			bundle = await parserFor(spec);
		} catch (error) {
			diagnostics.push(`Could not initialize Tree-sitter ${spec.id}: ${error instanceof Error ? error.message : String(error)}`);
			continue;
		}
		const files = filesBySpec.get(spec.id) ?? [];
		filesByLanguage[spec.id] = files.length;
		for (const absoluteFile of files) {
			if (signal?.aborted) break;
			if (Date.now() - started > timeoutMs) {
				diagnostics.push("Tree-sitter scan timed out before all files were parsed");
				return { parsedFiles, diagnostics, filesByLanguage, parsedByLanguage };
			}
			try {
				const source = fs.readFileSync(absoluteFile, "utf8");
				const tree = bundle.parser.parse(source);
				parsedFiles.push({ file: repoRelative(repoRoot, absoluteFile), absoluteFile, source, language: spec.id, root: tree.rootNode as TreeSitterNode, bundle });
				parsedByLanguage[spec.id] = (parsedByLanguage[spec.id] ?? 0) + 1;
			} catch (error) {
				diagnostics.push(`${repoRelative(repoRoot, absoluteFile)}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	}
	return { parsedFiles, diagnostics, filesByLanguage, parsedByLanguage };
}

function definitionName(node: TreeSitterNode, source: string): string | undefined {
	const nameNode = childForField(node, "name");
	return nameNode ? nodeText(source, nameNode) : undefined;
}

function typeSummary(node: TreeSitterNode, source: string): string | undefined {
	const typeNode = childForField(node, "type") ?? childForField(node, "value");
	if (!typeNode) return undefined;
	return nodeText(source, typeNode).split(/\s|\{/)[0];
}

function functionHeader(node: TreeSitterNode, source: string, name: string): string {
	const raw = nodeText(source, node);
	return compactText(raw.includes("{") ? raw.slice(0, raw.indexOf("{")) : raw.split(/\r?\n/)[0] ?? name);
}

function isExportedDefinition(node: TreeSitterNode, source: string, name: string): boolean {
	if (/^[A-Z]/.test(name)) return true;
	const prefix = source.slice(Math.max(0, node.startIndex - 48), node.startIndex);
	return /\bexport\s+(?:default\s+)?$/.test(prefix);
}

function callFunctionNode(node: TreeSitterNode): TreeSitterNode | null {
	return childForField(node, "function") ?? node.namedChild(0);
}

function argumentNodes(node: TreeSitterNode): TreeSitterNode[] {
	const args = childForField(node, "arguments") ?? namedChildren(node).find((child) => child.type === "argument_list" || child.type === "arguments");
	return args ? namedChildren(args) : [];
}

function selectorName(node: TreeSitterNode, source: string): string | undefined {
	const fieldNode = childForField(node, "field") ?? childForField(node, "property") ?? childForField(node, "attribute") ?? node.namedChild(1);
	return fieldNode ? nodeText(source, fieldNode) : undefined;
}

function childContains(parent: TreeSitterNode, maybeChild: TreeSitterNode): boolean {
	return maybeChild.startIndex >= parent.startIndex && maybeChild.endIndex <= parent.endIndex;
}

function isCallFunctionPart(node: TreeSitterNode, callNode: TreeSitterNode): boolean {
	const functionNode = callFunctionNode(callNode);
	return functionNode ? childContains(functionNode, node) : false;
}

function selectorObject(node: TreeSitterNode): TreeSitterNode | undefined {
	return childForField(node, "operand") ?? childForField(node, "object") ?? node.namedChild(0) ?? undefined;
}

function keyedName(node: TreeSitterNode, source: string): string | undefined {
	const keyNode = childForField(node, "key") ?? childForField(node, "name") ?? node.namedChild(0);
	return keyNode ? nodeText(source, keyNode).replace(/^['"]|['"]$/g, "") : undefined;
}

function extractFileRecords(parsed: ParsedFile, detail: ResultDetail): { definitions: SymbolRecord[]; candidates: SymbolRecord[] } {
	const definitions: SymbolRecord[] = [];
	const candidates: SymbolRecord[] = [];
	const includeSnippets = detail === "snippets";

	function snippetFields(node: TreeSitterNode): Partial<SymbolRecord> {
		if (!includeSnippets) return {};
		return { text: compactText(nodeText(parsed.source, node)), snippet: firstSourceLine(parsed, node) };
	}

	function addDefinition(node: TreeSitterNode, name: string, kind = node.type, currentType?: string): void {
		definitions.push({ kind, name, symbol: name, file: parsed.file, language: parsed.language, evidence: "tree-sitter:def", owner: currentType, type: typeSummary(node, parsed.source), exported: isExportedDefinition(node, parsed.source, name), ...(includeSnippets ? { text: functionHeader(node, parsed.source, name) } : {}), ...location(node) });
	}

	function visit(node: TreeSitterNode, currentFunction?: string, currentType?: string, parent?: TreeSitterNode): void {
		let nextFunction = currentFunction;
		let nextType = currentType;
		if (["function_declaration", "function_definition", "method_declaration", "method_definition"].includes(node.type)) {
			const name = definitionName(node, parsed.source);
			if (name) {
				nextFunction = name;
				const objectLiteralMethod = node.type === "method_definition" && !currentType;
				if (!objectLiteralMethod) addDefinition(node, name, node.type, currentType);
			}
		} else if (["class_declaration", "class_definition", "interface_declaration", "type_alias_declaration", "type_spec"].includes(node.type)) {
			const name = definitionName(node, parsed.source);
			if (name) {
				nextType = name;
				addDefinition(node, name, node.type === "type_spec" ? "type" : node.type);
			}
		} else if (node.type === "variable_declarator") {
			const nameNode = childForField(node, "name");
			const valueNode = childForField(node, "value");
			const name = nameNode ? nodeText(parsed.source, nameNode) : undefined;
			if (name && valueNode && ["arrow_function", "function", "function_expression"].includes(valueNode.type)) {
				nextFunction = name;
				addDefinition(node, name, "function_variable");
			}
		} else if (["field_declaration", "property_signature", "public_field_definition", "field_definition"].includes(node.type)) {
			const fieldNames = namedChildren(node).filter((child) => ["field_identifier", "property_identifier", "identifier"].includes(child.type));
			const typeNode = namedChildren(node).find((child) => !["field_identifier", "property_identifier", "identifier", "tag"].includes(child.type));
			for (const fieldName of fieldNames.slice(0, 1)) {
				const name = nodeText(parsed.source, fieldName);
				definitions.push({ kind: "field_declaration", name, symbol: name, owner: currentType, file: parsed.file, language: parsed.language, evidence: "tree-sitter:field_declaration", type: typeNode ? nodeText(parsed.source, typeNode) : undefined, ...(includeSnippets ? { text: compactText(nodeText(parsed.source, node)) } : {}), ...location(node) });
			}
		} else if (node.type === "call_expression" || node.type === "call") {
			const functionNode = callFunctionNode(node);
			const callee = functionNode ? nodeText(parsed.source, functionNode) : undefined;
			if (callee) {
				const name = simpleName(callee) ?? callee;
				candidates.push({ kind: "syntax_call", name, symbol: name, file: parsed.file, language: parsed.language, evidence: "tree-sitter:call_expression", inFunction: currentFunction, ...snippetFields(node), ...location(node) });
			}
		} else if (node.type === "selector_expression" || node.type === "member_expression" || node.type === "attribute") {
			const name = selectorName(node, parsed.source);
			if (name && !(parent?.type === "call_expression" && isCallFunctionPart(node, parent))) candidates.push({ kind: "syntax_selector", name, symbol: name, file: parsed.file, language: parsed.language, evidence: `tree-sitter:${node.type}`, inFunction: currentFunction, ...snippetFields(node), ...location(node) });
		} else if (node.type === "keyed_element" || node.type === "pair") {
			const name = keyedName(node, parsed.source);
			if (name) candidates.push({ kind: "syntax_keyed_field", name, symbol: name, file: parsed.file, language: parsed.language, evidence: `tree-sitter:${node.type}`, inFunction: currentFunction, ...snippetFields(node), ...location(node) });
		}

		for (const child of namedChildren(node)) visit(child, nextFunction, nextType, node);
	}

	visit(parsed.root);
	return { definitions, candidates };
}

function uniqueKey(row: SymbolRecord): string {
	return [row.kind, row.file, row.line, row.column, row.name, row.inFunction ?? ""].join("\0");
}

function addUnique(rows: SymbolRecord[], seen: Set<string>, row: SymbolRecord): void {
	const key = uniqueKey(row);
	if (seen.has(key)) return;
	seen.add(key);
	rows.push(row);
}

function safeChangedFiles(repoRoot: string, changedFiles: string[]): string[] {
	const files: string[] = [];
	for (const file of changedFiles) {
		try {
			files.push(ensureInsideRoot(repoRoot, file));
		} catch {
			// Caller-facing impact output records unsupported/unsafe paths elsewhere when needed.
		}
	}
	return files;
}

function languageIdsForFile(file: string): string[] {
	const extension = path.extname(file);
	return LANGUAGE_SPECS.filter((spec) => spec.extensions.includes(extension)).map((spec) => spec.id);
}

function changedFileSupportSummary(changedFiles: string[]): Record<string, unknown> {
	const unsupportedImpactFiles: Array<Record<string, unknown>> = [];
	const nonSourceFiles: string[] = [];
	for (const file of changedFiles) {
		const languages = languageIdsForFile(file);
		if (languages.length === 0) {
			nonSourceFiles.push(file);
			continue;
		}
		if (!languages.some((language) => IMPACT_LANGUAGE_SET.has(language))) unsupportedImpactFiles.push({ file, languages });
	}
	return {
		supportedImpactLanguages: IMPACT_LANGUAGES,
		unsupportedImpactFiles,
		nonSourceFiles,
	};
}

function definitionRank(record: SymbolRecord): number {
	if (["function_declaration", "method_declaration", "method_definition", "function_variable"].includes(record.kind)) return 0;
	if (["class_declaration", "interface_declaration", "type_alias_declaration", "type"].includes(record.kind)) return 1;
	if (record.kind === "field_declaration") return 3;
	return 2;
}

function isTestFile(file: string): boolean {
	return /(^|\/)(__tests__|test|tests)(\/|$)/.test(file) || /(^|\/).*\.(test|spec)\.[cm]?[tj]sx?$/.test(file) || /(^|\/).*_test\.go$/.test(file);
}

function fileRank(record: SymbolRecord): number {
	return isTestFile(record.file) ? 1 : 0;
}

const LOW_SIGNAL_METHOD_NAMES = new Set(["String", "Set", "Error", "Unwrap", "MarshalJSON", "UnmarshalJSON", "Len", "Less", "Swap"]);

function nameSignalRank(record: SymbolRecord): number {
	return record.kind.startsWith("method_") && LOW_SIGNAL_METHOD_NAMES.has(record.name) ? 1 : 0;
}

function exportRank(record: SymbolRecord): number {
	return record.exported === true ? 0 : 1;
}

function compareDefinitions(left: SymbolRecord, right: SymbolRecord): number {
	return fileRank(left) - fileRank(right) || definitionRank(left) - definitionRank(right) || nameSignalRank(left) - nameSignalRank(right) || exportRank(left) - exportRank(right) || left.file.localeCompare(right.file) || left.line - right.line || left.column - right.column || left.name.localeCompare(right.name);
}

function changedFileDefinitions(definitions: SymbolRecord[], changedFiles: string[]): SymbolRecord[] {
	const changedFileSet = new Set(changedFiles);
	const changedFileOrder = new Map(changedFiles.map((file, index) => [file, index]));
	const byFile = new Map<string, SymbolRecord[]>();
	for (const definition of definitions) {
		if (!changedFileSet.has(definition.file)) continue;
		const bucket = byFile.get(definition.file) ?? [];
		bucket.push(definition);
		byFile.set(definition.file, bucket);
	}
	const groups = [...byFile.entries()]
		.map(([file, records]) => ({ file, records: records.sort(compareDefinitions), rank: Math.min(...records.map(fileRank)) }))
		.sort((left, right) => left.rank - right.rank || (changedFileOrder.get(left.file) ?? Number.MAX_SAFE_INTEGER) - (changedFileOrder.get(right.file) ?? Number.MAX_SAFE_INTEGER) || left.file.localeCompare(right.file));
	const ordered: SymbolRecord[] = [];
	const ranks = [...new Set(groups.map((group) => group.rank))].sort((left, right) => left - right);
	for (const rank of ranks) {
		const rankedGroups = groups.filter((group) => group.rank === rank);
		for (let index = 0; ; index++) {
			let added = false;
			for (const group of rankedGroups) {
				const record = group.records[index];
				if (!record) continue;
				ordered.push(record);
				added = true;
			}
			if (!added) break;
		}
	}
	return ordered;
}

export async function runTreeSitterImpact(params: TreeSitterImpactParams, repoRoot: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
	const started = Date.now();
	const changedFiles = safeChangedFiles(repoRoot, normalizeStringArray(params.changedFiles));
	const supportSummary = changedFileSupportSummary(changedFiles);
	const parsed = await parseFiles(repoRoot, IMPACT_LANGUAGES, normalizeStringArray(params.paths), [], [], params.timeoutMs, signal);
	const diagnostics = [...parsed.diagnostics];
	if (parsed.parsedFiles.length === 0) {
		return {
			ok: false,
			backend: "tree-sitter",
			repoRoot,
			roots: [],
			related: [],
			diagnostics,
			reason: `No supported current-source files were parsed for Tree-sitter impact mapping. Supported impact languages: ${IMPACT_LANGUAGES.join(", ")}.`,
			coverage: {
				backendsUsed: ["tree-sitter"],
				filesParsed: 0,
				filesByLanguage: parsed.filesByLanguage,
				parsedByLanguage: parsed.parsedByLanguage,
				changedFiles,
				...supportSummary,
			},
			elapsedMs: Date.now() - started,
		};
	}

	const definitions: SymbolRecord[] = [];
	const candidates: SymbolRecord[] = [];
	for (const file of parsed.parsedFiles) {
		const records = extractFileRecords(file, params.detail);
		definitions.push(...records.definitions);
		candidates.push(...records.candidates);
	}

	const rootSymbols: string[] = [];
	const roots: SymbolRecord[] = [];
	const discoveredRootNames = new Set<string>();
	const usedRootNames = new Set<string>();
	const addRoot = (symbol: string | undefined, root: SymbolRecord): void => {
		if (!symbol) return;
		discoveredRootNames.add(symbol);
		if (usedRootNames.has(symbol) || rootSymbols.length >= params.maxRootSymbols) return;
		usedRootNames.add(symbol);
		rootSymbols.push(symbol);
		roots.push(root);
	};

	for (const symbol of normalizeStringArray(params.symbols)) {
		const definition = definitions.find((record) => record.name === symbol);
		addRoot(symbol, definition ? { ...definition, reason: "explicit symbol matched current-source Tree-sitter definition" } : { kind: "queried_symbol", name: symbol, symbol, file: "", evidence: "user", reason: "explicit symbol", line: 0, column: 0, endLine: 0, endColumn: 0 });
	}

	for (const definition of changedFileDefinitions(definitions, changedFiles)) {
		addRoot(definition.name, { ...definition, reason: `current-source symbol defined in changed file ${definition.file}` });
	}

	if (rootSymbols.length === 0) {
		return {
			ok: false,
			backend: "tree-sitter",
			repoRoot,
			roots: [],
			related: [],
			diagnostics,
			reason: "No symbols or changed-file symbols were available for Tree-sitter impact mapping. The parsed files may contain only unsupported definition shapes or non-source changes.",
			filesParsed: parsed.parsedFiles.length,
			coverage: {
				backendsUsed: ["tree-sitter"],
				filesParsed: parsed.parsedFiles.length,
				filesByLanguage: parsed.filesByLanguage,
				parsedByLanguage: parsed.parsedByLanguage,
				changedFiles,
				...supportSummary,
			},
			elapsedMs: Date.now() - started,
		};
	}

	const related: SymbolRecord[] = [];
	const relatedSeen = new Set<string>();
	for (const symbol of rootSymbols) {
		for (const candidate of candidates) {
			if (candidate.name !== symbol) continue;
			let reason: string;
			if (candidate.kind === "syntax_call") reason = `call expression with callee name ${symbol}`;
			else if (candidate.kind === "syntax_selector") reason = `selector/member expression with field/property name ${symbol}`;
			else reason = `keyed field/object-literal property with key ${symbol}`;
			addUnique(related, relatedSeen, { ...candidate, rootSymbol: symbol, reason });
			if (related.length >= params.maxResults) break;
		}
		if (related.length >= params.maxResults) break;
	}

	const outputRoots = roots.map((root) => withoutSnippet(root, params.detail));
	const outputRelated: Record<string, unknown>[] = related.map((row) => withoutSnippet(row, params.detail) as unknown as Record<string, unknown>);
	return {
		ok: true,
		backend: "tree-sitter",
		backends: ["tree-sitter"],
		repoRoot,
		detail: params.detail,
		rootSymbols,
		roots: outputRoots,
		related: outputRelated,
		summary: {
			rootFileCount: summarizeFileDistribution(outputRoots as unknown as Record<string, unknown>[]).fileCount,
			relatedFileCount: summarizeFileDistribution(outputRelated).fileCount,
			topRelatedFiles: summarizeFileDistribution(outputRelated).topFiles,
			basis: "currentSourceSyntax",
		},
		coverage: {
			backendsUsed: ["tree-sitter"],
			filesParsed: parsed.parsedFiles.length,
			filesByLanguage: parsed.filesByLanguage,
			parsedByLanguage: parsed.parsedByLanguage,
			changedFiles,
			...supportSummary,
			truncated: related.length >= params.maxResults || discoveredRootNames.size > rootSymbols.length,
			rootSymbolsDiscovered: discoveredRootNames.size,
			rootSymbolsUsed: rootSymbols.length,
			maxResults: params.maxResults,
			maxRootSymbols: params.maxRootSymbols,
			limitations: [
				"Tree-sitter impact maps are current-source syntax read-next candidates, not type-resolved semantic references.",
				"Same-name functions, fields, and properties from unrelated types can appear; use LSP/compiler tooling for exact references when required.",
			],
		},
		diagnostics,
		limitations: [
			"Tree-sitter impact maps are current-source syntax read-next candidates, not type-resolved semantic references.",
			"Same-name functions, fields, and properties from unrelated types can appear; use LSP/compiler tooling for exact references when required.",
		],
		elapsedMs: Date.now() - started,
	};
}

function parseCallPattern(pattern: string): { callee: string; variables: string[] } | undefined {
	const match = /^\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\((.*)\)\s*$/.exec(pattern);
	if (!match) return undefined;
	const args = match[2].trim();
	const variables = args ? args.split(",").map((arg) => arg.trim()).map((arg) => /^\$([A-Za-z_][\w]*)$/.exec(arg)?.[1] ?? "").filter(Boolean) : [];
	return { callee: match[1], variables };
}

function parseSelectorPattern(pattern: string): { variable: string; field: string } | undefined {
	const match = /\$([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)/.exec(pattern);
	return match ? { variable: match[1], field: match[2] } : undefined;
}

function parseKeyedPattern(pattern: string): { key: string; valueVariable?: string } | undefined {
	const match = /\b([A-Za-z_][\w]*)\s*:\s*(?:\$([A-Za-z_][\w]*)|[^,}\]]+)/.exec(pattern);
	return match ? { key: match[1], valueVariable: match[2] } : undefined;
}

function isRawTreeSitterQuery(pattern: string): boolean {
	return pattern.trim().startsWith("(") && !pattern.includes("$");
}

function collectNodes(node: TreeSitterNode, predicate: (node: TreeSitterNode) => boolean, output: TreeSitterNode[] = []): TreeSitterNode[] {
	if (predicate(node)) output.push(node);
	for (const child of namedChildren(node)) collectNodes(child, predicate, output);
	return output;
}

function visitNodes(node: TreeSitterNode, predicate: (node: TreeSitterNode) => boolean, visit: (node: TreeSitterNode) => void): void {
	if (predicate(node)) visit(node);
	for (const child of namedChildren(node)) visitNodes(child, predicate, visit);
}

interface SyntaxMatchAccumulator {
	detail: ResultDetail;
	maxResults: number;
	matchCount: number;
	matches: Record<string, unknown>[];
	fileCounts: Map<string, number>;
}

function addSyntaxMatch(accumulator: SyntaxMatchAccumulator, parsed: ParsedFile, node: TreeSitterNode, metaVariables?: () => Record<string, unknown>): void {
	accumulator.matchCount += 1;
	accumulator.fileCounts.set(parsed.file, (accumulator.fileCounts.get(parsed.file) ?? 0) + 1);
	if (accumulator.matches.length >= accumulator.maxResults) return;
	accumulator.matches.push(normalizeSyntaxMatch(parsed, node, accumulator.detail, accumulator.detail === "snippets" ? metaVariables?.() : undefined));
}

function normalizeSyntaxMatch(parsed: ParsedFile, node: TreeSitterNode, detail: ResultDetail, metaVariables?: Record<string, unknown>): Record<string, unknown> {
	const row: Record<string, unknown> = {
		file: parsed.file,
		line: node.startPosition.row + 1,
		column: node.startPosition.column + 1,
		endLine: node.endPosition.row + 1,
		endColumn: node.endPosition.column + 1,
		language: parsed.language,
		nodeType: node.type,
	};
	if (detail === "snippets") {
		row.text = nodeText(parsed.source, node);
		row.snippet = firstSourceLine(parsed, node);
		if (metaVariables && Object.keys(metaVariables).length > 0) row.metaVariables = { single: metaVariables };
	}
	return row;
}

function collectSyntaxMatchesForCall(parsed: ParsedFile, pattern: { callee: string; variables: string[] }, accumulator: SyntaxMatchAccumulator): void {
	visitNodes(parsed.root, (candidate) => candidate.type === "call_expression", (node) => {
		const functionNode = callFunctionNode(node);
		if (!functionNode) return;
		const callee = nodeText(parsed.source, functionNode);
		const matchesCallee = pattern.callee.includes(".") ? callee === pattern.callee : simpleName(callee) === pattern.callee;
		if (!matchesCallee) return;
		addSyntaxMatch(accumulator, parsed, node, pattern.variables.length > 0 ? () => {
			const args = argumentNodes(node);
			const variables: Record<string, string> = {};
			for (let index = 0; index < Math.min(pattern.variables.length, args.length); index++) variables[pattern.variables[index]] = nodeText(parsed.source, args[index]);
			return variables;
		} : undefined);
	});
}

function collectSyntaxMatchesForSelector(parsed: ParsedFile, pattern: { variable: string; field: string }, selector: string | undefined, accumulator: SyntaxMatchAccumulator): void {
	const selectorTypes = new Set(["selector_expression", "member_expression", "attribute"]);
	visitNodes(parsed.root, (candidate) => selectorTypes.has(candidate.type), (node) => {
		const field = selectorName(node, parsed.source);
		if (field !== pattern.field) return;
		if (selector && selector !== node.type) return;
		addSyntaxMatch(accumulator, parsed, node, () => {
			const objectNode = selectorObject(node);
			return objectNode ? { [pattern.variable]: nodeText(parsed.source, objectNode) } : {};
		});
	});
}

function collectSyntaxMatchesForKeyed(parsed: ParsedFile, pattern: { key: string; valueVariable?: string }, selector: string | undefined, accumulator: SyntaxMatchAccumulator): void {
	const keyedTypes = new Set(["keyed_element", "pair"]);
	visitNodes(parsed.root, (candidate) => keyedTypes.has(candidate.type), (node) => {
		const key = keyedName(node, parsed.source);
		if (key !== pattern.key) return;
		if (selector && selector !== node.type) return;
		addSyntaxMatch(accumulator, parsed, node, pattern.valueVariable ? () => {
			const valueNode = childForField(node, "value") ?? namedChildren(node).at(-1);
			return valueNode ? { [pattern.valueVariable as string]: nodeText(parsed.source, valueNode) } : {};
		} : undefined);
	});
}

function collectSyntaxMatchesForRawQuery(parsed: ParsedFile, querySource: string, selector: string | undefined, accumulator: SyntaxMatchAccumulator): void {
	const Query = parsed.bundle.Query;
	if (!Query) return;
	const query = new Query(parsed.bundle.language, querySource);
	try {
		for (const match of query.matches(parsed.root) as Array<{ captures?: Array<{ name: string; node: TreeSitterNode }> }>) {
			const captures = Array.isArray(match.captures) ? match.captures : [];
			const selected = selector
				? captures.filter((capture) => capture.name === selector.replace(/^@/, "") || capture.node.type === selector)
				: captures;
			for (const capture of selected.length > 0 ? selected : captures.slice(0, 1)) addSyntaxMatch(accumulator, parsed, capture.node, () => ({ [capture.name]: nodeText(parsed.source, capture.node) }));
		}
	} finally {
		query.delete?.();
	}
}

function languagesForSyntaxSearch(language: string | undefined, paths: string[]): string[] {
	if (language?.trim()) return [language.trim()];
	const pathExtensions = paths.map((item) => path.extname(item)).filter(Boolean);
	const inferred = LANGUAGE_SPECS.filter((spec) => spec.extensions.some((extension) => pathExtensions.includes(extension))).map((spec) => spec.id);
	return inferred.length > 0 ? [...new Set(inferred)] : ["go"];
}

function isIdentifierName(name: string): boolean {
	return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

function distributionFromFileCounts(fileCounts: Map<string, number>): { fileCount: number; topFiles: Array<{ file: string; count: number }> } {
	return {
		fileCount: fileCounts.size,
		topFiles: [...fileCounts.entries()]
			.map(([file, count]) => ({ file, count }))
			.sort((left, right) => right.count - left.count || left.file.localeCompare(right.file))
			.slice(0, 8),
	};
}

export async function runTreeSitterSelectorBatchSearch(params: TreeSitterSelectorBatchParams, repoRoot: string, signal?: AbortSignal): Promise<Record<string, unknown>[]> {
	const names = [...new Set(params.names.map((name) => name.trim()).filter(isIdentifierName))];
	if (names.length === 0) return [];
	const maxPerName = normalizePositiveInteger(params.maxPerName, 8, 1, 50);
	const timeoutMs = normalizePositiveInteger(params.timeoutMs, 30_000, 1_000, 600_000);
	const detail: ResultDetail = params.detail === "snippets" ? "snippets" : "locations";
	const paths = normalizeStringArray(params.paths);
	const languages = languagesForSyntaxSearch(params.language, paths);
	const parsed = await parseFiles(repoRoot, languages, paths, [], [], timeoutMs, signal);
	const diagnostics = [...parsed.diagnostics];
	const selectorTypes = new Set(["selector_expression", "member_expression", "attribute"]);
	const wanted = new Set(names);
	const buckets = new Map<string, { matchCount: number; matches: Record<string, unknown>[]; fileCounts: Map<string, number> }>();
	for (const name of names) buckets.set(name, { matchCount: 0, matches: [], fileCounts: new Map<string, number>() });

	for (const file of parsed.parsedFiles) {
		for (const node of collectNodes(file.root, (candidate) => selectorTypes.has(candidate.type))) {
			const field = selectorName(node, file.source);
			if (!field || !wanted.has(field)) continue;
			const bucket = buckets.get(field);
			if (!bucket) continue;
			bucket.matchCount += 1;
			bucket.fileCounts.set(file.file, (bucket.fileCounts.get(file.file) ?? 0) + 1);
			if (bucket.matches.length >= maxPerName) continue;
			let variables: Record<string, string> | undefined;
			if (detail === "snippets") {
				const objectNode = selectorObject(node);
				if (objectNode) variables = { X: nodeText(file.source, objectNode) };
			}
			bucket.matches.push(normalizeSyntaxMatch(file, node, detail, variables));
		}
	}

	return names.map((name) => {
		const bucket = buckets.get(name) ?? { matchCount: 0, matches: [], fileCounts: new Map<string, number>() };
		const matches = bucket.matches;
		return {
			kind: "selector_syntax",
			name,
			ok: diagnostics.length === 0 || bucket.matchCount > 0,
			backend: "tree-sitter",
			repoRoot,
			pattern: `$X.${name}`,
			detail,
			language: params.language,
			languages,
			paths: paths.length > 0 ? paths : ["."],
			includeGlobs: [],
			excludeGlobs: [],
			matchCount: bucket.matchCount,
			returned: matches.length,
			truncated: bucket.matchCount > matches.length,
			summary: {
				...distributionFromFileCounts(bucket.fileCounts),
				returnedFileCount: summarizeFileDistribution(matches).fileCount,
				basis: "treeSitterPatternAdapter",
			},
			matches,
			coverage: {
				filesParsed: parsed.parsedFiles.length,
				filesByLanguage: parsed.filesByLanguage,
				parsedByLanguage: parsed.parsedByLanguage,
				batched: true,
			},
			diagnostics,
			limitations: ["Syntax search matches are current-source Tree-sitter candidates, not semantic references, proof of a bug, or complete impact."],
		};
	});
}

export async function runTreeSitterSyntaxSearch(params: CodeIntelSyntaxSearchParams, repoRoot: string, config: CodeIntelConfig, signal?: AbortSignal): Promise<Record<string, unknown>> {
	const pattern = params.pattern?.trim();
	if (!pattern) throw new Error("code_intel_syntax_search requires a non-empty pattern");
	const maxResults = normalizePositiveInteger(params.maxResults, config.maxResults, 1, 500);
	const timeoutMs = normalizePositiveInteger(params.timeoutMs, config.queryTimeoutMs, 1_000, 600_000);
	const detail: ResultDetail = params.detail === "locations" ? "locations" : "snippets";
	const paths = normalizeStringArray(params.paths);
	const includeGlobs = normalizeStringArray(params.includeGlobs);
	const excludeGlobs = normalizeStringArray(params.excludeGlobs);
	const languages = languagesForSyntaxSearch(params.language, paths);
	const parsed = await parseFiles(repoRoot, languages, paths, includeGlobs, excludeGlobs, timeoutMs, signal);
	const callPattern = parseCallPattern(pattern);
	const selectorPattern = parseSelectorPattern(pattern);
	const keyedPattern = parseKeyedPattern(pattern);
	const rawQuery = isRawTreeSitterQuery(pattern);
	const diagnostics = [...parsed.diagnostics];
	const accumulator: SyntaxMatchAccumulator = { detail, maxResults, matchCount: 0, matches: [], fileCounts: new Map<string, number>() };
	if (!callPattern && !selectorPattern && !keyedPattern && !rawQuery) diagnostics.push("Unsupported Tree-sitter syntax pattern. Use foo($A), $OBJ.Field, Key: $VALUE, a wrapper containing one of those shapes, or a raw Tree-sitter S-expression query with captures.");
	for (const file of parsed.parsedFiles) {
		if (callPattern) collectSyntaxMatchesForCall(file, callPattern, accumulator);
		else if (selectorPattern) collectSyntaxMatchesForSelector(file, selectorPattern, params.selector?.trim(), accumulator);
		else if (keyedPattern) collectSyntaxMatchesForKeyed(file, keyedPattern, params.selector?.trim(), accumulator);
		else if (rawQuery) collectSyntaxMatchesForRawQuery(file, pattern, params.selector?.trim(), accumulator);
	}
	const matches = accumulator.matches;
	return {
		ok: diagnostics.length === 0 || accumulator.matchCount > 0,
		backend: "tree-sitter",
		repoRoot,
		pattern,
		detail,
		language: params.language,
		languages,
		paths: paths.length > 0 ? paths : ["."],
		includeGlobs,
		excludeGlobs,
		selector: params.selector?.trim() || undefined,
		matchCount: accumulator.matchCount,
		returned: matches.length,
		truncated: accumulator.matchCount > matches.length,
		summary: {
			...distributionFromFileCounts(accumulator.fileCounts),
			returnedFileCount: summarizeFileDistribution(matches).fileCount,
			basis: rawQuery ? "treeSitterQueryCaptures" : "treeSitterPatternAdapter",
		},
		matches,
		coverage: {
			filesParsed: parsed.parsedFiles.length,
			filesByLanguage: parsed.filesByLanguage,
			parsedByLanguage: parsed.parsedByLanguage,
		},
		diagnostics,
		limitations: ["Syntax search matches are current-source Tree-sitter candidates, not semantic references, proof of a bug, or complete impact."],
	};
}
