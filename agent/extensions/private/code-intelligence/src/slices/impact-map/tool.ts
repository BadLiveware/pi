import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { impactMapToolSpec } from "code-intel/pi-integration";
import { registerCodeIntelSpecTool } from "../../pi-tool-adapter.ts";
import { appendExpandHint, asArray, asNumber, asRecord, asString, compactPath, compactTopFiles, firstLine, renderBold, renderColor, renderLines, renderStatus, renderToolCall } from "../../core/tool-render.ts";

function renderImpactResult(details: Record<string, unknown>, expanded: boolean, theme: any) {
	const roots = asArray(details.rootSymbols);
	const related = asArray(details.related).map(asRecord);
	const coverage = asRecord(details.coverage);
	const summary = asRecord(details.summary);
	const relatedFileCount = asNumber(summary.relatedFileCount);
	const confirmation = asRecord(details.referenceConfirmation);
	const referenceCount = asArray(confirmation.references).length;
	const confirmedRefs = confirmation.backend ? ` · ${String(confirmation.backend)} refs ${referenceCount}` : "";
	const truncated = coverage.truncated === true ? renderColor(theme, "warning", " truncated") : "";
	const reason = firstLine(details.reason, 72);
	const reasonText = details.ok === false && reason ? ` · ${renderColor(theme, "warning", reason)}` : "";
	const lines = [`${renderStatus(theme, details.ok)} ${renderBold(theme, "impact map")} roots ${roots.length} · related ${related.length}${relatedFileCount !== undefined ? ` · ${relatedFileCount} file(s)` : ""}${confirmedRefs}${truncated}${reasonText}`];
	if (expanded) {
		if (roots.length > 0) lines.push(`${renderColor(theme, "muted", "roots")} ${roots.slice(0, 8).join(", ")}${roots.length > 8 ? ", …" : ""}`);
		const topFiles = compactTopFiles({ topFiles: summary.topRelatedFiles });
		if (topFiles) lines.push(`${renderColor(theme, "muted", "top files")} ${topFiles}`);
		const unsupportedImpactFiles = asArray(coverage.unsupportedImpactFiles).map(asRecord);
		const docFiles = asArray(coverage.docFiles).map((file) => String(file));
		const nonSourceFiles = asArray(coverage.nonSourceFiles).map((file) => String(file));
		if (unsupportedImpactFiles.length > 0) lines.push(`${renderColor(theme, "warning", "unsupported impact files")} ${unsupportedImpactFiles.slice(0, 5).map((file) => compactPath(file.file)).join(", ")}${unsupportedImpactFiles.length > 5 ? ", …" : ""}`);
		if (docFiles.length > 0) lines.push(`${renderColor(theme, "dim", "documentation changed files")} ${docFiles.slice(0, 5).map(compactPath).join(", ")}${docFiles.length > 5 ? ", …" : ""}`);
		if (nonSourceFiles.length > 0) lines.push(`${renderColor(theme, "dim", "non-source changed files")} ${nonSourceFiles.slice(0, 5).map(compactPath).join(", ")}${nonSourceFiles.length > 5 ? ", …" : ""}`);
		for (const row of related.slice(0, 10)) lines.push(`${compactPath(row.file)}${row.line ? `:${row.line}` : ""} ${asString(row.reason) ?? asString(row.name) ?? ""}`.trim());
		if (related.length > 10) lines.push(renderColor(theme, "dim", `… ${related.length - 10} more related row(s)`));
	} else appendExpandHint(lines, expanded, theme);
	return renderLines(lines);
}

function renderImpactToolResult(result: unknown, options: { expanded?: boolean; isPartial?: boolean } | undefined, theme: any) {
	if (options?.isPartial) return renderLines([renderColor(theme, "accent", "code-intel working…")]);
	return renderImpactResult(asRecord(asRecord(result).details), options?.expanded === true, theme);
}

export function registerImpactMapTool(pi: ExtensionAPI): void {
	registerCodeIntelSpecTool(pi, impactMapToolSpec, {
		renderCall: renderToolCall("code_intel_impact_map", (args) => {
			const parts = [];
			if (asArray(args.symbols).length > 0) parts.push(`${asArray(args.symbols).length} symbol(s)`);
			if (asArray(args.changedFiles).length > 0) parts.push(`${asArray(args.changedFiles).length} file(s)`);
			if (asString(args.baseRef)) parts.push(`base ${asString(args.baseRef)}`);
			return parts.join(" · ") || undefined;
		}),
		renderResult: renderImpactToolResult,
	});
}
