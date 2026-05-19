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

export function isSupportedTabUrl(url: string | undefined): boolean {
	return typeof url === "string" && /^(https?:|file:)/.test(url);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
