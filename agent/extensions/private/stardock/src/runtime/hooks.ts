/** Stardock session and agent lifecycle hooks. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";
import * as path from "node:path";
import type { LoopState } from "../state/core.ts";
import { existingStatePath, safeMtimeMs, tryRead } from "../state/paths.ts";
import { listLoops, loadState, saveState } from "../state/store.ts";
import { evaluateWorkflowStatus, type WorkflowStatus } from "../workflow-status.ts";
import { getModeHandler } from "./prompts.ts";
import type { StardockRuntime } from "./types.ts";

type TranscriptContent = { type?: string; name?: string };
type TranscriptMessage = { role?: string; toolName?: string; content?: TranscriptContent[] };

const PROMPT_QUEUEING_TOOLS = new Set(["stardock_start", "stardock_done", "stardock_complete"]);
const CONTINUATION_WORKFLOW_STATES = new Set<WorkflowStatus["state"]>(["ready_for_work", "active_work", "ready_for_final_verification", "ready_to_complete"]);

function transcriptMessages(messages: unknown): TranscriptMessage[] {
	return Array.isArray(messages) ? messages.filter((message): message is TranscriptMessage => typeof message === "object" && message !== null) : [];
}

function usedAnyTool(messages: TranscriptMessage[], toolNames: Set<string>): boolean {
	return messages.some((message) =>
		(typeof message.toolName === "string" && toolNames.has(message.toolName)) ||
		(Array.isArray(message.content) && message.content.some((part) => part.type === "toolCall" && typeof part.name === "string" && toolNames.has(part.name)))
	);
}

function shouldQueueContinuationPrompt(state: LoopState, status: WorkflowStatus, messages: TranscriptMessage[], ctx: { hasPendingMessages(): boolean }): boolean {
	if (state.status !== "active") return false;
	if (!CONTINUATION_WORKFLOW_STATES.has(status.state)) return false;
	if (usedAnyTool(messages, PROMPT_QUEUEING_TOOLS)) return false;
	if (ctx.hasPendingMessages()) return false;
	return true;
}

function queueContinuationPrompt(pi: ExtensionAPI, runtime: StardockRuntime, ctx: { cwd: string; hasPendingMessages(): boolean }, state: LoopState, status: WorkflowStatus, messages: TranscriptMessage[]): void {
	if (!shouldQueueContinuationPrompt(state, status, messages, ctx)) return;
	const content = tryRead(path.resolve(ctx.cwd, state.taskFile));
	if (!content) return;
	pi.sendUserMessage(
		[
			`Stardock continuation guard: loop ${state.name} is still ${status.state}; the previous turn ended without stardock_done or stardock_complete. Continue the current iteration from the Stardock prompt below, or call the appropriate Stardock lifecycle tool if the work is actually complete.`,
			"",
			runtime.buildPrompt(state, content, "iteration"),
		].join("\n"),
		{ deliverAs: "followUp" },
	);
}

export function registerLifecycleHooks(pi: ExtensionAPI, runtime: StardockRuntime): void {
	let unsubscribeInterruptInput: (() => void) | undefined;

	pi.on("before_agent_start", async (event, ctx) => {
		if (!runtime.ref.currentLoop) return;
		const state = loadState(ctx, runtime.ref.currentLoop);
		if (!state || state.status !== "active") return;
		const iterStr = `${state.iteration}${state.maxIterations > 0 ? `/${state.maxIterations}` : ""}`;
		const instructions = getModeHandler(state.mode).buildSystemInstructions(state);
		return { systemPrompt: event.systemPrompt + `\n[STARDOCK LOOP - ${state.name} - Iteration ${iterStr}]\n\n${instructions}` };
	});

	pi.on("agent_end", async (event, ctx) => {
		if (!runtime.ref.currentLoop) return;
		const state = loadState(ctx, runtime.ref.currentLoop);
		if (!state || state.status !== "active") return;
		const messages = transcriptMessages(event.messages);

		if (state.maxIterations > 0 && state.iteration >= state.maxIterations) {
			runtime.completeLoop(ctx, state, `───────────────────────────────────────────────────────────────────────
⚠️ STARDOCK LOOP STOPPED: ${state.name} | Max iterations (${state.maxIterations}) reached
───────────────────────────────────────────────────────────────────────`, "clear");
			return;
		}

		queueContinuationPrompt(pi, runtime, ctx, state, evaluateWorkflowStatus(state), messages);
	});

	pi.on("session_start", async (_event, ctx) => {
		unsubscribeInterruptInput?.();
		unsubscribeInterruptInput = ctx.hasUI
			? ctx.ui.onTerminalInput((data) => {
				if (!matchesKey(data, "escape") || ctx.isIdle() || !runtime.ref.currentLoop) return undefined;
				const state = loadState(ctx, runtime.ref.currentLoop);
				if (!state || state.status !== "active") return undefined;
				ctx.abort();
				return { consume: true };
			})
			: undefined;

		const active = listLoops(ctx).filter((l) => l.status === "active");
		if (!runtime.ref.currentLoop && active.length > 0) {
			const mostRecent = active.reduce((best, candidate) => {
				const bestMtime = safeMtimeMs(existingStatePath(ctx, best.name));
				const candidateMtime = safeMtimeMs(existingStatePath(ctx, candidate.name));
				return candidateMtime > bestMtime ? candidate : best;
			});
			runtime.ref.currentLoop = mostRecent.name;
		}

		if (active.length > 0 && ctx.hasUI) {
			const lines = active.map((l) => `  • ${l.name} (iteration ${l.iteration}${l.maxIterations > 0 ? `/${l.maxIterations}` : ""})`);
			ctx.ui.notify(`Active Stardock loops:\n${lines.join("\n")}\n\nUse /stardock resume <name> to continue`, "info");
		}
		runtime.updateUI(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		unsubscribeInterruptInput?.();
		unsubscribeInterruptInput = undefined;
		if (runtime.ref.currentLoop) {
			const state = loadState(ctx, runtime.ref.currentLoop);
			if (state) saveState(ctx, state);
		}
	});
}
