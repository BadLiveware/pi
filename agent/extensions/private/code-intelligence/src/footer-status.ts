import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { BackendName, BackendStatus, LanguageServerName, LanguageServerStatus } from "./types.ts";

type StatusStyle = "dim" | "muted" | "accent" | "success" | "warning" | "error";

type ProviderRank = {
	server: LanguageServerName;
	label: string;
	extensions: string[];
	fallbackRank: number;
};

const PROVIDERS: ProviderRank[] = [
	{ server: "typescript", label: "ts", extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"], fallbackRank: 0 },
	{ server: "clangd", label: "clangd", extensions: [".cpp", ".cc", ".cxx", ".c", ".h", ".hpp", ".hh", ".hxx"], fallbackRank: 1 },
	{ server: "gopls", label: "go", extensions: [".go"], fallbackRank: 2 },
	{ server: "rust-analyzer", label: "ra", extensions: [".rs"], fallbackRank: 3 },
];

const SKIP_DIRS = new Set([".git", "node_modules", "vendor", "contrib", "build", "build_debug", "build_release", "dist", "target", ".cache", "__pycache__"]);

function statusColor(ctx: ExtensionContext, style: StatusStyle, text: string): string {
	const ui = ctx.ui as unknown as { theme?: { fg?: (style: string, text: string) => string } };
	return ui.theme?.fg ? ui.theme.fg(style, text) : text;
}

function statusText(backend: BackendName, status: BackendStatus): { text: string; style: StatusStyle } {
	if (status.available === "available") return { text: "ok", style: "success" };
	if (status.available === "missing") return { text: backend === "rg" ? "missing" : "err", style: backend === "rg" ? "warning" : "error" };
	return { text: "err", style: "error" };
}

function languageEvidence(repoRoot: string, maxFiles = 2_000): Map<string, number> {
	const counts = new Map<string, number>();
	let seen = 0;
	const visit = (dir: string): void => {
		if (seen >= maxFiles) return;
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
		} catch {
			return;
		}
		for (const entry of entries) {
			if (seen >= maxFiles) return;
			const absolute = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				if (!SKIP_DIRS.has(entry.name)) visit(absolute);
			} else if (entry.isFile()) {
				seen++;
				const ext = path.extname(entry.name).toLowerCase();
				counts.set(ext, (counts.get(ext) ?? 0) + 1);
			}
		}
	};
	visit(repoRoot);
	return counts;
}

function rankAvailableLanguageServers(languageServers: Record<LanguageServerName, LanguageServerStatus>, repoRoot?: string): ProviderRank[] {
	const counts = repoRoot ? languageEvidence(repoRoot) : new Map<string, number>();
	return PROVIDERS
		.filter((provider) => languageServers[provider.server]?.available === "available")
		.map((provider) => ({ ...provider, score: provider.extensions.reduce((sum, ext) => sum + (counts.get(ext) ?? 0), 0) }))
		.sort((left, right) => right.score - left.score || left.fallbackRank - right.fallbackRank);
}

export function codeIntelStatusSummary(ctx: ExtensionContext, statuses: Record<BackendName, BackendStatus>, languageServers?: Record<LanguageServerName, LanguageServerStatus>, repoRoot?: string): string {
	const separator = statusColor(ctx, "dim", " · ");
	const colon = statusColor(ctx, "dim", ":");
	const backendText = (["tree-sitter", "rg"] as BackendName[]).map((backend) => {
		const state = statusText(backend, statuses[backend]);
		const label = backend === "tree-sitter" ? "syn" : "rg";
		return `${statusColor(ctx, "muted", label)}${colon}${statusColor(ctx, state.style, state.text)}`;
	});
	let lspText = statusColor(ctx, "dim", "?");
	let lspStyle: StatusStyle = "dim";
	if (languageServers) {
		const ranked = rankAvailableLanguageServers(languageServers, repoRoot);
		lspText = ranked.length > 0 ? `${ranked.slice(0, 2).map((provider) => provider.label).join(",")}${ranked.length > 2 ? `+${ranked.length - 2}` : ""}` : "none";
		lspStyle = ranked.length > 0 ? "accent" : "warning";
	}
	return `${statusColor(ctx, "muted", "ci")} ${[...backendText, `${statusColor(ctx, "muted", "lsp")}${colon}${statusColor(ctx, lspStyle, lspText)}`].join(separator)}`;
}

export function setCodeIntelStatusSummary(ctx: ExtensionContext, statuses: Record<BackendName, BackendStatus>, languageServers?: Record<LanguageServerName, LanguageServerStatus>, repoRoot?: string): void {
	const ui = ctx.ui as unknown as { setStatus?: (key: string, value: string | undefined) => void };
	ui.setStatus?.("code-intel", codeIntelStatusSummary(ctx, statuses, languageServers, repoRoot));
}
