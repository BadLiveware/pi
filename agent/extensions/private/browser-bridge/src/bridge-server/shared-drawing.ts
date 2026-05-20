import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeBridgeId } from "../core/ids.ts";
import type { BrowserDrawingGestureSummary, BrowserDrawingPointSummary, BrowserDrawingPreviewSummary, BrowserDrawingStrokeSummary, BrowserElementDescriptorSummary, BrowserSharedDrawingSummary } from "../core/state.ts";
import { isRecord } from "./auth-payloads.ts";
import { parseElementDescriptor, parseContext, stringValue, numberValue } from "./shared-selection.ts";

export function parseSharedDrawing(clientId: string, payload: unknown, fallbackTime: number): BrowserSharedDrawingSummary {
	const record = isRecord(payload) ? payload : {};
	const artifact = isRecord(record.artifact) ? record.artifact : {};
	const drawing = isRecord(artifact.drawing) ? artifact.drawing : {};
	const context = parseContext(record.context) ?? parseContext(artifact.context);
	const drawingId = makeBridgeId("drawing");
	return {
		drawingId,
		clientId,
		tabId: typeof record.tabId === "number" && Number.isSafeInteger(record.tabId) ? record.tabId : undefined,
		source: stringValue(record.source) ?? stringValue(context?.source),
		title: stringValue(record.title) ?? stringValue(context?.title),
		url: stringValue(record.url) ?? stringValue(context?.url),
		pageUrl: stringValue(record.pageUrl) ?? stringValue(context?.pageUrl),
		frameUrl: stringValue(record.frameUrl) ?? stringValue(context?.frameUrl),
		origin: stringValue(record.origin) ?? stringValue(context?.origin),
		status: artifact.status === "drawn" || artifact.status === "cancelled" ? artifact.status : "unknown",
		reason: stringValue(artifact.reason),
		userNote: stringValue(record.userNote) ?? stringValue(artifact.userNote),
		sharedAt: numberValue(record.sharedAt) ?? numberValue(context?.sharedAt) ?? fallbackTime,
		context,
		boundingBox: parseBoundingBox(drawing.boundingBox),
		pointCount: numberValue(drawing.pointCount) ?? countPoints(drawing.strokes),
		strokes: parseStrokes(drawing.strokes),
		gesture: parseGesture(drawing.gesture),
		previewImage: parsePreviewImage(record.previewImage, drawingId),
		nearbyElements: Array.isArray(artifact.nearbyElements) ? artifact.nearbyElements.map(parseElementDescriptor).filter((element): element is BrowserElementDescriptorSummary => Boolean(element)) : [],
	};
}

function parseStrokes(value: unknown): BrowserDrawingStrokeSummary[] {
	if (!Array.isArray(value)) return [];
	return value.map(parseStroke).filter((stroke): stroke is BrowserDrawingStrokeSummary => Boolean(stroke));
}

function parseStroke(value: unknown): BrowserDrawingStrokeSummary | undefined {
	if (!isRecord(value)) return undefined;
	const points = Array.isArray(value.points) ? value.points.map(parsePoint).filter((point): point is BrowserDrawingPointSummary => Boolean(point)) : [];
	if (points.length === 0) return undefined;
	return { color: stringValue(value.color), width: numberValue(value.width), points };
}

function parsePoint(value: unknown): BrowserDrawingPointSummary | undefined {
	if (!isRecord(value)) return undefined;
	const x = numberValue(value.x);
	const y = numberValue(value.y);
	if (x === undefined || y === undefined) return undefined;
	return { x, y, t: numberValue(value.t), pressure: numberValue(value.pressure) };
}

function parseBoundingBox(value: unknown): BrowserSharedDrawingSummary["boundingBox"] {
	if (!isRecord(value)) return undefined;
	const x = numberValue(value.x);
	const y = numberValue(value.y);
	const width = numberValue(value.width);
	const height = numberValue(value.height);
	if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined;
	return { x, y, width, height, coordinateSpace: stringValue(value.coordinateSpace) };
}

function parseGesture(value: unknown): BrowserDrawingGestureSummary | undefined {
	if (!isRecord(value)) return undefined;
	return {
		type: stringValue(value.type),
		confidence: stringValue(value.confidence),
		start: parsePointPair(value.start),
		end: parsePointPair(value.end),
		fromElement: parseElementDescriptor(value.fromElement),
		toElement: parseElementDescriptor(value.toElement),
	};
}

function parsePointPair(value: unknown): { x: number; y: number } | undefined {
	if (!isRecord(value)) return undefined;
	const x = numberValue(value.x);
	const y = numberValue(value.y);
	return x === undefined || y === undefined ? undefined : { x, y };
}

function parsePreviewImage(value: unknown, drawingId: string): BrowserDrawingPreviewSummary | undefined {
	if (!isRecord(value)) return undefined;
	const mediaType = stringValue(value.mediaType) ?? mediaTypeFromDataUrl(stringValue(value.dataUrl));
	const path = writePreviewDataUrl(stringValue(value.dataUrl), mediaType, drawingId);
	return {
		path,
		mediaType,
		crop: parseBoundingBox(value.crop),
		imageSize: parseSize(value.imageSize),
		viewport: parseSize(value.viewport),
	};
}

function parseSize(value: unknown): { width: number; height: number } | undefined {
	if (!isRecord(value)) return undefined;
	const width = numberValue(value.width);
	const height = numberValue(value.height);
	return width === undefined || height === undefined ? undefined : { width, height };
}

function writePreviewDataUrl(dataUrl: string | undefined, mediaType: string | undefined, drawingId: string): string | undefined {
	const match = dataUrl ? /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl) : undefined;
	if (!match) return undefined;
	const type = mediaType ?? match[1];
	const extension = type === "image/jpeg" ? "jpg" : "png";
	const directory = join(tmpdir(), "pi-browser-bridge-drawings");
	mkdirSync(directory, { recursive: true });
	const filePath = join(directory, `${drawingId}.${extension}`);
	writeFileSync(filePath, Buffer.from(match[2]!, "base64"));
	return filePath;
}

function mediaTypeFromDataUrl(dataUrl: string | undefined): string | undefined {
	return dataUrl ? /^data:([^;,]+)/.exec(dataUrl)?.[1] : undefined;
}

function countPoints(value: unknown): number {
	return parseStrokes(value).reduce((total, stroke) => total + stroke.points.length, 0);
}
