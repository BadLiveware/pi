/** Stardock loop lifecycle transitions. */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { applyActiveBriefLifecycle } from "../briefs.ts";
import type { BriefLifecycleAction, LoopState } from "../state/core.ts";
import { saveState } from "../state/store.ts";

export interface LoopRuntimeRef {
	currentLoop: string | null;
}

export function pauseLoop(ctx: ExtensionContext, ref: LoopRuntimeRef, updateUI: (ctx: ExtensionContext) => void, state: LoopState, message?: string): void {
	applyActiveBriefLifecycle(state, "clear");
	state.status = "paused";
	state.active = false;
	saveState(ctx, state);
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
	applyActiveBriefLifecycle(state, "clear");
	state.status = "completed";
	state.completedAt = new Date().toISOString();
	state.active = false;
	saveState(ctx, state);
	ref.currentLoop = null;
	updateUI(ctx);
	if (message && ctx.hasUI) ctx.ui.notify(message, "info");
}
