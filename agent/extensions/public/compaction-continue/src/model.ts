export type WatchdogNudgeKind = "overflow" | "ralph" | "assistant-stall";

export interface WatchdogNudgeDetails {
	kind: "watchdog_nudge";
	recoveryKind: WatchdogNudgeKind;
	title: string;
	reason: string;
	loop?: string;
	iteration?: number;
	compactionId?: string;
	promptKey?: string;
}

export interface WatchdogNudgeRequest {
	content: string;
	details: WatchdogNudgeDetails;
	entry: Record<string, unknown>;
	notification: string;
}

export const RECOVERY_DELAY_MS = 1_000;
export const ASSISTANT_IDLE_DELAY_MS = 2_000;
export const MAX_ASSISTANT_IDLE_RECOVERIES_PER_STREAK = 3;
export const MESSAGE_TYPE_WATCHDOG_NUDGE = "compaction-continue:watchdog-nudge";
export const WATCHDOG_ANSWER_TOOL = "watchdog_answer";

export function buildWatchdogNudgePrompt(): string {
	return [
		`<watchdog_nudge source="pi-compaction-continue" not_user_request="true">`,
		"Automated watchdog nudge: Pi became idle after compaction or after a stalled turn.",
		"This is not a new user request and does not mean more work is required.",
		"Do not acknowledge this nudge in prose. Perform only a minimal completion check.",
		"Scope `done` to the whole active user-visible work set, not just the subtask you were doing when Pi went idle. Consider any active plan, task-list items, loop/brief, checklist, requested validation, requested commit/PR/push, or pending direct user question.",
		`Answer \`${WATCHDOG_ANSWER_TOOL}(done: true)\` only if the whole active work set is complete: no pending/in_progress tracked tasks, unchecked required items, active loop/brief work, requested validation, requested commit/PR/push, or pending direct question remains.`,
		`Answer \`${WATCHDOG_ANSWER_TOOL}(done: false)\` if any explicit or tracked larger work remains, including cleanup/improvement/follow-up checks that are part of the active plan or current execution, even if the most recent subtask is complete. Then continue with the next concrete open item instead of replying about the nudge.`,
		"Merely possible ideas that were never requested, planned, or tracked do not count as required work.",
		"</watchdog_nudge>",
	].join("\n\n");
}

export const WATCHDOG_NUDGE_PROMPT = buildWatchdogNudgePrompt();
