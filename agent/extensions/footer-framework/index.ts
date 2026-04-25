import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "@mariozechner/pi-ai";
import { defineTool, type ExtensionAPI, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

type ChecksState = "pass" | "fail" | "running" | "unknown";
type FooterAnchorMode = "gap" | "left" | "center" | "right" | "spread";
type FooterLine = 1 | 2;
type FooterZone = "left" | "right";
type ConfigScope = "user" | "project";

interface FooterItemPlacement {
	visible: boolean;
	line: FooterLine;
	zone: FooterZone;
	order: number;
	column?: number;
	before?: string;
	after?: string;
}

interface FooterItem {
	id: string;
	text: string;
	placement: FooterItemPlacement;
}

interface ExternalFooterItemEvent {
	id: string;
	text?: string;
	placement?: Partial<FooterItemPlacement>;
	remove?: boolean;
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
	showCwd: boolean;
	showStats: boolean;
	showModel: boolean;
	showBranch: boolean;
	showPr: boolean;
	showExtensionStatuses: boolean;
	hideZeroMcp: boolean;
	line1Anchor: FooterAnchorMode;
	line2Anchor: FooterAnchorMode;
	branchMaxLength: number;
	minGap: number;
	maxGap: number;
	items: Record<string, Partial<FooterItemPlacement>>;
}

const DEFAULT_SETTINGS: FooterFrameworkSettings = {
	enabled: true,
	showCwd: true,
	showStats: true,
	showModel: true,
	showBranch: true,
	showPr: true,
	showExtensionStatuses: true,
	hideZeroMcp: true,
	line1Anchor: "right",
	line2Anchor: "right",
	branchMaxLength: 22,
	minGap: 2,
	maxGap: 20,
	items: {},
};

const ANCHOR_MODES: FooterAnchorMode[] = ["gap", "left", "center", "right", "spread"];
const CONFIG_FILE_NAME = "footer-framework.json";
const DEFAULT_ITEM_PLACEMENTS: Record<string, FooterItemPlacement> = {
	cwd: { visible: true, line: 1, zone: "left", order: 10 },
	model: { visible: true, line: 1, zone: "right", order: 10 },
	branch: { visible: true, line: 1, zone: "right", order: 20 },
	stats: { visible: true, line: 2, zone: "left", order: 10 },
	pr: { visible: true, line: 2, zone: "right", order: 10 },
	ext: { visible: true, line: 2, zone: "right", order: 20 },
};

function formatTokens(count: number): string {
	if (count < 1_000) return `${count}`;
	if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
	return `${(count / 1_000_000).toFixed(1)}M`;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
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
	if (typeof input.visible === "boolean") placement.visible = input.visible;
	if (input.line === 1 || input.line === 2) placement.line = input.line;
	if (input.zone === "left" || input.zone === "right") placement.zone = input.zone;
	if (Number.isFinite(input.order)) placement.order = Math.round(input.order as number);
	if (Number.isFinite(input.column)) placement.column = clamp(Math.round(input.column as number), 0, 500);
	if (typeof input.before === "string" && input.before.trim()) placement.before = input.before.trim();
	if (typeof input.after === "string" && input.after.trim()) placement.after = input.after.trim();
	return placement;
}

function normalizeSettings(input: Partial<FooterFrameworkSettings>): Partial<FooterFrameworkSettings> {
	const normalized: Partial<FooterFrameworkSettings> = {};
	for (const key of [
		"enabled",
		"showCwd",
		"showStats",
		"showModel",
		"showBranch",
		"showPr",
		"showExtensionStatuses",
		"hideZeroMcp",
	] as const) {
		if (typeof input[key] === "boolean") normalized[key] = input[key];
	}
	if (input.line1Anchor && ANCHOR_MODES.includes(input.line1Anchor)) normalized.line1Anchor = input.line1Anchor;
	if (input.line2Anchor && ANCHOR_MODES.includes(input.line2Anchor)) normalized.line2Anchor = input.line2Anchor;
	if (Number.isFinite(input.branchMaxLength)) normalized.branchMaxLength = clamp(Math.round(input.branchMaxLength as number), 10, 64);
	if (Number.isFinite(input.minGap)) normalized.minGap = clamp(Math.round(input.minGap as number), 1, 12);
	if (Number.isFinite(input.maxGap)) normalized.maxGap = clamp(Math.round(input.maxGap as number), normalized.minGap ?? 1, 40);
	if (input.items && typeof input.items === "object") {
		normalized.items = {};
		for (const [id, placement] of Object.entries(input.items)) {
			if (!id.trim() || !placement || typeof placement !== "object") continue;
			normalized.items[id] = normalizePlacement(placement as Partial<FooterItemPlacement>);
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

function compactBranchName(branch: string, maxLength: number): string {
	if (branch.length <= maxLength) return branch;
	const keep = Math.max(8, maxLength - 1);
	return `${branch.slice(0, keep)}…`;
}

function osc8(label: string, url: string): string {
	return `\u001b]8;;${url}\u0007${label}\u001b]8;;\u0007`;
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
		Object.assign(settings, { ...DEFAULT_SETTINGS, items: { ...DEFAULT_SETTINGS.items } });
		return "Footer framework reset to defaults.";
	}
	if (command === "section") {
		if (!key || !value) return "Usage: /footerfx section <cwd|stats|model|branch|pr|ext> <on|off>";
		const enabled = value === "on" || value === "enable" || value === "true";
		if (!["on", "off", "enable", "disable", "true", "false"].includes(value)) {
			return "Section value must be on/off.";
		}
		switch (key) {
			case "cwd":
				settings.showCwd = enabled;
				return `Section cwd ${enabled ? "enabled" : "disabled"}.`;
			case "stats":
				settings.showStats = enabled;
				return `Section stats ${enabled ? "enabled" : "disabled"}.`;
			case "model":
				settings.showModel = enabled;
				return `Section model ${enabled ? "enabled" : "disabled"}.`;
			case "branch":
				settings.showBranch = enabled;
				return `Section branch ${enabled ? "enabled" : "disabled"}.`;
			case "pr":
				settings.showPr = enabled;
				return `Section pr ${enabled ? "enabled" : "disabled"}.`;
			case "ext":
				settings.showExtensionStatuses = enabled;
				return `Section ext ${enabled ? "enabled" : "disabled"}.`;
			default:
				return "Unknown section. Use: cwd|stats|model|branch|pr|ext";
		}
	}
	if (command === "gap") {
		if (!key || !value) return "Usage: /footerfx gap <min> <max>";
		const min = Number(key);
		const max = Number(value);
		if (!Number.isFinite(min) || !Number.isFinite(max)) return "gap values must be numbers.";
		settings.minGap = clamp(Math.round(min), 1, 12);
		settings.maxGap = clamp(Math.round(max), settings.minGap, 40);
		return `Gap updated (min=${settings.minGap}, max=${settings.maxGap}).`;
	}
	if (command === "anchor") {
		if (!key || !value) return "Usage: /footerfx anchor <line1|line2|all> <gap|left|center|right|spread>";
		if (!ANCHOR_MODES.includes(value as FooterAnchorMode)) {
			return "Anchor must be one of: gap, left, center, right, spread.";
		}
		const mode = value as FooterAnchorMode;
		if (key === "line1") settings.line1Anchor = mode;
		else if (key === "line2") settings.line2Anchor = mode;
		else if (key === "all") {
			settings.line1Anchor = mode;
			settings.line2Anchor = mode;
		} else {
			return "Anchor target must be one of: line1, line2, all.";
		}
		return `Anchor ${key} set to ${mode}.`;
	}
	if (command === "branch-width") {
		if (!key) return "Usage: /footerfx branch-width <n>";
		const maxLength = Number(key);
		if (!Number.isFinite(maxLength)) return "branch-width must be a number.";
		settings.branchMaxLength = clamp(Math.round(maxLength), 10, 64);
		return `Branch width max set to ${settings.branchMaxLength}.`;
	}
	if (command === "mcp-zero") {
		if (!key || !["hide", "show"].includes(key)) return "Usage: /footerfx mcp-zero <hide|show>";
		settings.hideZeroMcp = key === "hide";
		return `MCP 0/x server line ${settings.hideZeroMcp ? "hidden" : "shown"}.`;
	}
	if (command === "item") {
		const [id, action, arg] = tokens.slice(1);
		if (!id || !action) {
			return "Usage: /footerfx item <id> <show|hide|line|zone|order|column|before|after|reset> [value]";
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
		if (action === "line") {
			const line = Number(arg);
			if (line !== 1 && line !== 2) return "Item line must be 1 or 2.";
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
			item.column = clamp(Math.round(column), 0, 500);
			return `Item ${id} column set to ${item.column}.`;
		}
		if (action === "before" || action === "after") {
			if (!arg) return `Usage: /footerfx item ${id} ${action} <other-item-id>`;
			delete item.before;
			delete item.after;
			item[action] = arg;
			return `Item ${id} positioned ${action} ${arg}.`;
		}
		return "Unknown item action. Use show|hide|line|zone|order|column|before|after|reset.";
	}

	return `Unknown command: ${command}`;
}

function settingsSummary(settings: FooterFrameworkSettings, loadedConfig?: string): string {
	const customizedItems = Object.keys(settings.items).sort();
	return [
		loadedConfig ? `loaded=${loadedConfig}` : undefined,
		`enabled=${settings.enabled}`,
		`sections: cwd=${settings.showCwd}, stats=${settings.showStats}, model=${settings.showModel}, branch=${settings.showBranch}, pr=${settings.showPr}, ext=${settings.showExtensionStatuses}`,
		`anchor: line1=${settings.line1Anchor}, line2=${settings.line2Anchor}`,
		`gap: min=${settings.minGap}, max=${settings.maxGap}`,
		`branchMaxLength=${settings.branchMaxLength}`,
		`hideZeroMcp=${settings.hideZeroMcp}`,
		customizedItems.length ? `customizedItems=${customizedItems.join(",")}` : undefined,
	]
		.filter(Boolean)
		.join("\n");
}

const extensionDir = path.dirname(fileURLToPath(import.meta.url));

export default function footerFramework(pi: ExtensionAPI): void {
	const settings: FooterFrameworkSettings = { ...DEFAULT_SETTINGS, items: { ...DEFAULT_SETTINGS.items } };
	let prState: PrState | undefined;
	let currentCtx: ExtensionContext | undefined;
	let requestRender: (() => void) | undefined;
	const externalItems = new Map<string, { text: string; placement: Partial<FooterItemPlacement> }>();
	let lastLoadedConfig = "defaults";
	let lastFooterSnapshot:
		| {
				width: number;
				line1: string;
				line2: string;
				line1Layout: {
					anchor: FooterAnchorMode;
					leftWidth: number;
					rightWidthOriginal: number;
					rightWidthFinal: number;
					padCount: number;
					rightStartCol: number;
					rightEndCol: number;
					truncated: boolean;
				};
				line2Layout: {
					anchor: FooterAnchorMode;
					leftWidth: number;
					rightWidthOriginal: number;
					rightWidthFinal: number;
					padCount: number;
					rightStartCol: number;
					rightEndCol: number;
					truncated: boolean;
				};
				gitBranch: string | null;
				renderedItems: Array<{ id: string; line: FooterLine; zone: FooterZone; order: number; column?: number; width: number }>;
				extensionStatuses: Array<{ key: string; value: string }>;
				model: string;
				cwd: string;
			}
		| undefined;

	function applyValidatedSettings(input: Partial<FooterFrameworkSettings>): void {
		Object.assign(settings, normalizeSettings(input));
		settings.minGap = clamp(settings.minGap, 1, 12);
		settings.maxGap = clamp(settings.maxGap, settings.minGap, 40);
		settings.branchMaxLength = clamp(settings.branchMaxLength, 10, 64);
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
		Object.assign(settings, { ...DEFAULT_SETTINGS, items: { ...DEFAULT_SETTINGS.items } });
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

	function renderCheck(theme: ExtensionContext["ui"]["theme"], checks: ChecksState): string {
		if (checks === "pass") return theme.fg("success", "✅");
		if (checks === "fail") return theme.fg("error", "❌");
		if (checks === "running") return theme.fg("warning", "⏳");
		return theme.fg("muted", "•");
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

	function renderBranch(theme: ExtensionContext["ui"]["theme"], gitBranch: string | null): string | undefined {
		if (!settings.showBranch || !gitBranch) return undefined;
		const compact = compactBranchName(gitBranch, settings.branchMaxLength);
		if (!settings.showPr || !prState?.pr || prState.branch !== gitBranch) {
			return theme.fg("muted", `(${compact})`);
		}
		const prLabel = osc8(theme.fg("accent", `#${prState.pr.number}`), prState.pr.url);
		return `${theme.fg("muted", `(${compact} `)}${prLabel}${theme.fg("muted", ")")}`;
	}

	function renderPrStatus(theme: ExtensionContext["ui"]["theme"]): string | undefined {
		if (!settings.showPr || !prState?.pr) return undefined;
		const tokens = [theme.fg("muted", "PR"), renderCheck(theme, prState.pr.checks)];
		if (prState.pr.comments > 0) tokens.push(theme.fg("muted", `💬${prState.pr.comments}`));
		return tokens.join(" ");
	}

	function placementFor(id: string, fallback: FooterItemPlacement, external?: Partial<FooterItemPlacement>): FooterItemPlacement {
		return {
			...fallback,
			...normalizePlacement(external ?? {}),
			...normalizePlacement(settings.items[id] ?? {}),
		};
	}

	function applyLegacySectionVisibility(items: FooterItem[]): void {
		const legacy: Record<string, boolean> = {
			cwd: settings.showCwd,
			stats: settings.showStats,
			model: settings.showModel,
			branch: settings.showBranch,
			pr: settings.showPr,
			ext: settings.showExtensionStatuses,
		};
		for (const item of items) {
			if (legacy[item.id] === false && settings.items[item.id]?.visible === undefined) item.placement.visible = false;
		}
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

	function collectItems(
		theme: ExtensionContext["ui"]["theme"],
		footerData: { getGitBranch(): string | null; getExtensionStatuses(): ReadonlyMap<string, string> },
		statsText: string,
	): FooterItem[] {
		const items: FooterItem[] = [];
		items.push({ id: "cwd", text: theme.fg("dim", currentCtx?.cwd ?? ""), placement: placementFor("cwd", DEFAULT_ITEM_PLACEMENTS.cwd) });
		items.push({ id: "model", text: theme.fg("dim", currentCtx?.model?.id ?? "no-model"), placement: placementFor("model", DEFAULT_ITEM_PLACEMENTS.model) });
		items.push({ id: "stats", text: statsText, placement: placementFor("stats", DEFAULT_ITEM_PLACEMENTS.stats) });

		const gitBranch = footerData.getGitBranch();
		if (gitBranch) {
			const compact = compactBranchName(gitBranch, settings.branchMaxLength);
			const branchText = settings.showPr && prState?.pr && prState.branch === gitBranch
				? `${theme.fg("muted", `(${compact} `)}${osc8(theme.fg("accent", `#${prState.pr.number}`), prState.pr.url)}${theme.fg("muted", ")")}`
				: theme.fg("muted", `(${compact})`);
			items.push({ id: "branch", text: branchText, placement: placementFor("branch", DEFAULT_ITEM_PLACEMENTS.branch) });
		}

		const prStatus = renderPrStatus(theme);
		if (prStatus) items.push({ id: "pr", text: prStatus, placement: placementFor("pr", DEFAULT_ITEM_PLACEMENTS.pr) });

		const extStatuses = Array.from(footerData.getExtensionStatuses().entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.filter(([key, value]) => {
				if (key === "footer-framework" || key === "pr-upstream") return false;
				if (settings.hideZeroMcp && /MCP:\s*0\/\d+\s+servers/.test(value)) return false;
				return true;
			})
			.map(([, value]) => value)
			.join(" · ");
		if (extStatuses) items.push({ id: "ext", text: extStatuses, placement: placementFor("ext", DEFAULT_ITEM_PLACEMENTS.ext) });

		for (const [id, external] of externalItems) {
			if (!external.text) continue;
			items.push({
				id,
				text: external.text,
				placement: placementFor(id, { visible: true, line: 2, zone: "right", order: 100 }, external.placement),
			});
		}

		applyLegacySectionVisibility(items);
		return resolveRelativeOrders(items).filter((item) => item.placement.visible && item.text.length > 0);
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

					const statsText = theme.fg("dim", `↑${formatTokens(input)} ↓${formatTokens(output)} $${cost.toFixed(3)}`);
					const items = collectItems(theme, footerData, statsText);
					const line1Result = renderFooterLine(theme, width, items, 1, settings.line1Anchor);
					const line2Result = renderFooterLine(theme, width, items, 2, settings.line2Anchor);

					lastFooterSnapshot = {
						width,
						line1: line1Result.line,
						line2: line2Result.line,
						line1Layout: line1Result.layout,
						line2Layout: line2Result.layout,
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
						cwd: ctx.cwd,
					};
					return [line1Result.line, line2Result.line];
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
		if (!item.id?.trim()) return;
		if (item.remove) externalItems.delete(item.id);
		else if (typeof item.text === "string") {
			externalItems.set(item.id, { text: item.text, placement: normalizePlacement(item.placement ?? {}) });
		}
		requestRender?.();
	});

	pi.registerCommand("footerfx", {
		description: "Footer framework controls (on/off, section, gap, branch-width, mcp-zero, reset)",
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
				lastFooterSnapshot,
			};
			ctx.ui.notify(JSON.stringify(payload, null, 2), "info");
		},
	});

	pi.registerTool(
		defineTool({
			name: "footer_framework_state",
			description: "Get footer framework settings and latest rendered footer snapshot for autonomous tuning",
			parameters: Type.Object({}),
			async execute() {
				const payload = {
					settings,
					loadedConfig: lastLoadedConfig,
					configPaths: currentCtx ? { user: userConfigPath(), project: projectConfigPath(currentCtx) } : { user: userConfigPath() },
					prState,
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
			name: "footer_framework_config",
			description: "Adjust footer framework settings without user command loop",
			parameters: Type.Object({
				command: Type.String({
					description:
						"Same syntax as /footerfx, e.g. 'section ext off', 'anchor all right', 'gap 1 10', 'save project', 'load', 'on', 'off', 'reset'",
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
