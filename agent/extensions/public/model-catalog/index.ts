import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
// @ts-ignore The Pi extension runtime provides typebox, but this package does not ship declarations in current Pi installs.
import { Type } from "typebox";
import { parseModelsGuideArgs, table, toRows, type ListPiModelsParams, type UnsupportedMode } from "./catalog.ts";

const listPiModelsParameters = Type.Object({
	query: Type.Optional(Type.String({ description: "Optional substring filter, e.g. 'mini', 'codex', 'sonnet'." })),
	includeUnavailable: Type.Optional(Type.Boolean({ description: "Include models without configured auth. Default false." })),
	includeDetails: Type.Optional(Type.Boolean({ description: "Include verbose use/avoid guidance for each returned model. Default false." })),
	includePricing: Type.Optional(Type.Boolean({ description: "Include numeric pricing columns from Pi's model registry. Prices are $/million tokens. Default false." })),
	relativeTo: Type.Optional(Type.String({ description: "Optional baseline model for relative pricing, e.g. 'openai-codex/gpt-5.4'. Use with includePricing." })),
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
		description: "List available Pi models with concise decision fields by default, plus supported thinking levels, optional verbose guidance, and numeric pricing.",
		promptSnippet: "List/query Pi models, supported thinking levels, model-selection guidance, and optional pricing.",
		promptGuidelines: [
			"Use list_pi_models before choosing or recommending a model when current model availability, local support status, cost, quota, thinking levels, or capability matters.",
			"For model overrides, choose rows with support yes and enabled yes unless the user explicitly authorizes configuration changes; auth yes alone only means credentials exist.",
			"list_pi_models excludes locally unsupported models by default; use unsupported: 'include' or 'only' only for diagnostics.",
			"Interpret list_pi_models fields as local guidance: support is local compatibility, quota is not live remaining quota, numeric pricing can be nominal/unknown, and rel-cost/rel-blend are rough local-registry ratios.",
			"list_pi_models thinking levels are Pi names: off means provider no/none thinking when supported, and compact table abbreviations min/med/xhi mean minimal/medium/xhigh.",
			"Treat local/free models as potentially slow or serial unless the local backend is known to support concurrent use; spark models are premium-speed, not cheap/mini substitutes.",
			"Default output is intentionally concise; request includeDetails: true only when use/avoid prose would materially help selection.",
			"When precise cost comparisons matter, pass includePricing: true and relativeTo: 'provider/model-id'.",
		],
		parameters: listPiModelsParameters,
		async execute(_toolCallId: string, params: ListPiModelsParams, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			const includeUnavailable = params.includeUnavailable === true;
			const includeDetails = params.includeDetails === true;
			const unsupportedMode: UnsupportedMode = params.unsupported ?? "exclude";
			const includePricing = params.includePricing === true;
			const result = toRows(ctx, includeUnavailable, unsupportedMode, params.query, params.relativeTo);
			return {
				content: [{ type: "text", text: table(result, includeDetails, unsupportedMode, includePricing) }],
				details: {
					models: result.rows,
					excludedUnsupportedModels: result.excludedUnsupportedRows,
				},
			};
		},
	});

	pi.registerCommand("models-guide", {
		description: "Show available Pi models and supported thinking levels with concise defaults. Use --verbose for details, or --pricing and --relative-to provider/model-id for numeric ratios.",
		handler: async (args: string, ctx: ExtensionContext) => {
			const parsed = parseModelsGuideArgs(args);
			const result = toRows(ctx, false, "exclude", parsed.query, parsed.relativeTo);
			ctx.ui.notify(table(result, parsed.includeDetails === true, "exclude", parsed.includePricing === true), "info");
		},
	});
}
