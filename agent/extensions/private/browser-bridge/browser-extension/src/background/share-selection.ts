import type { ExtensionDebugLogEntry } from "../shared/debug-log.js";
import { makeEnvelope, type BridgeEnvelope } from "../shared/protocol.js";
import type { ActivatedTab } from "./types.js";

interface ShareSelectionDependencies {
	activateCurrentTab: () => Promise<ActivatedTab>;
	sendToBridge: (envelope: BridgeEnvelope) => void;
	recordDebug: (entry: Omit<ExtensionDebugLogEntry, "at" | "source"> & { at?: number }) => void;
}

export async function shareSelectionFromCurrentTab(deps: ShareSelectionDependencies): Promise<unknown> {
	const activated = await deps.activateCurrentTab();
	deps.recordDebug({ level: "info", event: "user-selection-started", data: { tabId: activated.tabId, origin: activated.origin } });
	const response = await chrome.tabs.sendMessage(activated.tabId, {
		type: "pi-bridge:select-elements",
		options: { mode: "single", includeHtml: false, includeText: true, maxHtmlChars: 0, source: "picker" },
	});
	deps.recordDebug({ level: "info", event: "user-selection-finished", data: { tabId: activated.tabId, status: responseStatus(response), elementCount: responseElementCount(response) } });
	const selectedAt = Date.now();
	deps.sendToBridge(makeEnvelope({
		direction: "browser-to-pi",
		type: "elements:selected",
		payload: {
			source: "picker",
			tabId: activated.tabId,
			title: activated.title,
			url: activated.url,
			pageUrl: activated.url,
			frameUrl: responseContextValue(response, "frameUrl"),
			origin: activated.origin,
			selectedAt,
			context: selectionContext(response, activated, selectedAt),
			selection: response,
		},
	}));
	return response;
}

function selectionContext(response: unknown, activated: ActivatedTab, selectedAt: number): Record<string, string | number | boolean | undefined> {
	const responseContext = isRecord(response) && isRecord(response.context) ? response.context : {};
	return {
		...pickScalarContext(responseContext),
		source: "picker",
		url: activated.url,
		pageUrl: activated.url,
		frameUrl: responseContextValue(response, "frameUrl"),
		title: activated.title,
		origin: activated.origin,
		selectedAt,
	};
}

function responseContextValue(response: unknown, key: string): string | undefined {
	if (!isRecord(response) || !isRecord(response.context)) return undefined;
	const value = response.context[key];
	return typeof value === "string" ? value : undefined;
}

function pickScalarContext(value: Record<string, unknown>): Record<string, string | number | boolean | undefined> {
	const result: Record<string, string | number | boolean | undefined> = {};
	for (const [key, candidate] of Object.entries(value)) if (typeof candidate === "string" || typeof candidate === "number" || typeof candidate === "boolean") result[key] = candidate;
	return result;
}

function responseStatus(response: unknown): string | undefined {
	return isRecord(response) && typeof response.status === "string" ? response.status : undefined;
}

function responseElementCount(response: unknown): number {
	return isRecord(response) && Array.isArray(response.elements) ? response.elements.length : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
