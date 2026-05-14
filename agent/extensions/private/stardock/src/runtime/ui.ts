/** Stardock active status/widget rendering. */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { latestGovernorDecision, pendingOutsideRequests } from "../outside-requests.ts";
import { compactText, STATUS_ICONS } from "../state/core.ts";
import { loadState } from "../state/store.ts";
import { evaluateWorkflowStatus } from "../workflow-status.ts";

export function updateStardockUI(ctx: ExtensionContext, currentLoop: string | null): void {
	if (!ctx.hasUI) return;

	const state = currentLoop ? loadState(ctx, currentLoop) : null;
	if (!state || state.status !== "active") {
		ctx.ui.setStatus("stardock", undefined);
		ctx.ui.setWidget("stardock", undefined);
		return;
	}

	const { theme } = ctx.ui;
	const maxStr = state.maxIterations > 0 ? `/${state.maxIterations}` : "";
	const attempts = state.modeState.kind === "recursive" ? state.modeState.attempts : [];
	const reportedAttempts = attempts.filter((attempt) => attempt.status === "reported").length;
	const latestAttempt = attempts.at(-1);
	const pendingRequests = pendingOutsideRequests(state).length;
	const latestDecision = latestGovernorDecision(state);
	const workflow = evaluateWorkflowStatus(state);

	ctx.ui.setStatus("stardock", theme.fg("accent", `🔄 ${state.name} · ${state.iteration}${maxStr} · ${workflow.state}`));

	const lines = [
		theme.fg("accent", theme.bold("Stardock")),
		theme.fg("muted", `Loop: ${state.name}`),
		theme.fg("dim", `${STATUS_ICONS[state.status]} ${state.status} · ${state.mode} · iteration ${state.iteration}${maxStr}`),
		theme.fg(workflow.severity === "blocked" || workflow.severity === "warning" ? "warning" : "dim", `Workflow: ${workflow.state}`),
	];
	if (workflow.severity !== "info") lines.push(theme.fg("warning", `Next: ${compactText(workflow.recommendedActions[0]?.label ?? workflow.summary, 88)}`));

	if (state.modeState.kind === "recursive") {
		lines.push(theme.fg("dim", `Objective: ${compactText(state.modeState.objective, 72)}`));
		lines.push(theme.fg("dim", `Attempts: ${reportedAttempts}/${attempts.length} reported`));
		if (latestAttempt) {
			const attemptKind = latestAttempt.kind ? ` · ${latestAttempt.kind}` : "";
			const attemptResult = latestAttempt.result ? ` · ${latestAttempt.result}` : "";
			lines.push(theme.fg("dim", `Last: #${latestAttempt.iteration}${attemptKind}${attemptResult}`));
		}
	}

	lines.push(theme.fg("dim", `Outside: ${pendingRequests}/${state.outsideRequests.length} pending`));
	if (latestDecision?.requiredNextMove) {
		lines.push(theme.fg("warning", `Governor: ${compactText(latestDecision.requiredNextMove, 88)}`));
	} else if (latestDecision?.verdict) {
		lines.push(theme.fg("dim", `Governor: ${latestDecision.verdict}`));
	}
	if (state.reflectEvery > 0) {
		const next = state.reflectEvery - ((state.iteration - 1) % state.reflectEvery);
		lines.push(theme.fg("dim", `Next reflection in: ${next} iterations`));
	}
	lines.push("");
	lines.push(theme.fg("warning", "ESC pauses · /stardock view for details · /stardock-stop ends"));
	ctx.ui.setWidget("stardock", lines);
}
