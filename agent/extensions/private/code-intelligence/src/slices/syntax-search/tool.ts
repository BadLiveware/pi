import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { syntaxSearchToolSpec } from "code-intel/pi-integration";
import { registerCodeIntelSpecTool } from "../../pi-tool-adapter.ts";
import { appendExpandHint, asArray, asNumber, asRecord, asString, compactPath, compactTopFiles, firstLine, renderBold, renderColor, renderLines, renderStatus, renderToolCall } from "../../core/tool-render.ts";

function renderSyntaxResult(details: Record<string, unknown>, expanded: boolean, theme: any) {
	const matches = asArray(details.matches).map(asRecord);
	const summary = asRecord(details.summary);
	const returned = asNumber(details.returned) ?? matches.length;
	const matchCount = asNumber(details.matchCount) ?? returned;
	const fileCount = asNumber(summary.fileCount);
	const truncated = details.truncated === true ? renderColor(theme, "warning", " truncated") : "";
	const lines = [`${renderStatus(theme, details.ok)} ${renderBold(theme, "syntax search")} ${returned}/${matchCount}${fileCount !== undefined ? ` · ${fileCount} file(s)` : ""}${truncated} ${renderColor(theme, "muted", asString(details.language) ?? "")}`.trim()];
	if (expanded) {
		const topFiles = compactTopFiles(summary);
		if (topFiles) lines.push(`${renderColor(theme, "muted", "top files")} ${topFiles}`);
		for (const match of matches.slice(0, 10)) lines.push(`${compactPath(match.file)}${match.line ? `:${match.line}` : ""} ${firstLine(match.snippet ?? match.text, 90) ?? ""}`.trim());
		if (matches.length > 10) lines.push(renderColor(theme, "dim", `… ${matches.length - 10} more match(es)`));
	} else appendExpandHint(lines, expanded, theme);
	return renderLines(lines);
}

function renderSyntaxToolResult(result: unknown, options: { expanded?: boolean; isPartial?: boolean } | undefined, theme: any) {
	if (options?.isPartial) return renderLines([renderColor(theme, "accent", "code-intel working…")]);
	return renderSyntaxResult(asRecord(asRecord(result).details), options?.expanded === true, theme);
}

export function registerSyntaxSearchTool(pi: ExtensionAPI): void {
	registerCodeIntelSpecTool(pi, syntaxSearchToolSpec, {
		renderCall: renderToolCall("code_intel_syntax_search", (args) => `${asString(args.language) ?? ""} ${asString(args.pattern) ? "pattern" : ""}`.trim()),
		renderResult: renderSyntaxToolResult,
	});
}
