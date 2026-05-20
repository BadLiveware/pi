import type { ExtensionDebugLogEntry } from "../shared/debug-log.js";
import { makeEnvelope, type BridgeEnvelope } from "../shared/protocol.js";
import { isSupportedTabUrl } from "./request-helpers.js";

const SHARE_ELEMENT_MENU_ID = "pi-browser-bridge-share-element";

type ContextMenuInfo = chrome.contextMenus.OnClickData;

interface ContextMenuDependencies {
	isConnected: () => boolean;
	sendToBridgeWithAck: (envelope: BridgeEnvelope) => Promise<BridgeEnvelope>;
	showShareFeedback: (tabId: number, frameId: number | undefined, message: string, isError?: boolean) => Promise<void>;
	recordDebug: (entry: Omit<ExtensionDebugLogEntry, "at" | "source"> & { at?: number }) => void;
}

export function installElementContextMenu(deps: ContextMenuDependencies): void {
	recreateContextMenu(deps);
	chrome.contextMenus.onClicked.addListener((info, tab) => {
		if (info.menuItemId !== SHARE_ELEMENT_MENU_ID) return;
		void shareContextMenuElement(info, tab, deps).catch((error) => {
			const message = error instanceof Error ? error.message : String(error);
			deps.recordDebug({ level: "warn", event: "context-menu-share-failed", message, data: { tabId: tab?.id } });
			if (tab?.id) void deps.showShareFeedback(tab.id, typeof info.frameId === "number" ? info.frameId : undefined, message, true);
		});
	});
}

function recreateContextMenu(deps: ContextMenuDependencies): void {
	chrome.contextMenus.remove(SHARE_ELEMENT_MENU_ID, () => {
		void chrome.runtime.lastError;
		chrome.contextMenus.create({
			id: SHARE_ELEMENT_MENU_ID,
			title: "Share element with Pi",
			contexts: ["all"],
			documentUrlPatterns: ["http://*/*", "https://*/*", "file://*/*"],
		}, () => {
			const error = chrome.runtime.lastError;
			if (error) deps.recordDebug({ level: "warn", event: "context-menu-create-failed", message: error.message });
		});
	});
}

async function shareContextMenuElement(info: ContextMenuInfo, tab: chrome.tabs.Tab | undefined, deps: ContextMenuDependencies): Promise<void> {
	if (!deps.isConnected()) throw new Error("Connect to Pi before sharing a right-clicked element.");
	if (!tab?.id) throw new Error("No tab is available for the right-clicked element.");
	const url = tab.url ?? info.pageUrl ?? info.frameUrl;
	if (!isSupportedTabUrl(url)) throw new Error("This page cannot be shared with the Pi browser bridge.");
	const target = typeof info.frameId === "number" ? { tabId: tab.id, frameIds: [info.frameId] } : { tabId: tab.id };
	await chrome.scripting.executeScript({ target, files: ["dist/content.js"] });
	const frameId = typeof info.frameId === "number" ? info.frameId : undefined;
	const response = await chrome.tabs.sendMessage(tab.id, {
		type: "pi-bridge:describe-context-menu-target",
		options: { mode: "single", includeHtml: false, includeText: true, maxHtmlChars: 0, source: "context-menu", askForContext: true },
	}, frameId !== undefined ? { frameId } : undefined);
	const selectedAt = Date.now();
	deps.recordDebug({ level: "info", event: "context-menu-selection-finished", data: { tabId: tab.id, frameId, status: responseStatus(response), elementCount: responseElementCount(response) } });
	if (responseStatus(response) !== "selected") {
		const message = responseReason(response) === "context-cancelled" ? "Selection sharing cancelled." : "No selection shared with Pi.";
		await deps.showShareFeedback(tab.id, frameId, message, responseReason(response) !== "context-cancelled");
		return;
	}
	await deps.sendToBridgeWithAck(makeEnvelope({
		direction: "browser-to-pi",
		type: "elements:selected",
		payload: {
			source: "context-menu",
			userNote: responseUserNote(response),
			tabId: tab.id,
			title: tab.title,
			url: tab.url,
			pageUrl: info.pageUrl ?? tab.url,
			frameUrl: info.frameUrl,
			origin: originFromUrl(info.frameUrl ?? info.pageUrl ?? tab.url),
			selectedAt,
			context: contextMenuContext(info, tab, response, selectedAt),
			selection: response,
		},
	}));
	deps.recordDebug({ level: "info", event: "context-menu-selection-shared", data: { tabId: tab.id, frameId, elementCount: responseElementCount(response) } });
	await deps.showShareFeedback(tab.id, frameId, "Selection shared with Pi.");
}

function contextMenuContext(info: ContextMenuInfo, tab: chrome.tabs.Tab, response: unknown, selectedAt: number): Record<string, string | number | boolean | undefined> {
	const responseContext = isRecord(response) && isRecord(response.context) ? response.context : {};
	return {
		...pickScalarContext(responseContext),
		source: "context-menu",
		url: tab.url ?? info.pageUrl,
		pageUrl: info.pageUrl ?? tab.url,
		frameUrl: info.frameUrl,
		frameId: info.frameId,
		linkUrl: info.linkUrl,
		srcUrl: info.srcUrl,
		selectionText: info.selectionText,
		mediaType: info.mediaType,
		editable: info.editable,
		selectedAt,
	};
}

function pickScalarContext(value: Record<string, unknown>): Record<string, string | number | boolean | undefined> {
	const result: Record<string, string | number | boolean | undefined> = {};
	for (const [key, candidate] of Object.entries(value)) if (typeof candidate === "string" || typeof candidate === "number" || typeof candidate === "boolean") result[key] = candidate;
	return result;
}

function originFromUrl(value: string | undefined): string | undefined {
	if (!value) return undefined;
	try {
		return new URL(value).origin;
	} catch {
		return undefined;
	}
}

function responseStatus(response: unknown): string | undefined {
	return isRecord(response) && typeof response.status === "string" ? response.status : undefined;
}

function responseReason(response: unknown): string | undefined {
	return isRecord(response) && typeof response.reason === "string" ? response.reason : undefined;
}

function responseUserNote(response: unknown): string | undefined {
	return isRecord(response) && typeof response.userNote === "string" ? response.userNote : undefined;
}

function responseElementCount(response: unknown): number {
	return isRecord(response) && Array.isArray(response.elements) ? response.elements.length : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
