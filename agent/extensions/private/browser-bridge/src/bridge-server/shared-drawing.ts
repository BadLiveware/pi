import { makeBridgeId } from "../core/ids.ts";
import type { BrowserDrawingPointSummary, BrowserDrawingStrokeSummary, BrowserElementDescriptorSummary, BrowserSharedDrawingSummary } from "../core/state.ts";
import { isRecord } from "./auth-payloads.ts";
import { parseElementDescriptor, parseContext, stringValue, numberValue } from "./shared-selection.ts";

export function parseSharedDrawing(clientId: string, payload: unknown, fallbackTime: number): BrowserSharedDrawingSummary {
	const record = isRecord(payload) ? payload : {};
	const artifact = isRecord(record.artifact) ? record.artifact : {};
	const drawing = isRecord(artifact.drawing) ? artifact.drawing : {};
	const context = parseContext(record.context) ?? parseContext(artifact.context);
	return {
		drawingId: makeBridgeId("drawing"),
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

function countPoints(value: unknown): number {
	return parseStrokes(value).reduce((total, stroke) => total + stroke.points.length, 0);
}
