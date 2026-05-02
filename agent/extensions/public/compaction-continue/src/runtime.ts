import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
	analyzeCompactionRecovery,
	analyzeRalphBranchForStall,
	messageText,
	parseRalphPrompt,
	shouldRecoverStalledRalphTurn,
} from "./analysis.ts";
import type { CompactionRecoveryAnalysis, RalphBranchAnalysis, RalphPromptInfo } from "./analysis.ts";
import { branchBeforeCompaction, findMostRecentActiveLoop, isOverflowCompaction, latestLeafCompactionId, messageRole } from "./loop-state.ts";
import {
	MAX_RALPH_IDLE_RECOVERIES_PER_PROMPT,
	MESSAGE_TYPE_WATCHDOG_NUDGE,
	RALPH_IDLE_DELAY_MS,
	RECOVERY_DELAY_MS,
	WATCHDOG_NUDGE_PROMPT,
} from "./model.ts";
import type { WatchdogNudgeDetails, WatchdogNudgeRequest } from "./model.ts";

function registerWatchdogMessageRenderer(pi: ExtensionAPI): void {
	pi.registerMessageRenderer<WatchdogNudgeDetails>(MESSAGE_TYPE_WATCHDOG_NUDGE, (message, _options, theme) => {
		const details = message.details;
		if (!details || details.kind !== "watchdog_nudge") return undefined;

		const target = details.loop ? ` · ${details.loop}${details.iteration ? ` iter ${details.iteration}` : ""}` : "";
		const text = theme.fg("warning", "✦ watchdog nudge ") + theme.fg("muted", `${details.title}${target}`);
		return {
			render: () => [text],
			invalidate: () => {},
		};
	});
}

export function registerCompactionContinue(pi: ExtensionAPI): void {
	let enabled = true;
	let pendingTimer: ReturnType<typeof setTimeout> | undefined;
	let pendingRalphIdleTimer: ReturnType<typeof setTimeout> | undefined;
	let lastRecoveredCompactionId: string | undefined;
	let lastPreCompactionAnalysis: CompactionRecoveryAnalysis | undefined;
	let lastRalphPrompt: RalphPromptInfo | undefined;
	let ralphDoneAfterLastPrompt = false;
	const ralphRecoveryCounts = new Map<string, number>();

	registerWatchdogMessageRenderer(pi);

	function updateStatus(ctx: ExtensionContext): void {
		const state = enabled ? ctx.ui.theme.fg("success", "on") : ctx.ui.theme.fg("error", "off");
		ctx.ui.setStatus("compaction-continue", `${ctx.ui.theme.fg("muted", "watchdog:")}${state}`);
	}

	function clearRalphIdleTimer(): void {
		if (pendingRalphIdleTimer) clearTimeout(pendingRalphIdleTimer);
		pendingRalphIdleTimer = undefined;
	}

	function canSendNudge(ctx: ExtensionContext): boolean {
		return enabled && ctx.isIdle() && !ctx.hasPendingMessages();
	}

	function sendNudge(ctx: ExtensionContext, request: WatchdogNudgeRequest): void {
		pi.appendEntry("compaction-continue", request.entry);
		ctx.ui.notify(request.notification, "info");
		pi.sendMessage(
			{
				customType: MESSAGE_TYPE_WATCHDOG_NUDGE,
				content: request.content,
				display: true,
				details: request.details,
			},
			{ triggerTurn: true },
		);
	}

	function noteRalphPromptFromText(text: string, timestamp = Date.now()): void {
		const prompt = parseRalphPrompt(text, timestamp);
		if (!prompt) return;
		lastRalphPrompt = prompt;
		ralphDoneAfterLastPrompt = false;
		clearRalphIdleTimer();
	}

	function syncRalphPromptFromBranch(ctx: ExtensionContext): RalphBranchAnalysis {
		const analysis = analyzeRalphBranchForStall(ctx.sessionManager.getBranch());
		if (analysis.prompt) {
			lastRalphPrompt = analysis.prompt;
			ralphDoneAfterLastPrompt = analysis.ralphDoneAfterPrompt;
		}
		return analysis;
	}

	function scheduleRecovery(compactionId: string, ctx: ExtensionContext, seedAnalysis?: CompactionRecoveryAnalysis): void {
		if (pendingTimer) clearTimeout(pendingTimer);

		pendingTimer = setTimeout(() => {
			pendingTimer = undefined;
			if (!enabled) return;
			if (lastRecoveredCompactionId === compactionId) return;
			if (!canSendNudge(ctx)) return;

			const activeLoop = findMostRecentActiveLoop(ctx);
			const analysis = analyzeCompactionRecovery(branchBeforeCompaction(ctx, compactionId), {
				hasActiveLoop: Boolean(activeLoop),
				isOverflow: isOverflowCompaction(ctx, compactionId),
			});
			const recovery = analysis.shouldRecover ? analysis : seedAnalysis?.shouldRecover ? seedAnalysis : undefined;
			if (!recovery) return;

			lastRecoveredCompactionId = compactionId;
			const recoveryKind = recovery.kind ?? "overflow";
			const title = recoveryKind === "ralph" ? "Unresolved Ralph loop after compaction" : "Context overflow compaction finished";
			const loop = activeLoop?.name ?? recovery.ralph?.prompt?.loop;
			const iteration = activeLoop?.iteration || recovery.ralph?.prompt?.iteration;
			sendNudge(ctx, {
				content: WATCHDOG_NUDGE_PROMPT,
				details: {
					kind: "watchdog_nudge",
					recoveryKind,
					title,
					reason: recovery.reason,
					loop,
					iteration,
					compactionId,
				},
				entry: {
					compactionId,
					kind: recovery.kind,
					loop,
					iteration,
					reason: recovery.reason,
					timestamp: new Date().toISOString(),
				},
				notification:
					recoveryKind === "ralph"
						? "Compaction left an unresolved Ralph loop idle; sending watchdog nudge."
						: "Context overflow compaction finished; sending watchdog nudge.",
			});
		}, RECOVERY_DELAY_MS);
	}

	function scheduleRalphIdleRecovery(ctx: ExtensionContext, prompt: RalphPromptInfo, reason: string): void {
		clearRalphIdleTimer();
		const scheduledPromptKey = prompt.key;

		pendingRalphIdleTimer = setTimeout(() => {
			pendingRalphIdleTimer = undefined;
			if (!enabled) return;
			if (!canSendNudge(ctx)) return;

			const activeLoop = findMostRecentActiveLoop(ctx);
			if (!activeLoop) return;
			if (!lastRalphPrompt || lastRalphPrompt.key !== scheduledPromptKey || ralphDoneAfterLastPrompt) return;

			const recoveries = ralphRecoveryCounts.get(scheduledPromptKey) ?? 0;
			if (recoveries >= MAX_RALPH_IDLE_RECOVERIES_PER_PROMPT) return;
			ralphRecoveryCounts.set(scheduledPromptKey, recoveries + 1);

			const loop = activeLoop.name ?? prompt.loop;
			const iteration = activeLoop.iteration || prompt.iteration;
			sendNudge(ctx, {
				content: WATCHDOG_NUDGE_PROMPT,
				details: {
					kind: "watchdog_nudge",
					recoveryKind: "ralph-stall",
					title: "Ralph loop appears idle",
					reason,
					loop,
					iteration,
					promptKey: scheduledPromptKey,
				},
				entry: {
					kind: "ralph-stall",
					loop,
					iteration,
					reason,
					promptKey: scheduledPromptKey,
					timestamp: new Date().toISOString(),
				},
				notification: "Active Ralph loop went idle after saying it would continue; sending watchdog nudge.",
			});
		}, RALPH_IDLE_DELAY_MS);
	}

	function maybeWatchRalphStall(ctx: ExtensionContext, assistantMessage: unknown): void {
		if (!enabled) return;
		if (!findMostRecentActiveLoop(ctx)) return;
		if (!lastRalphPrompt) syncRalphPromptFromBranch(ctx);
		if (!lastRalphPrompt || ralphDoneAfterLastPrompt) return;
		if (!shouldRecoverStalledRalphTurn(assistantMessage)) return;
		scheduleRalphIdleRecovery(ctx, lastRalphPrompt, "assistant-promised-ralph-continuation");
	}

	function reportStatus(args: string, ctx: ExtensionContext): void {
		const value = args.trim().toLowerCase();
		if (value === "on" || value === "enable") enabled = true;
		else if (value === "off" || value === "disable") enabled = false;

		updateStatus(ctx);
		const activeLoop = findMostRecentActiveLoop(ctx);
		const analysis = syncRalphPromptFromBranch(ctx);
		ctx.ui.notify(
			`Compaction continue: ${enabled ? "enabled" : "disabled"}${
				activeLoop ? `\nActive loop: ${activeLoop.name} (iteration ${activeLoop.iteration})` : "\nNo active loop detected"
			}${analysis.prompt && !analysis.ralphDoneAfterPrompt ? "\nRalph idle watch: armed" : ""}`,
			"info",
		);
	}

	pi.registerCommand("compaction-continue", {
		description: "Toggle/status for watchdog nudges after idle compactions and Ralph stalls",
		handler: async (args, ctx) => reportStatus(args, ctx),
	});

	pi.registerCommand("ralph-compact-watchdog", {
		description: "Deprecated alias for /compaction-continue",
		handler: async (args, ctx) => reportStatus(args, ctx),
	});

	pi.on("session_before_compact", async (event, ctx) => {
		lastPreCompactionAnalysis = analyzeCompactionRecovery(event.branchEntries, {
			hasActiveLoop: Boolean(findMostRecentActiveLoop(ctx)),
			isOverflow: false,
		});
	});

	pi.on("session_compact", async (event, ctx) => {
		if (!enabled) return;
		const activeLoop = findMostRecentActiveLoop(ctx);
		const analysis = analyzeCompactionRecovery(branchBeforeCompaction(ctx, event.compactionEntry.id), {
			hasActiveLoop: Boolean(activeLoop),
			isOverflow: isOverflowCompaction(ctx, event.compactionEntry.id),
		});
		if (!analysis.shouldRecover && !lastPreCompactionAnalysis?.shouldRecover) return;
		scheduleRecovery(event.compactionEntry.id, ctx, lastPreCompactionAnalysis);
	});

	pi.on("message_end", async (event) => {
		if (messageRole(event.message) === "user") noteRalphPromptFromText(messageText(event.message));
	});

	pi.on("tool_result", async (event) => {
		if (event.toolName !== "ralph_done" || event.isError) return;
		ralphDoneAfterLastPrompt = true;
		clearRalphIdleTimer();
	});

	pi.on("turn_end", async (event, ctx) => {
		if (messageRole(event.message) !== "assistant") return;
		maybeWatchRalphStall(ctx, event.message);
	});

	pi.on("session_start", async (_event, ctx) => {
		updateStatus(ctx);

		const compactionId = latestLeafCompactionId(ctx);
		if (enabled && compactionId) {
			const analysis = analyzeCompactionRecovery(branchBeforeCompaction(ctx, compactionId), {
				hasActiveLoop: Boolean(findMostRecentActiveLoop(ctx)),
				isOverflow: isOverflowCompaction(ctx, compactionId),
			});
			if (analysis.shouldRecover) scheduleRecovery(compactionId, ctx, analysis);
		}

		const ralphAnalysis = syncRalphPromptFromBranch(ctx);
		if (enabled && ralphAnalysis.prompt && ralphAnalysis.shouldRecover) {
			scheduleRalphIdleRecovery(ctx, ralphAnalysis.prompt, ralphAnalysis.reason ?? "assistant-promised-ralph-continuation");
		}
	});

	pi.on("session_shutdown", async () => {
		if (pendingTimer) clearTimeout(pendingTimer);
		pendingTimer = undefined;
		clearRalphIdleTimer();
	});
}
