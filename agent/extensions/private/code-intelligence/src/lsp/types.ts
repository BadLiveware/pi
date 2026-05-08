import type { CodeIntelConfig } from "../types.ts";

export type ReferenceConfirmationProviderName = "gopls" | "typescript" | "clangd";

export interface ReferenceRoot {
	name: string;
	file: string;
	line: number;
	column: number;
	language?: string;
	kind?: string;
}

export interface ReferenceConfirmationOptions {
	maxRoots?: number;
	maxResults?: number;
	timeoutMs?: number;
	includeDeclarations?: boolean;
}

export interface ReferenceConfirmationLimits {
	maxRoots: number;
	maxResults: number;
	timeoutMs: number;
}

export interface ReferenceConfirmationContext {
	repoRoot: string;
	config: CodeIntelConfig;
	signal?: AbortSignal;
}

export interface ReferenceConfirmationProviderResult {
	executable?: string;
	roots: Record<string, unknown>[];
	references: Record<string, unknown>[];
	diagnostics: string[];
	limitations?: string[];
}

export interface ReferenceConfirmationProvider {
	name: ReferenceConfirmationProviderName;
	evidence: string;
	supportedLanguages: string[];
	missingDiagnostic: string;
	noRootsDiagnostic: string;
	limitations: string[];
	confirmRoots(roots: ReferenceRoot[], context: ReferenceConfirmationContext, options: ReferenceConfirmationOptions, limits: ReferenceConfirmationLimits): Promise<ReferenceConfirmationProviderResult>;
}
