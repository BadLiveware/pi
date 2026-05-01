import { Type } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Box, type Component, Markdown, type MarkdownTheme, Text, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";

const MESSAGE_TYPE = "rich-output:card";

type RichOutputKind = "report" | "findings" | "validation" | "benchmark" | "stardock" | "table" | "note";
type RichOutputStyle = "inline" | "card";

type RichBlockType = "heading" | "text" | "formula" | "diagram" | "table" | "tree" | "progress" | "code" | "callout" | "kv" | "rule";

interface RichBlock {
	type: RichBlockType;
	text?: string;
	level?: number;
	latex?: string;
	fallback?: string;
	language?: string;
	tone?: "info" | "success" | "warning" | "error";
	label?: string;
	value?: string | number | boolean;
	total?: number;
	columns?: string[];
	rows?: unknown[][];
	items?: unknown[];
	nodes?: unknown[];
	edges?: unknown[];
}

interface RichOutputCard {
	kind: RichOutputKind;
	style?: RichOutputStyle;
	title: string;
	summary?: string;
	markdown?: string;
	payload?: unknown;
	blocks?: RichBlock[];
	createdAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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

function normalizeBlocks(value: unknown): RichBlock[] | undefined {
	const blocks = arrayValue(value).filter(isRecord).map((block): RichBlock | undefined => {
		const type = stringValue(block.type);
		if (!type || !["heading", "text", "formula", "diagram", "table", "tree", "progress", "code", "callout", "kv", "rule"].includes(type)) return undefined;
		return {
			type: type as RichBlockType,
			text: stringValue(block.text),
			level: numberValue(block.level),
			latex: stringValue(block.latex),
			fallback: stringValue(block.fallback),
			language: stringValue(block.language),
			tone: stringValue(block.tone) as RichBlock["tone"],
			label: stringValue(block.label),
			value: typeof block.value === "string" || typeof block.value === "number" || typeof block.value === "boolean" ? block.value : undefined,
			total: numberValue(block.total),
			columns: arrayValue(block.columns).map((column) => stringValue(column)).filter((column): column is string => Boolean(column)),
			rows: arrayValue(block.rows).filter(Array.isArray) as unknown[][],
			items: arrayValue(block.items),
			nodes: arrayValue(block.nodes),
			edges: arrayValue(block.edges),
		};
	}).filter((block): block is RichBlock => Boolean(block));
	return blocks.length > 0 ? blocks : undefined;
}

function approximateLatex(input: string): string {
	let text = input;
	const replacements: Array<[RegExp, string]> = [
		[/\\infty/g, "∞"],
		[/\\pi/g, "π"],
		[/\\alpha/g, "α"],
		[/\\beta/g, "β"],
		[/\\gamma/g, "γ"],
		[/\\Delta/g, "Δ"],
		[/\\lambda/g, "λ"],
		[/\\mu/g, "μ"],
		[/\\sigma/g, "σ"],
		[/\\theta/g, "θ"],
		[/\\sum/g, "∑"],
		[/\\int/g, "∫"],
		[/\\sqrt\{([^{}]+)\}/g, "√($1)"],
		[/\\cdot/g, "·"],
		[/\\times/g, "×"],
		[/\\leq?/g, "≤"],
		[/\\geq?/g, "≥"],
		[/\\neq/g, "≠"],
		[/\\to/g, "→"],
		[/\\,|\\;/g, " "],
	];
	for (const [pattern, replacement] of replacements) text = text.replace(pattern, replacement);
	text = text.replace(/\^\{2\}|\^2/g, "²").replace(/\^\{3\}|\^3/g, "³").replace(/_\{([^{}]+)\}/g, "₍$1₎").replace(/\{([^{}]+)\}/g, "$1");
	return text.replace(/\s+/g, " ").trim();
}

function styleForTone(theme: any, tone?: RichBlock["tone"]): string {
	return tone === "error" ? "error" : tone === "warning" ? "warning" : tone === "success" ? "success" : "accent";
}

function progressLine(block: RichBlock, theme: any, width: number): string {
	const label = block.label ?? "progress";
	const value = typeof block.value === "number" ? block.value : Number(block.value ?? 0);
	const total = block.total && block.total > 0 ? block.total : 100;
	const ratio = Math.max(0, Math.min(1, value / total));
	const barWidth = Math.max(6, Math.min(24, width - label.length - 16));
	const filled = Math.round(barWidth * ratio);
	const bar = `${"█".repeat(filled)}${"░".repeat(Math.max(0, barWidth - filled))}`;
	return `${theme.fg("accent", label)}  ${bar}  ${value}/${total}`;
}

function tableLines(columns: string[], rows: unknown[][], theme: any, width: number): string[] {
	if (columns.length === 0) return [];
	const maxWidth = Math.max(20, width);
	const natural = columns.map((column, index) => Math.max(visibleWidth(column), ...rows.map((row) => visibleWidth(escapeCell(row[index])))));
	const borderOverhead = 3 * columns.length + 1;
	let available = Math.max(columns.length * 4, maxWidth - borderOverhead);
	const widths = natural.map((w) => Math.min(w, Math.max(4, Math.floor(available / columns.length))));
	let used = widths.reduce((sum, w) => sum + w, 0);
	for (let i = 0; used < available && i < widths.length; i = (i + 1) % widths.length) {
		if (widths[i] < natural[i]) {
			widths[i]++;
			used++;
		} else if (widths.every((w, idx) => w >= natural[idx])) break;
	}
	const fit = (value: unknown, index: number) => truncateToWidth(escapeCell(value), widths[index]).padEnd(widths[index]);
	const border = (left: string, mid: string, right: string) => `${left}${widths.map((w) => "─".repeat(w + 2)).join(mid)}${right}`;
	const line = (values: unknown[]) => `│ ${columns.map((_, index) => fit(values[index], index)).join(" │ ")} │`;
	return [
		theme.fg("dim", border("┌", "┬", "┐")),
		line(columns.map((column) => theme.bold(column))),
		theme.fg("dim", border("├", "┼", "┤")),
		...rows.map(line),
		theme.fg("dim", border("└", "┴", "┘")),
	];
}

function diagramLines(block: RichBlock): string[] {
	const edgeLines = block.edges?.map((edge) => {
		if (Array.isArray(edge)) return edge.map((item) => String(item)).join(" ─▶ ");
		if (isRecord(edge)) return `${edge.from ?? "?"} ─▶ ${edge.to ?? "?"}`;
		return String(edge);
	}) ?? [];
	if (edgeLines.length > 0) return edgeLines;
	return block.text ? block.text.split("\n") : [];
}

function treeLines(items: unknown[], theme: any, prefix = ""): string[] {
	const lines: string[] = [];
	items.forEach((item, index) => {
		const last = index === items.length - 1;
		const branch = last ? "└─ " : "├─ ";
		const childPrefix = `${prefix}${last ? "   " : "│  "}`;
		if (isRecord(item)) {
			lines.push(`${theme.fg("dim", prefix + branch)}${String(item.label ?? item.name ?? "item")}`);
			const children = arrayValue(item.children);
			if (children.length > 0) lines.push(...treeLines(children, theme, childPrefix));
		} else {
			lines.push(`${theme.fg("dim", prefix + branch)}${String(item)}`);
		}
	});
	return lines;
}

function blockLines(block: RichBlock, theme: any, width: number): string[] {
	switch (block.type) {
		case "heading": {
			const marks = "#".repeat(Math.max(1, Math.min(4, Math.floor(block.level ?? 2))));
			return [theme.fg("accent", theme.bold(`${marks} ${block.text ?? ""}`))];
		}
		case "text":
			return wrapTextWithAnsi(block.text ?? "", width);
		case "formula": {
			const formula = block.fallback ?? (block.latex ? approximateLatex(block.latex) : block.text ?? "");
			const raw = block.latex && formula !== block.latex ? theme.fg("dim", `  ${block.latex}`) : undefined;
			return [theme.fg("accent", `ƒ ${formula}`), ...(raw ? [raw] : [])];
		}
		case "diagram":
			return diagramLines(block).map((line) => theme.fg("accent", line));
		case "table":
			return tableLines(block.columns ?? [], block.rows ?? [], theme, width);
		case "tree":
			return treeLines(block.items ?? [], theme);
		case "progress":
			return [progressLine(block, theme, width)];
		case "code": {
			const language = block.language ? ` ${block.language}` : "";
			return [theme.fg("dim", `┌─ code${language}`), ...(block.text ?? "").split("\n").map((line) => `│ ${line}`), theme.fg("dim", "└─")];
		}
		case "callout": {
			const icon = block.tone === "error" ? "✖" : block.tone === "warning" ? "⚠" : block.tone === "success" ? "✓" : "ℹ";
			return wrapTextWithAnsi(`${theme.fg(styleForTone(theme, block.tone), icon)} ${block.text ?? ""}`, width);
		}
		case "kv":
			return [`${theme.fg("accent", block.label ?? "value")}: ${String(block.value ?? block.text ?? "")}`];
		case "rule":
			return [theme.fg("dim", "─".repeat(Math.min(width, 80)))];
	}
}

class RichOutputComponent implements Component {
	private card: RichOutputCard;
	private theme: any;

	constructor(card: RichOutputCard, theme: any) {
		this.card = card;
		this.theme = theme;
	}

	render(width: number): string[] {
		const lines: string[] = [];
		lines.push(`${this.theme.fg("accent", this.theme.bold(this.card.title))} ${this.theme.fg("dim", this.card.kind)}`);
		if (this.card.summary) lines.push(...wrapTextWithAnsi(this.card.summary, width));
		const blocks = this.card.blocks;
		if (blocks && blocks.length > 0) {
			if (this.card.summary) lines.push("");
			for (const block of blocks) {
				const rendered = blockLines(block, this.theme, width);
				if (rendered.length > 0) lines.push(...rendered, "");
			}
			while (lines.at(-1) === "") lines.pop();
			return lines.map((line) => visibleWidth(line) > width ? truncateToWidth(line, width) : line);
		}
		const markdown = generatedMarkdown(this.card);
		if (markdown) {
			const md = new Markdown(markdown, 0, this.card.summary ? 1 : 0, markdownTheme(this.theme));
			lines.push(...md.render(width));
		}
		return lines.map((line) => visibleWidth(line) > width ? truncateToWidth(line, width) : line);
	}

	invalidate(): void {}
}

function renderCard(card: RichOutputCard, theme: any): Component {
	const component = new RichOutputComponent(card, theme);
	if (card.style === "card") {
		const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
		box.addChild(component);
		return box;
	}
	return component;
}

function demoCard(): RichOutputCard {
	return {
		kind: "note",
		style: "inline",
		title: "Rich output prototype",
		summary: "Terminal-native blocks rendered from structured data.",
		blocks: [
			{ type: "formula", latex: "\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}" },
			{ type: "diagram", edges: [["Agent", "Tool"], ["Tool", "Timeline renderer"]] },
			{ type: "progress", label: "Blocks", value: 8, total: 10 },
			{ type: "callout", tone: "warning", text: "This is a prototype; rendering is terminal-native and approximate." },
		],
		createdAt: new Date().toISOString(),
	};
}

export default function richOutput(pi: ExtensionAPI): void {
	pi.registerMessageRenderer<RichOutputCard>(MESSAGE_TYPE, (message, _options, theme) => {
		const details = message.details;
		if (!details || details.kind === undefined) return undefined;
		return renderCard(details as RichOutputCard, theme);
	});

	pi.registerTool({
		name: "rich_output_present",
		label: "Present Rich Output",
		description: "Present generic terminal-native rich output blocks or legacy structured report/findings/validation/table payloads in the Pi timeline.",
		renderShell: "self",
		parameters: Type.Object({
			kind: Type.Union([Type.Literal("report"), Type.Literal("findings"), Type.Literal("validation"), Type.Literal("benchmark"), Type.Literal("stardock"), Type.Literal("table"), Type.Literal("note")], { description: "Presentation intent for legacy payload renderers or broad grouping for generic blocks." }),
			style: Type.Optional(Type.Union([Type.Literal("inline"), Type.Literal("card")], { description: "Visual style. inline blends with normal timeline output; card adds a background box." })),
			title: Type.String({ description: "Short title for the timeline entry." }),
			summary: Type.Optional(Type.String({ description: "One or two sentence compact summary." })),
			blocks: Type.Optional(Type.Array(Type.Object({
				type: Type.Union([Type.Literal("heading"), Type.Literal("text"), Type.Literal("formula"), Type.Literal("diagram"), Type.Literal("table"), Type.Literal("tree"), Type.Literal("progress"), Type.Literal("code"), Type.Literal("callout"), Type.Literal("kv"), Type.Literal("rule")]),
				text: Type.Optional(Type.String()),
				level: Type.Optional(Type.Number()),
				latex: Type.Optional(Type.String()),
				fallback: Type.Optional(Type.String()),
				language: Type.Optional(Type.String()),
				tone: Type.Optional(Type.Union([Type.Literal("info"), Type.Literal("success"), Type.Literal("warning"), Type.Literal("error")])),
				label: Type.Optional(Type.String()),
				value: Type.Optional(Type.Unknown()),
				total: Type.Optional(Type.Number()),
				columns: Type.Optional(Type.Array(Type.String())),
				rows: Type.Optional(Type.Array(Type.Array(Type.Unknown()))),
				items: Type.Optional(Type.Array(Type.Unknown())),
				nodes: Type.Optional(Type.Array(Type.Unknown())),
				edges: Type.Optional(Type.Array(Type.Unknown())),
			}), { description: "Generic terminal-native components to render. Prefer blocks when the output is not domain-specific." })),
			markdown: Type.Optional(Type.String({ description: "Optional Markdown fallback or additional details for legacy rendering." })),
			payload: Type.Optional(Type.Unknown({ description: "Optional legacy structured payload. Supported shapes include findings[], commands[], columns+rows, or Stardock status fields." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const input = params as Record<string, unknown>;
			const card: RichOutputCard = {
				kind: input.kind as RichOutputKind,
				style: input.style === "card" ? "card" : "inline",
				title: stringValue(input.title) ?? "Rich output",
				summary: stringValue(input.summary),
				markdown: stringValue(input.markdown),
				payload: input.payload,
				blocks: normalizeBlocks(input.blocks),
				createdAt: new Date().toISOString(),
			};
			pi.sendMessage({ customType: MESSAGE_TYPE, content: card.title, display: true, details: card });
			pi.appendEntry(MESSAGE_TYPE, card);
			return { content: [{ type: "text", text: `presented ${card.kind}: ${card.title}` }], details: card };
		},
		renderCall(args, theme) {
			const kind = stringValue((args as Record<string, unknown>).kind) ?? "entry";
			const title = stringValue((args as Record<string, unknown>).title) ?? "Rich output";
			return new Text(`${theme.fg("accent", "rich_output_present")} ${theme.fg("dim", `${kind}: ${title}`)}`, 0, 0);
		},
		renderResult(result, _options, theme) {
			const details = result.details as RichOutputCard | undefined;
			const kind = details?.kind ?? "entry";
			const title = details?.title ?? "Rich output";
			return new Text(theme.fg("dim", `✓ presented ${kind}: ${title}`), 0, 0);
		},
	});

	pi.registerCommand("rich-output-demo", {
		description: "Show a prototype generic rich output timeline entry",
		handler: async (_args, _ctx) => {
			const card = demoCard();
			pi.sendMessage({ customType: MESSAGE_TYPE, content: card.title, display: true, details: card });
			pi.appendEntry(MESSAGE_TYPE, card);
		},
	});
}
