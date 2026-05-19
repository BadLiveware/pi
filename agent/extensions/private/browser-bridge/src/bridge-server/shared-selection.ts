import { makeBridgeId } from "../core/ids.ts";
import type { BrowserElementDescriptorSummary, BrowserSelectionContextSummary, BrowserSharedSelectionSummary } from "../core/state.ts";
import { isRecord } from "./auth-payloads.ts";

export function parseSharedSelection(clientId: string, payload: unknown, fallbackTime: number): BrowserSharedSelectionSummary {
	const record = isRecord(payload) ? payload : {};
	const selection = isRecord(record.selection) ? record.selection : {};
	const context = parseContext(record.context) ?? parseContext(selection.context);
	const elements = Array.isArray(selection.elements) ? selection.elements.map(parseElementDescriptor).filter((element): element is BrowserElementDescriptorSummary => Boolean(element)) : [];
	return {
		selectionId: makeBridgeId("selection"),
		clientId,
		tabId: typeof record.tabId === "number" && Number.isSafeInteger(record.tabId) ? record.tabId : undefined,
		source: stringValue(record.source) ?? stringValue(context?.source),
		title: stringValue(record.title) ?? stringValue(context?.title),
		url: stringValue(record.url) ?? stringValue(context?.url),
		pageUrl: stringValue(record.pageUrl) ?? stringValue(context?.pageUrl),
		frameUrl: stringValue(record.frameUrl) ?? stringValue(context?.frameUrl),
		origin: stringValue(record.origin) ?? stringValue(context?.origin),
		status: selection.status === "selected" || selection.status === "cancelled" ? selection.status : "unknown",
		reason: typeof selection.reason === "string" ? selection.reason : undefined,
		selectedAt: numberValue(record.selectedAt) ?? numberValue(context?.selectedAt) ?? fallbackTime,
		context,
		elements,
	};
}

function parseElementDescriptor(value: unknown): BrowserElementDescriptorSummary | undefined {
	if (!isRecord(value)) return undefined;
	return {
		elementId: typeof value.elementId === "string" ? value.elementId : undefined,
		selectorCandidates: Array.isArray(value.selectorCandidates) ? value.selectorCandidates.filter((selector): selector is string => typeof selector === "string") : undefined,
		tagName: typeof value.tagName === "string" ? value.tagName : undefined,
		role: typeof value.role === "string" ? value.role : undefined,
		accessibleName: typeof value.accessibleName === "string" ? value.accessibleName : undefined,
		textPreview: typeof value.textPreview === "string" ? value.textPreview : undefined,
		attributes: parseStringRecord(value.attributes),
		boundingBox: parseBoundingBox(value.boundingBox),
		htmlPreview: typeof value.htmlPreview === "string" ? value.htmlPreview : undefined,
	};
}

function parseBoundingBox(value: unknown): BrowserElementDescriptorSummary["boundingBox"] {
	if (!isRecord(value)) return undefined;
	const { x, y, width, height } = value;
	if (typeof x !== "number" || typeof y !== "number" || typeof width !== "number" || typeof height !== "number") return undefined;
	return { x, y, width, height, coordinateSpace: typeof value.coordinateSpace === "string" ? value.coordinateSpace : undefined };
}

function parseContext(value: unknown): BrowserSelectionContextSummary | undefined {
	if (!isRecord(value)) return undefined;
	const result: BrowserSelectionContextSummary = {};
	for (const [key, candidate] of Object.entries(value)) if (typeof candidate === "string" || typeof candidate === "number" || typeof candidate === "boolean") result[key] = candidate;
	return Object.keys(result).length > 0 ? result : undefined;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseStringRecord(value: unknown): Record<string, string> | undefined {
	if (!isRecord(value)) return undefined;
	const result: Record<string, string> = {};
	for (const [key, candidate] of Object.entries(value)) if (typeof candidate === "string") result[key] = candidate;
	return Object.keys(result).length > 0 ? result : undefined;
}
