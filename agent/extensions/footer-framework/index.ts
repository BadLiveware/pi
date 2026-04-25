import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

type ChecksState = "pass" | "fail" | "running" | "unknown";

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
	branchMaxLength: number;
	minGap: number;
	maxGap: number;
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
	branchMaxLength: 22,
	minGap: 2,
	maxGap: 20,
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

function compactBranchName(branch: string, maxLength: number): string {
	if (branch.length <= maxLength) return branch;
	const keep = Math.max(8, maxLength - 1);
	return `${branch.slice(0, keep)}…`;
}

function osc8(label: string, url: string): string {
	return `\u001b]8;;${url}\u0007${label}\u001b]8;;\u0007`;
}

function parseSettingsInput(settings: FooterFrameworkSettings, args: string): string | undefined {
	const [command, key, value] = args
		.trim()
		.split(/\s+/)
		.filter(Boolean);

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
		Object.assign(settings, DEFAULT_SETTINGS);
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

	return `Unknown command: ${command}`;
}

function settingsSummary(settings: FooterFrameworkSettings): string {
	return [
		`enabled=${settings.enabled}`,
		`sections: cwd=${settings.showCwd}, stats=${settings.showStats}, model=${settings.showModel}, branch=${settings.showBranch}, pr=${settings.showPr}, ext=${settings.showExtensionStatuses}`,
		`gap: min=${settings.minGap}, max=${settings.maxGap}`,
		`branchMaxLength=${settings.branchMaxLength}`,
		`hideZeroMcp=${settings.hideZeroMcp}`,
	].join("\n");
}

export default function footerFramework(pi: ExtensionAPI): void {
	const settings: FooterFrameworkSettings = { ...DEFAULT_SETTINGS };
	let prState: PrState | undefined;
	let requestRender: (() => void) | undefined;

	function persistSettings(): void {
		pi.appendEntry("footer-framework-state", settings);
	}

	function renderCheck(theme: ExtensionContext["ui"]["theme"], checks: ChecksState): string {
		if (checks === "pass") return theme.fg("success", "✅");
		if (checks === "fail") return theme.fg("error", "❌");
		if (checks === "running") return theme.fg("warning", "⏳");
		return theme.fg("muted", "•");
	}

	function composeLine(theme: ExtensionContext["ui"]["theme"], width: number, left: string, right?: string): string {
		if (!right || visibleWidth(right) === 0) return truncateToWidth(left, width, theme.fg("dim", "..."));
		const leftWidth = visibleWidth(left);
		const rightWidth = visibleWidth(right);
		let padCount = width - leftWidth - rightWidth;
		if (padCount < settings.minGap) {
			const availableForRight = Math.max(0, width - leftWidth - settings.minGap);
			const compactRight = truncateToWidth(right, availableForRight, theme.fg("dim", "..."));
			return truncateToWidth(`${left}${" ".repeat(settings.minGap)}${compactRight}`, width, theme.fg("dim", "..."));
		}
		padCount = Math.min(padCount, settings.maxGap);
		const availableForRight = Math.max(0, width - leftWidth - padCount);
		const compactRight = truncateToWidth(right, availableForRight, theme.fg("dim", "..."));
		return truncateToWidth(`${left}${" ".repeat(padCount)}${compactRight}`, width, theme.fg("dim", "..."));
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

					const left1 = settings.showCwd ? theme.fg("dim", ctx.cwd) : "";
					const right1Parts: string[] = [];
					if (settings.showModel) right1Parts.push(theme.fg("dim", ctx.model?.id ?? "no-model"));
					const branchPart = renderBranch(theme, footerData.getGitBranch());
					if (branchPart) right1Parts.push(branchPart);
					const line1 = composeLine(theme, width, left1 || " ", right1Parts.join(" · "));

					const left2 = settings.showStats
						? theme.fg("dim", `↑${formatTokens(input)} ↓${formatTokens(output)} $${cost.toFixed(3)}`)
						: "";

					const right2Parts: string[] = [];
					const prStatus = renderPrStatus(theme);
					if (prStatus) right2Parts.push(prStatus);
					if (settings.showExtensionStatuses) {
						const extStatuses = Array.from(footerData.getExtensionStatuses().entries())
							.sort(([a], [b]) => a.localeCompare(b))
							.filter(([key, value]) => {
								if (key === "footer-framework" || key === "pr-upstream") return false;
								if (settings.hideZeroMcp && /MCP:\s*0\/\d+\s+servers/.test(value)) return false;
								return true;
							})
							.map(([, value]) => value)
							.join(" · ");
						if (extStatuses) right2Parts.push(extStatuses);
					}
					const line2 = composeLine(theme, width, left2 || " ", right2Parts.join(" · "));

					return [line1, line2];
				},
			};
		});
	}

	pi.events.on("pr-upstream:state", (event) => {
		prState = event as PrState;
		requestRender?.();
	});

	pi.registerCommand("footerfx", {
		description: "Footer framework controls (on/off, section, gap, branch-width, mcp-zero, reset)",
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			if (!trimmed) {
				ctx.ui.notify(settingsSummary(settings), "info");
				return;
			}
			const message = parseSettingsInput(settings, trimmed);
			if (message) ctx.ui.notify(message, "info");
			persistSettings();
			installFooter(ctx);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		const persisted = ctx.sessionManager
			.getEntries()
			.filter((entry) => entry.type === "custom" && entry.customType === "footer-framework-state")
			.pop() as { data?: Partial<FooterFrameworkSettings> } | undefined;
		if (persisted?.data) {
			Object.assign(settings, persisted.data);
			settings.minGap = clamp(settings.minGap, 1, 12);
			settings.maxGap = clamp(settings.maxGap, settings.minGap, 40);
			settings.branchMaxLength = clamp(settings.branchMaxLength, 10, 64);
		}

		installFooter(ctx);
		ctx.ui.setStatus("footer-framework", settings.enabled ? ctx.ui.theme.fg("muted", "footerfx:on") : undefined);
	});

	pi.on("session_shutdown", async () => {
		requestRender = undefined;
	});
}
