/** Shared runtime glue for Stardock registration modules. */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { BriefLifecycleAction, LoopState, PromptReason } from "../state/core.ts";
import type { FollowupToolRequest } from "./followups.ts";
import type { ExecutionNodeActivity } from "../execution-plan/widget.ts";
import type { LoopRuntimeRef } from "./lifecycle.ts";

export interface StardockRuntime {
	ref: LoopRuntimeRef;
	executionActivity?: Map<string, ExecutionNodeActivity>;
	updateUI(ctx: ExtensionContext): void;
	buildPrompt(state: LoopState, taskContent: string, reason: PromptReason): string;
	optionalLoopDetails(ctx: ExtensionContext, state: LoopState, options: { includeState?: boolean; includeOverview?: boolean; includePromptPreview?: boolean; followupTool?: FollowupToolRequest }): Record<string, unknown>;
	pauseLoop(ctx: ExtensionContext, state: LoopState, message?: string): void;
	completeLoop(ctx: ExtensionContext, state: LoopState, banner: string, activeBriefLifecycle?: BriefLifecycleAction, allowRetainedOwnership?: boolean): void;
	stopLoop(ctx: ExtensionContext, state: LoopState, message?: string): void;
	forceStopLoop(ctx: ExtensionContext, state: LoopState, message?: string, localRunCancellationRequested?: boolean): void;
}
