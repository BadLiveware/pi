/** Stardock session and agent lifecycle hooks. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { maybeCreateAutomaticAuditorRequest } from "../outside-requests.ts";
import { COMPLETE_MARKER } from "../state/core.ts";
import { existingStatePath, safeMtimeMs } from "../state/paths.ts";
import { openMutableWorkerRun } from "../worker-runs.ts";
import { listLoops, loadState, saveState } from "../state/store.ts";
import { getModeHandler } from "./prompts.ts";
import type { StardockRuntime } from "./types.ts";

export function registerLifecycleHooks(pi: ExtensionAPI, runtime: StardockRuntime): void {
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
		const lastAssistant = [...event.messages].reverse().find((m) => m.role === "assistant");
		const text = lastAssistant && Array.isArray(lastAssistant.content) ? lastAssistant.content.filter((c): c is { type: "text"; text: string } => c.type === "text").map((c) => c.text).join("\n") : "";

		if (text.includes(COMPLETE_MARKER)) {
			const openRun = openMutableWorkerRun(state);
			if (openRun) {
				pi.sendUserMessage(`Stardock completion blocked: implementer WorkerRun ${openRun.id} is ${openRun.status}. Review it with stardock_brief_worker({ action: "review", runId: "${openRun.id}" }) or dismiss it before completing.`, { deliverAs: "followUp" });
				return;
			}
			const auditorRequest = maybeCreateAutomaticAuditorRequest(state);
			if (auditorRequest) {
				saveState(ctx, state);
				runtime.updateUI(ctx);
				pi.sendUserMessage(`Stardock completion blocked: auditor request ${auditorRequest.id} is ${auditorRequest.status}. Build the payload with stardock_outside_payload({ requestId: "${auditorRequest.id}" }), record the review with stardock_auditor, or escalate to the user before completing.`, { deliverAs: "followUp" });
				return;
			}
			runtime.completeLoop(ctx, state, `───────────────────────────────────────────────────────────────────────
✅ STARDOCK LOOP COMPLETE: ${state.name} | ${state.iteration} iterations
───────────────────────────────────────────────────────────────────────`);
			return;
		}

		if (state.maxIterations > 0 && state.iteration >= state.maxIterations) {
			runtime.completeLoop(ctx, state, `───────────────────────────────────────────────────────────────────────
⚠️ STARDOCK LOOP STOPPED: ${state.name} | Max iterations (${state.maxIterations}) reached
───────────────────────────────────────────────────────────────────────`, "clear");
		}
	});

	pi.on("session_start", async (_event, ctx) => {
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
		if (runtime.ref.currentLoop) {
			const state = loadState(ctx, runtime.ref.currentLoop);
			if (state) saveState(ctx, state);
		}
	});
}
