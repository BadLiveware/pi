/// <reference path="../chrome.d.ts" />

import type { ExtensionDebugLogEntry } from "../shared/debug-log.js";
import { actionIconStatus, updateActionIcon } from "./icon.js";

type Debug = (entry: Omit<ExtensionDebugLogEntry, "at" | "source"> & { at?: number }) => void;

export interface ActionIconController {
	install(): void;
	markCurrentTab(tabId: number): void;
	refreshCurrentTab(windowId?: number): Promise<void>;
	update(): void;
}

export function createActionIconController(input: {
	isConnected: () => boolean;
	getLastError: () => string | undefined;
	isActivatedTab: (tabId: number) => boolean;
	clearActivatedTab: (tabId: number) => boolean;
	recordDebug: Debug;
}): ActionIconController {
	let currentTabId: number | undefined;
	let installed = false;
	let requestedIconKey: string | undefined;
	let lastIconResultKey: string | undefined;

	function update(): void {
		const connected = input.isConnected();
		const lastError = input.getLastError();
		const activeTab = connected && currentTabId !== undefined && input.isActivatedTab(currentTabId);
		const status = actionIconStatus(connected, lastError, activeTab);
		const requestKey = `${status}\u0000${lastError ?? ""}`;
		if (requestedIconKey === requestKey) return;
		requestedIconKey = requestKey;
		void updateActionIcon({ connected, lastError, activeTab })
			.then((result) => {
				const resultKey = `${result.status}:${result.ok}:${result.source}:${result.error ?? ""}`;
				if (lastIconResultKey === resultKey) return;
				lastIconResultKey = resultKey;
				if (!result.ok) {
					if (requestedIconKey === requestKey) requestedIconKey = undefined;
					input.recordDebug({ level: "warn", event: "action-icon-update-failed", message: result.error, data: { status: result.status, source: result.source, currentTabId, activeTab } });
					return;
				}
				input.recordDebug({ level: "debug", event: "action-icon-updated", data: { status: result.status, source: result.source, currentTabId, activeTab } });
			})
			.catch((error) => {
				if (requestedIconKey === requestKey) requestedIconKey = undefined;
				input.recordDebug({ level: "warn", event: "action-icon-update-failed", message: errorMessage(error), data: { status, currentTabId, activeTab } });
			});
	}

	async function refreshCurrentTab(windowId?: number): Promise<void> {
		try {
			const query = windowId === undefined ? { active: true, currentWindow: true } : { active: true, windowId };
			const [tab] = await chrome.tabs.query(query);
			currentTabId = tab?.id;
		} catch (error) {
			input.recordDebug({ level: "warn", event: "active-tab-icon-refresh-failed", message: errorMessage(error) });
		} finally {
			update();
		}
	}

	function markCurrentTab(tabId: number): void {
		currentTabId = tabId;
		update();
	}

	function install(): void {
		if (installed) return;
		installed = true;
		chrome.tabs.onActivated.addListener((activeInfo) => markCurrentTab(activeInfo.tabId));
		chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
			const wasActivated = changeInfo.url ? input.clearActivatedTab(tabId) : false;
			if (tab.active) currentTabId = tabId;
			if (tabId === currentTabId || wasActivated) update();
		});
		chrome.tabs.onRemoved.addListener((tabId) => {
			const wasActivated = input.clearActivatedTab(tabId);
			if (currentTabId === tabId) {
				currentTabId = undefined;
				void refreshCurrentTab();
			}
			if (wasActivated) update();
		});
		chrome.windows.onFocusChanged.addListener((windowId) => {
			if (windowId === chrome.windows.WINDOW_ID_NONE) {
				currentTabId = undefined;
				update();
				return;
			}
			void refreshCurrentTab(windowId);
		});
	}

	return { install, markCurrentTab, refreshCurrentTab, update };
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
