import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Api, Model } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
// @ts-ignore The Pi extension runtime provides typebox, but this package does not ship declarations in current Pi installs.
import { Type } from "typebox";

type UnsupportedMode = "exclude" | "include" | "only";

interface ListPiModelsParams {
	query?: string;
	includeUnavailable?: boolean;
	includeDetails?: boolean;
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
	images: string;
	cost: string;
	quota: string;
	supported: boolean;
	unsupportedReason?: string;
	useFor: string;
	avoidFor: string;
}

interface ModelCatalogResult {
	rows: ModelCatalogRow[];
	excludedUnsupportedRows: ModelCatalogRow[];
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

function matchesModel(model: Model<Api>, query: string | undefined): boolean {
	if (!query?.trim()) return true;
	const needle = query.trim().toLowerCase();
	return `${model.provider} ${model.id} ${model.name}`.toLowerCase().includes(needle);
}

function classifyCost(model: Model<Api>): string {
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
	if (/spark|mini|flash|lite|haiku|small/.test(id)) return "fast/limited";
	if (/opus|pro|gpt-5\.5|o3|sonnet|grok-4/.test(id)) return "scarce";
	if (provider.includes("codex") || provider.includes("copilot")) return "subscription";
	return "standard";
}

function modelStrength(model: Model<Api>): "fast" | "standard" | "strong" {
	const id = model.id.toLowerCase();
	if (/spark|mini|flash|lite|haiku|small/.test(id)) return "fast";
	if (/opus|pro|gpt-5\.5|gpt-5\.4(?!-mini)|o3|sonnet|grok-4/.test(id)) return "strong";
	return "standard";
}

function usageGuidance(model: Model<Api>): Pick<ModelCatalogRow, "useFor" | "avoidFor"> {
	const strength = modelStrength(model);
	if (strength === "fast") {
		return {
			useFor: "routine edits, search, summaries, tests, bounded subagent tasks",
			avoidFor: "risky architecture, subtle debugging, final review of high-impact changes",
		};
	}
	if (strength === "strong") {
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
	const unsupported = new Map<string, UnsupportedModelInfo>([
		[
			"openai-codex/gpt-5.1-codex-mini",
			{ reason: "not supported by Codex with the configured ChatGPT account" },
		],
	]);
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

function toRows(ctx: ExtensionContext, includeUnavailable: boolean, unsupportedMode: UnsupportedMode, query?: string): ModelCatalogResult {
	const availableIds = new Set(ctx.modelRegistry.getAvailable().map((model) => `${model.provider}/${model.id}`));
	const enabledIds = new Set(readSettings().enabledModels ?? []);
	const unsupportedById = unsupportedModels();
	const models = includeUnavailable ? ctx.modelRegistry.getAll() : ctx.modelRegistry.getAvailable();
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
				images: model.input.includes("image") ? "yes" : "no",
				cost: classifyCost(model),
				quota: classifyQuota(model),
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
	return { rows, excludedUnsupportedRows };
}

function table(result: ModelCatalogResult, includeDetails: boolean, unsupportedMode: UnsupportedMode): string {
	const rows = result.rows;
	if (rows.length === 0) return result.excludedUnsupportedRows.length > 0 ? "No matching supported models. Call with unsupported: 'include' to show locally unsupported matches." : "No matching models.";
	const headers = ["provider", "model", "auth", "support", "context", "max-out", "thinking", "images", "cost", "quota", "enabled"];
	const body = rows.map((row) => [
		row.provider,
		`${row.current ? "*" : ""}${row.model}`,
		row.available ? "yes" : "no",
		row.supported ? "yes" : "no",
		row.context,
		row.maxOut,
		row.thinking,
		row.images,
		row.cost,
		row.quota,
		row.cycleEnabled ? "yes" : "no",
	]);
	const widths = headers.map((header, index) => Math.max(header.length, ...body.map((cells) => cells[index].length)));
	const lines = [headers.map((header, index) => header.padEnd(widths[index])).join("  ")];
	for (const cells of body) {
		lines.push(cells.map((cell, index) => cell.padEnd(widths[index])).join("  "));
	}
	if (includeDetails) {
		lines.push("", "Usage guidance:");
		for (const row of rows) {
			const support = row.supported ? "" : ` Unsupported locally: ${row.unsupportedReason}.`;
			lines.push(`- ${row.fullId}: use for ${row.useFor}; avoid for ${row.avoidFor}.${support}`);
		}
	}
	if (unsupportedMode === "exclude" && result.excludedUnsupportedRows.length > 0) {
		lines.push("", `Excluded ${result.excludedUnsupportedRows.length} locally unsupported model(s). Call with unsupported: 'include' to show them.`);
	}
	lines.push("", "Notes: cost/quota are guidance tiers, not live billing or remaining quota. Support is a local compatibility hint, not provider live availability.");
	return lines.join("\n");
}

const listPiModelsParameters = Type.Object({
	query: Type.Optional(Type.String({ description: "Optional substring filter, e.g. 'mini', 'codex', 'sonnet'." })),
	includeUnavailable: Type.Optional(Type.Boolean({ description: "Include models without configured auth. Default false." })),
	includeDetails: Type.Optional(Type.Boolean({ description: "Include use/avoid guidance for each returned model. Default true." })),
	unsupported: Type.Optional(Type.Union([
		Type.Literal("exclude"),
		Type.Literal("include"),
		Type.Literal("only"),
	], { description: "How to handle locally unsupported models. Default 'exclude'." })),
});

export default function modelCatalog(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "list_pi_models",
		label: "List Pi Models",
		description: "List available Pi models with context, output, thinking/images, enabled status, support status, and cost/quota guidance.",
		promptSnippet: "List/query Pi models and model-selection guidance.",
		promptGuidelines: [
			"Use list_pi_models before choosing or recommending a model when current model availability, local support status, cost, quota, or capability matters.",
			"list_pi_models excludes locally unsupported models by default; use unsupported: 'include' or 'only' only for diagnostics.",
			"list_pi_models cost/quota fields are guidance tiers, not live remaining quota.",
		],
		parameters: listPiModelsParameters,
		async execute(_toolCallId: string, params: ListPiModelsParams, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			const includeUnavailable = params.includeUnavailable === true;
			const includeDetails = params.includeDetails !== false;
			const unsupportedMode = params.unsupported ?? "exclude";
			const result = toRows(ctx, includeUnavailable, unsupportedMode, params.query);
			return {
				content: [{ type: "text", text: table(result, includeDetails, unsupportedMode) }],
				details: {
					models: result.rows,
					excludedUnsupportedModels: result.excludedUnsupportedRows,
				},
			};
		},
	});

	pi.registerCommand("models-guide", {
		description: "Show available Pi models with cost/quota guidance",
		handler: async (args: string, ctx: ExtensionContext) => {
			const result = toRows(ctx, false, "exclude", args.trim() || undefined);
			ctx.ui.notify(table(result, false, "exclude"), "info");
		},
	});
}
