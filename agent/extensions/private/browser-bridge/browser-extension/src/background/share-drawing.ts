import { dataUrlToBlob } from "../shared/data-url.js";
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
	}, activated.frameId !== undefined ? { frameId: activated.frameId } : undefined);
	deps.recordDebug({ level: "info", event: "user-drawing-finished", data: { tabId: activated.tabId, status: responseStatus(response), strokeCount: responseStrokeCount(response), pointCount: responsePointCount(response) } });
	if (responseStatus(response) !== "drawn") {
		const message = responseReason(response) === "context-cancelled" ? "Drawing sharing cancelled." : "No drawing shared with Pi.";
		await deps.showShareFeedback(activated.tabId, activated.frameId, message, responseReason(response) !== "context-cancelled");
		return { response, shared: false, message };
	}
	const sharedAt = Date.now();
	const previewImage = await captureDrawingPreview(activated, response, deps);
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
			previewImage,
			artifact: response,
		},
	}));
	const message = "Drawing shared with Pi.";
	await deps.showShareFeedback(activated.tabId, activated.frameId, message);
	return { response, shared: true, message };
}

async function captureDrawingPreview(activated: ActivatedTab, response: unknown, deps: ShareDrawingDependencies): Promise<unknown> {
	try {
		const drawing = responseDrawing(response);
		const box = isRecord(drawing?.boundingBox) ? drawing.boundingBox : undefined;
		const viewportWidth = responseContextNumber(response, "viewportWidth");
		const viewportHeight = responseContextNumber(response, "viewportHeight");
		if (!box || viewportWidth === undefined || viewportHeight === undefined) return undefined;
		const dataUrl = await chrome.tabs.captureVisibleTab(activated.windowId, { format: "png" });
		return await cropPreviewDataUrl(dataUrl, box, viewportWidth, viewportHeight);
	} catch (error) {
		deps.recordDebug({ level: "warn", event: "drawing-preview-capture-failed", message: error instanceof Error ? error.message : String(error), data: { tabId: activated.tabId } });
		return undefined;
	}
}

async function cropPreviewDataUrl(dataUrl: string, box: Record<string, unknown>, viewportWidth: number, viewportHeight: number): Promise<unknown> {
	if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") return { dataUrl, mediaType: mediaTypeFromDataUrl(dataUrl), fullViewport: true, viewport: { width: viewportWidth, height: viewportHeight } };
	const blob = dataUrlToBlob(dataUrl);
	const image = await createImageBitmap(blob);
	const padding = 96;
	const scaleX = image.width / viewportWidth;
	const scaleY = image.height / viewportHeight;
	const source = paddedCrop(box, padding, viewportWidth, viewportHeight);
	const sx = Math.floor(source.x * scaleX);
	const sy = Math.floor(source.y * scaleY);
	const sw = Math.max(1, Math.ceil(source.width * scaleX));
	const sh = Math.max(1, Math.ceil(source.height * scaleY));
	const canvas = new OffscreenCanvas(sw, sh);
	const ctx = canvas.getContext("2d");
	if (!ctx) return { dataUrl, mediaType: mediaTypeFromDataUrl(dataUrl), fullViewport: true };
	ctx.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
	const cropped = await canvas.convertToBlob({ type: "image/png" });
	return {
		dataUrl: await blobToDataUrl(cropped),
		mediaType: "image/png",
		crop: { ...source, coordinateSpace: "viewport" },
		imageSize: { width: sw, height: sh },
		viewport: { width: viewportWidth, height: viewportHeight },
		scale: { x: scaleX, y: scaleY },
	};
}

function paddedCrop(box: Record<string, unknown>, padding: number, viewportWidth: number, viewportHeight: number): { x: number; y: number; width: number; height: number } {
	const x = Math.max(0, (numberValue(box.x) ?? 0) - padding);
	const y = Math.max(0, (numberValue(box.y) ?? 0) - padding);
	const right = Math.min(viewportWidth, (numberValue(box.x) ?? 0) + (numberValue(box.width) ?? 0) + padding);
	const bottom = Math.min(viewportHeight, (numberValue(box.y) ?? 0) + (numberValue(box.height) ?? 0) + padding);
	return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

async function blobToDataUrl(blob: Blob): Promise<string> {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	let binary = "";
	for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.slice(index, index + 0x8000));
	return `data:${blob.type || "image/png"};base64,${btoa(binary)}`;
}

function mediaTypeFromDataUrl(dataUrl: string): string | undefined {
	return /^data:([^;,]+)/.exec(dataUrl)?.[1];
}

function responseDrawing(response: unknown): Record<string, unknown> | undefined {
	return isRecord(response) && isRecord(response.drawing) ? response.drawing : undefined;
}

function responseContextNumber(response: unknown, key: string): number | undefined {
	if (!isRecord(response) || !isRecord(response.context)) return undefined;
	return numberValue(response.context[key]);
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function drawingContext(response: unknown, activated: ActivatedTab, sharedAt: number): Record<string, string | number | boolean | undefined> {
	const responseContext = isRecord(response) && isRecord(response.context) ? response.context : {};
	return {
		...pickScalarContext(responseContext),
		source: "drawing",
		url: activated.url,
		pageUrl: activated.url,
		frameUrl: responseContextValue(response, "frameUrl"),
		frameId: activated.frameId,
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
