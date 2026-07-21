import { compactText, type GovernorDecision, type IterationBrief, type LoopState } from "./state/core.ts";

const RECENT_ITEM_LIMIT = 5;
const CURRENT_ROUTING_ITEM_LIMIT = 10;
const ID_LIMIT = 20;

function countsBy<T>(items: T[], select: (item: T) => string): Record<string, number> {
	return items.reduce<Record<string, number>>((counts, item) => {
		const key = select(item);
		counts[key] = (counts[key] ?? 0) + 1;
		return counts;
	}, {});
}

function recentStrings(items: string[], limit = RECENT_ITEM_LIMIT): { total: number; recent: string[]; truncated: boolean } {
	return {
		total: items.length,
		recent: items.slice(-limit).map((item) => compactText(item, 500) ?? item),
		truncated: items.length > limit,
	};
}

function currentStrings(items: string[]): { total: number; items: string[]; truncated: boolean; requiresFullInspection: boolean } {
	const truncated = items.length > CURRENT_ROUTING_ITEM_LIMIT;
	return {
		total: items.length,
		items: items.slice(0, CURRENT_ROUTING_ITEM_LIMIT).map((item) => compactText(item, 500) ?? item),
		truncated,
		requiresFullInspection: truncated,
	};
}

function cappedIds(items: string[]): { total: number; items: string[]; truncated: boolean } {
	return { total: items.length, items: items.slice(0, ID_LIMIT), truncated: items.length > ID_LIMIT };
}

function cappedStrings(items: string[], limit = 5, maxLength = 500): { total: number; items: string[]; truncated: boolean } {
	return {
		total: items.length,
		items: items.slice(0, limit).map((item) => compactText(item, maxLength) ?? item),
		truncated: items.length > limit,
	};
}

function changedFilePreview(items: LoopState["workerRuns"][number]["changedFiles"]): Record<string, unknown> {
	return {
		total: items.length,
		items: items.slice(0, 5).map((item) => ({
			path: item.path,
			summary: compactText(item.summary, 240) ?? item.summary,
			reviewReason: compactText(item.reviewReason, 240),
		})),
		truncated: items.length > 5,
	};
}

function latestByTimestamp<T extends { updatedAt?: string; createdAt?: string }>(items: T[]): T | undefined {
	return items.reduce<T | undefined>((latest, item) => {
		if (!latest) return item;
		const itemTimestamp = item.updatedAt ?? item.createdAt ?? "";
		const latestTimestamp = latest.updatedAt ?? latest.createdAt ?? "";
		return itemTimestamp >= latestTimestamp ? item : latest;
	}, undefined);
}

export function governorMemoryRequiresFullInspection(state: LoopState): boolean {
	return [
		state.governorState.activeConstraints,
		state.governorState.knownRisks,
		state.governorState.openQuestions,
		state.governorState.evidenceGaps,
		state.governorState.nextContextHints,
	].some((items) => items.length > CURRENT_ROUTING_ITEM_LIMIT);
}

export function governorDecisionRequiresFullInspection(decision?: GovernorDecision): boolean {
	return [decision?.forbiddenNextMoves ?? [], decision?.evidenceGaps ?? []].some((items) => items.length > CURRENT_ROUTING_ITEM_LIMIT);
}

export function governorRoutingRequiresFullInspection(state: LoopState, decision?: GovernorDecision): boolean {
	return governorMemoryRequiresFullInspection(state) || governorDecisionRequiresFullInspection(decision);
}

export function summarizeGovernorDecision(decision: GovernorDecision | undefined): Record<string, unknown> | undefined {
	if (!decision) return undefined;
	const forbiddenNextMoves = currentStrings(decision.forbiddenNextMoves ?? []);
	const evidenceGaps = currentStrings(decision.evidenceGaps ?? []);
	return {
		verdict: decision.verdict,
		rationale: compactText(decision.rationale, 500) ?? decision.rationale,
		requiredNextMove: compactText(decision.requiredNextMove, 500),
		forbiddenNextMoves,
		evidenceGaps,
		requiresFullInspection: forbiddenNextMoves.truncated || evidenceGaps.truncated,
	};
}

export function summarizeGovernorMemory(state: LoopState): Record<string, unknown> {
	const memory = state.governorState;
	const activeConstraints = currentStrings(memory.activeConstraints);
	const knownRisks = currentStrings(memory.knownRisks);
	const openQuestions = currentStrings(memory.openQuestions);
	const evidenceGaps = currentStrings(memory.evidenceGaps);
	const nextContextHints = currentStrings(memory.nextContextHints);
	return {
		objective: compactText(memory.objective, 500),
		currentStrategy: compactText(memory.currentStrategy, 500),
		completedMilestones: recentStrings(memory.completedMilestones),
		activeConstraints,
		knownRisks,
		openQuestions,
		evidenceGaps,
		nextContextHints,
		requiresFullInspection: [activeConstraints, knownRisks, openQuestions, evidenceGaps, nextContextHints].some((item) => item.truncated),
		rejectedPaths: {
			total: memory.rejectedPaths.length,
			recent: memory.rejectedPaths.slice(-RECENT_ITEM_LIMIT).map((item) => ({
				summary: compactText(item.summary, 500) ?? item.summary,
				reason: compactText(item.reason, 500) ?? item.reason,
			})),
		},
	};
}

export function summarizeFinalVerificationReports(state: LoopState): Record<string, unknown> {
	const latest = latestByTimestamp(state.finalVerificationReports);
	return {
		total: state.finalVerificationReports.length,
		byStatus: countsBy(state.finalVerificationReports, (report) => report.status),
		latest: latest
			? {
					id: latest.id,
					status: latest.status,
					summary: compactText(latest.summary, 500) ?? latest.summary,
					criterionIds: cappedIds(latest.criterionIds),
					artifactIds: cappedIds(latest.artifactIds),
					unresolvedGaps: latest.unresolvedGaps.length,
					updatedAt: latest.updatedAt,
				}
			: undefined,
	};
}

export function summarizeAuditorReviews(state: LoopState): Record<string, unknown> {
	const latest = latestByTimestamp(state.auditorReviews);
	return {
		total: state.auditorReviews.length,
		byStatus: countsBy(state.auditorReviews, (review) => review.status),
		latest: latest
			? {
					id: latest.id,
					status: latest.status,
					summary: compactText(latest.summary, 500) ?? latest.summary,
					concerns: latest.concerns.length,
					requiredFollowups: latest.requiredFollowups.length,
					updatedAt: latest.updatedAt,
				}
			: undefined,
	};
}

export function summarizeAdvisoryHandoffs(state: LoopState): Record<string, unknown> {
	const latest = latestByTimestamp(state.advisoryHandoffs);
	return {
		total: state.advisoryHandoffs.length,
		byStatus: countsBy(state.advisoryHandoffs, (handoff) => handoff.status),
		byRole: countsBy(state.advisoryHandoffs, (handoff) => handoff.role),
		latest: latest
			? {
					id: latest.id,
					status: latest.status,
					role: latest.role,
					objective: compactText(latest.objective, 500) ?? latest.objective,
					updatedAt: latest.updatedAt,
				}
			: undefined,
	};
}

export function summarizeBreakoutPackages(state: LoopState): Record<string, unknown> {
	const latest = latestByTimestamp(state.breakoutPackages);
	return {
		total: state.breakoutPackages.length,
		byStatus: countsBy(state.breakoutPackages, (item) => item.status),
		latest: latest
			? {
					id: latest.id,
					status: latest.status,
					summary: compactText(latest.summary, 500) ?? latest.summary,
					blockedCriterionIds: cappedIds(latest.blockedCriterionIds),
					updatedAt: latest.updatedAt,
				}
			: undefined,
	};
}

export function summarizeWorkerReports(state: LoopState): Record<string, unknown> {
	const latest = latestByTimestamp(state.workerReports);
	return {
		total: state.workerReports.length,
		byStatus: countsBy(state.workerReports, (report) => report.status),
		byRole: countsBy(state.workerReports, (report) => report.role),
		latest: latest
			? {
					id: latest.id,
					status: latest.status,
					role: latest.role,
					summary: compactText(latest.summary, 500) ?? latest.summary,
					changedFiles: changedFilePreview(latest.changedFiles),
					validation: {
						total: latest.validation.length,
						items: latest.validation.slice(0, 5).map((item) => ({
							command: compactText(item.command, 240),
							result: item.result,
							summary: compactText(item.summary, 240) ?? item.summary,
						})),
						truncated: latest.validation.length > 5,
					},
					risks: cappedStrings(latest.risks),
					openQuestions: cappedStrings(latest.openQuestions),
					reviewHints: cappedStrings(latest.reviewHints, 5, 240),
					suggestedNextMove: compactText(latest.suggestedNextMove, 500),
					updatedAt: latest.updatedAt,
				}
			: undefined,
	};
}

export function summarizeWorkerRuns(state: LoopState): Record<string, unknown> {
	const latest = latestByTimestamp(state.workerRuns);
	return {
		total: state.workerRuns.length,
		byStatus: countsBy(state.workerRuns, (run) => run.status),
		byRole: countsBy(state.workerRuns, (run) => run.role),
		latest: latest
			? {
					id: latest.id,
					status: latest.status,
					role: latest.role,
					scope: latest.scope,
					briefId: latest.briefId,
					outsideRequestId: latest.outsideRequestId,
					reportId: latest.reportId,
					summary: compactText(latest.summary, 500),
					changedFiles: changedFilePreview(latest.changedFiles),
					outputRefs: cappedStrings(latest.outputRefs, 4, 500),
					startedAt: latest.startedAt,
					completedAt: latest.completedAt,
				}
			: undefined,
	};
}

export function summarizeBrief(brief: IterationBrief | undefined): Record<string, unknown> | undefined {
	if (!brief) return undefined;
	return {
		id: brief.id,
		status: brief.status,
		source: brief.source,
		requestId: brief.requestId,
		objective: compactText(brief.objective, 500) ?? brief.objective,
		task: compactText(brief.task, 1000) ?? brief.task,
		criterionIds: cappedIds(brief.criterionIds),
		updatedAt: brief.updatedAt,
	};
}
