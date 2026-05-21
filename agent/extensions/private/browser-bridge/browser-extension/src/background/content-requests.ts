import { capturePreviewSnapshot, captureTabSnapshot } from "./capture-preview.js";
import type { ExtensionDebugLogEntry } from "../shared/debug-log.js";
import { makeEnvelope, type BridgeEnvelope } from "../shared/protocol.js";

export interface ContentRequestHandlers {
	handleOverlayRequest(envelope: BridgeEnvelope): Promise<void>;
	handleDesignPreviewRequest(envelope: BridgeEnvelope): Promise<void>;
	handleStyleInspectionRequest(envelope: BridgeEnvelope): Promise<void>;
	handleCaptureViewRequest(envelope: BridgeEnvelope): Promise<void>;
	handleInteractRequest(envelope: BridgeEnvelope): Promise<void>;
	handleClipboardRequest(envelope: BridgeEnvelope): Promise<void>;
}

interface ContentRequestDeps {
	resolveTargetTabId: (envelope: BridgeEnvelope) => number | undefined;
	resolveTargetFrameId: (envelope: BridgeEnvelope) => number | undefined;
	sendToBridge: (envelope: BridgeEnvelope) => void;
	recordDebug?: (entry: Omit<ExtensionDebugLogEntry, "at" | "source"> & { at?: number }) => void;
}

export function createContentRequestHandlers(deps: ContentRequestDeps): ContentRequestHandlers {
	return {
		handleOverlayRequest: (envelope) => handleContentRequest(deps, envelope, {
			capability: "overlay",
			missingTabMessage: "No activated browser tab is available for overlay commands.",
			contentMessage: (payload) => ({ type: "pi-bridge:overlay", commands: isRecord(payload) && Array.isArray(payload.commands) ? payload.commands : [] }),
			resultType: "overlay:result",
			errorCode: "overlay_failed",
		}),
		handleDesignPreviewRequest: (envelope) => handleDesignPreviewRequest(deps, envelope),
		handleStyleInspectionRequest: (envelope) => handleContentRequest(deps, envelope, {
			capability: "style inspection",
			missingTabMessage: "No activated browser tab is available for style inspection.",
			contentMessage: (payload) => ({ type: "pi-bridge:style-inspection", request: isRecord(payload) ? payload : {} }),
			resultType: "style-inspection:result",
			errorCode: "style_inspection_failed",
		}),
		handleCaptureViewRequest: (envelope) => handleCaptureViewRequest(deps, envelope),
		handleInteractRequest: (envelope) => handleContentRequest(deps, envelope, {
			capability: "interaction",
			missingTabMessage: "No activated browser tab is available for interaction.",
			contentMessage: (payload) => ({ type: "pi-bridge:interact", request: isRecord(payload) ? payload : {} }),
			resultType: "interact:result",
			errorCode: "interact_failed",
		}),
		handleClipboardRequest: (envelope) => handleContentRequest(deps, envelope, {
			capability: "clipboard access",
			missingTabMessage: "No activated browser tab is available for clipboard access.",
			contentMessage: (payload) => ({ type: "pi-bridge:clipboard", request: isRecord(payload) ? payload : {} }),
			resultType: "clipboard:result",
			errorCode: "clipboard_failed",
		}),
	};
}

async function handleDesignPreviewRequest(deps: ContentRequestDeps, envelope: BridgeEnvelope): Promise<void> {
	try {
		const tabId = deps.resolveTargetTabId(envelope);
		if (!tabId) throw new Error("No activated browser tab is available for design preview commands.");
		const frameId = deps.resolveTargetFrameId(envelope);
		await chrome.scripting.executeScript({ target: scriptTarget(tabId, frameId), files: ["dist/content.js"] });
		const request = isRecord(envelope.payload) ? envelope.payload : { commands: [] };
		const response = await chrome.tabs.sendMessage(tabId, { type: "pi-bridge:design-preview", request }, messageOptions(frameId));
		const snapshot = await capturePreviewSnapshot(tabId, response, request.captureAfter, { recordDebug: deps.recordDebug });
		deps.sendToBridge(makeEnvelope({ direction: "browser-to-pi", requestId: envelope.id, type: "design-preview:result", payload: snapshot === undefined ? response : { ...(isRecord(response) ? response : { ok: false }), snapshot } }));
	} catch (error) {
		deps.sendToBridge(makeEnvelope({
			direction: "browser-to-pi",
			requestId: envelope.id,
			type: "error",
			payload: { code: "design_preview_failed", message: error instanceof Error ? error.message : String(error) || "design preview failed" },
		}));
	}
}

async function handleCaptureViewRequest(deps: ContentRequestDeps, envelope: BridgeEnvelope): Promise<void> {
	try {
		const tabId = deps.resolveTargetTabId(envelope);
		if (!tabId) throw new Error("No activated browser tab is available for viewport capture.");
		const snapshot = await captureTabSnapshot(tabId, { recordDebug: deps.recordDebug });
		deps.sendToBridge(makeEnvelope({ direction: "browser-to-pi", requestId: envelope.id, type: "capture-view:result", payload: { ok: true, snapshot } }));
	} catch (error) {
		deps.sendToBridge(makeEnvelope({
			direction: "browser-to-pi",
			requestId: envelope.id,
			type: "error",
			payload: { code: "capture_view_failed", message: error instanceof Error ? error.message : String(error) || "viewport capture failed" },
		}));
	}
}

async function handleContentRequest(deps: ContentRequestDeps, envelope: BridgeEnvelope, options: {
	capability: string;
	missingTabMessage: string;
	contentMessage: (payload: unknown) => Record<string, unknown>;
	resultType: string;
	errorCode: string;
}): Promise<void> {
	try {
		const tabId = deps.resolveTargetTabId(envelope);
		if (!tabId) throw new Error(options.missingTabMessage);
		const frameId = deps.resolveTargetFrameId(envelope);
		await chrome.scripting.executeScript({ target: scriptTarget(tabId, frameId), files: ["dist/content.js"] });
		const response = await chrome.tabs.sendMessage(tabId, options.contentMessage(envelope.payload), messageOptions(frameId));
		deps.sendToBridge(makeEnvelope({ direction: "browser-to-pi", requestId: envelope.id, type: options.resultType, payload: response }));
	} catch (error) {
		deps.sendToBridge(makeEnvelope({
			direction: "browser-to-pi",
			requestId: envelope.id,
			type: "error",
			payload: { code: options.errorCode, message: error instanceof Error ? error.message : String(error) || `${options.capability} failed` },
		}));
	}
}

function scriptTarget(tabId: number, frameId: number | undefined): { tabId: number; frameIds?: number[] } {
	return frameId === undefined ? { tabId } : { tabId, frameIds: [frameId] };
}

function messageOptions(frameId: number | undefined): { frameId?: number } | undefined {
	return frameId === undefined ? undefined : { frameId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
