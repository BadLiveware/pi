import type { ExtensionDebugLogEntry } from "../shared/debug-log.js";
import { makeEnvelope, type BridgeEnvelope } from "../shared/protocol.js";
import type { ActivatedTab } from "./types.js";

interface ShareDrawingDependencies {
	activateCurrentTab: () => Promise<ActivatedTab>;
	sendToBridgeWithAck: (envelope: BridgeEnvelope) => Promise<BridgeEnvelope>;
	showShareFeedback: (tabId: number, frameId: number | undefined, message: string, isError?: boolean) => Promise<void>;
	recordDebug: (entry: Omit<ExtensionDebugLogEntry, "at" | "source"> & { at?: number }) => void;
}

export interface ShareDrawingResult {
	response: unknown;
	shared: boolean;
	message: string;
}

export async function shareDrawingFromCurrentTab(deps: ShareDrawingDependencies): Promise<ShareDrawingResult> {
	const activated = await deps.activateCurrentTab();
	deps.recordDebug({ level: "info", event: "user-drawing-started", data: { tabId: activated.tabId, origin: activated.origin } });
	const response = await chrome.tabs.sendMessage(activated.tabId, {
		type: "pi-bridge:draw",
		options: { source: "drawing", askForContext: true, color: "#e53935", width: 4, maxPoints: 1200 },
	});
	deps.recordDebug({ level: "info", event: "user-drawing-finished", data: { tabId: activated.tabId, status: responseStatus(response), strokeCount: responseStrokeCount(response), pointCount: responsePointCount(response) } });
	if (responseStatus(response) !== "drawn") {
		const message = responseReason(response) === "context-cancelled" ? "Drawing sharing cancelled." : "No drawing shared with Pi.";
		await deps.showShareFeedback(activated.tabId, undefined, message, responseReason(response) !== "context-cancelled");
		return { response, shared: false, message };
	}
	const sharedAt = Date.now();
	await deps.sendToBridgeWithAck(makeEnvelope({
		direction: "browser-to-pi",
		type: "drawing:shared",
		payload: {
			source: "drawing",
			userNote: responseUserNote(response),
			tabId: activated.tabId,
			title: activated.title,
			url: activated.url,
			pageUrl: activated.url,
			frameUrl: responseContextValue(response, "frameUrl"),
			origin: activated.origin,
			sharedAt,
			context: drawingContext(response, activated, sharedAt),
			artifact: response,
		},
	}));
	const message = "Drawing shared with Pi.";
	await deps.showShareFeedback(activated.tabId, undefined, message);
	return { response, shared: true, message };
}

function drawingContext(response: unknown, activated: ActivatedTab, sharedAt: number): Record<string, string | number | boolean | undefined> {
	const responseContext = isRecord(response) && isRecord(response.context) ? response.context : {};
	return {
		...pickScalarContext(responseContext),
		source: "drawing",
		url: activated.url,
		pageUrl: activated.url,
		frameUrl: responseContextValue(response, "frameUrl"),
		title: activated.title,
		origin: activated.origin,
		sharedAt,
	};
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

function responseContextValue(response: unknown, key: string): string | undefined {
	if (!isRecord(response) || !isRecord(response.context)) return undefined;
	const value = response.context[key];
	return typeof value === "string" ? value : undefined;
}

function responseStrokeCount(response: unknown): number {
	if (!isRecord(response) || !isRecord(response.drawing) || !Array.isArray(response.drawing.strokes)) return 0;
	return response.drawing.strokes.length;
}

function responsePointCount(response: unknown): number {
	if (!isRecord(response) || !isRecord(response.drawing) || typeof response.drawing.pointCount !== "number") return 0;
	return response.drawing.pointCount;
}

function pickScalarContext(value: Record<string, unknown>): Record<string, string | number | boolean | undefined> {
	const result: Record<string, string | number | boolean | undefined> = {};
	for (const [key, candidate] of Object.entries(value)) if (typeof candidate === "string" || typeof candidate === "number" || typeof candidate === "boolean") result[key] = candidate;
	return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
