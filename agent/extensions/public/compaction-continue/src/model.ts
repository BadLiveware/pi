export type WatchdogNudgeKind = "overflow" | "ralph" | "ralph-stall";

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
export const RALPH_IDLE_DELAY_MS = 2_000;
export const MAX_RALPH_IDLE_RECOVERIES_PER_PROMPT = 1;
export const MESSAGE_TYPE_WATCHDOG_NUDGE = "compaction-continue:watchdog-nudge";

export const WATCHDOG_NUDGE_PROMPT = [
	"Automated watchdog nudge: Pi became idle after compaction or after a watched loop turn.",
	"This is not a new user request and does not mean more work is required.",
	"Check the previous task or loop state. If all requested work is complete, stop and briefly say no further action is needed. If this is a Ralph loop, respond with `<promise>COMPLETE</promise>` when the loop is fully complete. If unfinished in-scope work remains, continue from the next concrete step.",
].join("\n\n");
