import type { BrowserBridgeRuntime, BrowserClientSummary, BrowserElementDescriptorSummary, BrowserSharedSelectionSummary, BrowserTabSummary } from "../core/state.ts";

export interface BrowserTarget {
	client: BrowserClientSummary;
	tab: BrowserTabSummary;
}

export interface SharedSelectionLookupTarget {
	client: { clientId: string };
	tab: { tabId?: number };
}

export interface SharedStyleElementInput {
	elementId?: string;
	selector?: string;
	selectionId?: string;
	selectionIndex?: number;
}

export interface ResolvedBrowserElementTarget {
	elementId?: string;
	selector?: string;
	selectionId?: string;
	selectionIndex?: number;
	expected?: BrowserElementDescriptorSummary;
	limit?: number;
}

export function resolveSharedElementTarget(runtime: BrowserBridgeRuntime, target: BrowserTarget, input: SharedStyleElementInput | undefined, options: { fallbackSelectionOffset: number; role: string }): ResolvedBrowserElementTarget {
	if (input?.elementId) return { elementId: input.elementId };
	if (input?.selector) return { selector: input.selector };
	const selection = findSharedSelection(runtime, target, input?.selectionId, options.fallbackSelectionOffset);
	if (!selection) throw new Error(`No ${options.role} was provided and no matching shared selection is available. Ask the user to share/select an element first, or pass a selector.`);
	const index = clampIndex(input?.selectionIndex, selection.elements.length);
	const element = selection.elements[index];
	if (!element) throw new Error(`Shared selection ${selection.selectionId} has no element at index ${index}.`);
	const base = { selectionId: selection.selectionId, selectionIndex: index, expected: element };
	if (element.elementId) return { ...base, elementId: element.elementId };
	const selector = element.selectorCandidates?.[0];
	if (selector) return { ...base, selector };
	throw new Error(`Shared selection ${selection.selectionId} element ${index} has no reusable elementId or selector.`);
}

export function resolveElementDescriptorFromSharedSelection(runtime: BrowserBridgeRuntime, target: SharedSelectionLookupTarget, selectionId: string | undefined, selectionIndex: number | undefined, fallbackSelectionOffset = 0): { selection: BrowserSharedSelectionSummary; index: number; element: BrowserElementDescriptorSummary } | undefined {
	const selection = findSharedSelection(runtime, target, selectionId, fallbackSelectionOffset);
	if (!selection) return undefined;
	const index = clampIndex(selectionIndex, selection.elements.length);
	const element = selection.elements[index];
	return element ? { selection, index, element } : undefined;
}

export function findSharedSelection(runtime: BrowserBridgeRuntime, target: SharedSelectionLookupTarget, selectionId: string | undefined, fallbackSelectionOffset: number): BrowserSharedSelectionSummary | undefined {
	const matching = runtime.state.sharedSelections
		.filter((selection) => selection.status === "selected" && selection.clientId === target.client.clientId && (selection.tabId === undefined || selection.tabId === target.tab.tabId));
	if (selectionId) return matching.find((selection) => selection.selectionId === selectionId);
	return matching.at(-(fallbackSelectionOffset + 1));
}

function clampIndex(value: number | undefined, length: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return 0;
	return Math.min(Math.max(0, Math.trunc(value)), Math.max(0, length - 1));
}
