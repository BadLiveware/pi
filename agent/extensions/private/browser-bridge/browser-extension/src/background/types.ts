import type { ExtensionDebugLogEntry } from "../shared/debug-log.js";

export interface RuntimeState {
	connected: boolean;
	url?: string;
	clientId?: string;
	lastError?: string;
	activatedTabs: ActivatedTab[];
	debugLog: ExtensionDebugLogEntry[];
}

export interface ActivatedTab {
	tabId: number;
	windowId?: number;
	title?: string;
	url?: string;
	origin?: string;
	capabilities: string[];
	activatedAt: number;
}
