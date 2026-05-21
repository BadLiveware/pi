import type { BrowserBridgeState } from "../core/state.ts";

export interface ClearedEphemeralBrowserStateCounts {
	selections: number;
	drawings: number;
	previews: number;
}

export function clearClientEphemeralBrowserState(state: BrowserBridgeState, clientId: string): ClearedEphemeralBrowserStateCounts | undefined {
	const selections = state.sharedSelections.filter((selection) => selection.clientId === clientId).length;
	const drawings = state.sharedDrawings.filter((drawing) => drawing.clientId === clientId).length;
	const previews = state.designPreviews.filter((preview) => preview.clientId === clientId).length;
	if (selections + drawings + previews === 0) return undefined;
	state.sharedSelections = state.sharedSelections.filter((selection) => selection.clientId !== clientId);
	state.sharedDrawings = state.sharedDrawings.filter((drawing) => drawing.clientId !== clientId);
	state.designPreviews = state.designPreviews.filter((preview) => preview.clientId !== clientId);
	return { selections, drawings, previews };
}

export function clearAllEphemeralBrowserState(state: BrowserBridgeState): ClearedEphemeralBrowserStateCounts | undefined {
	const selections = state.sharedSelections.length;
	const drawings = state.sharedDrawings.length;
	const previews = state.designPreviews.length;
	if (selections + drawings + previews === 0) return undefined;
	state.sharedSelections = [];
	state.sharedDrawings = [];
	state.designPreviews = [];
	return { selections, drawings, previews };
}
