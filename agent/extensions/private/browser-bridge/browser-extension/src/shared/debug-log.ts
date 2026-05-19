export type ExtensionDebugLevel = "debug" | "info" | "warn" | "error";

export interface ExtensionDebugLogEntry {
	at: number;
	source: "background" | "popup" | "content";
	level: ExtensionDebugLevel;
	event: string;
	message?: string;
	data?: Record<string, string | number | boolean | undefined>;
}

export function appendExtensionDebugLog(entries: ExtensionDebugLogEntry[], entry: Omit<ExtensionDebugLogEntry, "at"> & { at?: number }, limit = 100): ExtensionDebugLogEntry[] {
	return [
		...entries,
		{
			...entry,
			at: entry.at ?? Date.now(),
			data: entry.data ? { ...entry.data } : undefined,
		},
	].slice(-limit);
}

export function parseStoredDebugLog(value: unknown): ExtensionDebugLogEntry[] {
	if (!Array.isArray(value)) return [];
	return value.filter(isDebugLogEntry).slice(-100);
}

export function formatExtensionDebugLog(entries: ExtensionDebugLogEntry[], limit = 20): string {
	return entries.slice(-limit).map((entry) => {
		const data = entry.data && Object.keys(entry.data).length > 0 ? ` ${JSON.stringify(entry.data)}` : "";
		const message = entry.message ? ` ${entry.message}` : "";
		return `${new Date(entry.at).toISOString()} [${entry.level}] ${entry.source}:${entry.event}${message}${data}`;
	}).join("\n");
}

function isDebugLogEntry(value: unknown): value is ExtensionDebugLogEntry {
	if (!isRecord(value)) return false;
	if (typeof value.at !== "number" || !Number.isFinite(value.at)) return false;
	if (value.source !== "background" && value.source !== "popup" && value.source !== "content") return false;
	if (value.level !== "debug" && value.level !== "info" && value.level !== "warn" && value.level !== "error") return false;
	if (typeof value.event !== "string" || value.event.length === 0) return false;
	if (value.message !== undefined && typeof value.message !== "string") return false;
	if (value.data !== undefined && !isRecord(value.data)) return false;
	return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
