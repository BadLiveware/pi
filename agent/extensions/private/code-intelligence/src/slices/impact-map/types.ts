import type { ResultDetail } from "../../core/types.ts";

export interface CodeIntelImpactMapParams {
	repoRoot?: string;
	symbols?: string[];
	changedFiles?: string[];
	baseRef?: string;
	maxResults?: number;
	maxRootSymbols?: number;
	timeoutMs?: number;
	detail?: ResultDetail;
	confirmReferences?: "gopls" | "typescript" | "clangd" | "rust-analyzer";
	maxReferenceRoots?: number;
	maxReferenceResults?: number;
	includeReferenceDeclarations?: boolean;
}
