import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import * as zlib from "node:zlib";
import { isRecord, numberValue, stringValue, type RichBlock } from "./model.ts";

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

export interface MermaidRenderResult {
	svgPath?: string;
	pngPath?: string;
	error?: string;
}

export interface ChartRenderResult {
	jsonPath?: string;
	svgPath?: string;
	pngPath?: string;
	error?: string;
}

const MERMAID_RENDER_VERSION = "dark-hires-v2";
const DEFAULT_MERMAID_WIDTH_CELLS = 120;
const MAX_MERMAID_WIDTH_CELLS = 180;
const MERMAID_PIXELS_PER_CELL = 12;
const MERMAID_SCALE = 2;
const MAX_MERMAID_DIAGRAMS_PER_CARD = 4;
const MAX_MERMAID_SOURCE_CHARS = 12_000;
const MAX_RENDER_ERROR_CHARS = 360;
const MAX_SOURCE_FALLBACK_CHARS = 2_000;
const CHART_RENDER_VERSION = "vl-dark-v1";
const MAX_CHART_SPEC_CHARS = 80_000;
const MAX_CHARTS_PER_CARD = 4;
const MAX_ARTIFACT_IMAGE_BYTES = 5_000_000;
const MAX_INLINE_IMAGE_BASE64_CHARS = 2_000_000;

export const renderLimits = {
	mermaidPerCard: MAX_MERMAID_DIAGRAMS_PER_CARD,
	chartPerCard: MAX_CHARTS_PER_CARD,
	sourceFallbackChars: MAX_SOURCE_FALLBACK_CHARS,
	mermaidSourceChars: MAX_MERMAID_SOURCE_CHARS,
};

export function truncateMiddle(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	const keep = Math.max(0, maxChars - 1);
	return `${text.slice(0, keep)}…`;
}

export function truncateRenderError(text: string): string {
	return truncateMiddle(text.replace(/\s+/g, " ").trim(), MAX_RENDER_ERROR_CHARS);
}

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
	ihdr[8] = 8;
	ihdr[9] = 6;
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

export function demoChartPng(values: number[] = [3, 5, 4, 8, 6, 9, 7, 11, 10, 12]): string {
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

export function mermaidSource(block: RichBlock): string | undefined {
	if (block.format !== "mermaid") return undefined;
	return block.text?.trim();
}

export function mermaidWidthCells(block: RichBlock): number {
	const preset = block.size === "compact" ? 72 : block.size === "wide" ? 150 : block.size === "full" ? MAX_MERMAID_WIDTH_CELLS : DEFAULT_MERMAID_WIDTH_CELLS;
	return Math.max(24, Math.min(MAX_MERMAID_WIDTH_CELLS, Math.floor(block.maxWidthCells ?? preset)));
}

function mermaidRenderWidthPx(widthCells: number): number {
	return Math.max(960, Math.min(2400, widthCells * MERMAID_PIXELS_PER_CELL));
}

function mermaidArtifactDir(): string {
	const projectDir = join(process.cwd(), ".pi", "rich-output", "mermaid");
	try {
		mkdirSync(projectDir, { recursive: true });
		return projectDir;
	} catch {
		const fallbackDir = join(tmpdir(), "pi-rich-output-mermaid");
		mkdirSync(fallbackDir, { recursive: true });
		return fallbackDir;
	}
}

function runMermaid(sourcePath: string, outputPath: string, widthPx: number): string | undefined {
	const result = spawnSync("mmdc", ["-i", sourcePath, "-o", outputPath, "-t", "dark", "-b", "transparent", "-w", String(widthPx), "-s", String(MERMAID_SCALE)], {
		encoding: "utf8",
		timeout: 15_000,
		maxBuffer: 1024 * 1024,
	});
	if (result.error) return truncateRenderError(result.error.message);
	if (result.status !== 0) return truncateRenderError(result.stderr || result.stdout || `mmdc exited ${result.status}`);
	return undefined;
}

function runVlConvert(command: "vl2svg" | "vl2png", inputPath: string, outputPath: string): string | undefined {
	const args = command === "vl2png"
		? [command, "--input", inputPath, "--output", outputPath, "--theme", "dark", "--scale", "2"]
		: [command, "--input", inputPath, "--output", outputPath, "--theme", "dark"];
	const result = spawnSync("vl-convert", args, { encoding: "utf8", timeout: 15_000, maxBuffer: 1024 * 1024 });
	if (result.error) return truncateRenderError(result.error.message);
	if (result.status !== 0) return truncateRenderError(result.stderr || result.stdout || `vl-convert ${command} exited ${result.status}`);
	return undefined;
}

function chartArtifactDir(): string {
	const projectDir = join(process.cwd(), ".pi", "rich-output", "charts");
	try {
		mkdirSync(projectDir, { recursive: true });
		return projectDir;
	} catch {
		const fallbackDir = join(tmpdir(), "pi-rich-output-charts");
		mkdirSync(fallbackDir, { recursive: true });
		return fallbackDir;
	}
}

function chartSpec(block: RichBlock): Record<string, unknown> | undefined {
	if (block.type !== "chart" || block.format !== "vega-lite" || !isRecord(block.spec)) return undefined;
	return block.spec;
}

function renderMermaidArtifacts(source: string, widthCells: number): MermaidRenderResult {
	const widthPx = mermaidRenderWidthPx(widthCells);
	const hash = createHash("sha256").update(MERMAID_RENDER_VERSION).update("\0").update(String(widthPx)).update("\0").update(source).digest("hex").slice(0, 16);
	const dir = mermaidArtifactDir();
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
		return { error: truncateRenderError(error instanceof Error ? error.message : String(error)) };
	}
}

export function prepareChartArtifacts(spec: Record<string, unknown>): ChartRenderResult {
	const specJson = safeStringify(spec);
	if (!specJson) return { error: "Vega-Lite spec could not be serialized; showing text fallback." };
	if (specJson.length > MAX_CHART_SPEC_CHARS) return { error: `Vega-Lite spec exceeds ${MAX_CHART_SPEC_CHARS} characters; showing text fallback.` };
	const hash = createHash("sha256").update(CHART_RENDER_VERSION).update("\0").update(specJson).digest("hex").slice(0, 16);
	const dir = chartArtifactDir();
	const jsonPath = join(dir, `${hash}.vl.json`);
	const svgPath = join(dir, `${hash}.svg`);
	const pngPath = join(dir, `${hash}.png`);
	try {
		writeFileSync(jsonPath, specJson, "utf8");
		if (!existsSync(svgPath)) {
			const error = runVlConvert("vl2svg", jsonPath, svgPath);
			if (error) return { jsonPath, error };
		}
		if (!existsSync(pngPath)) {
			const error = runVlConvert("vl2png", jsonPath, pngPath);
			if (error) return { jsonPath, svgPath, error };
		}
		return { jsonPath, svgPath, pngPath };
	} catch (error) {
		return { error: truncateRenderError(error instanceof Error ? error.message : String(error)) };
	}
}

function safeStringify(spec: Record<string, unknown>): string | undefined {
	try {
		const json = JSON.stringify(spec);
		return typeof json === "string" ? json : undefined;
	} catch {
		return undefined;
	}
}

function prepareChartBlock(block: RichBlock): RichBlock {
	const spec = chartSpec(block);
	if (!spec || block.pngPath || block.svgPath || block.renderError) return block;
	const result = prepareChartArtifacts(spec);
	return { ...block, jsonPath: result.jsonPath, svgPath: result.svgPath, pngPath: result.pngPath, renderError: result.error };
}

export function prepareBlocks(blocks: RichBlock[] | undefined): RichBlock[] | undefined {
	if (!blocks) return undefined;
	let mermaidDiagramCount = 0;
	let chartCount = 0;
	return blocks.map((block) => {
		if (block.type === "chart") {
			if (chartSpec(block)) chartCount++;
			if (chartCount > MAX_CHARTS_PER_CARD) {
				return {
					...block,
					renderError: `Vega-Lite chart cap reached (${MAX_CHARTS_PER_CARD} rendered per entry); showing text fallback.`,
				};
			}
			return prepareChartBlock(block);
		}
		const source = mermaidSource(block);
		if (!source || block.render === "text" || block.pngPath || block.svgPath || block.renderError) return block;
		if (source.length > MAX_MERMAID_SOURCE_CHARS) {
			return {
				...block,
				text: truncateMiddle(source, MAX_SOURCE_FALLBACK_CHARS),
				renderError: `Mermaid source exceeds ${MAX_MERMAID_SOURCE_CHARS} characters; showing source fallback.`,
			};
		}
		mermaidDiagramCount++;
		if (mermaidDiagramCount > MAX_MERMAID_DIAGRAMS_PER_CARD) {
			return {
				...block,
				renderError: `Mermaid diagram cap reached (${MAX_MERMAID_DIAGRAMS_PER_CARD} rendered per entry); showing source fallback.`,
			};
		}
		const result = renderMermaidArtifacts(source, mermaidWidthCells(block));
		return {
			...block,
			svgPath: result.svgPath,
			pngPath: result.pngPath,
			renderError: result.error,
		};
	});
}

export function readableArtifact(path: string | undefined): path is string {
	return Boolean(path && existsSync(path));
}

export function readImageBase64(path: string): string | undefined {
	try {
		const stat = statSync(path);
		if (!stat.isFile() || stat.size > MAX_ARTIFACT_IMAGE_BYTES) return undefined;
		return readFileSync(path).toString("base64");
	} catch {
		return undefined;
	}
}

export function validatedBase64Payload(value: string): string | undefined {
	const payload = value.trim();
	if (payload.length === 0 || payload.length > MAX_INLINE_IMAGE_BASE64_CHARS) return undefined;
	if (!/^[A-Za-z0-9+/]+={0,2}$/.test(payload) || payload.length % 4 !== 0) return undefined;
	return payload;
}

export function isTerminalImageLine(line: string): boolean {
	return line.includes("\x1b_G") || line.includes("\x1b]1337;File=");
}
