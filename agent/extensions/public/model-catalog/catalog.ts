import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getSupportedThinkingLevels, type Api, type Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type UnsupportedMode = "exclude" | "include" | "only";

export interface ListPiModelsParams {
	query?: string;
	includeUnavailable?: boolean;
	includeDetails?: boolean;
	includePricing?: boolean;
	relativeTo?: string;
	unsupported?: UnsupportedMode;
}

interface ModelCatalogSettings {
	enabledModels?: string[];
}

interface ModelCatalogConfig {
	unsupportedModels?: Array<string | { model?: string; fullId?: string; reason?: string }>;
}

interface UnsupportedModelInfo {
	reason: string;
}

interface ModelPricing {
	inputPerMillion: number;
	outputPerMillion: number;
	cacheReadPerMillion: number;
	cacheWritePerMillion: number;
	known: boolean;
	relativeTo?: string;
	relativeInput?: number;
	relativeOutput?: number;
	relativeCacheRead?: number;
	relativeBlended?: number;
}

interface ModelCatalogRow {
	provider: string;
	model: string;
	fullId: string;
	current: boolean;
	available: boolean;
	cycleEnabled: boolean;
	context: string;
	maxOut: string;
	thinking: string;
	thinkingLevels: string[];
	thinkingLevelMap?: Partial<Record<string, string | null>>;
	images: string;
	cost: string;
	quota: string;
	pricing: ModelPricing;
	supported: boolean;
	unsupportedReason?: string;
	useFor: string;
	avoidFor: string;
}

interface ModelCatalogResult {
	rows: ModelCatalogRow[];
	excludedUnsupportedRows: ModelCatalogRow[];
	pricingBaseline?: string;
	pricingBaselineMissing?: string;
}

function agentDir(): string {
	return process.env.PI_CODING_AGENT_DIR ?? process.env.PI_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
}

function readSettings(): ModelCatalogSettings {
	try {
		const settingsPath = path.join(agentDir(), "settings.json");
		const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as ModelCatalogSettings;
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

function readModelCatalogConfig(): ModelCatalogConfig {
	try {
		const configPath = path.join(agentDir(), "model-catalog.json");
		const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8")) as ModelCatalogConfig;
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

function formatTokenCount(count: number): string {
	if (count >= 1_000_000) {
		const millions = count / 1_000_000;
		return millions % 1 === 0 ? `${millions}M` : `${millions.toFixed(1)}M`;
	}
	if (count >= 1_000) {
		const thousands = count / 1_000;
		return thousands % 1 === 0 ? `${thousands}K` : `${thousands.toFixed(1)}K`;
	}
	return count.toString();
}

function formatPricePerMillion(value: number, known: boolean): string {
	if (!known) return "—";
	if (value === 0) return "$0";
	return `$${value < 1 ? value.toFixed(3) : value.toFixed(2)}`;
}

function formatRatio(value: number | undefined): string {
	if (value === undefined || !Number.isFinite(value)) return "—";
	return `${value.toFixed(2)}×`;
}

function formatCapabilities(row: ModelCatalogRow): string {
	const caps: string[] = [];
	if (row.thinking === "yes") caps.push("think");
	if (row.images === "yes") caps.push("img");
	return caps.length > 0 ? caps.join("+") : "text";
}

function formatThinkingLevels(levels: string[]): string {
	const labels: Record<string, string> = {
		off: "off",
		minimal: "min",
		low: "low",
		medium: "med",
		high: "high",
		xhigh: "xhi",
	};
	return levels.map((level) => labels[level] ?? level).join(",") || "—";
}

function shellWords(input: string): string[] {
	const words: string[] = [];
	let current = "";
	let quote: '"' | "'" | undefined;
	let escaping = false;
	for (const char of input) {
		if (escaping) {
			current += char;
			escaping = false;
			continue;
		}
		if (char === "\\" && quote !== "'") {
			escaping = true;
			continue;
		}
		if ((char === '"' || char === "'") && (!quote || quote === char)) {
			quote = quote ? undefined : char;
			continue;
		}
		if (!quote && /\s/.test(char)) {
			if (current) words.push(current);
			current = "";
			continue;
		}
		current += char;
	}
	if (current) words.push(current);
	return words;
}

export function parseModelsGuideArgs(args: string): Pick<ListPiModelsParams, "query" | "includeDetails" | "includePricing" | "relativeTo"> {
	const queryParts: string[] = [];
	let includeDetails = false;
	let includePricing = false;
	let relativeTo: string | undefined;
	const words = shellWords(args);
	for (let index = 0; index < words.length; index += 1) {
		const word = words[index];
		if (word === "--verbose" || word === "--details" || word === "-v") {
			includeDetails = true;
			continue;
		}
		if (word === "--pricing" || word === "--prices" || word === "-p") {
			includePricing = true;
			continue;
		}
		if (word === "--relative-to" || word === "--relative" || word === "--baseline") {
			relativeTo = words[index + 1];
			index += 1;
			continue;
		}
		const relativeMatch = word.match(/^--(?:relative-to|relative|baseline)=(.+)$/);
		if (relativeMatch) {
			relativeTo = relativeMatch[1];
			continue;
		}
		queryParts.push(word);
	}
	return {
		query: queryParts.join(" ") || undefined,
		includeDetails,
		includePricing,
		relativeTo,
	};
}

function matchesModel(model: Model<Api>, query: string | undefined): boolean {
	if (!query?.trim()) return true;
	const needle = query.trim().toLowerCase();
	return `${model.provider} ${model.id} ${model.name}`.toLowerCase().includes(needle);
}

function isSparkModel(model: Model<Api>): boolean {
	return /(?:^|[-_])spark(?:$|[-_])/.test(model.id.toLowerCase());
}

function isLocalModel(model: Model<Api>): boolean {
	const provider = String(model.provider).toLowerCase();
	return provider.startsWith("local-") || provider.includes("llamaswap");
}

function classifyCost(model: Model<Api>): string {
	if (isLocalModel(model)) return "free/local";
	if (isSparkModel(model)) return "premium-speed";
	const cost = model.cost;
	const output = cost?.output ?? 0;
	const input = cost?.input ?? 0;
	const blended = input + output;
	if (blended <= 0) return "unknown/sub";
	if (blended <= 1) return "low";
	if (blended <= 8) return "medium";
	if (blended <= 30) return "high";
	return "premium";
}

function classifyQuota(model: Model<Api>): string {
	const id = model.id.toLowerCase();
	const provider = String(model.provider).toLowerCase();
	if (isLocalModel(model)) return "local-serial";
	if (isSparkModel(model)) return "very-fast";
	if (/mini|flash|lite|haiku|small/.test(id)) return "fast/limited";
	if (/opus|pro|gpt-5\.5|o3|sonnet|grok-4/.test(id)) return "scarce";
	if (provider.includes("codex") || provider.includes("copilot")) return "subscription";
	return "standard";
}

function modelProfile(model: Model<Api>): "local" | "latency" | "fast" | "standard" | "strong" {
	const id = model.id.toLowerCase();
	if (isLocalModel(model)) return "local";
	if (isSparkModel(model)) return "latency";
	if (/mini|flash|lite|haiku|small/.test(id)) return "fast";
	if (/opus|pro|gpt-5\.5|gpt-5\.4(?!-mini)|o3|sonnet|grok-4/.test(id)) return "strong";
	return "standard";
}

function usageGuidance(model: Model<Api>): Pick<ModelCatalogRow, "useFor" | "avoidFor"> {
	const profile = modelProfile(model);
	if (profile === "local") {
		return {
			useFor: "local background work when latency is acceptable, concurrency is low, and the configured model's capability is sufficient",
			avoidFor: "interactive work, latency-sensitive tasks, tasks above the configured local model's capability, final review, or parallel/concurrent local-model tasks unless explicitly chosen",
		};
	}
	if (profile === "latency") {
		return {
			useFor: "latency-critical bounded tasks and quick scouts when very high speed is worth premium cost",
			avoidFor: "cheap routine delegation, bulk mechanical work, cost-sensitive tasks, risky architecture, final review",
		};
	}
	if (profile === "fast") {
		return {
			useFor: "routine edits, search, summaries, tests, bounded subagent tasks when low cost or lower scarcity matters",
			avoidFor: "risky architecture, subtle debugging, final review of high-impact changes",
		};
	}
	if (profile === "strong") {
		return {
			useFor: "hard reasoning, risky refactors, architecture, adversarial review",
			avoidFor: "mechanical searches or easy-to-verify chores when faster models suffice",
		};
	}
	return {
		useFor: "default implementation, debugging, review, moderate planning",
		avoidFor: "very mechanical chores if a faster model is available; highest-risk work if a stronger model is available",
	};
}

function unsupportedModels(): Map<string, UnsupportedModelInfo> {
	const unsupported = new Map<string, UnsupportedModelInfo>();
	for (const entry of readModelCatalogConfig().unsupportedModels ?? []) {
		if (typeof entry === "string") {
			unsupported.set(entry, { reason: "marked unsupported in model-catalog.json" });
			continue;
		}
		const fullId = entry.fullId ?? entry.model;
		if (!fullId) continue;
		unsupported.set(fullId, { reason: entry.reason ?? "marked unsupported in model-catalog.json" });
	}
	return unsupported;
}

function findModelById(ctx: ExtensionContext, id: string | undefined): Model<Api> | undefined {
	const needle = id?.trim();
	if (!needle) return undefined;
	for (const model of ctx.modelRegistry.getAll()) {
		const fullId = `${model.provider}/${model.id}`;
		if (fullId === needle || model.id === needle) return model;
	}
	return undefined;
}

function hasKnownPricing(model: Model<Api>): boolean {
	return isLocalModel(model) || model.cost.input > 0 || model.cost.output > 0 || model.cost.cacheRead > 0 || model.cost.cacheWrite > 0;
}

function pricingForModel(model: Model<Api>, baseline: Model<Api> | undefined): ModelPricing {
	const known = hasKnownPricing(model);
	const baselineKnown = baseline ? hasKnownPricing(baseline) : false;
	const baselineCost = baselineKnown ? baseline?.cost : undefined;
	const modelBlend = model.cost.input + model.cost.output;
	const baselineBlend = baselineCost ? baselineCost.input + baselineCost.output : 0;
	return {
		inputPerMillion: model.cost.input,
		outputPerMillion: model.cost.output,
		cacheReadPerMillion: model.cost.cacheRead,
		cacheWritePerMillion: model.cost.cacheWrite,
		known,
		relativeTo: baseline && baselineKnown ? `${baseline.provider}/${baseline.id}` : undefined,
		relativeInput: known && baselineCost && baselineCost.input > 0 ? model.cost.input / baselineCost.input : undefined,
		relativeOutput: known && baselineCost && baselineCost.output > 0 ? model.cost.output / baselineCost.output : undefined,
		relativeCacheRead: known && baselineCost && baselineCost.cacheRead > 0 ? model.cost.cacheRead / baselineCost.cacheRead : undefined,
		relativeBlended: known && baselineCost && baselineBlend > 0 ? modelBlend / baselineBlend : undefined,
	};
}

export function toRows(ctx: ExtensionContext, includeUnavailable: boolean, unsupportedMode: UnsupportedMode, query?: string, relativeTo?: string): ModelCatalogResult {
	const availableIds = new Set(ctx.modelRegistry.getAvailable().map((model) => `${model.provider}/${model.id}`));
	const enabledIds = new Set(readSettings().enabledModels ?? []);
	const unsupportedById = unsupportedModels();
	const models = includeUnavailable ? ctx.modelRegistry.getAll() : ctx.modelRegistry.getAvailable();
	const requestedBaselineId = relativeTo?.trim();
	const requestedBaseline = findModelById(ctx, requestedBaselineId);
	const baseline = requestedBaselineId ? requestedBaseline : ctx.model;
	const pricingBaseline = baseline && hasKnownPricing(baseline) ? `${baseline.provider}/${baseline.id}` : undefined;
	const pricingBaselineMissing = requestedBaselineId && !pricingBaseline ? requestedBaselineId : undefined;
	const allRows = models
		.filter((model) => matchesModel(model, query))
		.sort((a, b) => {
			const providerCmp = String(a.provider).localeCompare(String(b.provider));
			return providerCmp || a.id.localeCompare(b.id);
		})
		.map((model) => {
			const fullId = `${model.provider}/${model.id}`;
			const guidance = usageGuidance(model);
			const unsupported = unsupportedById.get(fullId);
			const thinkingLevels = getSupportedThinkingLevels(model);
			return {
				provider: String(model.provider),
				model: model.id,
				fullId,
				current: ctx.model ? ctx.model.provider === model.provider && ctx.model.id === model.id : false,
				available: availableIds.has(fullId),
				cycleEnabled: enabledIds.has(fullId),
				context: formatTokenCount(model.contextWindow),
				maxOut: formatTokenCount(model.maxTokens),
				thinking: model.reasoning ? "yes" : "no",
				thinkingLevels,
				thinkingLevelMap: model.thinkingLevelMap ? { ...model.thinkingLevelMap } : undefined,
				images: model.input.includes("image") ? "yes" : "no",
				cost: classifyCost(model),
				quota: classifyQuota(model),
				pricing: pricingForModel(model, baseline),
				supported: unsupported === undefined,
				unsupportedReason: unsupported?.reason,
				useFor: guidance.useFor,
				avoidFor: guidance.avoidFor,
			};
		});
	const excludedUnsupportedRows = allRows.filter((row) => !row.supported);
	const rows = unsupportedMode === "only"
		? excludedUnsupportedRows
		: unsupportedMode === "include"
			? allRows
			: allRows.filter((row) => row.supported);
	return { rows, excludedUnsupportedRows, pricingBaseline, pricingBaselineMissing };
}

export function table(result: ModelCatalogResult, includeDetails: boolean, unsupportedMode: UnsupportedMode, includePricing: boolean): string {
	const rows = result.rows;
	if (rows.length === 0) return result.excludedUnsupportedRows.length > 0 ? "No matching supported models. Call with unsupported: 'include' to show locally unsupported matches." : "No matching models.";
	const headers = includePricing
		? ["model", "auth", "support", "enabled", "ctx", "out", "caps", "think-levels", "price-tier", "quota", "in$/M", "out$/M", "rel-in", "rel-out", "rel-blend"]
		: ["model", "auth", "support", "enabled", "ctx", "out", "caps", "think-levels", "price-tier", "rel-cost", "quota"];
	const body = rows.map((row) => {
		const cells = [
			`${row.current ? "*" : ""}${row.fullId}`,
			row.available ? "yes" : "no",
			row.supported ? "yes" : "no",
			row.cycleEnabled ? "yes" : "no",
			row.context,
			row.maxOut,
			formatCapabilities(row),
			formatThinkingLevels(row.thinkingLevels),
			row.cost,
		];
		if (!includePricing) {
			cells.push(formatRatio(row.pricing.relativeBlended));
		}
		cells.push(row.quota);
		if (includePricing) {
			cells.push(
				formatPricePerMillion(row.pricing.inputPerMillion, row.pricing.known),
				formatPricePerMillion(row.pricing.outputPerMillion, row.pricing.known),
				formatRatio(row.pricing.relativeInput),
				formatRatio(row.pricing.relativeOutput),
				formatRatio(row.pricing.relativeBlended),
			);
		}
		return cells;
	});
	const widths = headers.map((header, index) => Math.max(header.length, ...body.map((cells) => cells[index].length)));
	const lines = [headers.map((header, index) => header.padEnd(widths[index])).join("  ")];
	for (const cells of body) {
		lines.push(cells.map((cell, index) => cell.padEnd(widths[index])).join("  "));
	}
	if (result.pricingBaseline) {
		lines.push("", includePricing
			? `Pricing: $/million tokens. Relative columns compare against ${result.pricingBaseline}; rel-blend uses input+output rates as a rough 1:1 token-mix weight.`
			: `rel-cost compares input+output rates against ${result.pricingBaseline}; pass relativeTo/--relative-to to choose a different baseline.`);
	} else if (result.pricingBaselineMissing) {
		lines.push("", `Pricing: relative baseline '${result.pricingBaselineMissing}' was not found or has no numeric pricing.`);
	} else if (includePricing) {
		lines.push("", "Pricing: $/million tokens. Pass relativeTo: 'provider/model-id' to include relative cost ratios.");
	}
	if (includeDetails) {
		lines.push("", "Usage guidance:");
		for (const row of rows) {
			const support = row.supported ? "" : ` Unsupported locally: ${row.unsupportedReason}.`;
			const pricing = includePricing
				? ` Pricing: input ${formatPricePerMillion(row.pricing.inputPerMillion, row.pricing.known)}/M, output ${formatPricePerMillion(row.pricing.outputPerMillion, row.pricing.known)}/M${row.pricing.relativeTo ? `, relative to ${row.pricing.relativeTo}: input ${formatRatio(row.pricing.relativeInput)}, output ${formatRatio(row.pricing.relativeOutput)}, blended ${formatRatio(row.pricing.relativeBlended)}` : ""}.`
				: "";
			lines.push(`- ${row.fullId}: thinking levels ${row.thinkingLevels.join(", ") || "none"}; use for ${row.useFor}; avoid for ${row.avoidFor}.${pricing}${support}`);
		}
	}
	if (unsupportedMode === "exclude" && result.excludedUnsupportedRows.length > 0) {
		lines.push("", `Excluded ${result.excludedUnsupportedRows.length} locally unsupported model(s). Call with unsupported: 'include' to show them.`);
	}
	lines.push("", "Notes: think-levels are Pi thinking level names (off/minimal/low/medium/high/xhigh; table abbreviates minimal=min, medium=med, xhigh=xhi). `off` corresponds to provider no/none thinking when supported. Structured details include full thinkingLevels and any thinkingLevelMap provider mapping. price-tier uses input+output $/million-token rates from Pi's local model registry: low ≤ $1, medium ≤ $8, high ≤ $30, premium > $30; local models are free/local and spark models are premium-speed. Local models are usually free from API billing but can be slow and effectively serial/concurrency-constrained: avoid using multiple local models or many same-local-model tasks at once unless your local backend supports it. Numeric prices may be nominal weights for subscription-backed providers. Zero/blank pricing outside free/local can mean unknown, bundled, or non-metered rather than free. Quota is guidance, not live remaining quota. Support is a local compatibility hint, not provider live availability.");
	return lines.join("\n");
}
