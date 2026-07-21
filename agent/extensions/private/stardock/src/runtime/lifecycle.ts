/** Stardock loop lifecycle transitions. */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { applyActiveBriefLifecycle } from "../briefs.ts";
import type { BriefLifecycleAction, LoopState } from "../state/core.ts";
import { saveState } from "../state/store.ts";
import { markOwnershipDetachedCandidate } from "../stages/ownership.ts";
import { OwnershipProtocolError, removeOwnershipToken } from "../stages/ownership-records.ts";

export interface LoopRuntimeRef {
	currentLoop: string | null;
	sessionId: string;
}

export function pauseLoop(ctx: ExtensionContext, ref: LoopRuntimeRef, updateUI: (ctx: ExtensionContext) => void, state: LoopState, message?: string): void {
	const detachedOwnership = markOwnershipDetachedCandidate(state);
	applyActiveBriefLifecycle(state, "clear");
	state.status = "paused";
	state.active = false;
	saveState(ctx, state);
	if (detachedOwnership) removeOwnershipToken(ctx, state.name, ref.sessionId);
	ref.currentLoop = null;
	updateUI(ctx);
	if (message && ctx.hasUI) ctx.ui.notify(message, "info");
}

export function completeLoop(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	ref: LoopRuntimeRef,
	updateUI: (ctx: ExtensionContext) => void,
	state: LoopState,
	banner: string,
	activeBriefLifecycle: BriefLifecycleAction = "complete",
): void {
	if (state.executionGraph?.ownership) {
		throw new OwnershipProtocolError("owner_nonterminal", `Cannot complete loop "${state.name}" while graph "${state.executionGraph.ownership.graphId}" stage "${state.executionGraph.ownership.stageId}" retains ownership. Reconcile and release or abandon the stage first.`);
	}
	applyActiveBriefLifecycle(state, activeBriefLifecycle);
	state.status = "completed";
	state.completedAt = new Date().toISOString();
	state.active = false;
	saveState(ctx, state);
	ref.currentLoop = null;
	updateUI(ctx);
	pi.appendEntry("stardock", {
		kind: "completed",
		name: state.name,
		iteration: state.iteration,
		maxIterations: state.maxIterations,
		completedAt: state.completedAt,
		banner,
	});
	if (ctx.hasUI) ctx.ui.notify(banner, "info");
}

export function stopLoop(ctx: ExtensionContext, ref: LoopRuntimeRef, updateUI: (ctx: ExtensionContext) => void, state: LoopState, message?: string): void {
	if (state.executionGraph?.ownership) {
		pauseLoop(ctx, ref, updateUI, state, message);
		return;
	}
	applyActiveBriefLifecycle(state, "clear");
	state.status = "completed";
	state.completedAt = new Date().toISOString();
	state.active = false;
	saveState(ctx, state);
	ref.currentLoop = null;
	updateUI(ctx);
	if (message && ctx.hasUI) ctx.ui.notify(message, "info");
}
