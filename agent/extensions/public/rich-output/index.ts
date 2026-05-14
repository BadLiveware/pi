import { Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { MESSAGE_TYPE, coerceCard, demoCard, isRecord, normalizeBlocks, stringValue, type RichOutputCard, type RichOutputKind } from "./src/model.ts";
import { prepareBlocks } from "./src/artifacts.ts";
import { renderCard } from "./src/renderer.ts";
import { richOutputParameters } from "./src/schema.ts";

export default function richOutput(pi: ExtensionAPI): void {
	pi.registerMessageRenderer<RichOutputCard>(MESSAGE_TYPE, (message, _options, theme) => {
		const card = coerceCard(message.details);
		if (!card) return undefined;
		return renderCard(card, theme);
	});

	pi.registerTool({
		name: "rich_output_present",
		label: "Present Rich Output",
		description: "Present generic terminal-native rich output blocks when structure or visuals help. Use prose by default for simple answers; use diagrams when they genuinely clarify complex flows, architecture, state, or relationships. Mermaid diagrams are pre-rendered and capped for safety; keep entries focused and avoid duplicating rendered diagrams with long source unless showSource is needed.",
		renderShell: "self",
		parameters: richOutputParameters,
		async execute(_toolCallId, params) {
			const input = params as Record<string, unknown>;
			const card: RichOutputCard = {
				kind: input.kind as RichOutputKind,
				style: input.style === "card" ? "card" : "inline",
				title: stringValue(input.title) ?? "Rich output",
				summary: stringValue(input.summary),
				markdown: stringValue(input.markdown),
				payload: input.payload,
				blocks: prepareBlocks(normalizeBlocks(input.blocks)),
				createdAt: new Date().toISOString(),
			};
			pi.sendMessage({ customType: MESSAGE_TYPE, content: card.title, display: true, details: card });
			pi.appendEntry(MESSAGE_TYPE, card);
			return {
				content: [{ type: "text", text: `presented ${card.kind}: ${card.title}` }],
				details: card,
			};
		},
		renderCall(args, theme) {
			const input: Record<string, unknown> = isRecord(args) ? args : {};
			const kind = stringValue(input.kind) ?? "entry";
			const title = stringValue(input.title) ?? "Rich output";
			return new Text(`${theme.fg("accent", "rich_output_present")} ${theme.fg("dim", `${kind}: ${title}`)}`, 0, 0);
		},
		renderResult(result, _options, theme) {
			const details = isRecord(result) ? coerceCard(result.details) : undefined;
			const kind = details?.kind ?? "entry";
			const title = details?.title ?? "Rich output";
			return new Text(theme.fg("dim", `✓ presented ${kind}: ${title}`), 0, 0);
		},
	});

	pi.registerCommand("rich-output-demo", {
		description: "Show a prototype generic rich output timeline entry",
		handler: async () => {
			const demo = demoCard();
			const card = { ...demo, blocks: prepareBlocks(demo.blocks) };
			pi.sendMessage({ customType: MESSAGE_TYPE, content: card.title, display: true, details: card });
			pi.appendEntry(MESSAGE_TYPE, card);
		},
	});
}
