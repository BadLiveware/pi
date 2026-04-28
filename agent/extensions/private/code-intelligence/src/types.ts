export const CONFIG_FILE_NAME = "code-intelligence.json";
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_INDEX_TIMEOUT_MS = 300_000;
export const DEFAULT_MAX_OUTPUT_BYTES = 5_000_000;
export const SQRY_REPO_ARTIFACTS = [".sqry/", ".sqry-cache/", ".sqry-index/", ".sqry-index.user"] as const;
export const SQRY_POLICY_ARTIFACTS = [".sqry/", ".sqry-index/"] as const;

export type BackendName = "cymbal" | "ast-grep" | "sqry";
export type UpdateBackend = BackendName | "auto";
export type RepoArtifactPolicy = "never" | "ifIgnored" | "always";
export type Availability = "available" | "missing" | "error";
export type IndexStatus = "fresh" | "present" | "missing" | "stale" | "not-required" | "unknown" | "error";
export type ResultDetail = "locations" | "snippets";

export interface CodeIntelConfig {
	backendOrder: BackendName[];
	autoIndexOnSessionStart: boolean;
	autoIndexBackends: BackendName[];
	allowRepoArtifacts: RepoArtifactPolicy;
	maxResults: number;
	queryTimeoutMs: number;
	indexTimeoutMs: number;
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

export interface RepoRoots {
	requestedRoot: string;
	repoRoot: string;
	diagnostics: string[];
}

export interface ArtifactIgnoreEntry {
	artifact: string;
	ignored: boolean | "unknown";
	source?: string;
	diagnostic?: string;
}

export interface ArtifactPolicyState {
	policy: RepoArtifactPolicy;
	artifacts: ArtifactIgnoreEntry[];
	policyArtifacts: string[];
	policyArtifactsIgnored: boolean;
	allowed: boolean;
	reason: string;
}

export interface CodeIntelStateParams {
	repoRoot?: string;
	includeDiagnostics?: boolean;
}

export interface CodeIntelUpdateParams {
	backend?: UpdateBackend;
	repoRoot?: string;
	allowRepoArtifacts?: RepoArtifactPolicy;
	force?: boolean;
	timeoutMs?: number;
}

export interface CodeIntelSyntaxSearchParams {
	repoRoot?: string;
	pattern: string;
	language?: string;
	paths?: string[];
	includeGlobs?: string[];
	excludeGlobs?: string[];
	maxResults?: number;
	timeoutMs?: number;
	strictness?: "cst" | "smart" | "ast" | "relaxed" | "signature" | "template";
	detail?: ResultDetail;
}

export interface AstGrepMatch {
	text?: string;
	file?: string;
	lines?: string;
	language?: string;
	range?: {
		start?: { line?: number; column?: number };
		end?: { line?: number; column?: number };
	};
	metaVariables?: {
		single?: Record<string, { text?: string; range?: unknown }>;
		multi?: Record<string, Array<{ text?: string; range?: unknown }>>;
	};
}

export interface CymbalSymbolContextParams {
	repoRoot?: string;
	symbol: string;
	maxCallers?: number;
	timeoutMs?: number;
}

export type ReferenceRelation = "refs" | "callers" | "callees" | "impact" | "implementers" | "implementedBy" | "importers";

export interface CymbalReferencesParams {
	repoRoot?: string;
	query: string;
	relation?: ReferenceRelation;
	maxResults?: number;
	depth?: number;
	paths?: string[];
	excludeGlobs?: string[];
	timeoutMs?: number;
	detail?: ResultDetail;
}

export interface CymbalImpactMapParams {
	repoRoot?: string;
	symbols?: string[];
	changedFiles?: string[];
	baseRef?: string;
	maxDepth?: number;
	maxResults?: number;
	maxRootSymbols?: number;
	timeoutMs?: number;
	detail?: ResultDetail;
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

export interface CodeIntelSymbolSourceParams {
	repoRoot?: string;
	symbol: string;
	file?: string;
	paths?: string[];
	maxSourceBytes?: number;
	timeoutMs?: number;
}

export interface CodeIntelReplaceSymbolParams {
	repoRoot?: string;
	symbol: string;
	file: string;
	expectedRange: {
		startLine: number;
		endLine: number;
	};
	expectedHash: string;
	newSource: string;
	timeoutMs?: number;
}

export interface CymbalSymbol {
	name?: string;
	kind?: string;
	file?: string;
	rel_path?: string;
	start_line?: number;
	end_line?: number;
	depth?: number;
	language?: string;
}

export interface CymbalContextPayload {
	results?: {
		symbol?: CymbalSymbol;
		source?: string;
		type_refs?: unknown;
		callers?: unknown[];
		file_imports?: unknown;
		matches?: CymbalSymbol[];
		match_count?: number;
	};
	version?: string;
}

export interface CymbalListPayload<T> {
	results?: T[];
	version?: string;
}

export const DEFAULT_CONFIG: CodeIntelConfig = {
	backendOrder: ["cymbal", "sqry"],
	autoIndexOnSessionStart: true,
	autoIndexBackends: ["sqry", "cymbal"],
	allowRepoArtifacts: "ifIgnored",
	maxResults: 50,
	queryTimeoutMs: DEFAULT_TIMEOUT_MS,
	indexTimeoutMs: DEFAULT_INDEX_TIMEOUT_MS,
	maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
};
