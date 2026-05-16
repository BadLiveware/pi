import { Text } from "@earendil-works/pi-tui";

export type StatusStyle = "dim" | "muted" | "accent" | "success" | "warning" | "error";

export function renderColor(theme: any, style: StatusStyle | "toolTitle", text: string): string {
	return typeof theme?.fg === "function" ? theme.fg(style, text) : text;
}

export function renderBold(theme: any, text: string): string {
	return typeof theme?.bold === "function" ? theme.bold(text) : text;
}

export function renderStatus(theme: any, ok: unknown): string {
	if (ok === true) return renderColor(theme, "success", "✓");
	if (ok === false) return renderColor(theme, "error", "×");
	return renderColor(theme, "warning", "?");
}

export function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function compactPath(value: unknown): string {
	const text = asString(value) ?? "(unknown)";
	if (text.length <= 96) return text;
	const parts = text.split("/");
	return parts.length > 3 ? `…/${parts.slice(-3).join("/")}` : `…${text.slice(-92)}`;
}

export function compactTopFiles(summary: Record<string, unknown>, limit = 3): string | undefined {
	const topFiles = asArray(summary.topFiles).map(asRecord).slice(0, limit);
	if (topFiles.length === 0) return undefined;
	return topFiles.map((file) => `${compactPath(file.file)}×${String(file.count ?? "?")}`).join(" · ");
}

export function firstLine(value: unknown, maxLength = 100): string | undefined {
	const text = asString(value)?.trim().split(/\r?\n/).find(Boolean);
	if (!text) return undefined;
	return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

export function renderLines(lines: string[]): Text {
	return new Text(lines.join("\n"), 0, 0);
}

export function renderToolCall(label: string, summarize: (args: Record<string, unknown>) => string | undefined) {
	return (args: unknown, theme: any) => {
		const summary = summarize(asRecord(args));
		return renderLines([`${renderColor(theme, "toolTitle", renderBold(theme, label))}${summary ? ` ${renderColor(theme, "muted", summary)}` : ""}`]);
	};
}

export function appendExpandHint(lines: string[], expanded: boolean, theme: any): void {
	if (!expanded) lines.push(renderColor(theme, "dim", "expand for details"));
}

export function backendAvailable(status: Record<string, unknown>): boolean {
	return status.available === "available";
}
