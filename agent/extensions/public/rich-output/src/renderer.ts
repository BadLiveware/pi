import { Box, getCapabilities, hyperlink, Image, type Component, Markdown, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import {
	clampCellCount,
	escapeCell,
	safeJsonStringify,
	generatedMarkdown,
	isRecord,
	markdownTheme,
	type RichBlock,
	type RichOutputCard,
	styleForTone,
	progressLine,
	sparkline,
} from "./model.ts";
import {
	demoChartPng,
	isTerminalImageLine,
	mermaidSource,
	readImageBase64,
	validatedBase64Payload,
	readableArtifact,
	truncateRenderError,
	type MermaidRenderResult,
	truncateMiddle,
} from "./artifacts.ts";

export function fitRenderedLine(line: string, width: number): string {
	const safeWidth = Math.max(1, Math.floor(Number.isFinite(width) ? width : 80));
	return !isTerminalImageLine(line) && visibleWidth(line) > safeWidth ? truncateToWidth(line, safeWidth) : line;
}

function treeLines(items: unknown[], theme: any, prefix = ""): string[] {
	const lines: string[] = [];
	items.forEach((item, index) => {
		const last = index === items.length - 1;
		const branch = last ? "└─ " : "├─ ";
		const childPrefix = `${prefix}${last ? "   " : "│  "}`;
		if (isRecord(item)) {
			lines.push(`${theme.fg("dim", prefix + branch)}${String(item.label ?? item.name ?? "item")}`);
			const children = Array.isArray(item.children) ? item.children : [];
			if (children.length > 0) lines.push(...treeLines(children, theme, childPrefix));
		} else {
			lines.push(`${theme.fg("dim", prefix + branch)}${String(item)}`);
		}
	});
	return lines;
}

function capabilityLines(theme: any): string[] {
	const caps = getCapabilities();
	return [
		`${theme.fg("accent", "terminal")} images=${caps.images ?? "no"} hyperlinks=${caps.hyperlinks ? "yes" : "no"} truecolor=${caps.trueColor ? "yes" : "no"}`,
		`${theme.fg("dim", "ghostty demo")} use images for faithful diagrams/formulas, OSC 8 for file/artifact links, unicode/truecolor for compact status`,
	];
}

function linkTarget(block: RichBlock): string | undefined {
	if (block.url) return block.url;
	if (block.path) return block.path.startsWith("file://") ? block.path : `file://${block.path}`;
	return undefined;
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

function tableLines(columns: string[], rows: unknown[][], theme: any, width: number): string[] {
	if (columns.length === 0) return [];
	const maxWidth = Math.max(20, width);
	const natural = columns.map((column, index) =>
		Math.max(visibleWidth(column), ...rows.map((row) => visibleWidth(escapeCell(row[index]))))
	);
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

function approximateLatex(input: string): string {
	let text = input;
	const replacements: Array<[RegExp, string]> = [
		[/\infty/g, "∞"],
		[/\pi/g, "π"],
		[/\alpha/g, "α"],
		[/\beta/g, "β"],
		[/\gamma/g, "γ"],
		[/\Delta/g, "Δ"],
		[/\lambda/g, "λ"],
		[/\mu/g, "μ"],
		[/\sigma/g, "σ"],
		[/\theta/g, "θ"],
		[/\sum/g, "∑"],
		[/\int/g, "∫"],
		[/\sqrt\\{([^{}]+)\\}/g, "√($1)"],
		[/\cdot/g, "·"],
		[/\times/g, "×"],
		[/\leq?/g, "≤"],
		[/\geq?/g, "≥"],
		[/\neq/g, "≠"],
		[/\to/g, "→"],
		[/\,|\;/g, " "],
	];
	for (const [pattern, replacement] of replacements) text = text.replace(pattern, replacement);
	text = text.replace(/\^\{2\}|\^2/g, "²").replace(/\^\{3\}|\^3/g, "³").replace(/_\{([^{}]+)\}/g, "₍$1₎").replace(/\{([^{}]+)\}/g, "$1");
	return text.replace(/\s+/g, " ").trim();
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
		case "chart":
			return [theme.fg("dim", `[chart: ${block.label ?? "Vega-Lite chart"}]`)];
		case "rule":
			return [theme.fg("dim", "─".repeat(Math.max(1, Math.min(width, 80))))];
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
		const renderWidth = Math.max(1, Math.floor(Number.isFinite(width) ? width : 80));
		const lines: string[] = [];
		lines.push(`${this.theme.fg("accent", this.theme.bold(this.card.title))} ${this.theme.fg("dim", this.card.kind)}`);
		if (this.card.summary) lines.push(...wrapTextWithAnsi(this.card.summary, renderWidth));
		const blocks = Array.isArray(this.card.blocks) ? this.card.blocks : undefined;
		if (blocks && blocks.length > 0) {
			if (this.card.summary) lines.push("");
			for (const block of blocks) {
				const rendered = this.renderBlockSafely(block, renderWidth);
				if (rendered.length > 0) lines.push(...rendered, "");
			}
			while (lines.at(-1) === "") lines.pop();
			return lines.map((line) => fitRenderedLine(line, renderWidth));
		}
		const markdown = generatedMarkdown(this.card);
		if (markdown) {
			const md = new Markdown(markdown, 0, this.card.summary ? 1 : 0, markdownTheme(this.theme));
			lines.push(...md.render(renderWidth));
		}
		return lines.map((line) => fitRenderedLine(line, renderWidth));
	}

	private renderBlockSafely(block: RichBlock, width: number): string[] {
		try {
			return block.type === "image"
				? this.renderImageBlock(block, width)
				: block.type === "chart"
					? this.renderChartBlock(block, width)
					: block.type === "diagram" && mermaidSource(block) && block.render !== "text"
						? this.renderMermaidDiagramBlock(block, width)
						: blockLines(block, this.theme, width);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return [this.theme.fg("warning", `Could not render ${block.type} block: ${truncateRenderError(message)}`)];
		}
	}

	private renderChartBlock(block: RichBlock, width: number): string[] {
		const lines: string[] = [this.theme.fg("accent", block.label ?? "Chart")];
		const pngData = block.pngPath ? readImageBase64(block.pngPath) : undefined;
		if (pngData) {
			const image = new Image(pngData, "image/png", { fallbackColor: (text) => this.theme.fg("dim", text) }, {
				filename: block.label ?? "Chart",
				maxWidthCells: Math.min(clampCellCount(block.maxWidthCells, 120, 1, 240), Math.max(1, width - 2)),
				maxHeightCells: clampCellCount(block.maxHeightCells, 18, 1, 80),
			});
			lines.push(...image.render(width));
		} else if (block.pngPath) {
			lines.push(this.theme.fg("warning", `Chart image unavailable: ${block.pngPath}`));
		}
		if (block.svgPath) lines.push(`${this.theme.fg("dim", "svg")} ${this.theme.fg(readableArtifact(block.svgPath) ? "dim" : "warning", block.svgPath)}`);
		if (block.jsonPath) lines.push(`${this.theme.fg("dim", "spec")} ${this.theme.fg(readableArtifact(block.jsonPath) ? "dim" : "warning", block.jsonPath)}`);
		if (block.renderError) lines.push(this.theme.fg("warning", `Chart render failed: ${block.renderError}`));
		if (block.showSource === true && block.spec) {
			const specJson = safeJsonStringify(block.spec);
			if (specJson) lines.push(...wrapTextWithAnsi(truncateMiddle(specJson, 2000), width).map((line) => this.theme.fg("dim", line)));
			else lines.push(this.theme.fg("warning", "Chart source unavailable: spec could not be serialized"));
		}
		return lines;
	}

	private renderMermaidDiagramBlock(block: RichBlock, width: number): string[] {
		const source = mermaidSource(block);
		if (!source) return blockLines(block, this.theme, width);
		const result: MermaidRenderResult = { svgPath: block.svgPath, pngPath: block.pngPath, error: block.renderError };
		const lines: string[] = [this.theme.fg("accent", block.label ?? "Mermaid diagram")];
		const pngData = result.pngPath ? readImageBase64(result.pngPath) : undefined;
		if (pngData) {
			const image = new Image(pngData, "image/png", { fallbackColor: (text) => this.theme.fg("dim", text) }, {
				filename: block.label ?? "Mermaid diagram",
				maxWidthCells: Math.min(mermaidWidthCells(block), Math.max(1, width - 2)),
				maxHeightCells: clampCellCount(block.maxHeightCells, 16, 1, 80),
			});
			lines.push(...image.render(width));
		} else if (result.pngPath) {
			lines.push(this.theme.fg("warning", `Mermaid image unavailable: ${result.pngPath}`));
		}
		if (result.svgPath) {
			const url = `file://${result.svgPath}`;
			const style = readableArtifact(result.svgPath) ? "dim" : "warning";
			const target = this.theme.fg(style, result.svgPath);
			const renderedTarget = getCapabilities().hyperlinks ? hyperlink(target, url) : target;
			lines.push(`${this.theme.fg("dim", "svg")} ${renderedTarget}`);
		}
		if (result.error) lines.push(this.theme.fg("warning", `Mermaid render failed: ${result.error}`));
		const renderedSuccessfully = Boolean(pngData || readableArtifact(result.svgPath));
		if (block.showSource === true || !renderedSuccessfully) {
			lines.push(...wrapTextWithAnsi(source, width).map((line) => this.theme.fg("dim", line)));
		}
		return lines;
	}

	private renderImageBlock(block: RichBlock, width: number): string[] {
		const label = block.alt ?? block.label ?? "Ghostty inline image demo";
		const data = block.data ? validatedBase64Payload(block.data) : demoChartPng(block.values);
		const captionTarget = linkTarget(block);
		const captionText = captionTarget && getCapabilities().hyperlinks ? hyperlink(label, captionTarget) : label;
		if (!data) return [this.theme.fg("dim", captionText), this.theme.fg("warning", "Image data unavailable: expected bounded base64 payload")];
		const mimeType = block.mimeType ?? "image/png";
		const image = new Image(data, mimeType, { fallbackColor: (text) => this.theme.fg("dim", text) }, {
			filename: label,
			maxWidthCells: clampCellCount(block.maxWidthCells, Math.min(48, Math.max(1, width - 2)), 1, 240),
			maxHeightCells: clampCellCount(block.maxHeightCells, 12, 1, 80),
		});
		return [this.theme.fg("dim", captionText), ...image.render(width)];
	}

	invalidate(): void {}
}

export function renderCard(card: RichOutputCard, theme: any): Component {
	const component = new RichOutputComponent(card, theme);
	if (card.style === "card") {
		const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
		box.addChild(component);
		return box;
	}
	return component;
}

function mermaidWidthCells(block: RichBlock): number {
	const preset = block.size === "compact" ? 72 : block.size === "wide" ? 150 : block.size === "full" ? 180 : 120;
	return Math.max(24, Math.min(180, Math.floor(block.maxWidthCells ?? preset)));
}

