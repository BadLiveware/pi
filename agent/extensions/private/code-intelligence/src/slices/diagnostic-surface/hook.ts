import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { collectTouchedDiagnostics, loadStandaloneConfig, resolveRepoRootsFromCwd, type NormalizedPostEditDiagnostic } from "code-intel/pi-integration";
import { markDiagnosticsSurfacedForContext, recentTouchedFilesNeedingDiagnosticsForContext } from "../post-edit-map/touched-files.ts";

export const MESSAGE_TYPE_CODE_INTEL_DIAGNOSTICS = "code-intel:lsp-diagnostics";

function severityRank(row: NormalizedPostEditDiagnostic): number {
	if (row.severity === "error") return 0;
	if (row.severity === "warning") return 1;
	return 2;
}

function sortDiagnostics(rows: NormalizedPostEditDiagnostic[]): NormalizedPostEditDiagnostic[] {
	return [...rows].sort((left, right) => severityRank(left) - severityRank(right) || left.path.localeCompare(right.path) || left.line - right.line || (left.column ?? 0) - (right.column ?? 0));
}

function compactMessage(message: string | undefined, max = 140): string {
	if (!message) return "";
	const oneLine = message.replace(/\s+/g, " ").trim();
	return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

export function formatDiagnosticLine(row: NormalizedPostEditDiagnostic): string {
	const location = `${row.path}:${row.line}${row.column ? `:${row.column}` : ""}`;
	const severity = row.severity ?? "diagnostic";
	const code = row.code ? ` ${row.code}` : "";
	const message = compactMessage(row.message);
	return `- ${location} ${severity}${code}${message ? ` — ${message}` : ""}`;
}

export function buildDiagnosticSurfaceContent(rows: NormalizedPostEditDiagnostic[], changedFiles: string[]): string {
	const sorted = sortDiagnostics(rows);
	const shown = sorted.slice(0, 8);
	const omitted = sorted.length - shown.length;
	const header = `Code-intel found ${rows.length} current touched-file diagnostic${rows.length === 1 ? "" : "s"} in ${changedFiles.length} recently touched file${changedFiles.length === 1 ? "" : "s"}.`;
	return [
		header,
		"These are current touched-file diagnostics, not baseline-compared proof that the issues are new.",
		"Inspect or fix them before claiming the change is ready, or explicitly disclose the validation gap.",
		...shown.map(formatDiagnosticLine),
		omitted > 0 ? `- … ${omitted} more diagnostic${omitted === 1 ? "" : "s"}` : undefined,
	].filter((line): line is string => !!line).join("\n");
}

function hasPendingMessages(ctx: ExtensionContext): boolean {
	try {
		return typeof ctx.hasPendingMessages === "function" && ctx.hasPendingMessages();
	} catch {
		return false;
	}
}

export async function surfaceTouchedDiagnosticsIfNeeded(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	if (hasPendingMessages(ctx)) return;
	const roots = await resolveRepoRootsFromCwd(ctx.cwd, undefined);
	const changedFiles = recentTouchedFilesNeedingDiagnosticsForContext(ctx, roots.repoRoot, 50);
	if (changedFiles.length === 0) return;
	const loadedConfig = loadStandaloneConfig(ctx.cwd);
	const collected = await collectTouchedDiagnostics(roots.repoRoot, changedFiles, loadedConfig.config, undefined);
	markDiagnosticsSurfacedForContext(ctx);
	if (collected.diagnostics.length === 0) return;
	pi.sendMessage(
		{
			customType: MESSAGE_TYPE_CODE_INTEL_DIAGNOSTICS,
			content: buildDiagnosticSurfaceContent(collected.diagnostics, changedFiles),
			display: true,
			details: {
				repoRoot: roots.repoRoot,
				changedFiles,
				touchedDiagnostics: sortDiagnostics(collected.diagnostics),
				diagnosticProviders: collected.providerStatuses,
				diagnostics: collected.toolDiagnostics,
				limitations: collected.limitations,
				source: "agent_end",
			},
		},
		{ triggerTurn: true },
	);
}

export function registerDiagnosticSurfaceHooks(pi: ExtensionAPI): void {
	pi.on("agent_end", async (_event, ctx) => {
		try {
			await surfaceTouchedDiagnosticsIfNeeded(pi, ctx);
		} catch (error) {
			ctx.ui.notify(`code-intel diagnostic surfacing failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
		}
	});
}
