import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as zlib from "node:zlib";
import { Type } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Box, getCapabilities, hyperlink, Image, type Component, Markdown, type MarkdownTheme, Text, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";

const MESSAGE_TYPE = "rich-output:card";

type RichOutputKind = "report" | "findings" | "validation" | "benchmark" | "stardock" | "table" | "note";
type RichOutputStyle = "inline" | "card";

type RichBlockType = "heading" | "text" | "formula" | "diagram" | "table" | "tree" | "progress" | "code" | "callout" | "kv" | "rule" | "link" | "sparkline" | "image" | "capabilities" | "badge";

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
	showSource?: boolean;
	svgPath?: string;
	pngPath?: string;
	renderError?: string;
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

function booleanValue(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
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
		if (!type || !["heading", "text", "formula", "diagram", "table", "tree", "progress", "code", "callout", "kv", "rule", "link", "sparkline", "image", "capabilities", "badge"].includes(type)) return undefined;
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
			showSource: booleanValue(block.showSource),
			svgPath: stringValue(block.svgPath),
			pngPath: stringValue(block.pngPath),
			renderError: stringValue(block.renderError),
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


function sparkline(values: number[]): string {
	if (values.length === 0) return "";
	const ticks = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
	const min = Math.min(...values);
	const max = Math.max(...values);
	const span = max - min || 1;
	return values.map((value) => ticks[Math.max(0, Math.min(ticks.length - 1, Math.round(((value - min) / span) * (ticks.length - 1))))]).join("");
}

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(buffer: Buffer): number {
	let c = 0xffffffff;
	for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
	const typeBuffer = Buffer.from(type, "ascii");
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length, 0);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
	return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width: number, height: number, rgba: Buffer): string {
	const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // RGBA
	ihdr[10] = 0;
	ihdr[11] = 0;
	ihdr[12] = 0;
	const scanlines = Buffer.alloc(height * (width * 4 + 1));
	for (let y = 0; y < height; y++) {
		scanlines[y * (width * 4 + 1)] = 0;
		rgba.copy(scanlines, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
	}
	return Buffer.concat([
		header,
		pngChunk("IHDR", ihdr),
		pngChunk("IDAT", zlib.deflateSync(scanlines)),
		pngChunk("IEND", Buffer.alloc(0)),
	]).toString("base64");
}

function demoChartPng(values: number[] = [3, 5, 4, 8, 6, 9, 7, 11, 10, 12]): string {
	if (values.length === 0) values = [3, 5, 4, 8, 6, 9, 7, 11, 10, 12];
	const width = 320;
	const height = 120;
	const rgba = Buffer.alloc(width * height * 4);
	const min = Math.min(...values);
	const max = Math.max(...values);
	const span = max - min || 1;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const offset = (y * width + x) * 4;
			rgba[offset] = 20 + Math.floor((x / width) * 40);
			rgba[offset + 1] = 24 + Math.floor((y / height) * 30);
			rgba[offset + 2] = 38 + Math.floor((x / width) * 80);
			rgba[offset + 3] = 255;
		}
	}
	const plotTop = 14;
	const plotBottom = height - 18;
	const step = width / Math.max(1, values.length);
	values.forEach((value, index) => {
		const barHeight = Math.round(((value - min) / span) * (plotBottom - plotTop));
		const x0 = Math.floor(index * step + 5);
		const x1 = Math.floor((index + 1) * step - 5);
		const y0 = plotBottom - barHeight;
		for (let y = y0; y <= plotBottom; y++) {
			for (let x = x0; x <= x1; x++) {
				const offset = (y * width + x) * 4;
				rgba[offset] = 94;
				rgba[offset + 1] = 234;
				rgba[offset + 2] = 212;
				rgba[offset + 3] = 255;
			}
		}
	});
	return encodePng(width, height, rgba);
}

function linkTarget(block: RichBlock): string | undefined {
	if (block.url) return block.url;
	if (block.path) return block.path.startsWith("file://") ? block.path : `file://${block.path}`;
	return undefined;
}

function capabilityLines(theme: any): string[] {
	const caps = getCapabilities();
	return [
		`${theme.fg("accent", "terminal")} images=${caps.images ?? "no"} hyperlinks=${caps.hyperlinks ? "yes" : "no"} truecolor=${caps.trueColor ? "yes" : "no"}`,
		`${theme.fg("dim", "ghostty demo")} use images for faithful diagrams/formulas, OSC 8 for file/artifact links, unicode/truecolor for compact status`,
	];
}

function isTerminalImageLine(line: string): boolean {
	return line.includes("\x1b_G") || line.includes("\x1b]1337;File=");
}

function fitRenderedLine(line: string, width: number): string {
	return !isTerminalImageLine(line) && visibleWidth(line) > width ? truncateToWidth(line, width) : line;
}

interface MermaidRenderResult {
	svgPath?: string;
	pngPath?: string;
	error?: string;
}

function mermaidSource(block: RichBlock): string | undefined {
	if (block.format !== "mermaid") return undefined;
	return block.text?.trim();
}

const MERMAID_RENDER_VERSION = "dark-hires-v1";
const DEFAULT_MERMAID_WIDTH_CELLS = 120;
const MERMAID_PIXELS_PER_CELL = 12;
const MERMAID_SCALE = 2;

function mermaidWidthCells(block: RichBlock): number {
	return Math.max(24, Math.min(180, Math.floor(block.maxWidthCells ?? DEFAULT_MERMAID_WIDTH_CELLS)));
}

function mermaidRenderWidthPx(widthCells: number): number {
	return Math.max(960, Math.min(2400, widthCells * MERMAID_PIXELS_PER_CELL));
}

function runMermaid(sourcePath: string, outputPath: string, widthPx: number): string | undefined {
	const result = spawnSync("mmdc", ["-i", sourcePath, "-o", outputPath, "-t", "dark", "-b", "transparent", "-w", String(widthPx), "-s", String(MERMAID_SCALE)], {
		encoding: "utf8",
		timeout: 15_000,
		maxBuffer: 1024 * 1024,
	});
	if (result.error) return result.error.message;
	if (result.status !== 0) return (result.stderr || result.stdout || `mmdc exited ${result.status}`).trim();
	return undefined;
}

function renderMermaidArtifacts(source: string, widthCells: number): MermaidRenderResult {
	const widthPx = mermaidRenderWidthPx(widthCells);
	const hash = createHash("sha256").update(MERMAID_RENDER_VERSION).update("\0").update(String(widthPx)).update("\0").update(source).digest("hex").slice(0, 16);
	const dir = join(tmpdir(), "pi-rich-output-mermaid");
	const inputPath = join(dir, `${hash}.mmd`);
	const svgPath = join(dir, `${hash}.svg`);
	const pngPath = join(dir, `${hash}.png`);
	try {
		mkdirSync(dir, { recursive: true });
		writeFileSync(inputPath, source, "utf8");
		if (!existsSync(svgPath)) {
			const error = runMermaid(inputPath, svgPath, widthPx);
			if (error) return { error };
		}
		if (!existsSync(pngPath)) {
			const error = runMermaid(inputPath, pngPath, widthPx);
			if (error) return { svgPath, error };
		}
		return { svgPath, pngPath };
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
}


function prepareBlocks(blocks: RichBlock[] | undefined): RichBlock[] | undefined {
	if (!blocks) return undefined;
	return blocks.map((block) => {
		const source = mermaidSource(block);
		if (!source || block.render === "text" || block.pngPath || block.svgPath || block.renderError) return block;
		const result = renderMermaidArtifacts(source, mermaidWidthCells(block));
		return {
			...block,
			svgPath: result.svgPath,
			pngPath: result.pngPath,
			renderError: result.error,
		};
	});
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
		case "link": {
			const target = linkTarget(block);
			const label = block.label ?? block.text ?? target ?? "link";
			if (!target) return [theme.fg("accent", label)];
			const renderedLabel = getCapabilities().hyperlinks ? hyperlink(theme.fg("accent", label), target) : theme.fg("accent", label);
			return [`${renderedLabel} ${theme.fg("dim", target)}`];
		}
		case "sparkline": {
			const values = block.values ?? [];
			const label = block.label ? `${theme.fg("accent", block.label)} ` : "";
			const range = values.length > 0 ? ` ${theme.fg("dim", `${Math.min(...values)}…${Math.max(...values)}`)}` : "";
			return [`${label}${sparkline(values)}${range}`];
		}
		case "capabilities":
			return capabilityLines(theme);
		case "badge": {
			const text = String(block.value ?? block.text ?? block.label ?? "badge");
			return [theme.fg(styleForTone(theme, block.tone), `● ${text}`)];
		}
		case "image": {
			const label = block.alt ?? block.label ?? "inline image";
			return [theme.fg("dim", `[image: ${label}]`)];
		}
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
				const rendered = block.type === "image"
					? this.renderImageBlock(block, width)
					: block.type === "diagram" && mermaidSource(block) && block.render !== "text"
						? this.renderMermaidDiagramBlock(block, width)
						: blockLines(block, this.theme, width);
				if (rendered.length > 0) lines.push(...rendered, "");
			}
			while (lines.at(-1) === "") lines.pop();
			return lines.map((line) => fitRenderedLine(line, width));
		}
		const markdown = generatedMarkdown(this.card);
		if (markdown) {
			const md = new Markdown(markdown, 0, this.card.summary ? 1 : 0, markdownTheme(this.theme));
			lines.push(...md.render(width));
		}
		return lines.map((line) => fitRenderedLine(line, width));
	}

	private renderMermaidDiagramBlock(block: RichBlock, width: number): string[] {
		const source = mermaidSource(block);
		if (!source) return blockLines(block, this.theme, width);
		const result: MermaidRenderResult = { svgPath: block.svgPath, pngPath: block.pngPath, error: block.renderError };
		const lines: string[] = [this.theme.fg("accent", block.label ?? "Mermaid diagram")];
		if (result.pngPath) {
			const image = new Image(readFileSync(result.pngPath).toString("base64"), "image/png", { fallbackColor: (text) => this.theme.fg("dim", text) }, {
				filename: block.label ?? "Mermaid diagram",
				maxWidthCells: Math.min(mermaidWidthCells(block), Math.max(16, width - 2)),
				maxHeightCells: block.maxHeightCells ?? 16,
			});
			lines.push(...image.render(width));
		}
		if (result.svgPath) {
			const url = `file://${result.svgPath}`;
			const target = this.theme.fg("dim", result.svgPath);
			const renderedTarget = getCapabilities().hyperlinks ? hyperlink(target, url) : target;
			lines.push(`${this.theme.fg("dim", "svg")} ${renderedTarget}`);
		}
		if (result.error) lines.push(this.theme.fg("warning", `Mermaid render failed: ${result.error}`));
		const renderedSuccessfully = Boolean(result.pngPath || result.svgPath);
		if (block.showSource === true || !renderedSuccessfully) {
			lines.push(...wrapTextWithAnsi(source, width).map((line) => this.theme.fg("dim", line)));
		}
		return lines;
	}

	private renderImageBlock(block: RichBlock, width: number): string[] {
		const label = block.alt ?? block.label ?? "Ghostty inline image demo";
		const data = block.data ?? demoChartPng(block.values);
		const mimeType = block.mimeType ?? "image/png";
		const image = new Image(data, mimeType, { fallbackColor: (text) => this.theme.fg("dim", text) }, {
			filename: label,
			maxWidthCells: block.maxWidthCells ?? Math.min(48, Math.max(12, width - 2)),
			maxHeightCells: block.maxHeightCells ?? 12,
		});
		const captionTarget = linkTarget(block);
		const captionText = captionTarget && getCapabilities().hyperlinks ? hyperlink(label, captionTarget) : label;
		return [this.theme.fg("dim", captionText), ...image.render(width)];
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
				type: Type.Union([Type.Literal("heading"), Type.Literal("text"), Type.Literal("formula"), Type.Literal("diagram"), Type.Literal("table"), Type.Literal("tree"), Type.Literal("progress"), Type.Literal("code"), Type.Literal("callout"), Type.Literal("kv"), Type.Literal("rule"), Type.Literal("link"), Type.Literal("sparkline"), Type.Literal("image"), Type.Literal("capabilities"), Type.Literal("badge")]),
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
				url: Type.Optional(Type.String()),
				path: Type.Optional(Type.String()),
				values: Type.Optional(Type.Array(Type.Number())),
				data: Type.Optional(Type.String()),
				mimeType: Type.Optional(Type.String()),
				alt: Type.Optional(Type.String()),
				maxWidthCells: Type.Optional(Type.Number()),
				maxHeightCells: Type.Optional(Type.Number()),
				format: Type.Optional(Type.String()),
				render: Type.Optional(Type.Union([Type.Literal("auto"), Type.Literal("text"), Type.Literal("svg")])),
				showSource: Type.Optional(Type.Boolean()),
				svgPath: Type.Optional(Type.String()),
				pngPath: Type.Optional(Type.String()),
				renderError: Type.Optional(Type.String()),
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
				blocks: prepareBlocks(normalizeBlocks(input.blocks)),
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
			const demo = demoCard();
			const card = { ...demo, blocks: prepareBlocks(demo.blocks) };
			pi.sendMessage({ customType: MESSAGE_TYPE, content: card.title, display: true, details: card });
			pi.appendEntry(MESSAGE_TYPE, card);
		},
	});
}
