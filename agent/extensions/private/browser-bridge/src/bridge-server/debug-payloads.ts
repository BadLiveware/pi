import { isRecord } from "./auth-payloads.ts";
import type { BrowserBridgeDebugLevel } from "../core/state.ts";

export function parseDebugLevel(value: unknown): BrowserBridgeDebugLevel {
	return value === "debug" || value === "info" || value === "warn" || value === "error" ? value : "info";
}

export function sanitizeDebugData(value: unknown, clientId: string): Record<string, string | number | boolean | undefined> {
	const result: Record<string, string | number | boolean | undefined> = { clientId };
	if (!isRecord(value)) return result;
	for (const [key, candidate] of Object.entries(value)) {
		if (typeof candidate === "string") result[key] = candidate.slice(0, 240);
		else if (typeof candidate === "number" || typeof candidate === "boolean" || candidate === undefined) result[key] = candidate;
	}
	return result;
}
