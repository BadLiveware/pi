import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCodeIntelSpecTool } from "../../pi-tool-adapter.ts";
import { localMapToolSpec } from "./spec.ts";
import { appendExpandHint, asArray, asRecord, compactPath, renderBold, renderColor, renderLines, renderStatus, renderToolCall } from "../../core/tool-render.ts";

function renderLocalMapResult(details: Record<string, unknown>, expanded: boolean, theme: any) {
	const summary = asRecord(details.summary);
	const coverage = asRecord(details.coverage);
	const suggestedFiles = asArray(summary.suggestedFiles).map(asRecord);
	const sections = asRecord(details.sections);
	const treeCount = asArray(sections.treeSitterMaps).length;
	const syntaxCount = asArray(sections.syntaxMatches).length;
	const literalCount = asArray(sections.literalMatches).length;
	const truncated = coverage.truncated === true ? renderColor(theme, "warning", " truncated") : "";
	const lines = [`${renderStatus(theme, details.ok)} ${renderBold(theme, "local map")} names ${asArray(details.names).length} · files ${suggestedFiles.length} · tree/syn/rg ${treeCount}/${syntaxCount}/${literalCount}${truncated}`];
	if (expanded) {
		for (const file of suggestedFiles.slice(0, 10)) {
			const reasons = asArray(file.reasons).map((reason) => String(reason)).slice(0, 2).join(", ");
			lines.push(`${compactPath(file.file)}×${String(file.count ?? "?")}${reasons ? ` ${renderColor(theme, "dim", reasons)}` : ""}`);
		}
		if (suggestedFiles.length > 10) lines.push(renderColor(theme, "dim", `… ${suggestedFiles.length - 10} more suggested file(s)`));
	} else appendExpandHint(lines, expanded, theme);
	return renderLines(lines);
}

function renderLocalMapToolResult(result: unknown, options: { expanded?: boolean; isPartial?: boolean } | undefined, theme: any) {
	if (options?.isPartial) return renderLines([renderColor(theme, "accent", "code-intel working…")]);
	return renderLocalMapResult(asRecord(asRecord(result).details), options?.expanded === true, theme);
}

export function registerLocalMapTool(pi: ExtensionAPI): void {
	registerCodeIntelSpecTool(pi, localMapToolSpec, {
		renderCall: renderToolCall("code_intel_local_map", (args) => {
			const anchors = asArray(args.anchors).length;
			const names = asArray(args.names).length;
			const paths = asArray(args.paths).length;
			return [`${anchors} anchor(s)`, `${names} name(s)`, paths ? `${paths} path(s)` : undefined].filter(Boolean).join(" · ");
		}),
		renderResult: renderLocalMapToolResult,
	});
}
