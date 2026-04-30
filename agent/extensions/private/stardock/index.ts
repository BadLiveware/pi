/**
 * Stardock - private governed implementation loops for Pi.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import * as path from "node:path";
import { registerCommands } from "./src/runtime/commands.ts";
import { registerCoreTools } from "./src/runtime/core-tools.ts";
import { registerFeatureTools } from "./src/runtime/feature-tools.ts";
import { registerLifecycleHooks } from "./src/runtime/hooks.ts";
import { completeLoop, type LoopRuntimeRef, pauseLoop, stopLoop } from "./src/runtime/lifecycle.ts";
import { buildPrompt } from "./src/runtime/prompts.ts";
import type { StardockRuntime } from "./src/runtime/types.ts";
import { updateStardockUI } from "./src/runtime/ui.ts";
import { compactText, type LoopState } from "./src/state/core.ts";
import { tryRead } from "./src/state/paths.ts";
import { formatRunOverview, summarizeLoopState } from "./src/views.ts";

export default function (pi: ExtensionAPI) {
	const ref: LoopRuntimeRef = { currentLoop: null };

	const runtime: StardockRuntime = {
		ref,
		updateUI(ctx: ExtensionContext): void {
			updateStardockUI(ctx, ref.currentLoop);
		},
		buildPrompt,
		optionalLoopDetails(ctx: ExtensionContext, state: LoopState, options: { includeState?: boolean; includeOverview?: boolean; includePromptPreview?: boolean }): Record<string, unknown> {
			const content = tryRead(path.resolve(ctx.cwd, state.taskFile));
			return {
				...(options.includeState ? { loop: summarizeLoopState(ctx, state, false, false) } : {}),
				...(options.includeOverview ? { overview: formatRunOverview(ctx, state, false) } : {}),
				...(options.includePromptPreview && content ? { promptPreview: compactText(buildPrompt(state, content, "iteration"), 4000) } : {}),
			};
		},
		pauseLoop(ctx: ExtensionContext, state: LoopState, message?: string): void {
			pauseLoop(ctx, ref, runtime.updateUI, state, message);
		},
		completeLoop(ctx: ExtensionContext, state: LoopState, banner: string): void {
			completeLoop(pi, ctx, ref, runtime.updateUI, state, banner);
		},
		stopLoop(ctx: ExtensionContext, state: LoopState, message?: string): void {
			stopLoop(ctx, ref, runtime.updateUI, state, message);
		},
	};

	registerCommands(pi, runtime);
	registerCoreTools(pi, runtime);
	registerFeatureTools(pi, runtime);
	registerLifecycleHooks(pi, runtime);
}
