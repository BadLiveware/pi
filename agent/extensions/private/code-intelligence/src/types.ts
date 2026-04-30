export const CONFIG_FILE_NAME = "code-intelligence.json";
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_OUTPUT_BYTES = 5_000_000;

export type BackendName = "tree-sitter" | "rg";
export type LanguageServerName = "gopls" | "rust-analyzer" | "typescript";
export type Availability = "available" | "missing" | "error";
export type IndexStatus = "not-required" | "error";
export type ResultDetail = "locations" | "snippets";

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
	confirmReferences?: "gopls" | "typescript";
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

export const DEFAULT_CONFIG: CodeIntelConfig = {
	maxResults: 125,
	queryTimeoutMs: DEFAULT_TIMEOUT_MS,
	maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
};
