import { makeBridgeId } from "../core/ids.ts";
import type { BrowserElementDescriptorSummary, BrowserSharedSelectionSummary } from "../core/state.ts";
import { isRecord } from "./auth-payloads.ts";

export function parseSharedSelection(clientId: string, payload: unknown, fallbackTime: number): BrowserSharedSelectionSummary {
	const record = isRecord(payload) ? payload : {};
	const selection = isRecord(record.selection) ? record.selection : {};
	const elements = Array.isArray(selection.elements) ? selection.elements.map(parseElementDescriptor).filter((element): element is BrowserElementDescriptorSummary => Boolean(element)) : [];
	return {
		selectionId: makeBridgeId("selection"),
		clientId,
		tabId: typeof record.tabId === "number" && Number.isSafeInteger(record.tabId) ? record.tabId : undefined,
		title: typeof record.title === "string" ? record.title : undefined,
		origin: typeof record.origin === "string" ? record.origin : undefined,
		status: selection.status === "selected" || selection.status === "cancelled" ? selection.status : "unknown",
		reason: typeof selection.reason === "string" ? selection.reason : undefined,
		selectedAt: typeof record.selectedAt === "number" && Number.isFinite(record.selectedAt) ? record.selectedAt : fallbackTime,
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

function parseStringRecord(value: unknown): Record<string, string> | undefined {
	if (!isRecord(value)) return undefined;
	const result: Record<string, string> = {};
	for (const [key, candidate] of Object.entries(value)) if (typeof candidate === "string") result[key] = candidate;
	return Object.keys(result).length > 0 ? result : undefined;
}
