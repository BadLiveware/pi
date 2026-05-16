export const CONFIG_FILE_NAME = "code-intelligence.json";
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_OUTPUT_BYTES = 5_000_000;

export type BackendName = "tree-sitter" | "rg";
export type LanguageServerName = "gopls" | "rust-analyzer" | "typescript" | "clangd";
export type Availability = "available" | "missing" | "error";
export type IndexStatus = "not-required" | "error";
export type ResultDetail = "locations" | "snippets";
export type SourceDetail = "source" | "locations";

export interface CodeIntelConfig {
	maxResults: number;
	queryTimeoutMs: number;
	maxOutputBytes: number;
}

export interface LoadedConfig {
	config: CodeIntelConfig;
	paths: {
		user: string;
		project: string;
	};
	loaded: string[];
	diagnostics: string[];
}

export interface CommandResult {
	command: string;
	args: string[];
	cwd: string;
	exitCode: number | null;
	signal: NodeJS.Signals | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
	outputTruncated: boolean;
	error?: string;
}

export interface CommandOptions {
	cwd: string;
	timeoutMs?: number;
	maxOutputBytes?: number;
	env?: NodeJS.ProcessEnv;
	signal?: AbortSignal;
}

export interface BackendStatus {
	backend: BackendName;
	available: Availability;
	executable?: string;
	version?: string;
	indexStatus: IndexStatus;
	writesToRepo: boolean;
	artifacts: string[];
	diagnostics: string[];
	details?: Record<string, unknown>;
}

export interface LanguageServerStatus {
	server: LanguageServerName;
	available: Availability;
	executable?: string;
	version?: string;
	diagnostics: string[];
	details?: Record<string, unknown>;
}

export interface RepoRoots {
	requestedRoot: string;
	repoRoot: string;
	diagnostics: string[];
}

export interface CodeIntelStateParams {
	repoRoot?: string;
	includeDiagnostics?: boolean;
}

export interface CodeIntelSyntaxSearchParams {
	repoRoot?: string;
	pattern: string;
	language?: string;
	paths?: string[];
	includeGlobs?: string[];
	excludeGlobs?: string[];
	selector?: string;
	maxResults?: number;
	timeoutMs?: number;
	strictness?: "cst" | "smart" | "ast" | "relaxed" | "signature" | "template";
	detail?: ResultDetail;
}

export interface CodeIntelImpactMapParams {
	repoRoot?: string;
	symbols?: string[];
	changedFiles?: string[];
	baseRef?: string;
	maxResults?: number;
	maxRootSymbols?: number;
	timeoutMs?: number;
	detail?: ResultDetail;
	confirmReferences?: "gopls" | "typescript" | "clangd";
	maxReferenceRoots?: number;
	maxReferenceResults?: number;
	includeReferenceDeclarations?: boolean;
}

export interface CodeIntelLocalMapParams {
	repoRoot?: string;
	anchors?: string[];
	names?: string[];
	paths?: string[];
	language?: string;
	includeSyntax?: boolean;
	maxResults?: number;
	maxPerName?: number;
	timeoutMs?: number;
	detail?: ResultDetail;
}

export interface CodeIntelRepoOverviewParams {
	repoRoot?: string;
	paths?: string[];
	tier?: "shape" | "files";
	maxDepth?: number;
	maxDirs?: number;
	maxFilesPerDir?: number;
	maxSymbolsPerFile?: number;
	includeGlobs?: string[];
	excludeGlobs?: string[];
	includeGenerated?: boolean;
	includeVendor?: boolean;
	timeoutMs?: number;
}

export interface CodeIntelFileOutlineParams {
	repoRoot?: string;
	path: string;
	includeImports?: boolean;
	includeNonExported?: boolean;
	maxSymbols?: number;
	timeoutMs?: number;
	detail?: ResultDetail;
}

export interface CodeIntelTestMapParams {
	repoRoot?: string;
	path?: string;
	symbols?: string[];
	names?: string[];
	testPaths?: string[];
	maxResults?: number;
	maxLiteralMatches?: number;
	confirmReferences?: "gopls" | "typescript" | "clangd";
	maxReferenceRoots?: number;
	maxReferenceResults?: number;
	timeoutMs?: number;
	detail?: ResultDetail;
}

export interface CodeIntelRepoRouteParams {
	repoRoot?: string;
	terms?: string[];
	paths?: string[];
	maxResults?: number;
	maxFiles?: number;
	maxMatchesPerFile?: number;
	timeoutMs?: number;
}

export interface CodeIntelReadSymbolParams {
	repoRoot?: string;
	target?: Record<string, unknown>;
	path?: string;
	symbol?: string;
	name?: string;
	owner?: string;
	kind?: string;
	signature?: string;
	symbolRef?: string;
	rangeId?: string;
	line?: number;
	column?: number;
	contextLines?: number;
	include?: string[];
	maxContextSegments?: number;
	maxBytes?: number;
	timeoutMs?: number;
	detail?: SourceDetail;
}

export interface CodeIntelReplaceSymbolParams {
	repoRoot?: string;
	target?: Record<string, unknown>;
	path?: string;
	symbol?: string;
	name?: string;
	owner?: string;
	kind?: string;
	signature?: string;
	symbolRef?: string;
	rangeId?: string;
	oldText?: string;
	oldHash?: string;
	newText: string;
	normalizeEol?: boolean;
	timeoutMs?: number;
}

export interface CodeIntelInsertRelativeParams {
	repoRoot?: string;
	anchor?: Record<string, unknown>;
	target?: Record<string, unknown>;
	path?: string;
	symbol?: string;
	name?: string;
	owner?: string;
	kind?: string;
	signature?: string;
	symbolRef?: string;
	rangeId?: string;
	position: "before" | "after";
	text: string;
	anchorHash?: string;
	normalizeEol?: boolean;
	timeoutMs?: number;
}

export interface CodeIntelPostEditDiagnostic {
	path: string;
	line: number;
	column?: number;
	severity?: "error" | "warning" | "info" | "hint" | string;
	source?: string;
	code?: string;
}

export interface CodeIntelPostEditMapParams {
	repoRoot?: string;
	changedFiles?: string[];
	baseRef?: string;
	includeChangedSymbols?: boolean;
	includeCallers?: boolean;
	includeTests?: boolean;
	includeDiagnostics?: boolean;
	diagnostics?: Array<CodeIntelPostEditDiagnostic | Record<string, unknown>>;
	avoidReReadingCompleteReturnedSegments?: boolean;
	maxResults?: number;
	timeoutMs?: number;
}

export const DEFAULT_CONFIG: CodeIntelConfig = {
	maxResults: 125,
	queryTimeoutMs: DEFAULT_TIMEOUT_MS,
	maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
};
