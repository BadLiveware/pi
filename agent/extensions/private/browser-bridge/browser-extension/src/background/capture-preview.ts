import { dataUrlToBlob } from "../shared/data-url.js";
import type { ExtensionDebugLogEntry } from "../shared/debug-log.js";

interface CapturePreviewDeps {
	recordDebug?: (entry: Omit<ExtensionDebugLogEntry, "at" | "source"> & { at?: number }) => void;
}

interface CapturePreviewOptions {
	mode: "affected" | "viewport";
	padding: number;
}

export async function capturePreviewSnapshot(tabId: number, response: unknown, captureAfter: unknown, deps: CapturePreviewDeps = {}): Promise<unknown> {
	const options = normalizeCaptureOptions(captureAfter);
	if (!options) return undefined;
	try {
		const { dataUrl } = await captureTabDataUrl(tabId);
		const viewport = responseViewport(response);
		if (options.mode === "viewport" || !viewport) return fullViewportSnapshot(dataUrl, viewport);
		const box = unionBoxes(collectAffectedBoxes(response));
		if (!box) return fullViewportSnapshot(dataUrl, viewport);
		return await cropSnapshotDataUrl(dataUrl, paddedCrop(box, options.padding, viewport.width, viewport.height), viewport);
	} catch (error) {
		deps.recordDebug?.({ level: "warn", event: "preview-snapshot-capture-failed", message: error instanceof Error ? error.message : String(error), data: { tabId } });
		return undefined;
	}
}

export async function captureTabSnapshot(tabId: number, deps: CapturePreviewDeps = {}): Promise<unknown> {
	try {
		const { dataUrl } = await captureTabDataUrl(tabId);
		return fullViewportSnapshot(dataUrl);
	} catch (error) {
		deps.recordDebug?.({ level: "warn", event: "viewport-capture-failed", message: error instanceof Error ? error.message : String(error), data: { tabId } });
		throw error;
	}
}

async function captureTabDataUrl(tabId: number): Promise<{ dataUrl: string }> {
	const tab = await chrome.tabs.get(tabId);
	if (!tab.active) await chrome.tabs.update(tabId, { active: true });
	return { dataUrl: await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }) };
}

function normalizeCaptureOptions(value: unknown): CapturePreviewOptions | undefined {
	if (value !== true && !isRecord(value)) return undefined;
	const mode = isRecord(value) && value.mode === "viewport" ? "viewport" : "affected";
	const padding = isRecord(value) && typeof value.padding === "number" && Number.isFinite(value.padding) ? Math.trunc(value.padding) : 96;
	return { mode, padding: Math.min(400, Math.max(0, padding)) };
}

async function cropSnapshotDataUrl(dataUrl: string, crop: Box, viewport: { width: number; height: number }): Promise<unknown> {
	if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") return fullViewportSnapshot(dataUrl, viewport);
	const blob = dataUrlToBlob(dataUrl);
	const image = await createImageBitmap(blob);
	const scaleX = image.width / viewport.width;
	const scaleY = image.height / viewport.height;
	const sx = Math.floor(crop.x * scaleX);
	const sy = Math.floor(crop.y * scaleY);
	const sw = Math.max(1, Math.ceil(crop.width * scaleX));
	const sh = Math.max(1, Math.ceil(crop.height * scaleY));
	const canvas = new OffscreenCanvas(sw, sh);
	const ctx = canvas.getContext("2d");
	if (!ctx) return fullViewportSnapshot(dataUrl, viewport);
	ctx.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
	const cropped = await canvas.convertToBlob({ type: "image/png" });
	return {
		dataUrl: await blobToDataUrl(cropped),
		mediaType: "image/png",
		crop: { ...crop, coordinateSpace: "viewport" },
		imageSize: { width: sw, height: sh },
		viewport,
		scale: { x: scaleX, y: scaleY },
	};
}

function fullViewportSnapshot(dataUrl: string, viewport?: { width: number; height: number }): unknown {
	return { dataUrl, mediaType: mediaTypeFromDataUrl(dataUrl), fullViewport: true, ...(viewport ? { viewport } : {}) };
}

function responseViewport(response: unknown): { width: number; height: number } | undefined {
	const context = isRecord(response) && isRecord(response.context) ? response.context : undefined;
	const width = numberValue(context?.viewportWidth);
	const height = numberValue(context?.viewportHeight);
	return width === undefined || height === undefined ? undefined : { width, height };
}

type Box = { x: number; y: number; width: number; height: number };

function collectAffectedBoxes(response: unknown): Box[] {
	const results = isRecord(response) && Array.isArray(response.results) ? response.results : [];
	const boxes: Box[] = [];
	for (const result of results) {
		if (!isRecord(result) || !Array.isArray(result.computedAfter)) continue;
		for (const item of result.computedAfter) {
			const descriptor = isRecord(item) && isRecord(item.descriptor) ? item.descriptor : undefined;
			const box = parseBox(descriptor?.boundingBox);
			if (box) boxes.push(box);
		}
	}
	return boxes;
}

function parseBox(value: unknown): Box | undefined {
	if (!isRecord(value)) return undefined;
	const x = numberValue(value.x);
	const y = numberValue(value.y);
	const width = numberValue(value.width);
	const height = numberValue(value.height);
	return x === undefined || y === undefined || width === undefined || height === undefined ? undefined : { x, y, width, height };
}

function unionBoxes(boxes: Box[]): Box | undefined {
	if (boxes.length === 0) return undefined;
	const left = Math.min(...boxes.map((box) => box.x));
	const top = Math.min(...boxes.map((box) => box.y));
	const right = Math.max(...boxes.map((box) => box.x + box.width));
	const bottom = Math.max(...boxes.map((box) => box.y + box.height));
	return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

function paddedCrop(box: Box, padding: number, viewportWidth: number, viewportHeight: number): Box {
	const x = Math.max(0, box.x - padding);
	const y = Math.max(0, box.y - padding);
	const right = Math.min(viewportWidth, box.x + box.width + padding);
	const bottom = Math.min(viewportHeight, box.y + box.height + padding);
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

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
