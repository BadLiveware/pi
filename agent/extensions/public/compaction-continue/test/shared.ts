import type { SessionEntry } from "@mariozechner/pi-coding-agent";

export const ralphPrompt = `───────────────────────────────────────────────────────────────────────
🔄 RALPH LOOP: native-sql-optimization-sweep | Iteration 6/100 | 🪞 REFLECTION
───────────────────────────────────────────────────────────────────────

REFLECTION CHECKPOINT

Update the task file with your reflection, then continue working.

## Instructions

You are in a Ralph loop (iteration 6 of 100).

1. Continue working on the task
2. Update the task file (.ralph/native-sql-optimization-sweep.md) with your progress
3. When FULLY COMPLETE, respond with: <promise>COMPLETE</promise>
4. Otherwise, call the ralph_done tool to proceed to next iteration`;

export function messageEntry(id: string, role: string, content: unknown, extra: Record<string, unknown> = {}): SessionEntry {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp: "2026-04-28T17:31:12.000Z",
		message: {
			role,
			content,
			...extra,
		},
	} as unknown as SessionEntry;
}
