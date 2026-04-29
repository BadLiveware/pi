import type { CodeIntelConfig, CodeIntelImpactMapParams, ResultDetail } from "./types.ts";
import { changedFilesFromBase } from "./repo.ts";
import { runTreeSitterImpact } from "./tree-sitter.ts";
import { normalizePositiveInteger, normalizeStringArray } from "./util.ts";

const IMPACT_DEFAULT_MAX_RESULTS = 25;
const IMPACT_DEFAULT_MAX_ROOT_SYMBOLS = 20;

export async function runImpactMap(params: CodeIntelImpactMapParams, repoRoot: string, config: CodeIntelConfig, signal?: AbortSignal): Promise<Record<string, unknown>> {
	const maxResults = normalizePositiveInteger(params.maxResults, Math.min(config.maxResults, IMPACT_DEFAULT_MAX_RESULTS), 1, 500);
	const maxRootSymbols = normalizePositiveInteger(params.maxRootSymbols, IMPACT_DEFAULT_MAX_ROOT_SYMBOLS, 1, 500);
	const timeoutMs = normalizePositiveInteger(params.timeoutMs, config.queryTimeoutMs, 1_000, 600_000);
	const detail: ResultDetail = params.detail === "snippets" ? "snippets" : "locations";
	const diagnostics: string[] = [];
	const base = await changedFilesFromBase(repoRoot, params.baseRef, config.queryTimeoutMs, config.maxOutputBytes);
	if (base.diagnostic) diagnostics.push(base.diagnostic);
	const changedFiles = [...new Set([...normalizeStringArray(params.changedFiles), ...base.files])];
	const payload = await runTreeSitterImpact({ symbols: params.symbols, changedFiles, maxRootSymbols, maxResults, timeoutMs, detail }, repoRoot, signal);
	return {
		...payload,
		diagnostics: [...diagnostics, ...(Array.isArray(payload.diagnostics) ? payload.diagnostics : [])],
	};
}
