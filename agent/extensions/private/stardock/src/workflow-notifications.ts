/** Workflow-status transition notifications for Stardock. */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { LoopState } from "./state/core.ts";
import { evaluateWorkflowStatus, type WorkflowStatus } from "./workflow-status.ts";

export interface WorkflowNotificationTracker {
	seen: Map<string, string>;
}

function reasonKey(status: WorkflowStatus): string {
	return status.reasons.slice(0, 3).join("|");
}

function statusKey(status: WorkflowStatus): string {
	return `${status.state}:${status.severity}:${reasonKey(status)}`;
}

function shouldNotify(status: WorkflowStatus, previousKey: string | undefined): boolean {
	const actionable = status.severity !== "info" || status.state === "ready_for_final_verification" || status.state === "ready_to_complete";
	return actionable && previousKey !== undefined && previousKey !== statusKey(status);
}

export function notifyWorkflowTransition(ctx: ExtensionContext, state: LoopState, tracker: WorkflowNotificationTracker): void {
	if (!ctx.hasUI) return;
	const status = evaluateWorkflowStatus(state);
	const key = statusKey(status);
	const previousKey = tracker.seen.get(state.name);
	tracker.seen.set(state.name, key);
	if (!shouldNotify(status, previousKey)) return;
	const reason = status.reasons[0] ? ` — ${status.reasons[0]}` : "";
	ctx.ui.notify(`stardock ${state.name}: ${status.state}${reason}`, status.severity === "blocked" || status.severity === "warning" ? "warning" : "info");
}
