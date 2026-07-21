/**
 * Stardock state and run view formatting slice.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as path from "node:path";
import { currentBrief } from "./briefs.ts";
import { formatChecklistLedgerDrift, loadChecklistLedgerDrift } from "./checklist-drift.ts";
import {
	governorDecisionRequiresFullInspection,
	governorMemoryRequiresFullInspection,
	summarizeAdvisoryHandoffs,
	summarizeAuditorReviews,
	summarizeBreakoutPackages,
	summarizeBrief,
	summarizeFinalVerificationReports,
	summarizeGovernorDecision,
	summarizeGovernorMemory,
	summarizeWorkerReports,
	summarizeWorkerRuns,
} from "./compact-loop-summary.ts";
import { formatGovernorState, hasGovernorMemory } from "./governor-state.ts";
import { criterionCounts, formatCriterionCounts } from "./ledger.ts";
import { latestGovernorDecision, pendingOutsideRequests } from "./outside-requests.ts";
import { compactText, type LoopState, type OutsideRequest, STATUS_ICONS } from "./state/core.ts";
import { summarizeExecutionGraph } from "./stages/graph.ts";
import { existingStatePath } from "./state/paths.ts";
import { evaluateWorkflowStatus, formatWorkflowStatus } from "./workflow-status.ts";

export function formatLoop(l: LoopState): string {
	const status = `${STATUS_ICONS[l.status]} ${l.status}`;
	const iter = l.maxIterations > 0 ? `${l.iteration}/${l.maxIterations}` : `${l.iteration}`;
	return `${l.name}: ${status} (iteration ${iter})`;
}

export function governorRoutingInspection(state: LoopState, decision = latestGovernorDecision(state)): Record<string, unknown> & { requiresFullInspection: boolean; message?: string } {
	const memoryRequiresFullInspection = governorMemoryRequiresFullInspection(state);
	const latestDecisionRequiresFullInspection = governorDecisionRequiresFullInspection(decision);
	const latestDecisionRequest = [...state.outsideRequests].reverse().find((request) => request.kind === "governor_review" && request.decision);
	const actions: Array<{ tool: string; args: Record<string, unknown>; reason: string }> = [];
	if (memoryRequiresFullInspection) {
		actions.push({ tool: "stardock_governor_state", args: { action: "list", loopName: state.name }, reason: "Inspect full durable governor memory." });
	}
	if (latestDecisionRequiresFullInspection) {
		actions.push({
			tool: "stardock_outside_requests",
			args: { loopName: state.name, requestId: latestDecisionRequest?.id },
			reason: "Inspect the full latest governor decision.",
		});
	}
	const requiresFullInspection = actions.length > 0;
	const actionText = actions.map((action) => `${action.tool}(${JSON.stringify(action.args)})`).join(" and ");
	return {
		requiresFullInspection,
		memoryRequiresFullInspection,
		latestDecisionRequiresFullInspection,
		latestDecisionRequestId: latestDecisionRequest?.id,
		actions,
		message: requiresFullInspection ? `Governor memory: FULL INSPECTION REQUIRED before choosing the next move. Run ${actionText}.` : undefined,
	};
}

export function summarizeLoopState(ctx: ExtensionContext, state: LoopState, archived = false, includeDetails = false): Record<string, unknown> {
	const attempts = state.modeState.kind === "recursive" ? state.modeState.attempts : [];
	const outsideRequests = state.outsideRequests;
	const pendingRequests = pendingOutsideRequests(state);
	const latestAttempt = attempts.at(-1);
	const activeBrief = currentBrief(state);
	const criteria = criterionCounts(state.criterionLedger);
	const latestDecision = latestGovernorDecision(state);
	const governorRouting = governorRoutingInspection(state, latestDecision);
	const checklistDrift = loadChecklistLedgerDrift(ctx, state);
	const workflowStatus = evaluateWorkflowStatus(state);
	let executionGraph: ReturnType<typeof summarizeExecutionGraph> | undefined;
	if (state.executionGraph) executionGraph = summarizeExecutionGraph(state.executionGraph);
	const artifactsByKind = state.verificationArtifacts.reduce<Record<string, number>>((counts, artifact) => {
		counts[artifact.kind] = (counts[artifact.kind] ?? 0) + 1;
		return counts;
	}, {});
	return {
		name: state.name,
		mode: state.mode,
		status: state.status,
		workflowStatus,
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
						objective: compactText(state.modeState.objective, 500) ?? state.modeState.objective,
						attempts: attempts.length,
						reportedAttempts: attempts.filter((attempt) => attempt.status === "reported").length,
						latestAttempt: latestAttempt
							? {
									id: latestAttempt.id,
									iteration: latestAttempt.iteration,
									status: latestAttempt.status,
									kind: latestAttempt.kind,
									result: latestAttempt.result,
									summary: compactText(latestAttempt.summary, 500),
								}
							: undefined,
					}
				: undefined,
		governorState: summarizeGovernorMemory(state),
		governorRouting,
		outsideRequests: {
			total: outsideRequests.length,
			pending: pendingRequests.length,
			answered: outsideRequests.filter((request) => request.status === "answered").length,
			latestGovernorDecision: summarizeGovernorDecision(latestDecision),
		},
		criteria: {
			...criteria,
			requirementTrace: state.criterionLedger.requirementTrace.length,
		},
		verificationArtifacts: {
			total: state.verificationArtifacts.length,
			byKind: artifactsByKind,
		},
		baselineValidations: {
			total: state.baselineValidations.length,
			passed: state.baselineValidations.filter((baseline) => baseline.result === "passed").length,
			failed: state.baselineValidations.filter((baseline) => baseline.result === "failed").length,
			skipped: state.baselineValidations.filter((baseline) => baseline.result === "skipped").length,
		},
		finalVerificationReports: summarizeFinalVerificationReports(state),
		auditorReviews: summarizeAuditorReviews(state),
		advisoryHandoffs: summarizeAdvisoryHandoffs(state),
		breakoutPackages: summarizeBreakoutPackages(state),
		workerReports: summarizeWorkerReports(state),
		workerRuns: summarizeWorkerRuns(state),
		executionGraph,
		checklistLedgerDrift: {
			total: checklistDrift.length,
			items: includeDetails ? checklistDrift : checklistDrift.slice(0, 5),
		},
		briefs: {
			total: state.briefs.length,
			currentBriefId: state.currentBriefId,
			current: summarizeBrief(activeBrief),
		},
		...(includeDetails
			? {
					modeState: state.modeState,
					governorStateDetails: state.governorState,
					requests: state.outsideRequests,
					criterionLedger: state.criterionLedger,
					artifacts: state.verificationArtifacts,
					baselineValidationList: state.baselineValidations,
					briefList: state.briefs,
					finalVerificationReportList: state.finalVerificationReports,
					auditorReviewList: state.auditorReviews,
					advisoryHandoffList: state.advisoryHandoffs,
					breakoutPackageList: state.breakoutPackages,
					workerReportList: state.workerReports,
					workerRunList: state.workerRuns,
				}
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
	const baselineText = state.baselineValidations.length > 0 ? `, baselines ${state.baselineValidations.length}` : "";
	const reportsText = state.finalVerificationReports.length > 0 ? `, final reports ${state.finalVerificationReports.length}` : "";
	const handoffText = state.advisoryHandoffs.length > 0 ? `, handoffs ${state.advisoryHandoffs.length}` : "";
	const breakoutText = state.breakoutPackages.length > 0 ? `, breakouts ${state.breakoutPackages.length}` : "";
	const workerText = state.workerReports.length > 0 ? `, worker reports ${state.workerReports.length}` : "";
	const briefText = state.currentBriefId ? `, brief ${state.currentBriefId}` : "";
	const workflow = evaluateWorkflowStatus(state);
	return `${formatLoop(state)} [${workflow.state}]${attemptText}${requestText}${criteriaText}${artifactsText}${baselineText}${reportsText}${handoffText}${breakoutText}${workerText}${briefText}`;
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

	for (const run of state.workerRuns) {
		items.push({
			time: Date.parse(run.completedAt ?? run.startedAt) || 0,
			order: state.iteration * 10 + 3,
			lines: [
				`WorkerRun ${run.id} · ${run.status}/${run.role}`,
				run.summary ? `  ${compactViewText(run.summary, 180)}` : `  ${run.briefId ? `Brief: ${run.briefId}` : run.outsideRequestId ? `Request: ${run.outsideRequestId}` : `Scope: ${run.scope ?? "loop"}`}`,
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
		formatWorkflowStatus(evaluateWorkflowStatus(state)),
		`Task: ${state.taskFile}`,
		`State: ${path.relative(ctx.cwd, existingStatePath(ctx, state.name, archived))}`,
	];

	if (state.modeState.kind === "recursive") {
		lines.push("", "Objective", `  ${state.modeState.objective}`);
		if (state.modeState.baseline) lines.push(`  Baseline: ${state.modeState.baseline}`);
		if (state.modeState.validationCommand) lines.push(`  Validation: ${state.modeState.validationCommand}`);
	}

	lines.push("", "Progress", `  Attempts: ${reported}/${attempts.length} reported`, `  Outside requests: ${pending}/${state.outsideRequests.length} pending`);
	lines.push(`  ${formatCriterionCounts(state.criterionLedger)}`, `  Verification artifacts: ${state.verificationArtifacts.length}`, `  Final reports: ${state.finalVerificationReports.length}`, `  Auditor reviews: ${state.auditorReviews.length}`, `  Advisory handoffs: ${state.advisoryHandoffs.length}`, `  Breakout packages: ${state.breakoutPackages.length}`, `  Worker reports: ${state.workerReports.length}`, `  Worker runs: ${state.workerRuns.length}`, `  Briefs: ${state.briefs.length}${activeBrief ? ` (current ${activeBrief.id})` : ""}`);
	const checklistDrift = loadChecklistLedgerDrift(ctx, state);
	if (checklistDrift.length) lines.push("", ...formatChecklistLedgerDrift(checklistDrift));
	if (activeBrief) {
		lines.push("", "Active brief", `  ${activeBrief.id}: ${compactViewText(activeBrief.objective, 180)}`, `  Task: ${compactViewText(activeBrief.task, 180)}`);
		if (activeBrief.criterionIds.length) lines.push(`  Criteria: ${activeBrief.criterionIds.join(", ")}`);
	}
	if (hasGovernorMemory(state)) lines.push("", formatGovernorState(state.governorState));
	if (latestDecision) {
		lines.push("", "Latest governor decision", `  Verdict: ${latestDecision.verdict}`, `  Rationale: ${compactViewText(latestDecision.rationale, 220) ?? "none"}`);
		if (latestDecision.requiredNextMove) lines.push(`  Required next move: ${latestDecision.requiredNextMove}`);
	}
	lines.push("", formatRunTimeline(state));
	return lines.join("\n");
}
