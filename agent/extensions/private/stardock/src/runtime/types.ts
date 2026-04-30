/** Shared runtime glue for Stardock registration modules. */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { LoopState, PromptReason } from "../state/core.ts";
import type { LoopRuntimeRef } from "./lifecycle.ts";

export interface StardockRuntime {
	ref: LoopRuntimeRef;
	updateUI(ctx: ExtensionContext): void;
	buildPrompt(state: LoopState, taskContent: string, reason: PromptReason): string;
	optionalLoopDetails(ctx: ExtensionContext, state: LoopState, options: { includeState?: boolean; includeOverview?: boolean; includePromptPreview?: boolean }): Record<string, unknown>;
	pauseLoop(ctx: ExtensionContext, state: LoopState, message?: string): void;
	completeLoop(ctx: ExtensionContext, state: LoopState, banner: string): void;
	stopLoop(ctx: ExtensionContext, state: LoopState, message?: string): void;
}
