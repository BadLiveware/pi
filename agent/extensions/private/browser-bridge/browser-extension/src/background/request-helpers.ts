export function selectionOptions(payload: unknown): Record<string, unknown> {
	if (!isRecord(payload)) return { mode: "single" };
	return {
		mode: payload.mode === "multiple" ? "multiple" : "single",
		includeHtml: payload.includeHtml === true,
		includeText: payload.includeText !== false,
		maxHtmlChars: typeof payload.maxHtmlChars === "number" ? payload.maxHtmlChars : undefined,
		timeoutMs: typeof payload.timeoutMs === "number" ? payload.timeoutMs : undefined,
	};
}

export type BrowserKind = "chrome" | "edge" | "chromium" | "unknown";

export function isSupportedTabUrl(url: string | undefined): boolean {
	return typeof url === "string" && /^(https?:|file:)/.test(url);
}

export function detectBrowser(userAgent = navigator.userAgent): BrowserKind {
	const normalized = userAgent.toLowerCase();
	if (normalized.includes("edg/")) return "edge";
	if (normalized.includes("chrome/")) return "chrome";
	if (normalized.includes("chromium/")) return "chromium";
	return "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
