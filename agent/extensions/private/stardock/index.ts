/**
 * Stardock - private governed implementation loops for Pi.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as path from "node:path";
import { registerCommands } from "./src/runtime/commands.ts";
import { registerCoreTools } from "./src/runtime/core-tools.ts";
import { registerFeatureTools } from "./src/runtime/feature-tools.ts";
import { runFollowupTool, type FollowupToolRequest } from "./src/runtime/followups.ts";
import { registerLifecycleHooks } from "./src/runtime/hooks.ts";
import { completeLoop, type LoopRuntimeRef, pauseLoop, stopLoop } from "./src/runtime/lifecycle.ts";
import { buildPrompt } from "./src/runtime/prompts.ts";
import type { StardockRuntime } from "./src/runtime/types.ts";
import { updateStardockUI } from "./src/runtime/ui.ts";
import { notifyWorkflowTransition, type WorkflowNotificationTracker } from "./src/workflow-notifications.ts";
import { type BriefLifecycleAction, compactText, type LoopState } from "./src/state/core.ts";
import { tryRead } from "./src/state/paths.ts";
import { loadState } from "./src/state/store.ts";
import { formatRunOverview, summarizeLoopState } from "./src/views.ts";

export default function (pi: ExtensionAPI) {
	const ref: LoopRuntimeRef = { currentLoop: null };
	const workflowNotifications: WorkflowNotificationTracker = { seen: new Map() };

	const runtime: StardockRuntime = {
		ref,
		updateUI(ctx: ExtensionContext): void {
			if (ref.currentLoop) {
				// Transition notifications are derived from current state only and never mutate loop state.
				const state = loadState(ctx, ref.currentLoop);
				if (state) notifyWorkflowTransition(ctx, state, workflowNotifications);
			}
			updateStardockUI(ctx, ref.currentLoop);
		},
		buildPrompt,
		optionalLoopDetails(ctx: ExtensionContext, state: LoopState, options: { includeState?: boolean; includeOverview?: boolean; includePromptPreview?: boolean; followupTool?: FollowupToolRequest }): Record<string, unknown> {
			const content = tryRead(path.resolve(ctx.cwd, state.taskFile));
			const followup = runFollowupTool(ctx, ref.currentLoop, options.followupTool, ["optionalLoopDetails"]);
			return {
				...(options.includeState ? { loop: summarizeLoopState(ctx, state, false, false) } : {}),
				...(options.includeOverview ? { overview: formatRunOverview(ctx, state, false) } : {}),
				...(options.includePromptPreview && content ? { promptPreview: compactText(buildPrompt(state, content, "iteration"), 4000) } : {}),
				...(followup ? { followupTool: followup } : {}),
			};
		},
		pauseLoop(ctx: ExtensionContext, state: LoopState, message?: string): void {
			pauseLoop(ctx, ref, runtime.updateUI, state, message);
		},
		completeLoop(ctx: ExtensionContext, state: LoopState, banner: string, activeBriefLifecycle?: BriefLifecycleAction): void {
			completeLoop(pi, ctx, ref, runtime.updateUI, state, banner, activeBriefLifecycle);
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
