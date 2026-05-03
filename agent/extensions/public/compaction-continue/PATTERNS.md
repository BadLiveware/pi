# Watchdog Pattern Catalog

Living catalog of every pattern the compaction-continue watchdog uses to decide
whether to nudge a session. When adding, removing, or changing a pattern, update
this file with the semantic context and rationale.

## Stall Detection Rules

Ordered decision tree in `shouldRecoverStalledAssistantTurn`. First match wins.

### R1. Aborted turn → skip

| Field | Value |
|-------|-------|
| Location | `analysis.ts:shouldRecoverStalledAssistantTurn` |
| Added | 2026-05-03 |
| Detection | `message.stopReason === "aborted"` |
| Semantic scenario | User explicitly cancelled the model (Ctrl+C, abort button). An aborted turn produces zero tokens and zero tool calls, which would otherwise match `isBlankAssistantStop`. |
| Action | Return `false` — never nudge. |

### R2. Active tool call → skip

| Field | Value |
|-------|-------|
| Location | `analysis.ts:shouldRecoverStalledAssistantTurn` via `hasNonWatchdogToolCall` |
| Detection | Assistant message contains a tool call block that isn't `watchdog_answer` |
| Semantic scenario | The assistant issued a real tool call (bash, read, edit, etc.) in its last turn. The session may be waiting for tool results, not stalled. |
| Action | Return `false` — let tool results arrive. |

### R3. Watchdog self-check: done → skip

| Field | Value |
|-------|-------|
| Location | `analysis.ts:shouldRecoverStalledAssistantTurn` via `watchdogAnswerDoneValue` |
| Detection | Assistant called `watchdog_answer({ done: true })` |
| Semantic scenario | Previous nudge was answered: agent confirmed work is complete. No more nudging needed. |
| Action | Return `false`. |

### R4. Watchdog self-check: not done → recover

| Field | Value |
|-------|-------|
| Location | `analysis.ts:shouldRecoverStalledAssistantTurn` via `watchdogAnswerDoneValue` |
| Detection | Assistant called `watchdog_answer({ done: false })` |
| Semantic scenario | Previous nudge was answered: agent confirmed work remains but then produced no further tool calls. The agent said "I should continue" but didn't — that's exactly the stall pattern. |
| Action | Return `true` — nudge again. |

### R5. Assistant promised continuation → recover

| Field | Value |
|-------|-------|
| Location | `analysis.ts:shouldRecoverStalledAssistantTurn` via `assistantRequestsContinuation` |
| Detection | Assistant's text matches continuation-language patterns (see [L1-L7](#continuation-language-patterns)) |
| Semantic scenario | The assistant said something like "I'll continue now" but then produced no tool calls in the same turn. The session is idle but the agent declared intent to keep working. |
| Action | Return `true` — nudge. |

### R6. Blank assistant stop without tool progress → recover

| Field | Value |
|-------|-------|
| Location | `analysis.ts:shouldRecoverStalledAssistantTurn` via `isBlankAssistantStop` |
| Detection | Assistant message has zero text content and zero tool calls, AND no tool results arrived between the last user message and this assistant message (`hadToolResultSincePreviousUser === false`) |
| Semantic scenario | The assistant produced an empty turn after a user prompt, without having done any tool work yet. This is a model hiccup or premature stop. If tool results had already arrived for this user prompt, a blank follow-up is normal (the agent already worked and is done). |
| Action | Return `true` — nudge. Only when `hadToolResultSincePreviousUser !== true`. |

## Continuation Language Patterns

Regex patterns in `assistantRequestsContinuation` that detect an assistant declaring
intent to continue but not actually doing work in the same turn.

### Exclusion filters (checked first)

| Pattern | Semantic scenario |
|---------|-------------------|
| `<promise>COMPLETE</promise>` | Loop completion marker — work is done |
| `blocked \| paused \| waiting for \| cannot proceed \| can't proceed \| unable to proceed` | Agent explicitly blocked |
| `need (your\|user) (input\|decision\|confirmation\|approval)` | Agent waiting for user |
| `please (confirm\|advise\|decide) \| should i \| do you want` | Agent asking user a question |

### L1. Future-tense work declaration

| Field | Value |
|-------|-------|
| Pattern | `/\bi('ll\| will)\s+(do\|record\|update\|continue\|proceed\|work\|start\|run\|check\|inspect\|implement\|create\|capture\|execute)\b/` |
| Example | "I'll continue with the next step", "I will run the tests now" |
| Semantic scenario | Agent declares what it will do next but stops the turn with zero tool calls. |

### L2. Present-continuous work declaration

| Field | Value |
|-------|-------|
| Pattern | `/\bi('m\| am)\s+(proceeding\|continuing\|working\|going to\|gonna\|on it)\b/` |
| Example | "I'm proceeding with the implementation", "I'm on it" |
| Semantic scenario | Agent says it's working right now but doesn't issue tools. |

### L3. Explicit "proceeding with that now"

| Field | Value |
|-------|-------|
| Pattern | `/\bproceeding with (that\|this\|it) now\b/` |
| Example | "Proceeding with that now" |
| Semantic scenario | Direct statement of continuation without follow-through. |

### L4. "Continue with the next/current/this"

| Field | Value |
|-------|-------|
| Pattern | `/\bcontinue with (the )?(next\|current\|this)\b/` |
| Example | "Continue with the next step" |
| Semantic scenario | Agent says it will continue a specific step. |

### L5. "Next, I'll/will"

| Field | Value |
|-------|-------|
| Pattern | `/\bnext[, ]+i('ll\| will)\b/` |
| Example | "Next, I'll update the tests" |
| Semantic scenario | Agent declares next action without executing it. |

### L6. "Let me ..." (solo)

| Field | Value |
|-------|-------|
| Pattern | `/\blet me\s+(continue\|proceed\|check\|run\|update\|record\|implement\|start\|execute)\b/` |
| Example | "Let me check the results" |
| Semantic scenario | Agent announces a solo action. |

### L7. "Let's / let us ..." (collaborative)

| Field | Value |
|-------|-------|
| Pattern | `/\blet('s\| us)\s+(continue\|proceed\|check\|run\|update\|record\|implement\|start\|execute\|inspect\|create\|capture\|do)\b/` |
| Example | "Let's proceed with the refactor" |
| Semantic scenario | Agent announces a collaborative action. |

## User Nudge Patterns

Regex patterns in `userRequestsSimpleContinuation` that detect a user explicitly
telling the agent to keep working. Resets the stall streak in `runtime.ts:message_end`.

| Pattern | Example | Added |
|---------|---------|-------|
| `/^continue\b/` | "continue" | initial |
| `/^keep going\b/` | "keep going" | initial |
| `/^go on\b/` | "go on" | initial |
| `/^carry on\b/` | "carry on" | initial |
| `/^resume\b/` | "resume" | initial |
| `/^proceed\b/` | "proceed" | initial |
| `/\bjust continue\b/` | "just continue working" | initial |
| `/\bcontinue working\b/` | "continue working" | initial |
| `/\bdo not acknowledge me\b/` | "do not acknowledge me, just continue" | initial |

When a user message matches any of these, the stall streak is reset to 0 and the
idle timer is cleared — the user's explicit "keep going" counts as forward progress.

## Runtime Trigger Logic

### Turn-end: arm the stall timer

| Field | Value |
|-------|-------|
| Location | `runtime.ts:turn_end` |
| Trigger | Every assistant `turn_end` event where `shouldRecoverStalledAssistantTurn` returns `true` |
| Action | Increment `assistantIdleRecoveryStreak`, schedule `scheduleAssistantIdleRecovery` after `ASSISTANT_IDLE_DELAY_MS` (2s) |
| Guard | Nudge suppressed when streak exceeds `MAX_ASSISTANT_IDLE_RECOVERIES_PER_STREAK` (3) |

### Message-end: reset on user input

| Field | Value |
|-------|-------|
| Location | `runtime.ts:message_end` |
| Trigger | Every user `message_end` event |
| Action | Reset `hadToolResultSinceLastUser` to `false`. If user message does NOT match `userRequestsSimpleContinuation`, reset streak to 0 and clear idle timer. |

### Tool-result: reset on progress

| Field | Value |
|-------|-------|
| Location | `runtime.ts:tool_result` |
| Trigger | Every `tool_result` event |
| Action | Set `hadToolResultSinceLastUser = true`, reset streak to 0, clear idle timer. Tool results are evidence of real work. |

### Session-start: check for stale state

| Field | Value |
|-------|-------|
| Location | `runtime.ts:session_start` |
| Trigger | Every session start |
| Action | If a compaction left unresolved work, schedule compaction recovery. Also run `analyzeLatestAssistantStall` on the branch to detect stalls carried over from a prior session. |

## Compaction Recovery

| Field | Value |
|-------|-------|
| Location | `analysis.ts:analyzeCompactionRecovery` |
| Trigger | After a context-overflow or Ralph-prompt compaction |
| Decision | Recovery fires for: (a) overflow compactions — always nudge, the compaction interrupted real work; (b) Ralph compactions where the most recent Ralph prompt lacks a `ralph_done` response and the last assistant turn looks stalled |
| Suppressed | Recovery suppressed when: no active Ralph loop, Ralph already advanced, or latest assistant didn't request continuation |
