import type { BridgeEnvelope } from "../shared/protocol.js";
import type { ActivatedTab } from "./types.js";

export const MAIN_FRAME_ID = 0;

export function resolveTargetFrameId(envelope: BridgeEnvelope, activatedTabs: ReadonlyMap<number, ActivatedTab>): number | undefined {
	if (typeof envelope.target?.frameId === "number") return envelope.target.frameId;
	const tabId = typeof envelope.target?.tabId === "number" ? envelope.target.tabId : undefined;
	if (tabId !== undefined) return activatedTabs.get(tabId)?.frameId ?? MAIN_FRAME_ID;
	const latest = [...activatedTabs.values()].sort((a, b) => b.activatedAt - a.activatedAt)[0];
	return latest?.frameId ?? MAIN_FRAME_ID;
}
