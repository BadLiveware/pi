import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "@mariozechner/pi-ai";
import { defineTool, type ExtensionAPI, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

type ChecksState = "pass" | "fail" | "running" | "unknown";
type FooterAnchorMode = "gap" | "left" | "center" | "right" | "spread";
type FooterLine = number;
type FooterZone = "left" | "right";
type ConfigScope = "user" | "project";
type ExternalFooterItemTone = "muted" | "info" | "success" | "warning" | "error" | "accent";
type ExternalFooterItemFormat = "auto" | "value" | "label-value" | "status";
type FooterAdapterSource = "pi" | "extensionStatus" | "sessionEntry";

interface FooterItemPlacement {
	visible: boolean;
	line: FooterLine;
	zone: FooterZone;
	order: number;
	column?: number;
	before?: string;
	after?: string;
}

interface FooterLineLayout {
	anchor: FooterAnchorMode;
	leftWidth: number;
	rightWidthOriginal: number;
	rightWidthFinal: number;
	padCount: number;
	rightStartCol: number;
	rightEndCol: number;
	truncated: boolean;
}

interface FooterItem {
	id: string;
	text: string;
	placement: FooterItemPlacement;
}

interface FooterItemDisplayHint {
	label?: string;
	icon?: string;
	format?: ExternalFooterItemFormat;
	tone?: ExternalFooterItemTone;
	placement?: Partial<FooterItemPlacement>;
}

interface ExternalFooterItemEvent {
	id: string;
	label?: string;
	value?: unknown;
	status?: unknown;
	data?: unknown;
	url?: string;
	tone?: ExternalFooterItemTone;
	/** Compatibility input. Prefer structured value/status/data plus optional hint. */
	text?: string;
	/** Display hint only. User config always wins over this placement/formatting advice. */
	hint?: FooterItemDisplayHint;
	placement?: Partial<FooterItemPlacement>;
	remove?: boolean;
}

interface ExternalFooterItem {
	id: string;
	label?: string;
	value?: unknown;
	status?: unknown;
	data?: unknown;
	url?: string;
	tone?: ExternalFooterItemTone;
	text?: string;
	hint: FooterItemDisplayHint;
}

interface FooterSnapshot {
	width: number;
	lines: Array<{ line: FooterLine; text: string; layout: FooterLineLayout }>;
	line1: string;
	line2: string;
	line1Layout: FooterLineLayout;
	line2Layout: FooterLineLayout;
	gitBranch: string | null;
	renderedItems: Array<{ id: string; line: FooterLine; zone: FooterZone; order: number; column?: number; width: number }>;
	extensionStatuses: Array<{ key: string; value: string }>;
	model: string;
	contextUsage: { tokens: number | null; contextWindow: number; percent: number | null } | null;
	thinkingLevel: string;
	cwd: string;
}

interface FooterAdapterConfig {
	source: FooterAdapterSource;
	/** Built-in Pi source key, extension status key, or custom entry type for sessionEntry adapters. */
	key: string;
	itemId?: string;
	label?: string;
	path?: string;
	match?: string;
	group?: string | number;
	urlPath?: string;
	tone?: ExternalFooterItemTone;
	format?: ExternalFooterItemFormat;
	/** Liquid-style interpolation template. Supports variables, string literals, and style filters. */
	template?: string;
	/** Optional fallback template when the selected source is empty. */
	emptyTemplate?: string;
	/** Default style applied to the full rendered adapter item. */
	style?: string;
	icon?: string;
	placement?: Partial<FooterItemPlacement>;
	hideWhenEmpty?: boolean;
}

interface FooterTemplateDiagnostic {
	adapterId: string;
	message: string;
	token?: string;
	severity: "warning" | "error";
}

interface FooterSourceInventoryOptions {
	includeTools?: boolean;
	includeCommands?: boolean;
	includeSkills?: boolean;
	includeDetails?: boolean;
}

interface FooterAdapterSourceValue {
	label?: string;
	value?: unknown;
	status?: unknown;
	data?: unknown;
	url?: string;
	tone?: ExternalFooterItemTone;
	hint?: FooterItemDisplayHint;
}

interface PrState {
	branch?: string;
	error?: string;
	autoSolveEnabled?: boolean;
	pr?: {
		number: number;
		title: string;
		url: string;
		comments: number;
		checks: ChecksState;
	};
}

interface FooterFrameworkSettings {
	enabled: boolean;
	lineAnchors: Record<string, FooterAnchorMode>;
	minGap: number;
	maxGap: number;
	items: Record<string, Partial<FooterItemPlacement>>;
	adapters: Record<string, FooterAdapterConfig>;
}

const MIN_FOOTER_LINE = 1;

const DEFAULT_SETTINGS: FooterFrameworkSettings = {
	enabled: true,
	lineAnchors: { "1": "right", "2": "right" },
	minGap: 2,
	maxGap: 20,
	items: {},
	adapters: {},
};

const ANCHOR_MODES: FooterAnchorMode[] = ["gap", "left", "center", "right", "spread"];
const CONFIG_FILE_NAME = "footer-framework.json";
const DEFAULT_ITEM_PLACEMENTS: Record<string, FooterItemPlacement> = {
	cwd: { visible: true, line: 1, zone: "left", order: 10 },
	model: { visible: true, line: 1, zone: "right", order: 10 },
	branch: { visible: true, line: 1, zone: "right", order: 20 },
	stats: { visible: true, line: 2, zone: "left", order: 10 },
	context: { visible: true, line: 2, zone: "left", order: 20 },
	pr: { visible: true, line: 2, zone: "right", order: 10 },
	ext: { visible: true, line: 2, zone: "right", order: 20 },
};

const DEFAULT_BUILT_IN_ADAPTERS: Record<string, FooterAdapterConfig> = {
	cwd: { source: "pi", key: "cwd", itemId: "cwd", template: '{{ pi.cwd | style: "dim" }}', placement: DEFAULT_ITEM_PLACEMENTS.cwd },
	model: {
		source: "pi",
		key: "model",
		itemId: "model",
		template: '{{ pi.model.id | style: "dim" }}{{ ":" | style: "dim" }}{{ pi.model.thinking | style: "dim" }}',
		placement: DEFAULT_ITEM_PLACEMENTS.model,
	},
	branch: { source: "pi", key: "branch", itemId: "branch", template: '{{ pi.branch.label | truncate: 22 | style: "muted" }}', placement: DEFAULT_ITEM_PLACEMENTS.branch },
	stats: {
		source: "pi",
		key: "stats",
		itemId: "stats",
		template: '{{ "↑" | style: "dim" }}{{ pi.stats.inputText | style: "dim" }} {{ "↓" | style: "dim" }}{{ pi.stats.outputText | style: "dim" }} {{ "$" | style: "dim" }}{{ pi.stats.costText | style: "dim" }}',
		placement: DEFAULT_ITEM_PLACEMENTS.stats,
	},
	context: {
		source: "pi",
		key: "context",
		itemId: "context",
		template: '{{ "ctx" | style: pi.context.tone }} {{ pi.context.percentText | style: pi.context.tone }} {{ pi.context.tokenText | style: pi.context.tone }}',
		placement: DEFAULT_ITEM_PLACEMENTS.context,
	},
	pr: { source: "pi", key: "pr", itemId: "pr", template: '{{ "PR " | style: "muted" }}{{ pi.pr.checkGlyph | style: pi.pr.checkTone }}{{ pi.pr.commentsText | style: "muted" }}', placement: DEFAULT_ITEM_PLACEMENTS.pr },
};

function formatTokens(count: number): string {
	if (count < 1_000) return `${count}`;
	if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
	return `${(count / 1_000_000).toFixed(1)}M`;
}

function formatContextTokens(count: number): string {
	if (count < 1_000) return `${Math.round(count)}`;
	if (count < 1_000_000) return `${Math.round(count / 1_000)}K`;
	return `${Math.round(count / 1_000_000)}M`;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function cloneDefaultSettings(): FooterFrameworkSettings {
	return {
		...DEFAULT_SETTINGS,
		lineAnchors: { ...DEFAULT_SETTINGS.lineAnchors },
		items: { ...DEFAULT_SETTINGS.items },
		adapters: { ...DEFAULT_SETTINGS.adapters },
	};
}

function normalizeFooterLine(value: unknown): FooterLine | undefined {
	const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : undefined;
	if (!Number.isFinite(parsed)) return undefined;
	const line = Math.round(parsed as number);
	return line >= MIN_FOOTER_LINE ? line : undefined;
}

function parseFooterLineSelector(value: string): FooterLine | "all" | undefined {
	if (value === "all") return "all";
	const normalized = value.toLowerCase().startsWith("line") ? value.slice(4) : value;
	return normalizeFooterLine(normalized);
}

function setLineAnchor(settings: FooterFrameworkSettings, line: FooterLine, mode: FooterAnchorMode): void {
	settings.lineAnchors[String(line)] = mode;
}

function getLineAnchor(settings: FooterFrameworkSettings, line: FooterLine): FooterAnchorMode {
	return settings.lineAnchors[String(line)] ?? settings.lineAnchors["2"] ?? "right";
}

function setAllLineAnchors(settings: FooterFrameworkSettings, mode: FooterAnchorMode): void {
	setLineAnchor(settings, 1, mode);
	setLineAnchor(settings, 2, mode);
	for (const lineKey of Object.keys(settings.lineAnchors)) {
		const line = normalizeFooterLine(lineKey);
		if (line !== undefined) setLineAnchor(settings, line, mode);
	}
}

function sortedLineAnchors(settings: FooterFrameworkSettings): string {
	return Object.entries(settings.lineAnchors)
		.sort(([a], [b]) => Number(a) - Number(b))
		.map(([line, mode]) => `line${line}=${mode}`)
		.join(", ");
}

function agentDir(): string {
	return process.env.PI_CODING_AGENT_DIR ?? process.env.PI_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
}

function userConfigPath(): string {
	return path.join(agentDir(), CONFIG_FILE_NAME);
}

function projectConfigPath(ctx: ExtensionContext): string {
	return path.join(ctx.cwd, ".pi", CONFIG_FILE_NAME);
}

function normalizePlacement(input: Partial<FooterItemPlacement>): Partial<FooterItemPlacement> {
	const placement: Partial<FooterItemPlacement> = {};
	const rawInput = input as Partial<FooterItemPlacement> & { line?: unknown };
	const line = normalizeFooterLine(rawInput.line);
	if (typeof input.visible === "boolean") placement.visible = input.visible;
	if (line !== undefined) placement.line = line;
	if (input.zone === "left" || input.zone === "right") placement.zone = input.zone;
	if (Number.isFinite(input.order)) placement.order = Math.round(input.order as number);
	if (Number.isFinite(input.column)) placement.column = Math.max(0, Math.round(input.column as number));
	if (typeof input.before === "string" && input.before.trim()) placement.before = input.before.trim();
	if (typeof input.after === "string" && input.after.trim()) placement.after = input.after.trim();
	return placement;
}

function normalizeAdapter(input: unknown): FooterAdapterConfig | undefined {
	if (!input || typeof input !== "object") return undefined;
	const raw = input as Partial<FooterAdapterConfig>;
	if (raw.source !== "pi" && raw.source !== "extensionStatus" && raw.source !== "sessionEntry") return undefined;
	if (typeof raw.key !== "string" || !raw.key.trim()) return undefined;
	const adapter: FooterAdapterConfig = {
		source: raw.source,
		key: raw.key.trim(),
	};
	if (typeof raw.itemId === "string" && raw.itemId.trim()) adapter.itemId = raw.itemId.trim();
	if (typeof raw.label === "string" && raw.label.trim()) adapter.label = sanitizeStatusText(raw.label);
	if (typeof raw.path === "string" && raw.path.trim()) adapter.path = raw.path.trim();
	if (typeof raw.match === "string" && raw.match.trim()) adapter.match = raw.match;
	if (typeof raw.group === "string" || typeof raw.group === "number") adapter.group = raw.group;
	if (typeof raw.urlPath === "string" && raw.urlPath.trim()) adapter.urlPath = raw.urlPath.trim();
	const tone = normalizeTone(raw.tone);
	if (tone) adapter.tone = tone;
	const format = normalizeFormat(raw.format);
	if (format) adapter.format = format;
	if (typeof raw.template === "string" && raw.template.trim()) adapter.template = raw.template;
	if (typeof raw.emptyTemplate === "string" && raw.emptyTemplate.trim()) adapter.emptyTemplate = raw.emptyTemplate;
	if (typeof raw.style === "string" && raw.style.trim()) adapter.style = raw.style.trim();
	if (typeof raw.icon === "string" && raw.icon.trim()) adapter.icon = sanitizeStatusText(raw.icon);
	if (raw.placement && typeof raw.placement === "object") adapter.placement = normalizePlacement(raw.placement);
	if (typeof raw.hideWhenEmpty === "boolean") adapter.hideWhenEmpty = raw.hideWhenEmpty;
	return adapter;
}

function normalizeSettings(input: Partial<FooterFrameworkSettings>): Partial<FooterFrameworkSettings> {
	const normalized: Partial<FooterFrameworkSettings> = {};
	for (const key of ["enabled"] as const) {
		if (typeof input[key] === "boolean") normalized[key] = input[key];
	}
	const lineAnchors: Record<string, FooterAnchorMode> = {};
	if (input.lineAnchors && typeof input.lineAnchors === "object") {
		for (const [lineKey, mode] of Object.entries(input.lineAnchors)) {
			const line = normalizeFooterLine(lineKey);
			if (line !== undefined && ANCHOR_MODES.includes(mode)) lineAnchors[String(line)] = mode;
		}
	}
	if (Object.keys(lineAnchors).length > 0) normalized.lineAnchors = lineAnchors;
	if (Number.isFinite(input.minGap)) normalized.minGap = Math.max(0, Math.round(input.minGap as number));
	if (Number.isFinite(input.maxGap)) normalized.maxGap = Math.max(normalized.minGap ?? 0, Math.round(input.maxGap as number));
	if (input.items && typeof input.items === "object") {
		normalized.items = {};
		for (const [id, placement] of Object.entries(input.items)) {
			if (!id.trim() || !placement || typeof placement !== "object") continue;
			normalized.items[id] = normalizePlacement(placement as Partial<FooterItemPlacement>);
		}
	}
	if (input.adapters && typeof input.adapters === "object") {
		normalized.adapters = {};
		for (const [id, adapterInput] of Object.entries(input.adapters)) {
			if (!id.trim()) continue;
			const adapter = normalizeAdapter(adapterInput);
			if (adapter) normalized.adapters[id] = adapter;
		}
	}
	return normalized;
}

function readConfigFile(filePath: string): Partial<FooterFrameworkSettings> | undefined {
	try {
		if (!fs.existsSync(filePath)) return undefined;
		const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Partial<FooterFrameworkSettings>;
		return normalizeSettings(parsed);
	} catch {
		return undefined;
	}
}

function writeConfigFile(filePath: string, settings: FooterFrameworkSettings): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
}

function osc8(label: string, url: string): string {
	return `\u001b]8;;${url}\u0007${label}\u001b]8;;\u0007`;
}

function normalizeLinkUrl(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (!trimmed || /[\r\n]/.test(trimmed)) return undefined;
	return trimmed;
}

function sanitizeStatusText(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

function normalizeTone(tone: unknown): ExternalFooterItemTone | undefined {
	return tone === "muted" || tone === "info" || tone === "success" || tone === "warning" || tone === "error" || tone === "accent" ? tone : undefined;
}

function normalizeFormat(format: unknown): ExternalFooterItemFormat | undefined {
	return format === "auto" || format === "value" || format === "label-value" || format === "status" ? format : undefined;
}

function valueToText(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value === "string") return sanitizeStatusText(value);
	if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") return String(value);
	if (Array.isArray(value)) return sanitizeStatusText(value.map((entry) => valueToText(entry)).filter(Boolean).join(" "));
	try {
		return sanitizeStatusText(JSON.stringify(value));
	} catch {
		return sanitizeStatusText(String(value));
	}
}

function valueToTemplateText(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value === "string") return value.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ");
	return valueToText(value);
}

function normalizeDisplayHint(event: ExternalFooterItemEvent): FooterItemDisplayHint {
	return {
		label: typeof event.hint?.label === "string" ? sanitizeStatusText(event.hint.label) : undefined,
		icon: typeof event.hint?.icon === "string" ? sanitizeStatusText(event.hint.icon) : undefined,
		format: normalizeFormat(event.hint?.format),
		tone: normalizeTone(event.hint?.tone),
		placement: normalizePlacement({ ...(event.placement ?? {}), ...(event.hint?.placement ?? {}) }),
	};
}

function normalizeExternalItemEvent(event: ExternalFooterItemEvent): ExternalFooterItem | undefined {
	const id = event.id?.trim();
	if (!id) return undefined;
	return {
		id,
		label: typeof event.label === "string" ? sanitizeStatusText(event.label) : undefined,
		value: event.value,
		status: event.status,
		data: event.data,
		url: typeof event.url === "string" ? event.url : undefined,
		tone: normalizeTone(event.tone),
		text: typeof event.text === "string" ? sanitizeStatusText(event.text) : undefined,
		hint: normalizeDisplayHint(event),
	};
}

function applyExternalTone(theme: ExtensionContext["ui"]["theme"], tone: ExternalFooterItemTone | undefined, text: string): string {
	if (tone === "success") return theme.fg("success", text);
	if (tone === "warning") return theme.fg("warning", text);
	if (tone === "error") return theme.fg("error", text);
	if (tone === "accent") return theme.fg("accent", text);
	if (tone === "muted") return theme.fg("muted", text);
	return theme.fg("dim", text);
}

const THEME_FG_COLORS = new Set([
	"accent",
	"border",
	"borderAccent",
	"borderMuted",
	"success",
	"error",
	"warning",
	"muted",
	"dim",
	"text",
	"thinkingText",
	"userMessageText",
	"customMessageText",
	"customMessageLabel",
	"toolTitle",
	"toolOutput",
	"mdHeading",
	"mdLink",
	"mdLinkUrl",
	"mdCode",
	"mdCodeBlock",
	"mdCodeBlockBorder",
	"mdQuote",
	"mdQuoteBorder",
	"mdHr",
	"mdListBullet",
	"toolDiffAdded",
	"toolDiffRemoved",
	"toolDiffContext",
	"syntaxComment",
	"syntaxKeyword",
	"syntaxFunction",
	"syntaxVariable",
	"syntaxString",
	"syntaxNumber",
	"syntaxType",
	"syntaxOperator",
	"syntaxPunctuation",
	"thinkingOff",
	"thinkingMinimal",
	"thinkingLow",
	"thinkingMedium",
	"thinkingHigh",
	"thinkingXhigh",
	"bashMode",
]);

const THEME_BG_COLORS = new Set(["selectedBg", "userMessageBg", "customMessageBg", "toolPendingBg", "toolSuccessBg", "toolErrorBg"]);
const THEME_TEXT_ATTRIBUTES = new Set(["bold", "italic", "underline", "inverse", "strikethrough"]);

function applyStyleSpec(
	theme: ExtensionContext["ui"]["theme"],
	text: string,
	styleSpec: unknown,
	diagnostics: FooterTemplateDiagnostic[],
	adapterId: string,
	token?: string,
): string {
	const spec = valueToText(styleSpec);
	if (!spec) return text;
	let out = text;
	for (const rawPart of spec.split(",")) {
		const part = rawPart.trim();
		if (!part) continue;
		const [prefix, value] = part.includes(":") ? (part.split(/:(.*)/s).filter(Boolean) as [string, string]) : [undefined, part];
		if ((prefix === "fg" || prefix === "color") && THEME_FG_COLORS.has(value)) out = theme.fg(value as never, out);
		else if ((prefix === "bg" || prefix === "background") && THEME_BG_COLORS.has(value)) out = theme.bg(value as never, out);
		else if (!prefix && THEME_FG_COLORS.has(value)) out = theme.fg(value as never, out);
		else if (!prefix && value === "bold") out = theme.bold(out);
		else if (!prefix && value === "italic") out = theme.italic(out);
		else if (!prefix && value === "underline") out = theme.underline(out);
		else if (!prefix && value === "inverse") out = theme.inverse(out);
		else if (!prefix && value === "strikethrough") out = theme.strikethrough(out);
		else if (prefix === "attr" && THEME_TEXT_ATTRIBUTES.has(value)) out = applyStyleSpec(theme, out, value, diagnostics, adapterId, token);
		else {
			diagnostics.push({ adapterId, token, severity: "warning", message: `Unknown style token: ${part}` });
			out = theme.fg("warning", out);
		}
	}
	return out;
}

function renderExternalItem(theme: ExtensionContext["ui"]["theme"], item: ExternalFooterItem): string | undefined {
	const hint = item.hint;
	const label = hint.label ?? item.label;
	const value = valueToText(item.value) ?? valueToText(item.status) ?? valueToText(item.data) ?? item.text;
	const format = hint.format ?? (item.text && !label && item.value === undefined && item.status === undefined && item.data === undefined ? "value" : "auto");
	const renderedValue = value ? applyExternalTone(theme, item.tone ?? hint.tone, value) : undefined;
	const prefix = hint.icon ? `${hint.icon} ` : "";
	let text: string | undefined;
	if (format === "value") text = renderedValue ? `${prefix}${renderedValue}` : undefined;
	else if (format === "status" && label && renderedValue) text = `${prefix}${theme.fg("muted", label)} ${renderedValue}`;
	else if (label && renderedValue) text = `${prefix}${theme.fg("muted", label)}: ${renderedValue}`;
	else if (renderedValue) text = `${prefix}${renderedValue}`;
	else if (label) text = `${prefix}${theme.fg("muted", label)}`;
	if (!text) return undefined;
	return item.url ? osc8(text, item.url) : text;
}

function parsePath(pathExpression: string): string[] {
	return pathExpression
		.replace(/^\$\.?/, "")
		.replace(/\[(\d+)\]/g, ".$1")
		.split(".")
		.map((part) => part.trim())
		.filter(Boolean);
}

function selectPath(value: unknown, pathExpression?: string): unknown {
	if (!pathExpression?.trim()) return value;
	let current = value;
	for (const part of parsePath(pathExpression)) {
		if (current === undefined || current === null) return undefined;
		if (Array.isArray(current)) {
			const index = Number(part);
			current = Number.isInteger(index) ? current[index] : undefined;
		} else if (typeof current === "object") {
			current = (current as Record<string, unknown>)[part];
		} else {
			return undefined;
		}
	}
	return current;
}

function splitTemplatePipes(expression: string): string[] {
	const parts: string[] = [];
	let current = "";
	let quote: string | undefined;
	let escaped = false;
	for (const char of expression) {
		if (escaped) {
			current += char;
			escaped = false;
			continue;
		}
		if (char === "\\") {
			current += char;
			escaped = true;
			continue;
		}
		if (quote) {
			current += char;
			if (char === quote) quote = undefined;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			current += char;
			continue;
		}
		if (char === "|") {
			parts.push(current.trim());
			current = "";
			continue;
		}
		current += char;
	}
	parts.push(current.trim());
	return parts;
}

function parseFilter(filterExpression: string): { name: string; arg?: string } {
	let quote: string | undefined;
	let escaped = false;
	for (let index = 0; index < filterExpression.length; index++) {
		const char = filterExpression[index];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (char === "\\") {
			escaped = true;
			continue;
		}
		if (quote) {
			if (char === quote) quote = undefined;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (char === ":") {
			return { name: filterExpression.slice(0, index).trim(), arg: filterExpression.slice(index + 1).trim() };
		}
	}
	return { name: filterExpression.trim() };
}

function splitFilterArgs(expression: string | undefined): string[] {
	if (!expression?.trim()) return [];
	const args: string[] = [];
	let current = "";
	let quote: string | undefined;
	let escaped = false;
	for (const char of expression) {
		if (escaped) {
			current += char;
			escaped = false;
			continue;
		}
		if (char === "\\") {
			current += char;
			escaped = true;
			continue;
		}
		if (quote) {
			current += char;
			if (char === quote) quote = undefined;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			current += char;
			continue;
		}
		if (char === ",") {
			args.push(current.trim());
			current = "";
			continue;
		}
		current += char;
	}
	args.push(current.trim());
	return args.filter(Boolean);
}

function parseQuotedString(expression: string): string | undefined {
	const trimmed = expression.trim();
	if (trimmed.length < 2) return undefined;
	const quote = trimmed[0];
	if ((quote !== '"' && quote !== "'") || trimmed[trimmed.length - 1] !== quote) return undefined;
	try {
		return quote === '"' ? JSON.parse(trimmed) : trimmed.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, "\\");
	} catch {
		return undefined;
	}
}

function evaluateTemplateTerm(
	term: string | undefined,
	context: Record<string, unknown>,
	diagnostics: FooterTemplateDiagnostic[],
	adapterId: string,
	token: string,
	reportMissing = true,
): unknown {
	if (!term) return undefined;
	const trimmed = term.trim();
	const literal = parseQuotedString(trimmed);
	if (literal !== undefined) return literal;
	if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
	if (trimmed === "true") return true;
	if (trimmed === "false") return false;
	const value = selectPath(context, trimmed);
	if (value === undefined) {
		if (reportMissing) diagnostics.push({ adapterId, token, severity: "error", message: `Missing template variable: ${trimmed}` });
		return reportMissing ? `[missing:${trimmed}]` : undefined;
	}
	return value;
}

function numberFilterArg(value: unknown, fallback: number, min: number): number {
	const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
	return Number.isFinite(parsed) ? Math.max(min, Math.round(parsed)) : fallback;
}

function truncateStartToWidth(text: string, maxWidth: number, ellipsis = "…"): string {
	if (visibleWidth(text) <= maxWidth) return text;
	if (maxWidth <= visibleWidth(ellipsis)) return ellipsis;
	let suffix = "";
	for (const char of Array.from(text).reverse()) {
		const next = `${char}${suffix}`;
		if (visibleWidth(next) + visibleWidth(ellipsis) > maxWidth) break;
		suffix = next;
	}
	return `${ellipsis}${suffix}`;
}

function compactPathText(input: string, maxWidth: number, tailSegments: number): string {
	if (!input) return input;
	const home = os.homedir();
	let display = input;
	if (home && (display === home || display.startsWith(`${home}/`) || display.startsWith(`${home}\\`))) display = `~${display.slice(home.length)}`;
	if (visibleWidth(display) <= maxWidth) return display;

	const normalized = display.replace(/\\/g, "/").replace(/\/+/g, "/");
	const driveMatch = normalized.match(/^[A-Za-z]:\//);
	const prefix = normalized.startsWith("~/") ? "~/" : driveMatch ? driveMatch[0] : normalized.startsWith("/") ? "/" : "";
	const body = prefix ? normalized.slice(prefix.length) : normalized;
	const segments = body.split("/").filter(Boolean);
	const tailCount = Math.max(1, tailSegments);
	if (segments.length <= tailCount) return truncateStartToWidth(normalized, maxWidth);
	const compact = `${prefix}…/${segments.slice(-tailCount).join("/")}`;
	return truncateStartToWidth(compact, maxWidth);
}

function evaluateFilterArgs(
	arg: string | undefined,
	context: Record<string, unknown>,
	diagnostics: FooterTemplateDiagnostic[],
	adapterId: string,
	token: string,
): unknown[] {
	return splitFilterArgs(arg).map((part) => evaluateTemplateTerm(part, context, diagnostics, adapterId, token));
}

function applyTemplateFilter(
	theme: ExtensionContext["ui"]["theme"],
	value: string,
	filterExpression: string,
	context: Record<string, unknown>,
	diagnostics: FooterTemplateDiagnostic[],
	adapterId: string,
	token: string,
): string {
	const { name, arg } = parseFilter(filterExpression);
	if (name === "style" || name === "color") {
		return applyStyleSpec(theme, value, evaluateTemplateTerm(arg, context, diagnostics, adapterId, token), diagnostics, adapterId, token);
	}
	if (name === "bg" || name === "background") {
		const bg = valueToText(evaluateTemplateTerm(arg, context, diagnostics, adapterId, token));
		return bg && THEME_BG_COLORS.has(bg) ? theme.bg(bg as never, value) : applyStyleSpec(theme, value, `bg:${bg}`, diagnostics, adapterId, token);
	}
	if (name === "bold" || name === "italic" || name === "underline" || name === "inverse" || name === "strikethrough") {
		return applyStyleSpec(theme, value, name, diagnostics, adapterId, token);
	}
	if (name === "link") {
		const url = valueToText(evaluateTemplateTerm(arg, context, diagnostics, adapterId, token));
		return url ? osc8(value, url) : value;
	}
	if (name === "truncate") {
		const [maxWidthArg, ellipsisArg] = evaluateFilterArgs(arg, context, diagnostics, adapterId, token);
		const maxWidth = numberFilterArg(maxWidthArg, 40, 1);
		const ellipsis = valueToText(ellipsisArg) || "…";
		return truncateToWidth(value, maxWidth, ellipsis);
	}
	if (name === "compactPath") {
		const [maxWidthArg, tailSegmentsArg] = evaluateFilterArgs(arg, context, diagnostics, adapterId, token);
		const maxWidth = numberFilterArg(maxWidthArg, 40, 4);
		const tailSegments = numberFilterArg(tailSegmentsArg, 2, 1);
		return compactPathText(value, maxWidth, tailSegments);
	}
	if (name === "default") {
		return value.length > 0 && !value.startsWith("[missing:") ? value : (valueToTemplateText(evaluateTemplateTerm(arg, context, diagnostics, adapterId, token)) ?? "");
	}
	diagnostics.push({ adapterId, token, severity: "warning", message: `Unknown template filter: ${name}` });
	return theme.fg("warning", value);
}

function renderTemplate(
	template: string,
	context: Record<string, unknown>,
	theme: ExtensionContext["ui"]["theme"],
	adapterId: string,
	diagnostics: FooterTemplateDiagnostic[],
): string {
	let output = "";
	let cursor = 0;
	const tokenPattern = /{{([\s\S]*?)}}/g;
	for (let match = tokenPattern.exec(template); match; match = tokenPattern.exec(template)) {
		output += template.slice(cursor, match.index);
		const token = match[0];
		const expression = match[1]?.trim() ?? "";
		if (!expression) {
			diagnostics.push({ adapterId, token, severity: "error", message: "Empty template token" });
			output += theme.fg("error", "[empty-token]");
		} else {
			const [head, ...filters] = splitTemplatePipes(expression);
			const hasDefaultFilter = filters.some((filter) => parseFilter(filter).name === "default");
			let rendered = valueToTemplateText(evaluateTemplateTerm(head, context, diagnostics, adapterId, token, !hasDefaultFilter)) ?? "";
			for (const filter of filters) rendered = applyTemplateFilter(theme, rendered, filter, context, diagnostics, adapterId, token);
			output += rendered;
		}
		cursor = match.index + token.length;
	}
	output += template.slice(cursor);
	const literalRemainder = template.replace(/{{[\s\S]*?}}/g, "");
	if (literalRemainder.includes("{{") || literalRemainder.includes("}}")) {
		diagnostics.push({ adapterId, severity: "error", message: "Unbalanced template braces" });
		return `${output}${theme.fg("error", "[template braces]")}`;
	}
	return output;
}

function extractMatchedValue(text: string, adapter: FooterAdapterConfig): string | undefined {
	if (!adapter.match) return text;
	let match: RegExpMatchArray | null;
	try {
		match = text.match(new RegExp(adapter.match));
	} catch {
		return undefined;
	}
	if (!match) return undefined;
	if (typeof adapter.group === "number") return match[adapter.group];
	if (typeof adapter.group === "string" && adapter.group) {
		if (/^\d+$/.test(adapter.group)) return match[Number(adapter.group)];
		return match.groups?.[adapter.group];
	}
	return match[1] ?? match[0];
}

function sourceValueObject(sourceValue: unknown): FooterAdapterSourceValue {
	return sourceValue && typeof sourceValue === "object" && !Array.isArray(sourceValue) ? (sourceValue as FooterAdapterSourceValue) : { value: sourceValue };
}

function adapterItemFromSource(adapterId: string, adapter: FooterAdapterConfig, sourceValue: unknown): ExternalFooterItem | undefined {
	const sourceObject = sourceValueObject(sourceValue);
	const defaultPath = adapter.source === "sessionEntry" ? "data" : "value";
	const selected = selectPath(sourceValue, adapter.path ?? defaultPath);
	const selectedText = valueToText(selected);
	const allowEmpty = adapter.hideWhenEmpty === false || Boolean(adapter.emptyTemplate);
	if (!selectedText && !allowEmpty) return undefined;
	const matched = selectedText ? extractMatchedValue(selectedText, adapter) : undefined;
	if (!matched && !allowEmpty) return undefined;
	const url = (adapter.urlPath ? normalizeLinkUrl(selectPath(sourceValue, adapter.urlPath)) : undefined) ?? normalizeLinkUrl(sourceObject.url);
	return {
		id: adapter.itemId ?? adapterId,
		label: adapter.label ?? sourceObject.label ?? adapterId,
		value: matched ?? selectedText ?? "",
		status: sourceObject.status,
		data: sourceObject.data,
		url,
		tone: adapter.tone ?? sourceObject.tone,
		hint: {
			...sourceObject.hint,
			format: adapter.format ?? sourceObject.hint?.format ?? "label-value",
			icon: adapter.icon ?? sourceObject.hint?.icon,
			placement: normalizePlacement({ ...(sourceObject.hint?.placement ?? {}), ...(adapter.placement ?? {}) }),
		},
	};
}

function templatePiContext(piSources: Record<string, FooterAdapterSourceValue>): Record<string, unknown> {
	return {
		cwd: piSources.cwd?.value,
		model: piSources.model?.data ?? {},
		stats: piSources.stats?.data ?? {},
		context: piSources.context?.data ?? {},
		branch: piSources.branch?.data ?? {},
		pr: piSources.pr?.data ?? {},
		extensionStatuses: piSources.extensionStatuses?.data ?? {},
	};
}

function templateContextForAdapter(external: ExternalFooterItem, sourceValue: unknown, piSources: Record<string, FooterAdapterSourceValue>): Record<string, unknown> {
	const sourceObject = sourceValueObject(sourceValue);
	return {
		label: external.label ?? sourceObject.label,
		value: external.value ?? sourceObject.value,
		status: external.status ?? sourceObject.status,
		data: external.data ?? sourceObject.data ?? sourceValue,
		url: external.url ?? sourceObject.url,
		source: sourceObject,
		pi: templatePiContext(piSources),
	};
}

function renderAdapterText(
	theme: ExtensionContext["ui"]["theme"],
	adapterId: string,
	adapter: FooterAdapterConfig,
	external: ExternalFooterItem,
	sourceValue: unknown,
	piSources: Record<string, FooterAdapterSourceValue>,
	diagnostics: FooterTemplateDiagnostic[],
): string | undefined {
	const template = !external.value && adapter.emptyTemplate ? adapter.emptyTemplate : adapter.template;
	let text = template ? renderTemplate(template, templateContextForAdapter(external, sourceValue, piSources), theme, adapterId, diagnostics) : renderExternalItem(theme, external);
	if (text && adapter.style) text = applyStyleSpec(theme, text, adapter.style, diagnostics, adapterId);
	if (text && template && external.url) text = osc8(text, external.url);
	return text;
}

function redactSensitive(value: unknown, depth = 0): unknown {
	if (depth > 4) return "…";
	if (Array.isArray(value)) return value.slice(0, 8).map((entry) => redactSensitive(entry, depth + 1));
	if (!value || typeof value !== "object") return value;
	const out: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 30)) {
		out[key] = /(token|secret|password|credential|authorization|api[_-]?key)/i.test(key) ? "[redacted]" : redactSensitive(entry, depth + 1);
	}
	return out;
}

function previewValue(value: unknown, maxLength = 1200): unknown {
	const redacted = redactSensitive(value);
	const text = valueToText(redacted) ?? "";
	return text.length > maxLength ? `${text.slice(0, maxLength)}…` : redacted;
}

function parseSettingsInput(settings: FooterFrameworkSettings, args: string): string | undefined {
	const tokens = args
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	const [command, key, value] = tokens;

	if (!command) return undefined;
	if (command === "on") {
		settings.enabled = true;
		return "Footer framework enabled.";
	}
	if (command === "off") {
		settings.enabled = false;
		return "Footer framework disabled (default footer restored).";
	}
	if (command === "reset") {
		Object.assign(settings, cloneDefaultSettings());
		return "Footer framework reset to defaults.";
	}
	if (command === "section") {
		if (!key || !value) return "Usage: /footerfx section <cwd|stats|context|model|branch|pr|ext> <on|off>";
		const enabled = value === "on" || value === "enable" || value === "true";
		if (!["on", "off", "enable", "disable", "true", "false"].includes(value)) return "Section value must be on/off.";
		if (!["cwd", "stats", "context", "model", "branch", "pr", "ext"].includes(key)) return "Unknown section. Use: cwd|stats|context|model|branch|pr|ext";
		(settings.items[key] ??= {}).visible = enabled;
		return `Section ${key} ${enabled ? "enabled" : "disabled"}.`;
	}
	if (command === "gap") {
		if (!key || !value) return "Usage: /footerfx gap <min> <max>";
		const min = Number(key);
		const max = Number(value);
		if (!Number.isFinite(min) || !Number.isFinite(max)) return "gap values must be numbers.";
		settings.minGap = Math.max(0, Math.round(min));
		settings.maxGap = Math.max(settings.minGap, Math.round(max));
		return `Gap updated (min=${settings.minGap}, max=${settings.maxGap}).`;
	}
	if (command === "anchor") {
		if (!key || !value) return "Usage: /footerfx anchor <line|all> <gap|left|center|right|spread>";
		if (!ANCHOR_MODES.includes(value as FooterAnchorMode)) {
			return "Anchor must be one of: gap, left, center, right, spread.";
		}
		const mode = value as FooterAnchorMode;
		const target = parseFooterLineSelector(key);
		if (target === "all") {
			setAllLineAnchors(settings, mode);
			return `Anchor all lines set to ${mode}.`;
		}
		if (target === undefined) return "Anchor target must be all or a positive line number.";
		setLineAnchor(settings, target, mode);
		return `Anchor line ${target} set to ${mode}.`;
	}
	if (command === "item") {
		const [id, action, arg] = tokens.slice(1);
		if (!id || !action) {
			return "Usage: /footerfx item <id> <show|hide|line|row|zone|order|column|before|after|reset> [value]";
		}
		const item = (settings.items[id] ??= {});
		if (action === "show") {
			item.visible = true;
			return `Item ${id} shown.`;
		}
		if (action === "hide") {
			item.visible = false;
			return `Item ${id} hidden.`;
		}
		if (action === "reset") {
			delete settings.items[id];
			return `Item ${id} reset.`;
		}
		if (action === "line" || action === "row") {
			const line = normalizeFooterLine(arg);
			if (line === undefined) return "Item line must be a positive number.";
			item.line = line;
			return `Item ${id} moved to line ${line}.`;
		}
		if (action === "zone") {
			if (arg !== "left" && arg !== "right") return "Item zone must be left or right.";
			item.zone = arg;
			return `Item ${id} moved to ${arg} zone.`;
		}
		if (action === "order") {
			const order = Number(arg);
			if (!Number.isFinite(order)) return "Item order must be a number.";
			item.order = Math.round(order);
			delete item.before;
			delete item.after;
			return `Item ${id} order set to ${item.order}.`;
		}
		if (action === "column") {
			if (arg === "off" || arg === "auto") {
				delete item.column;
				return `Item ${id} absolute column disabled.`;
			}
			const column = Number(arg);
			if (!Number.isFinite(column)) return "Item column must be a number, off, or auto.";
			item.column = Math.max(0, Math.round(column));
			return `Item ${id} column set to ${item.column}.`;
		}
		if (action === "before" || action === "after") {
			if (!arg) return `Usage: /footerfx item ${id} ${action} <other-item-id>`;
			delete item.before;
			delete item.after;
			item[action] = arg;
			return `Item ${id} positioned ${action} ${arg}.`;
		}
		return "Unknown item action. Use show|hide|line|row|zone|order|column|before|after|reset.";
	}
	if (command === "adapter") {
		const [id, action, sourceKey, label] = tokens.slice(1);
		if (!id) {
			const ids = Object.keys(settings.adapters).sort();
			return ids.length ? `Adapters: ${ids.join(", ")}` : "No footer adapters configured.";
		}
		if (action === "remove" || action === "delete") {
			delete settings.adapters[id];
			if (DEFAULT_BUILT_IN_ADAPTERS[id]) {
				(settings.items[id] ??= {}).visible = false;
				return `Built-in item ${id} hidden.`;
			}
			return `Adapter ${id} removed.`;
		}
		if (action === "template" || action === "empty-template" || action === "style") {
			const existing = settings.adapters[id] ?? DEFAULT_BUILT_IN_ADAPTERS[id];
			if (!existing) return `Adapter ${id} does not exist yet. Create it with pi/status/custom or footer_framework_adapter_config first.`;
			const match = args.match(new RegExp(`^adapter\\s+${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+${action}\\s+([\\s\\S]+)$`));
			const body = match?.[1]?.trim();
			if (!body) return `Usage: /footerfx adapter ${id} ${action} <value>`;
			settings.adapters[id] = { ...existing };
			if (action === "template") settings.adapters[id].template = body;
			else if (action === "empty-template") settings.adapters[id].emptyTemplate = body;
			else settings.adapters[id].style = body;
			return `Adapter ${id} ${action} updated.`;
		}
		if (action === "pi") {
			if (!sourceKey) return `Usage: /footerfx adapter ${id} pi <source-key> [label]`;
			settings.adapters[id] = {
				source: "pi",
				key: sourceKey,
				label: label ?? id,
				format: "label-value",
				placement: { visible: true, line: 2, zone: "right", order: 100 },
			};
			return `Adapter ${id} maps Pi source ${sourceKey}.`;
		}
		if (action === "status") {
			if (!sourceKey) return `Usage: /footerfx adapter ${id} status <status-key> [label]`;
			settings.adapters[id] = {
				source: "extensionStatus",
				key: sourceKey,
				label: label ?? id,
				format: "label-value",
				placement: { visible: true, line: 2, zone: "right", order: 100 },
			};
			return `Adapter ${id} maps extension status ${sourceKey}.`;
		}
		if (action === "custom") {
			const pathExpression = tokens[4];
			const customLabel = tokens[5];
			if (!sourceKey || !pathExpression) return `Usage: /footerfx adapter ${id} custom <custom-type> <path> [label]`;
			const dataPath = pathExpression.startsWith("data.") || pathExpression.startsWith("$.data.") ? pathExpression : `data.${pathExpression.replace(/^\$\.?/, "")}`;
			settings.adapters[id] = {
				source: "sessionEntry",
				key: sourceKey,
				path: dataPath,
				label: customLabel ?? id,
				format: "label-value",
				placement: { visible: true, line: 2, zone: "right", order: 100 },
			};
			return `Adapter ${id} maps latest custom entry ${sourceKey}.${pathExpression}.`;
		}
		return "Usage: /footerfx adapter [id] <pi|status|custom|remove> ...";
	}

	return `Unknown command: ${command}`;
}

function settingsSummary(settings: FooterFrameworkSettings, loadedConfig?: string): string {
	const customizedItems = Object.keys(settings.items).sort();
	const adapters = Object.keys(settings.adapters).sort();
	return [
		loadedConfig ? `loaded=${loadedConfig}` : undefined,
		`enabled=${settings.enabled}`,
		`anchors: ${sortedLineAnchors(settings)}`,
		`gap: min=${settings.minGap}, max=${settings.maxGap}`,
		customizedItems.length ? `customizedItems=${customizedItems.join(",")}` : undefined,
		adapters.length ? `adapters=${adapters.join(",")}` : undefined,
	]
		.filter(Boolean)
		.join("\n");
}

const extensionDir = path.dirname(fileURLToPath(import.meta.url));

export default function footerFramework(pi: ExtensionAPI): void {
	const settings: FooterFrameworkSettings = cloneDefaultSettings();
	let prState: PrState | undefined;
	let currentCtx: ExtensionContext | undefined;
	let requestRender: (() => void) | undefined;
	const externalItems = new Map<string, ExternalFooterItem>();
	let lastLoadedConfig = "defaults";
	let lastFooterSnapshot: FooterSnapshot | undefined;
	let lastPiSources: Record<string, FooterAdapterSourceValue> = {};
	let lastTemplateDiagnostics: FooterTemplateDiagnostic[] = [];

	function applyValidatedSettings(input: Partial<FooterFrameworkSettings>): void {
		Object.assign(settings, normalizeSettings(input));
		settings.minGap = Math.max(0, Math.round(settings.minGap));
		settings.maxGap = Math.max(settings.minGap, Math.round(settings.maxGap));
	}

	function saveSettings(scope: ConfigScope, ctx?: ExtensionContext): string {
		if (scope === "project") {
			if (!ctx) return "Cannot save project config before a session is active.";
			const filePath = projectConfigPath(ctx);
			writeConfigFile(filePath, settings);
			lastLoadedConfig = `project:${filePath}`;
			return `Saved project footer config: ${filePath}`;
		}
		const filePath = userConfigPath();
		writeConfigFile(filePath, settings);
		lastLoadedConfig = `user:${filePath}`;
		return `Saved user footer config: ${filePath}`;
	}

	function persistSettings(): void {
		saveSettings("user", currentCtx);
		pi.appendEntry("footer-framework-state", settings);
	}

	function loadSettings(ctx: ExtensionContext): string {
		Object.assign(settings, cloneDefaultSettings());
		const userPath = userConfigPath();
		const projectPath = projectConfigPath(ctx);
		const userConfig = readConfigFile(userPath);
		const projectConfig = readConfigFile(projectPath);

		if (userConfig) applyValidatedSettings(userConfig);
		if (projectConfig) applyValidatedSettings(projectConfig);

		if (projectConfig) lastLoadedConfig = `project:${projectPath}`;
		else if (userConfig) lastLoadedConfig = `user:${userPath}`;
		else lastLoadedConfig = "defaults";
		return lastLoadedConfig;
	}

	function checkGlyph(checks: ChecksState): string {
		if (checks === "pass") return "✅";
		if (checks === "fail") return "❌";
		if (checks === "running") return "⏳";
		return "•";
	}

	function checkTone(checks: ChecksState): ExternalFooterItemTone {
		if (checks === "pass") return "success";
		if (checks === "fail") return "error";
		if (checks === "running") return "warning";
		return "muted";
	}

	function composeLine(
		theme: ExtensionContext["ui"]["theme"],
		width: number,
		left: string,
		right: string | undefined,
		anchor: FooterAnchorMode,
	): {
		line: string;
		layout: {
			anchor: FooterAnchorMode;
			leftWidth: number;
			rightWidthOriginal: number;
			rightWidthFinal: number;
			padCount: number;
			rightStartCol: number;
			rightEndCol: number;
			truncated: boolean;
		};
	} {
		const leftWidth = visibleWidth(left);
		if (!right || visibleWidth(right) === 0) {
			return {
				line: truncateToWidth(left, width, theme.fg("dim", "...")),
				layout: {
					anchor,
					leftWidth,
					rightWidthOriginal: 0,
					rightWidthFinal: 0,
					padCount: 0,
					rightStartCol: leftWidth,
					rightEndCol: leftWidth,
					truncated: false,
				},
			};
		}
		const rightWidthOriginal = visibleWidth(right);
		const naturalPad = width - leftWidth - rightWidthOriginal;
		let padCount = settings.minGap;
		if (anchor === "right" || anchor === "spread") {
			padCount = Math.max(settings.minGap, naturalPad);
		} else if (anchor === "center") {
			padCount = Math.max(settings.minGap, Math.floor(naturalPad / 2));
			padCount = Math.min(padCount, settings.maxGap);
		} else if (anchor === "gap") {
			padCount = Math.max(settings.minGap, Math.min(naturalPad, settings.maxGap));
		} else if (anchor === "left") {
			padCount = settings.minGap;
		}

		const availableForRight = Math.max(0, width - leftWidth - padCount);
		const compactRight = truncateToWidth(right, availableForRight, theme.fg("dim", "..."));
		const rightWidthFinal = visibleWidth(compactRight);
		const line = truncateToWidth(`${left}${" ".repeat(padCount)}${compactRight}`, width, theme.fg("dim", "..."));
		const rightStartCol = leftWidth + padCount;
		const rightEndCol = Math.max(rightStartCol, rightStartCol + rightWidthFinal - 1);
		return {
			line,
			layout: {
				anchor,
				leftWidth,
				rightWidthOriginal,
				rightWidthFinal,
				padCount,
				rightStartCol,
				rightEndCol,
				truncated: rightWidthFinal < rightWidthOriginal,
			},
		};
	}

	function renderModelLabel(): string {
		const model = currentCtx?.model?.id ?? "no-model";
		return `${model}:${pi.getThinkingLevel()}`;
	}

	function contextUsageSource(): FooterAdapterSourceValue | undefined {
		const usage = currentCtx?.getContextUsage();
		const contextWindow = usage?.contextWindow ?? currentCtx?.model?.contextWindow;
		if (!contextWindow) return undefined;

		const tokens = usage?.tokens ?? null;
		const percent = usage?.percent ?? null;
		const percentText = percent === null ? "?%" : `${percent.toFixed(1)}%`;
		const tokenText = tokens === null ? `?/${formatContextTokens(contextWindow)}` : `${formatContextTokens(tokens)}/${formatContextTokens(contextWindow)}`;
		const tone: ExternalFooterItemTone = percent !== null && percent > 90 ? "error" : percent !== null && percent > 70 ? "warning" : "muted";
		return {
			label: "ctx",
			value: `ctx ${percentText} ${tokenText}`,
			tone,
			data: { tokens, contextWindow, window: contextWindow, percent, percentText, tokenText, tone },
		};
	}

	function placementFor(id: string, fallback: FooterItemPlacement, external?: Partial<FooterItemPlacement>): FooterItemPlacement {
		return {
			...fallback,
			...normalizePlacement(external ?? {}),
			...normalizePlacement(settings.items[id] ?? {}),
		};
	}

	function resolveRelativeOrders(items: FooterItem[]): FooterItem[] {
		const sorted = [...items].sort((a, b) => a.placement.order - b.placement.order || a.id.localeCompare(b.id));
		for (const item of sorted) {
			const before = item.placement.before;
			const after = item.placement.after;
			if (before) {
				const target = sorted.find((candidate) => candidate.id === before);
				if (target) item.placement.order = target.placement.order - 0.1;
			}
			if (after) {
				const target = sorted.find((candidate) => candidate.id === after);
				if (target) item.placement.order = target.placement.order + 0.1;
			}
		}
		return sorted.sort((a, b) => a.placement.order - b.placement.order || a.id.localeCompare(b.id));
	}

	function overlayAbsoluteItems(theme: ExtensionContext["ui"]["theme"], width: number, line: string, items: FooterItem[]): string {
		let out = line;
		const sorted = items
			.filter((item) => Number.isFinite(item.placement.column))
			.sort((a, b) => (a.placement.column ?? 0) - (b.placement.column ?? 0) || a.placement.order - b.placement.order);
		for (const item of sorted) {
			const column = clamp(item.placement.column ?? 0, 0, width - 1);
			const prefix = truncateToWidth(out, column, "");
			const pad = " ".repeat(Math.max(0, column - visibleWidth(prefix)));
			const available = Math.max(0, width - column);
			const text = truncateToWidth(item.text, available, theme.fg("dim", "..."));
			out = truncateToWidth(`${prefix}${pad}${text}`, width, theme.fg("dim", "..."));
		}
		return out;
	}

	function renderFooterLine(theme: ExtensionContext["ui"]["theme"], width: number, items: FooterItem[], line: FooterLine, anchor: FooterAnchorMode) {
		const lineItems = items.filter((item) => item.placement.line === line);
		const normalItems = lineItems.filter((item) => !Number.isFinite(item.placement.column));
		const left = normalItems
			.filter((item) => item.placement.zone === "left")
			.sort((a, b) => a.placement.order - b.placement.order)
			.map((item) => item.text)
			.join(" · ");
		const right = normalItems
			.filter((item) => item.placement.zone === "right")
			.sort((a, b) => a.placement.order - b.placement.order)
			.map((item) => item.text)
			.join(" · ");
		const result = composeLine(theme, width, left || " ", right, anchor);
		return { ...result, line: overlayAbsoluteItems(theme, width, result.line, lineItems) };
	}

	function latestCustomEntry(customType: string): unknown {
		const entries = currentCtx?.sessionManager.getEntries() ?? [];
		for (let index = entries.length - 1; index >= 0; index--) {
			const entry = entries[index] as { type?: string; customType?: string };
			if (entry.type === "custom" && entry.customType === customType) return entry;
		}
		return undefined;
	}

	function adaptedExtensionStatusKeys(): Set<string> {
		return new Set(
			Object.values(allAdapters())
				.filter((adapter) => adapter.source === "extensionStatus")
				.map((adapter) => adapter.key),
		);
	}

	function allAdapters(): Record<string, FooterAdapterConfig> {
		return { ...DEFAULT_BUILT_IN_ADAPTERS, ...settings.adapters };
	}

	function buildPiSources(
		footerData: { getGitBranch(): string | null; getExtensionStatuses(): ReadonlyMap<string, string> },
		stats: { input: number; output: number; cost: number; inputText: string; outputText: string; costText: string; value: string },
	): Record<string, FooterAdapterSourceValue> {
		const sources: Record<string, FooterAdapterSourceValue> = {
			cwd: { label: "cwd", value: currentCtx?.cwd ?? "", tone: "muted", data: { path: currentCtx?.cwd ?? "" } },
			model: {
				label: "model",
				value: renderModelLabel(),
				tone: "muted",
				data: { ...(currentCtx?.model ?? {}), id: currentCtx?.model?.id ?? "no-model", provider: currentCtx?.model?.provider, thinking: pi.getThinkingLevel() },
			},
			stats: { label: "stats", value: stats.value, tone: "muted", data: stats },
			extensionStatuses: { label: "ext", value: footerData.getExtensionStatuses().size, data: Object.fromEntries(footerData.getExtensionStatuses()) },
		};
		const context = contextUsageSource();
		if (context) sources.context = context;
		const gitBranch = footerData.getGitBranch();
		if (gitBranch) {
			const pr = prState?.pr && prState.branch === gitBranch ? prState.pr : undefined;
			const label = pr ? `(${gitBranch} #${pr.number})` : `(${gitBranch})`;
			sources.branch = {
				label: "branch",
				value: label,
				url: pr?.url,
				tone: "muted",
				data: { name: gitBranch, label, prNumber: pr?.number, prUrl: pr?.url, pr },
			};
		}
		if (prState?.pr) {
			const commentsText = prState.pr.comments > 0 ? ` 💬${prState.pr.comments}` : "";
			const data = {
				...prState,
				number: prState.pr.number,
				title: prState.pr.title,
				url: prState.pr.url,
				comments: prState.pr.comments,
				commentsText,
				checks: prState.pr.checks,
				checkGlyph: checkGlyph(prState.pr.checks),
				checkTone: checkTone(prState.pr.checks),
			};
			sources.pr = { label: "PR", value: `${data.checkGlyph}${commentsText}`, url: prState.pr.url, tone: data.checkTone, data };
		}
		return sources;
	}

	function collectAdapterItems(
		theme: ExtensionContext["ui"]["theme"],
		footerData: { getExtensionStatuses(): ReadonlyMap<string, string> },
		piSources: Record<string, FooterAdapterSourceValue>,
		diagnostics: FooterTemplateDiagnostic[],
	): FooterItem[] {
		const items: FooterItem[] = [];
		const extensionStatuses = footerData.getExtensionStatuses();
		for (const [adapterId, adapter] of Object.entries(allAdapters())) {
			let sourceValue: unknown;
			if (adapter.source === "pi") {
				sourceValue = piSources[adapter.key];
				if (sourceValue === undefined) continue;
			} else if (adapter.source === "extensionStatus") {
				const value = extensionStatuses.get(adapter.key);
				if (value === undefined) continue;
				sourceValue = { key: adapter.key, value };
			} else if (adapter.source === "sessionEntry") {
				sourceValue = latestCustomEntry(adapter.key);
				if (sourceValue === undefined) continue;
			}
			const external = adapterItemFromSource(adapterId, adapter, sourceValue);
			if (!external) continue;
			const text = renderAdapterText(theme, adapterId, adapter, external, sourceValue, piSources, diagnostics);
			if (!text) continue;
			items.push({
				id: external.id,
				text,
				placement: placementFor(external.id, { visible: true, line: 2, zone: "right", order: 90 }, external.hint.placement),
			});
		}
		return items;
	}

	function collectItems(
		theme: ExtensionContext["ui"]["theme"],
		footerData: { getGitBranch(): string | null; getExtensionStatuses(): ReadonlyMap<string, string> },
		stats: { input: number; output: number; cost: number; inputText: string; outputText: string; costText: string; value: string },
		diagnostics: FooterTemplateDiagnostic[],
	): FooterItem[] {
		const items: FooterItem[] = [];
		const piSources = buildPiSources(footerData, stats);
		lastPiSources = piSources;

		const adaptedStatusKeys = adaptedExtensionStatusKeys();
		const extStatuses = Array.from(footerData.getExtensionStatuses().entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.flatMap(([key, value]) => {
				const text = sanitizeStatusText(value);
				if (key === "footer-framework" || key === "pr-upstream" || adaptedStatusKeys.has(key)) return [];
				if (visibleWidth(text) === 0) return [];
				return [text];
			})
			.join(" · ");
		if (extStatuses) items.push({ id: "ext", text: extStatuses, placement: placementFor("ext", DEFAULT_ITEM_PLACEMENTS.ext) });

		items.push(...collectAdapterItems(theme, footerData, piSources, diagnostics));

		for (const [id, external] of externalItems) {
			const text = renderExternalItem(theme, external);
			if (!text) continue;
			items.push({
				id,
				text,
				placement: placementFor(id, { visible: true, line: 2, zone: "right", order: 100 }, external.hint.placement),
			});
		}

		return resolveRelativeOrders(items).filter((item) => item.placement.visible && item.text.length > 0);
	}

	function compactRuntimeItem(item: { name: string; description?: string; sourceInfo?: unknown }, options: FooterSourceInventoryOptions) {
		return options.includeDetails ? { name: item.name, description: item.description, sourceInfo: item.sourceInfo } : { name: item.name };
	}

	function footerSourceInventory(options: FooterSourceInventoryOptions = {}) {
		const entries = currentCtx?.sessionManager.getEntries() ?? [];
		const customEntries = new Map<string, { customType: string; count: number; latest: unknown }>();
		for (const entry of entries as Array<{ type?: string; customType?: string; data?: unknown }>) {
			if (entry.type !== "custom" || !entry.customType) continue;
			const current = customEntries.get(entry.customType) ?? { customType: entry.customType, count: 0, latest: undefined };
			current.count += 1;
			current.latest = previewValue(entry.data);
			customEntries.set(entry.customType, current);
		}
		const payload: Record<string, unknown> = {
			builtInItems: Object.keys(DEFAULT_ITEM_PLACEMENTS).sort(),
			piSources: Object.fromEntries(Object.entries(lastPiSources).map(([key, value]) => [key, previewValue(value)])),
			stylePrimitives: {
				foregroundColors: Array.from(THEME_FG_COLORS),
				backgroundColors: Array.from(THEME_BG_COLORS),
				attributes: Array.from(THEME_TEXT_ATTRIBUTES),
			},
			templateDiagnostics: lastTemplateDiagnostics,
			defaultBuiltInAdapters: DEFAULT_BUILT_IN_ADAPTERS,
			externalItems: Array.from(externalItems.values()).map((item) => ({
				id: item.id,
				label: item.label,
				hasValue: item.value !== undefined,
				hasStatus: item.status !== undefined,
				hasData: item.data !== undefined,
				hint: item.hint,
			})),
			extensionStatuses: lastFooterSnapshot?.extensionStatuses ?? [],
			customEntries: Array.from(customEntries.values()).sort((a, b) => a.customType.localeCompare(b.customType)),
			adapters: settings.adapters,
			renderedItems: lastFooterSnapshot?.renderedItems ?? [],
			configPaths: currentCtx ? { user: userConfigPath(), project: projectConfigPath(currentCtx) } : { user: userConfigPath() },
			omitted: {
				tools: "pass includeTools: true to include registered tool names",
				commands: "pass includeCommands: true to include command names",
				details: "pass includeDetails: true with includeTools/includeCommands for descriptions and sourceInfo",
				skills: "pass includeSkills: true with includeCommands to include skill commands",
			},
		};
		if (options.includeTools) payload.tools = pi.getAllTools().map((tool) => compactRuntimeItem(tool, options));
		if (options.includeCommands) {
			const commands = options.includeSkills ? pi.getCommands() : pi.getCommands().filter((command) => !command.name.startsWith("skill:"));
			payload.commands = commands.map((command) => compactRuntimeItem(command, options));
		}
		return payload;
	}

	function applyFooterConfig(input: string, ctx?: ExtensionContext): string {
		try {
			const trimmed = input.trim();
			const [command, scope] = trimmed.split(/\s+/);
			let message: string;
			let shouldPersist = true;

			if (command === "save") {
				if (scope !== "user" && scope !== "project") return "Usage: /footerfx save <user|project>";
				message = saveSettings(scope, ctx);
				shouldPersist = false;
			} else if (command === "load") {
				if (!ctx) return "Cannot load footer config before a session is active.";
				message = `Loaded footer config from ${loadSettings(ctx)}.`;
				shouldPersist = false;
			} else if (command === "config") {
				message = [`Loaded: ${lastLoadedConfig}`, `User: ${userConfigPath()}`, ctx ? `Project: ${projectConfigPath(ctx)}` : "Project: unavailable before session"].join("\n");
				shouldPersist = false;
			} else {
				message = parseSettingsInput(settings, trimmed) ?? settingsSummary(settings, lastLoadedConfig);
			}

			if (shouldPersist) persistSettings();
			if (ctx) {
				installFooter(ctx);
				ctx.ui.setStatus("footer-framework", settings.enabled ? ctx.ui.theme.fg("muted", "footerfx:on") : undefined);
			}
			return message;
		} catch (error) {
			return `Footer config error: ${error instanceof Error ? error.message : "unknown error"}`;
		}
	}

	function installFooter(ctx: ExtensionContext): void {
		if (!settings.enabled) {
			ctx.ui.setFooter(undefined);
			return;
		}

		ctx.ui.setFooter((tui, theme, footerData) => {
			requestRender = () => tui.requestRender();
			const unsubscribe = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose() {
					requestRender = undefined;
					unsubscribe();
				},
				invalidate() {},
					render(width: number): string[] {
					let input = 0;
					let output = 0;
					let cost = 0;
					for (const entry of ctx.sessionManager.getEntries()) {
						if (entry.type !== "message" || entry.message.role !== "assistant") continue;
						input += entry.message.usage.input;
						output += entry.message.usage.output;
						cost += entry.message.usage.cost.total;
					}

					const stats = {
						input,
						output,
						cost,
						inputText: formatTokens(input),
						outputText: formatTokens(output),
						costText: cost.toFixed(3),
						value: `↑${formatTokens(input)} ↓${formatTokens(output)} $${cost.toFixed(3)}`,
					};
					const diagnostics: FooterTemplateDiagnostic[] = [];
					const items = collectItems(theme, footerData, stats, diagnostics);
					lastTemplateDiagnostics = diagnostics;
					const maxLine = Math.max(2, ...items.map((item) => item.placement.line));
					const lineResults = Array.from({ length: maxLine }, (_, index) => {
						const line = index + 1;
						const result = renderFooterLine(theme, width, items, line, getLineAnchor(settings, line));
						return { line, text: result.line, layout: result.layout };
					});
					const line1Result = lineResults[0];
					const line2Result = lineResults[1];

					lastFooterSnapshot = {
						width,
						lines: lineResults,
						line1: line1Result?.text ?? "",
						line2: line2Result?.text ?? "",
						line1Layout: line1Result?.layout ?? renderFooterLine(theme, width, [], 1, getLineAnchor(settings, 1)).layout,
						line2Layout: line2Result?.layout ?? renderFooterLine(theme, width, [], 2, getLineAnchor(settings, 2)).layout,
						gitBranch: footerData.getGitBranch(),
						renderedItems: items.map((item) => ({
							id: item.id,
							line: item.placement.line,
							zone: item.placement.zone,
							order: item.placement.order,
							column: item.placement.column,
							width: visibleWidth(item.text),
						})),
						extensionStatuses: Array.from(footerData.getExtensionStatuses().entries()).map(([key, value]) => ({ key, value })),
						model: ctx.model?.id ?? "no-model",
						contextUsage: ctx.getContextUsage() ?? null,
						thinkingLevel: pi.getThinkingLevel(),
						cwd: ctx.cwd,
					};
					return lineResults.map((line) => line.text);
				},
			};
		});
	}

	pi.on("resources_discover", async () => {
		return { skillPaths: [path.join(extensionDir, "skills")] };
	});

	pi.events.on("pr-upstream:state", (event) => {
		prState = event as PrState;
		requestRender?.();
	});

	pi.events.on("footer-framework:item", (event) => {
		const item = event as ExternalFooterItemEvent;
		const id = item.id?.trim();
		if (!id) return;
		if (item.remove) externalItems.delete(id);
		else {
			const normalized = normalizeExternalItemEvent(item);
			if (normalized) externalItems.set(id, normalized);
		}
		requestRender?.();
	});

	pi.registerCommand("footerfx", {
		description: "Footer framework controls (on/off, item layout, anchor, gap, reset)",
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			if (!trimmed) {
				ctx.ui.notify(settingsSummary(settings, lastLoadedConfig), "info");
				return;
			}
			ctx.ui.notify(applyFooterConfig(trimmed, ctx), "info");
		},
	});

	pi.registerCommand("footerfx-debug", {
		description: "Show latest footer render snapshot and framework state",
		handler: async (_args, ctx) => {
			const payload = {
				settings,
				loadedConfig: lastLoadedConfig,
				configPaths: { user: userConfigPath(), project: projectConfigPath(ctx) },
				prState,
				lastTemplateDiagnostics,
				lastFooterSnapshot,
			};
			ctx.ui.notify(JSON.stringify(payload, null, 2), "info");
		},
	});

	pi.registerTool(
		defineTool({
			name: "footer_framework_state",
			label: "Footer Framework State",
			description: "Get footer framework settings and latest rendered footer snapshot for autonomous tuning",
			parameters: Type.Object({}),
			async execute() {
				const payload = {
					settings,
					loadedConfig: lastLoadedConfig,
					configPaths: currentCtx ? { user: userConfigPath(), project: projectConfigPath(currentCtx) } : { user: userConfigPath() },
					prState,
					lastTemplateDiagnostics,
					lastFooterSnapshot,
				};
				return {
					content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
					details: payload,
				};
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "footer_framework_sources",
			label: "Footer Framework Sources",
			description: "Inspect data sources the footer framework can adapt into footer items. Defaults to concise footer-relevant data; pass includeTools/includeCommands for runtime metadata.",
			parameters: Type.Object({
				includeTools: Type.Optional(Type.Boolean({ description: "Include registered tool names. Default false to avoid bloating footer discovery output." })),
				includeCommands: Type.Optional(Type.Boolean({ description: "Include command names. Default false to avoid bloating footer discovery output." })),
				includeSkills: Type.Optional(Type.Boolean({ description: "Include skill commands when includeCommands is true. Default false." })),
				includeDetails: Type.Optional(Type.Boolean({ description: "Include descriptions and sourceInfo for included tools/commands. Default false." })),
			}),
			async execute(_toolCallId, params) {
				const payload = footerSourceInventory(params as FooterSourceInventoryOptions);
				return {
					content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
					details: payload,
				};
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "footer_framework_adapter_config",
			label: "Footer Framework Adapter Config",
			description: "List, set, or remove footer adapters that map existing Pi/extension data sources into framework-owned footer items",
			parameters: Type.Object({
				action: Type.String({ description: "One of: list, set, remove" }),
				id: Type.Optional(Type.String({ description: "Adapter id for set/remove" })),
				adapterJson: Type.Optional(Type.String({ description: "JSON adapter config for set. Required fields: source ('pi', 'extensionStatus', or 'sessionEntry') and key." })),
			}),
			async execute(_toolCallId, params) {
				const action = params.action.trim();
				let message: string;
				if (action === "list") {
					message = JSON.stringify({ defaultBuiltInAdapters: DEFAULT_BUILT_IN_ADAPTERS, adapters: settings.adapters }, null, 2);
				} else if (action === "remove") {
					if (!params.id?.trim()) throw new Error("remove requires id");
					const id = params.id.trim();
					delete settings.adapters[id];
					if (DEFAULT_BUILT_IN_ADAPTERS[id]) (settings.items[id] ??= {}).visible = false;
					persistSettings();
					if (currentCtx) installFooter(currentCtx);
					message = DEFAULT_BUILT_IN_ADAPTERS[id] ? `Built-in item ${id} hidden.` : `Adapter ${id} removed.`;
				} else if (action === "set") {
					if (!params.id?.trim()) throw new Error("set requires id");
					if (!params.adapterJson?.trim()) throw new Error("set requires adapterJson");
					const adapter = normalizeAdapter(JSON.parse(params.adapterJson));
					if (!adapter) throw new Error("adapterJson must include valid source and key");
					settings.adapters[params.id.trim()] = adapter;
					persistSettings();
					if (currentCtx) installFooter(currentCtx);
					message = `Adapter ${params.id.trim()} saved.`;
				} else {
					throw new Error("action must be list, set, or remove");
				}
				const payload = { message, adapters: settings.adapters };
				return {
					content: [{ type: "text", text: message }],
					details: payload,
				};
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "footer_framework_config",
			label: "Footer Framework Config",
			description: "Adjust footer framework settings without user command loop",
			parameters: Type.Object({
				command: Type.String({
					description:
						"Same syntax as /footerfx, e.g. 'section context on', 'item context line 3', 'item context after stats', 'anchor all right', 'gap 1 10', 'save project', 'load', 'on', 'off', 'reset'",
				}),
			}),
			async execute(_toolCallId, params) {
				const message = applyFooterConfig(params.command, currentCtx);
				return {
					content: [{ type: "text", text: message }],
					details: { message, settings },
				};
			},
		}),
	);

	pi.on("session_start", async (_event, ctx) => {
		currentCtx = ctx;
		loadSettings(ctx);

		// Compatibility migration: if no config file exists yet, seed from the last
		// session entry and immediately persist it as the user default.
		if (lastLoadedConfig === "defaults") {
			const persisted = ctx.sessionManager
				.getEntries()
				.filter((entry) => entry.type === "custom" && entry.customType === "footer-framework-state")
				.pop() as { data?: Partial<FooterFrameworkSettings> } | undefined;
			if (persisted?.data) {
				applyValidatedSettings(persisted.data);
				persistSettings();
			}
		}

		installFooter(ctx);
		ctx.ui.setStatus("footer-framework", settings.enabled ? ctx.ui.theme.fg("muted", "footerfx:on") : undefined);
	});

	pi.on("session_shutdown", async () => {
		requestRender = undefined;
		currentCtx = undefined;
	});
}
