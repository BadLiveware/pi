import { Type } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Box, Markdown, type MarkdownTheme, Text } from "@mariozechner/pi-tui";

const MESSAGE_TYPE = "rich-output:card";

type RichOutputKind = "report" | "findings" | "validation" | "benchmark" | "stardock" | "table" | "note";

interface RichOutputCard {
	kind: RichOutputKind;
	title: string;
	summary?: string;
	markdown?: string;
	payload?: unknown;
	createdAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function arrayValue(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function escapeCell(value: unknown): string {
	return String(value ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}

function tableMarkdown(columns: string[], rows: unknown[][]): string {
	if (columns.length === 0) return "";
	const header = `| ${columns.map(escapeCell).join(" | ")} |`;
	const sep = `| ${columns.map(() => "---").join(" | ")} |`;
	const body = rows.map((row) => `| ${columns.map((_, index) => escapeCell(row[index])).join(" | ")} |`);
	return [header, sep, ...body].join("\n");
}

function payloadTable(payload: unknown): string | undefined {
	if (!isRecord(payload)) return undefined;
	const columns = arrayValue(payload.columns).map((column) => stringValue(column)).filter((column): column is string => Boolean(column));
	if (columns.length === 0) return undefined;
	const rawRows = arrayValue(payload.rows);
	const rows = rawRows.map((row) => Array.isArray(row) ? row : columns.map((column) => isRecord(row) ? row[column] : undefined));
	return tableMarkdown(columns, rows);
}

function findingsMarkdown(payload: unknown): string | undefined {
	if (!isRecord(payload)) return undefined;
	const findings = arrayValue(payload.findings).filter(isRecord);
	const gaps = arrayValue(payload.gaps).map((gap) => String(gap));
	const lines: string[] = [];
	for (const finding of findings) {
		const severity = stringValue(finding.severity)?.toUpperCase() ?? "INFO";
		const location = stringValue(finding.location) ?? "unknown location";
		const title = stringValue(finding.title) ?? "Untitled finding";
		lines.push(`- **${severity}** \`${location}\` — ${title}`);
		for (const key of ["evidence", "impact", "suggestedFix"] as const) {
			const value = stringValue(finding[key]);
			if (value) lines.push(`  - **${key}:** ${value}`);
		}
	}
	if (gaps.length > 0) {
		lines.push("", "**Gaps**");
		for (const gap of gaps) lines.push(`- ${gap}`);
	}
	return lines.length > 0 ? lines.join("\n") : undefined;
}

function validationMarkdown(payload: unknown): string | undefined {
	if (!isRecord(payload)) return undefined;
	const commands = arrayValue(payload.commands).filter(isRecord);
	const rows = commands.map((command) => [
		stringValue(command.command) ?? "manual check",
		stringValue(command.result)?.toUpperCase() ?? "UNKNOWN",
		stringValue(command.duration) ?? "",
		stringValue(command.summary) ?? "",
	]);
	const lines = rows.length > 0 ? [tableMarkdown(["Command", "Result", "Duration", "Summary"], rows)] : [];
	const gaps = arrayValue(payload.gaps).map((gap) => String(gap));
	if (gaps.length > 0) {
		lines.push("", "**Validation gaps**", ...gaps.map((gap) => `- ${gap}`));
	}
	return lines.length > 0 ? lines.join("\n") : undefined;
}

function stardockMarkdown(payload: unknown): string | undefined {
	if (!isRecord(payload)) return undefined;
	const lines: string[] = [];
	for (const [label, key] of [
		["Objective", "objective"],
		["Criteria", "criteria"],
		["Latest attempt", "latestAttempt"],
		["Governor steer", "governorSteer"],
		["Next brief", "nextBrief"],
	] as const) {
		const value = stringValue(payload[key]);
		if (value) lines.push(`- **${label}:** ${value}`);
	}
	return lines.length > 0 ? lines.join("\n") : undefined;
}

function generatedMarkdown(card: RichOutputCard): string {
	const lines: string[] = [];
	if (card.summary) lines.push(card.summary);
	const generated = card.kind === "findings"
		? findingsMarkdown(card.payload)
		: card.kind === "validation"
			? validationMarkdown(card.payload)
			: card.kind === "table" || card.kind === "benchmark"
				? payloadTable(card.payload)
				: card.kind === "stardock"
					? stardockMarkdown(card.payload)
					: undefined;
	if (generated) lines.push(generated);
	if (card.markdown) lines.push(card.markdown);
	return lines.join("\n\n");
}

function markdownTheme(theme: any): MarkdownTheme {
	return {
		heading: (text) => theme.fg("accent", text),
		link: (text) => theme.fg("accent", text),
		linkUrl: (text) => theme.fg("dim", text),
		code: (text) => theme.fg("warning", text),
		codeBlock: (text) => text,
		codeBlockBorder: (text) => theme.fg("dim", text),
		quote: (text) => theme.fg("dim", text),
		quoteBorder: (text) => theme.fg("dim", text),
		hr: (text) => theme.fg("dim", text),
		listBullet: (text) => theme.fg("accent", text),
		bold: (text) => theme.bold(text),
		italic: (text) => text,
		strikethrough: (text) => text,
		underline: (text) => text,
	};
}

function renderTitle(card: RichOutputCard, theme: any): string {
	const kind = theme.fg("dim", card.kind);
	return `${theme.fg("accent", theme.bold(card.title))} ${kind}`;
}

function demoCard(): RichOutputCard {
	return {
		kind: "validation",
		title: "Rich output prototype",
		summary: "Timeline-native card rendered from structured data, with Markdown fallback.",
		payload: {
			commands: [
				{ command: "npm run typecheck", result: "passed", duration: "4.1s", summary: "TypeScript accepted the prototype." },
				{ command: "npm test", result: "skipped", summary: "Demo card only; no runtime tests were launched." },
			],
			gaps: ["This is a first-pass renderer, not a full artifact framework."],
		},
		createdAt: new Date().toISOString(),
	};
}

export default function richOutput(pi: ExtensionAPI): void {
	pi.registerMessageRenderer<RichOutputCard>(MESSAGE_TYPE, (message, { expanded }, theme) => {
		const details = message.details;
		if (!details || details.kind === undefined) return undefined;
		const card = details as RichOutputCard;
		const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
		box.addChild(new Text(renderTitle(card, theme), 0, 0));
		const markdown = generatedMarkdown(card);
		box.addChild(new Markdown(markdown, 0, 1, markdownTheme(theme)));
		return box;
	});

	pi.registerTool({
		name: "rich_output_present",
		label: "Present Rich Output",
		description: "Present a structured report, findings list, validation summary, benchmark table, Stardock status, or note as a custom Pi timeline card.",
		renderShell: "self",
		parameters: Type.Object({
			kind: Type.Union([Type.Literal("report"), Type.Literal("findings"), Type.Literal("validation"), Type.Literal("benchmark"), Type.Literal("stardock"), Type.Literal("table"), Type.Literal("note")], { description: "Presentation intent for the renderer." }),
			title: Type.String({ description: "Short title for the timeline card." }),
			summary: Type.Optional(Type.String({ description: "One or two sentence compact summary shown in collapsed rendering." })),
			markdown: Type.Optional(Type.String({ description: "Optional Markdown fallback or additional details." })),
			payload: Type.Optional(Type.Unknown({ description: "Optional structured payload. Supported shapes include findings[], commands[], columns+rows, or Stardock status fields." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const input = params as Record<string, unknown>;
			const card: RichOutputCard = {
				kind: input.kind as RichOutputKind,
				title: stringValue(input.title) ?? "Rich output",
				summary: stringValue(input.summary),
				markdown: stringValue(input.markdown),
				payload: input.payload,
				createdAt: new Date().toISOString(),
			};
			pi.sendMessage({ customType: MESSAGE_TYPE, content: card.title, display: true, details: card });
			pi.appendEntry(MESSAGE_TYPE, card);
			return { content: [{ type: "text", text: `presented ${card.kind}: ${card.title}` }], details: card };
		},
		renderCall(args, theme) {
			const kind = stringValue((args as Record<string, unknown>).kind) ?? "card";
			const title = stringValue((args as Record<string, unknown>).title) ?? "Rich output";
			return new Text(`${theme.fg("accent", "rich_output_present")} ${theme.fg("dim", `${kind}: ${title}`)}`, 0, 0);
		},
		renderResult(result, _options, theme) {
			const details = result.details as RichOutputCard | undefined;
			const kind = details?.kind ?? "card";
			const title = details?.title ?? "Rich output";
			return new Text(theme.fg("dim", `✓ presented ${kind}: ${title}`), 0, 0);
		},
	});

	pi.registerCommand("rich-output-demo", {
		description: "Show a prototype rich output timeline card",
		handler: async (_args, _ctx) => {
			const card = demoCard();
			pi.sendMessage({ customType: MESSAGE_TYPE, content: card.title, display: true, details: card });
			pi.appendEntry(MESSAGE_TYPE, card);
		},
	});
}
