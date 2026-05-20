import type { ExtensionDebugLogEntry } from "../shared/debug-log.js";

interface ShareFeedbackDependencies {
	recordDebug: (entry: Omit<ExtensionDebugLogEntry, "at" | "source"> & { at?: number }) => void;
}

export type ShowShareFeedback = (tabId: number, frameId: number | undefined, message: string, isError?: boolean) => Promise<void>;

export function createShareFeedback({ recordDebug }: ShareFeedbackDependencies): ShowShareFeedback {
	return async (tabId, frameId, message, isError = false) => {
		try {
			await chrome.tabs.sendMessage(tabId, { type: "pi-bridge:share-feedback", message, isError }, typeof frameId === "number" ? { frameId } : undefined);
		} catch (error) {
			recordDebug({ level: "debug", event: "share-feedback-unavailable", message: error instanceof Error ? error.message : String(error), data: { tabId, frameId } });
		}
	};
}
