import type { WebSocket } from "ws";
import type { BrowserClientSummary } from "../core/state.ts";

export interface BrowserClientAuthDetails {
	clientId?: string;
	browser?: BrowserClientSummary["browser"];
	extensionVersion?: string;
	capabilities?: string[];
	activeTabId?: number;
}

export interface PairPayload {
	token: string;
	client?: BrowserClientAuthDetails;
}

export interface ResumePayload {
	clientId: string;
	resumeSecret: string;
	client?: BrowserClientAuthDetails;
}

export function rawDataToText(data: WebSocket.RawData): string {
	if (typeof data === "string") return data;
	if (Buffer.isBuffer(data)) return data.toString("utf8");
	if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
	return Buffer.from(data).toString("utf8");
}

export function parsePairPayload(payload: unknown): PairPayload | undefined {
	if (!isRecord(payload) || typeof payload.token !== "string") return undefined;
	return { token: payload.token, client: parseClientAuthDetails(payload.client) };
}

export function parseResumePayload(payload: unknown): ResumePayload | undefined {
	if (!isRecord(payload) || typeof payload.clientId !== "string" || typeof payload.resumeSecret !== "string") return undefined;
	return { clientId: payload.clientId, resumeSecret: payload.resumeSecret, client: parseClientAuthDetails(payload.client) };
}

export function parseClientAuthDetails(value: unknown): BrowserClientAuthDetails | undefined {
	const client = isRecord(value) ? value : undefined;
	if (!client) return undefined;
	const browser = parseBrowser(client.browser);
	const capabilities = Array.isArray(client.capabilities) ? client.capabilities.filter((capability): capability is string => typeof capability === "string") : undefined;
	const activeTabId = typeof client.activeTabId === "number" && Number.isSafeInteger(client.activeTabId) && client.activeTabId >= 0 ? client.activeTabId : undefined;
	return {
		clientId: typeof client.clientId === "string" ? client.clientId : undefined,
		browser,
		extensionVersion: typeof client.extensionVersion === "string" ? client.extensionVersion : undefined,
		capabilities,
		activeTabId,
	};
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBrowser(value: unknown): BrowserClientSummary["browser"] | undefined {
	return value === "chrome" || value === "edge" || value === "chromium" || value === "unknown" ? value : undefined;
}
