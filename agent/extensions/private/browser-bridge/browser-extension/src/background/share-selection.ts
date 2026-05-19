import { makeEnvelope, type BridgeEnvelope } from "../shared/protocol.js";
import type { ExtensionDebugLogEntry } from "../shared/debug-log.js";

interface ActivatedTab {
	tabId: number;
	title?: string;
	origin?: string;
	capabilities: string[];
	activatedAt: number;
}

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
		options: { mode: "single", includeHtml: false, includeText: true, maxHtmlChars: 0 },
	});
	deps.recordDebug({ level: "info", event: "user-selection-finished", data: { tabId: activated.tabId, status: responseStatus(response), elementCount: responseElementCount(response) } });
	deps.sendToBridge(makeEnvelope({
		direction: "browser-to-pi",
		type: "elements:selected",
		payload: {
			tabId: activated.tabId,
			title: activated.title,
			origin: activated.origin,
			selectedAt: Date.now(),
			selection: response,
		},
	}));
	return response;
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
