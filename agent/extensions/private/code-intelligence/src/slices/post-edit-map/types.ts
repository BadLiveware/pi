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
