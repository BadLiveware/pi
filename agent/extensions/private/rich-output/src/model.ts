import type { MarkdownTheme } from "@mariozechner/pi-tui";

export const MESSAGE_TYPE = "rich-output:card";

export type RichOutputKind = "report" | "findings" | "validation" | "benchmark" | "stardock" | "table" | "note";
export type RichOutputStyle = "inline" | "card";

export type RichBlockType =
	| "heading"
	| "text"
	| "formula"
	| "diagram"
	| "table"
	| "tree"
	| "progress"
	| "code"
	| "callout"
	| "kv"
	| "rule"
	| "link"
	| "sparkline"
	| "image"
	| "capabilities"
	| "badge"
	| "chart";

export interface RichBlock {
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
	url?: string;
	path?: string;
	values?: number[];
	data?: string;
	mimeType?: string;
	alt?: string;
	maxWidthCells?: number;
	maxHeightCells?: number;
	format?: string;
	render?: "auto" | "text" | "svg";
	size?: "compact" | "normal" | "wide" | "full";
	showSource?: boolean;
	svgPath?: string;
	pngPath?: string;
	renderError?: string;
	spec?: unknown;
	jsonPath?: string;
}

export interface RichOutputCard {
	kind: RichOutputKind;
	style?: RichOutputStyle;
	title: string;
	summary?: string;
	markdown?: string;
	payload?: unknown;
	blocks?: RichBlock[];
	createdAt: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function booleanValue(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

export function displayString(value: unknown, fallback = ""): string {
	if (typeof value === "string") return value;
	if (value === undefined || value === null) return fallback;
	try {
		return String(value);
	} catch {
		return fallback;
	}
}

export function arrayValue(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

export function escapeCell(value: unknown): string {
	return String(value ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}

function tableMarkdown(columns: string[], rows: unknown[][]): string {
	if (columns.length === 0) return "";
	const header = `| ${columns.map(escapeCell).join(" | ")} |`;
	const sep = `| ${columns.map(() => "---").join(" | ")} |`;
	const body = rows.map((row) => `| ${columns.map((_, index) => escapeCell(row[index])).join(" | ")} |`);
	return [header, sep, ...body].join("\n");
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

export function payloadTable(payload: unknown): string | undefined {
	if (!isRecord(payload)) return undefined;
	const columns = arrayValue(payload.columns).map((column) => stringValue(column)).filter((column): column is string => Boolean(column));
	if (columns.length === 0) return undefined;
	const rawRows = arrayValue(payload.rows);
	const rows = rawRows.map((row) => Array.isArray(row) ? row : columns.map((column) => isRecord(row) ? row[column] : undefined));
	return tableMarkdown(columns, rows);
}

export function generatedMarkdown(card: RichOutputCard): string {
	const lines: string[] = [];
	const summary = stringValue(card.summary);
	if (summary) lines.push(summary);
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
	const markdown = stringValue(card.markdown);
	if (markdown) lines.push(markdown);
	return lines.join("\n\n");
}

export function markdownTheme(theme: any): MarkdownTheme {
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

export function normalizeBlocks(value: unknown): RichBlock[] | undefined {
	const blocks = arrayValue(value).filter(isRecord).map((block): RichBlock | undefined => {
		const type = stringValue(block.type);
		if (!type || !["heading", "text", "formula", "diagram", "table", "tree", "progress", "code", "callout", "kv", "rule", "link", "sparkline", "image", "capabilities", "badge", "chart"].includes(type)) return undefined;
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
			url: stringValue(block.url),
			path: stringValue(block.path),
			values: arrayValue(block.values).map((value) => numberValue(value)).filter((value): value is number => value !== undefined),
			data: stringValue(block.data),
			mimeType: stringValue(block.mimeType),
			alt: stringValue(block.alt),
			maxWidthCells: numberValue(block.maxWidthCells),
			maxHeightCells: numberValue(block.maxHeightCells),
			format: stringValue(block.format),
			render: stringValue(block.render) as RichBlock["render"],
			size: stringValue(block.size) as RichBlock["size"],
			showSource: booleanValue(block.showSource),
			svgPath: stringValue(block.svgPath),
			pngPath: stringValue(block.pngPath),
			renderError: stringValue(block.renderError),
			spec: block.spec,
			jsonPath: stringValue(block.jsonPath),
		};
	}).filter((block): block is RichBlock => Boolean(block));
	return blocks.length > 0 ? blocks : undefined;
}

export function approximateLatex(input: string): string {
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

export function coerceCard(value: unknown): RichOutputCard | undefined {
	if (!isRecord(value)) return undefined;
	const kind = stringValue(value.kind);
	if (!kind || !["report", "findings", "validation", "benchmark", "stardock", "table", "note"].includes(kind)) return undefined;
	return {
		kind: kind as RichOutputKind,
		style: value.style === "card" ? "card" : "inline",
		title: stringValue(value.title) ?? "Rich output",
		summary: stringValue(value.summary),
		markdown: stringValue(value.markdown),
		payload: value.payload,
		blocks: normalizeBlocks(value.blocks),
		createdAt: stringValue(value.createdAt) ?? "",
	};
}

export function demoCard(): RichOutputCard {
	return {
		kind: "note",
		style: "inline",
		title: "Rich output prototype",
		summary: "Terminal-native blocks rendered from structured data.",
		blocks: [
			{ type: "capabilities" },
			{ type: "badge", tone: "success", text: "Ghostty-friendly: Kitty images + OSC 8 links + truecolor glyphs" },
			{ type: "formula", latex: "\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}" },
			{ type: "diagram", edges: [["Agent", "Tool"], ["Tool", "Timeline renderer"], ["Renderer", "Ghostty image path"]] },
			{ type: "diagram", format: "mermaid", render: "svg", label: "Mermaid SVG artifact", text: "flowchart LR\n  Agent --> Tool\n  Tool --> Timeline\n  Timeline --> Ghostty" },
			{ type: "sparkline", label: "latency", values: [18, 16, 21, 15, 14, 17, 12, 11, 13, 10] },
			{ type: "image", label: "Generated inline PNG chart", values: [3, 5, 4, 8, 6, 9, 7, 11, 10, 12], maxWidthCells: 36 },
			{ type: "link", label: "Open rich-output source", path: `${process.cwd()}/agent/extensions/private/rich-output/index.ts` },
			{ type: "progress", label: "Blocks", value: 13, total: 15 },
			{ type: "callout", tone: "warning", text: "Demo-only: images should stay opt-in and text fallbacks should remain useful." },
		],
		createdAt: new Date().toISOString(),
	};
}

export function styleForTone(theme: any, tone?: RichBlock["tone"]): string {
	return tone === "error" ? "error" : tone === "warning" ? "warning" : tone === "success" ? "success" : "accent";
}

export function progressLine(block: RichBlock, theme: any, width: number): string {
	const label = block.label ?? "progress";
	const value = typeof block.value === "number" ? block.value : Number(block.value ?? 0);
	const total = block.total && block.total > 0 ? block.total : 100;
	const ratio = Math.max(0, Math.min(1, value / total));
	const barWidth = Math.max(6, Math.min(24, width - label.length - 16));
	const filled = Math.round(barWidth * ratio);
	const bar = `${"█".repeat(filled)}${"░".repeat(Math.max(0, barWidth - filled))}`;
	return `${theme.fg("accent", label)}  ${bar}  ${value}/${total}`;
}

export function sparkline(values: number[]): string {
	if (values.length === 0) return "";
	const ticks = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
	const min = Math.min(...values);
	const max = Math.max(...values);
	const span = max - min || 1;
	return values.map((value) => ticks[Math.max(0, Math.min(ticks.length - 1, Math.round(((value - min) / span) * (ticks.length - 1))))]).join("");
}

export function clampCellCount(value: number | undefined, fallback: number, min: number, max: number): number {
	const numeric = Number.isFinite(value) ? Math.floor(value as number) : fallback;
	return Math.max(min, Math.min(max, numeric));
}

export function safeJsonStringify(value: unknown): string | undefined {
	try {
		const json = JSON.stringify(value);
		return typeof json === "string" ? json : undefined;
	} catch {
		return undefined;
	}
}
