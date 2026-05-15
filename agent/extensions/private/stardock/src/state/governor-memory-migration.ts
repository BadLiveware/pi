/** Migration helpers for durable Stardock governor memory. */

import { compactText, type GovernorState, type RejectedPath } from "./core.ts";

function normalizeStringList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const items = value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
	return [...new Set(items)];
}

function normalizeOptionalText(value: unknown, maxLength = 500): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed ? compactText(trimmed, maxLength) ?? trimmed : undefined;
}

export function defaultGovernorState(): GovernorState {
	return { completedMilestones: [], activeConstraints: [], knownRisks: [], openQuestions: [], evidenceGaps: [], rejectedPaths: [], nextContextHints: [], updatedAt: new Date().toISOString() };
}

function migrateRejectedPaths(value: unknown): RejectedPath[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((item): RejectedPath | null => {
			if (!item || typeof item !== "object") return null;
			const raw = item as Record<string, unknown>;
			const summary = normalizeOptionalText(raw.summary, 240);
			const reason = normalizeOptionalText(raw.reason, 240);
			return summary && reason ? { summary, reason } : null;
		})
		.filter((item): item is RejectedPath => item !== null);
}

function compactList(value: unknown): string[] {
	return normalizeStringList(value).map((item) => compactText(item, 240) ?? item);
}

export function migrateGovernorState(value: unknown): GovernorState {
	const fallback = defaultGovernorState();
	if (!value || typeof value !== "object") return fallback;
	const raw = value as Partial<GovernorState> & Record<string, unknown>;
	return {
		objective: normalizeOptionalText(raw.objective, 500),
		currentStrategy: normalizeOptionalText(raw.currentStrategy, 500),
		completedMilestones: compactList(raw.completedMilestones),
		activeConstraints: compactList(raw.activeConstraints),
		knownRisks: compactList(raw.knownRisks),
		openQuestions: compactList(raw.openQuestions),
		evidenceGaps: compactList(raw.evidenceGaps),
		rejectedPaths: migrateRejectedPaths(raw.rejectedPaths),
		nextContextHints: compactList(raw.nextContextHints),
		updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : fallback.updatedAt,
	};
}
