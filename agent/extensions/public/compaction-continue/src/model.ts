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

export const WATCHDOG_NUDGE_PROMPT = [
	"Automated watchdog nudge: Pi became idle after compaction or after a stalled turn.",
	"This is not a new user request and does not mean more work is required.",
	`Do not acknowledge this nudge in prose. First call \`${WATCHDOG_ANSWER_TOOL}\` once with \`done: true\` if the previous task is already complete, or \`done: false\` if unfinished in-scope work remains.`,
	"If you answered `done: true`, stop after the tool call or emit the loop completion marker (`<promise>COMPLETE</promise>`) when the loop is fully complete. If you answered `done: false`, continue from the next concrete step instead of replying about the nudge.",
].join("\n\n");
