/**
 * Stardock state and run view formatting slice.
 */

import * as path from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { currentBrief } from "./briefs.ts";
import { criterionCounts, formatCriterionCounts } from "./ledger.ts";
import { latestGovernorDecision, pendingOutsideRequests } from "./outside-requests.ts";
import { type LoopState, type OutsideRequest, STATUS_ICONS, existingStatePath } from "./state.ts";

export function formatLoop(l: LoopState): string {
	const status = `${STATUS_ICONS[l.status]} ${l.status}`;
	const iter = l.maxIterations > 0 ? `${l.iteration}/${l.maxIterations}` : `${l.iteration}`;
	return `${l.name}: ${status} (iteration ${iter})`;
}

export function summarizeLoopState(ctx: ExtensionContext, state: LoopState, archived = false, includeDetails = false): Record<string, unknown> {
	const attempts = state.modeState.kind === "recursive" ? state.modeState.attempts : [];
	const outsideRequests = state.outsideRequests;
	const pendingRequests = pendingOutsideRequests(state);
	const latestAttempt = attempts.at(-1);
	const activeBrief = currentBrief(state);
	const criteria = criterionCounts(state.criterionLedger);
	const latestFinalReport = state.finalVerificationReports.at(-1);
	const artifactsByKind = state.verificationArtifacts.reduce<Record<string, number>>((counts, artifact) => {
		counts[artifact.kind] = (counts[artifact.kind] ?? 0) + 1;
		return counts;
	}, {});
	return {
		name: state.name,
		mode: state.mode,
		status: state.status,
		active: state.active,
		iteration: state.iteration,
		maxIterations: state.maxIterations,
		taskFile: state.taskFile,
		stateFile: path.relative(ctx.cwd, existingStatePath(ctx, state.name, archived)),
		startedAt: state.startedAt,
		completedAt: state.completedAt,
		recursive:
			state.modeState.kind === "recursive"
				? {
						objective: state.modeState.objective,
						attempts: attempts.length,
						reportedAttempts: attempts.filter((attempt) => attempt.status === "reported").length,
						latestAttempt: latestAttempt
							? {
									id: latestAttempt.id,
									iteration: latestAttempt.iteration,
									status: latestAttempt.status,
									kind: latestAttempt.kind,
									result: latestAttempt.result,
									summary: latestAttempt.summary,
								}
							: undefined,
					}
				: undefined,
		outsideRequests: {
			total: outsideRequests.length,
			pending: pendingRequests.length,
			answered: outsideRequests.filter((request) => request.status === "answered").length,
			latestGovernorDecision: latestGovernorDecision(state),
		},
		criteria: {
			...criteria,
			requirementTrace: state.criterionLedger.requirementTrace.length,
		},
		verificationArtifacts: {
			total: state.verificationArtifacts.length,
			byKind: artifactsByKind,
		},
		finalVerificationReports: {
			total: state.finalVerificationReports.length,
			latest: latestFinalReport
				? {
						id: latestFinalReport.id,
						status: latestFinalReport.status,
						summary: latestFinalReport.summary,
						criterionIds: latestFinalReport.criterionIds,
						artifactIds: latestFinalReport.artifactIds,
						unresolvedGaps: latestFinalReport.unresolvedGaps.length,
					}
				: undefined,
		},
		auditorReviews: state.auditorReviews,
		advisoryHandoffs: state.advisoryHandoffs,
		breakoutPackages: state.breakoutPackages,
		workerReports: state.workerReports,
		briefs: {
			total: state.briefs.length,
			currentBriefId: state.currentBriefId,
			current: activeBrief
				? {
						id: activeBrief.id,
						status: activeBrief.status,
						source: activeBrief.source,
						requestId: activeBrief.requestId,
						objective: activeBrief.objective,
						task: activeBrief.task,
						criterionIds: activeBrief.criterionIds,
					}
				: undefined,
		},
		...(includeDetails
			? { modeState: state.modeState, requests: state.outsideRequests, criterionLedger: state.criterionLedger, artifacts: state.verificationArtifacts, briefList: state.briefs, finalVerificationReportList: state.finalVerificationReports }
			: {}),
	};
}

export function formatStateSummary(state: LoopState): string {
	const attempts = state.modeState.kind === "recursive" ? state.modeState.attempts : [];
	const reported = attempts.filter((attempt) => attempt.status === "reported").length;
	const requestText = state.outsideRequests.length > 0 ? `, outside ${pendingOutsideRequests(state).length}/${state.outsideRequests.length} pending` : "";
	const attemptText = attempts.length > 0 ? `, attempts ${reported}/${attempts.length} reported` : "";
	const criteriaText = state.criterionLedger.criteria.length > 0 ? `, criteria ${criterionCounts(state.criterionLedger).passed}/${state.criterionLedger.criteria.length} passed` : "";
	const artifactsText = state.verificationArtifacts.length > 0 ? `, artifacts ${state.verificationArtifacts.length}` : "";
	const reportsText = state.finalVerificationReports.length > 0 ? `, final reports ${state.finalVerificationReports.length}` : "";
	const handoffText = state.advisoryHandoffs.length > 0 ? `, handoffs ${state.advisoryHandoffs.length}` : "";
	const breakoutText = state.breakoutPackages.length > 0 ? `, breakouts ${state.breakoutPackages.length}` : "";
	const workerText = state.workerReports.length > 0 ? `, worker reports ${state.workerReports.length}` : "";
	const briefText = state.currentBriefId ? `, brief ${state.currentBriefId}` : "";
	return `${formatLoop(state)}${attemptText}${requestText}${criteriaText}${artifactsText}${reportsText}${handoffText}${breakoutText}${workerText}${briefText}`;
}

function compactViewText(value: string | undefined, maxLength = 160): string | undefined {
	if (!value) return undefined;
	const compact = value.replace(/\s+/g, " ").trim();
	return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact;
}

function formatRequestTitle(request: OutsideRequest): string {
	const decision = request.decision ? ` · ${request.decision.verdict}` : "";
	return `${request.kind} ${request.id} · ${request.status}${decision}`;
}

export function formatRunTimeline(state: LoopState): string {
	type TimelineItem = { time: number; order: number; lines: string[] };
	const items: TimelineItem[] = [
		{
			time: Date.parse(state.startedAt) || 0,
			order: 0,
			lines: [`Start · ${state.startedAt}`, `  Mode: ${state.mode}`],
		},
	];

	if (state.modeState.kind === "recursive") {
		for (const attempt of state.modeState.attempts) {
			const result = attempt.result ? ` · ${attempt.result}` : "";
			const kind = attempt.kind ? ` · ${attempt.kind}` : "";
			const summary = compactViewText(attempt.summary || attempt.hypothesis || attempt.actionSummary);
			items.push({
				time: Date.parse(attempt.updatedAt ?? attempt.createdAt) || 0,
				order: attempt.iteration * 10 + 1,
				lines: [`Attempt ${attempt.iteration} · ${attempt.status}${kind}${result}`, summary ? `  ${summary}` : "  No summary recorded."],
			});
		}
	}

	for (const request of state.outsideRequests) {
		const nextMove = compactViewText(request.decision?.requiredNextMove);
		const answer = compactViewText(request.answer);
		items.push({
			time: Date.parse(request.consumedAt ?? request.requestedAt) || 0,
			order: request.requestedByIteration * 10 + 2,
			lines: [
				`Request ${request.requestedByIteration} · ${formatRequestTitle(request)}`,
				nextMove ? `  Next: ${nextMove}` : answer ? `  Answer: ${answer}` : `  Trigger: ${request.trigger}`,
			],
		});
	}

	if (state.completedAt) {
		items.push({
			time: Date.parse(state.completedAt) || Number.MAX_SAFE_INTEGER,
			order: Number.MAX_SAFE_INTEGER,
			lines: [`Complete · ${state.completedAt}`, `  Final status: ${state.status}`],
		});
	}

	const lines = [`Timeline: ${state.name}`];
	items
		.sort((a, b) => a.time - b.time || a.order - b.order)
		.forEach((item, index) => {
			lines.push(`${index + 1}. ${item.lines[0]}`);
			lines.push(...item.lines.slice(1));
		});
	return lines.join("\n");
}

export function formatRunOverview(ctx: ExtensionContext, state: LoopState, archived = false): string {
	const attempts = state.modeState.kind === "recursive" ? state.modeState.attempts : [];
	const reported = attempts.filter((attempt) => attempt.status === "reported").length;
	const pending = pendingOutsideRequests(state).length;
	const latestDecision = latestGovernorDecision(state);
	const activeBrief = currentBrief(state);
	const lines = [
		`Stardock run: ${state.name}`,
		`Status: ${STATUS_ICONS[state.status]} ${state.status} · ${state.mode} · iteration ${state.iteration}${state.maxIterations > 0 ? `/${state.maxIterations}` : ""}`,
		`Task: ${state.taskFile}`,
		`State: ${path.relative(ctx.cwd, existingStatePath(ctx, state.name, archived))}`,
	];

	if (state.modeState.kind === "recursive") {
		lines.push("", "Objective", `  ${state.modeState.objective}`);
		if (state.modeState.baseline) lines.push(`  Baseline: ${state.modeState.baseline}`);
		if (state.modeState.validationCommand) lines.push(`  Validation: ${state.modeState.validationCommand}`);
	}

	lines.push("", "Progress", `  Attempts: ${reported}/${attempts.length} reported`, `  Outside requests: ${pending}/${state.outsideRequests.length} pending`);
	lines.push(`  ${formatCriterionCounts(state.criterionLedger)}`, `  Verification artifacts: ${state.verificationArtifacts.length}`, `  Final reports: ${state.finalVerificationReports.length}`, `  Auditor reviews: ${state.auditorReviews.length}`, `  Advisory handoffs: ${state.advisoryHandoffs.length}`, `  Breakout packages: ${state.breakoutPackages.length}`, `  Worker reports: ${state.workerReports.length}`, `  Briefs: ${state.briefs.length}${activeBrief ? ` (current ${activeBrief.id})` : ""}`);
	if (activeBrief) {
		lines.push("", "Active brief", `  ${activeBrief.id}: ${compactViewText(activeBrief.objective, 180)}`, `  Task: ${compactViewText(activeBrief.task, 180)}`);
		if (activeBrief.criterionIds.length) lines.push(`  Criteria: ${activeBrief.criterionIds.join(", ")}`);
	}
	if (latestDecision) {
		lines.push("", "Latest governor decision", `  Verdict: ${latestDecision.verdict}`, `  Rationale: ${compactViewText(latestDecision.rationale, 220) ?? "none"}`);
		if (latestDecision.requiredNextMove) lines.push(`  Required next move: ${latestDecision.requiredNextMove}`);
	}
	lines.push("", formatRunTimeline(state));
	return lines.join("\n");
}
