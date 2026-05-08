/**
 * Reserved evolve-mode state normalization.
 *
 * Evolve execution is not implemented. This slice only keeps future
 * candidate/archive/evaluator metadata bounded and inspectable if state exists.
 */

import {
	compactText,
	type EvolveCandidate,
	type EvolveCandidateArtifact,
	type EvolveCandidateArtifactKind,
	type EvolveCandidateStatus,
	EVOLVE_IMPLEMENTATION_GATES,
	type EvolveImplementationGate,
	type EvolveIsolation,
	type EvolveMetricGoal,
	type EvolveModeState,
	type EvolveMutationPolicy,
	type EvolveSetup,
} from "./core.ts";

export const DEFAULT_EVOLVE_ARCHIVE_SIZE = 20;
export const MAX_EVOLVE_ARCHIVE_SIZE = 50;
export const DEFAULT_EVOLVE_CANDIDATE_BUDGET = 20;
export const MAX_EVOLVE_CANDIDATE_BUDGET = 200;
export const DEFAULT_EVOLVE_TIMEOUT_MS = 60_000;
export const MAX_EVOLVE_TIMEOUT_MS = 600_000;
export const DEFAULT_EVOLVE_OUTPUT_BYTES = 100_000;
export const MAX_EVOLVE_OUTPUT_BYTES = 1_000_000;
export const DEFAULT_EVOLVE_PROMPT_CANDIDATES = 5;
export const MAX_EVOLVE_PROMPT_CANDIDATES = 20;

export function defaultEvolveModeState(): EvolveModeState {
	return {
		kind: "evolve",
		candidates: [],
		archive: [],
		consecutiveNonImproving: 0,
		implementationGates: [...EVOLVE_IMPLEMENTATION_GATES],
	};
}

function numberOrDefault(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeStringList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const items = value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
	return [...new Set(items)];
}

function normalizeId(value: unknown, fallback: string): string {
	const raw = typeof value === "string" ? value.trim() : "";
	const normalized = raw.replace(/[^a-zA-Z0-9_.:-]/g, "_").replace(/_+/g, "_");
	return normalized || fallback;
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
	const number = numberOrDefault(value, fallback);
	return Math.min(max, Math.max(min, number));
}

function isEvolveMetricGoal(value: unknown): value is EvolveMetricGoal {
	return value === "minimize" || value === "maximize";
}

function isEvolveMutationPolicy(value: unknown): value is EvolveMutationPolicy {
	return value === "small_diff" || value === "rewrite_candidate";
}

function isEvolveIsolation(value: unknown): value is EvolveIsolation {
	return value === "advisory_patch" || value === "worktree";
}

function isEvolveCandidateStatus(value: unknown): value is EvolveCandidateStatus {
	return value === "accepted" || value === "rejected" || value === "invalid" || value === "best";
}

function isEvolveCandidateArtifactKind(value: unknown): value is EvolveCandidateArtifactKind {
	return value === "benchmark" || value === "test" || value === "smoke";
}

function migrateEvolveSetup(value: unknown): EvolveSetup | undefined {
	if (!value || typeof value !== "object") return undefined;
	const raw = value as Partial<EvolveSetup> & Record<string, unknown>;
	const evaluatorCommand = typeof raw.evaluatorCommand === "string" ? raw.evaluatorCommand.trim() : "";
	const primaryMetric = typeof raw.primaryMetric === "string" ? raw.primaryMetric.trim() : "";
	if (!evaluatorCommand || !primaryMetric) return undefined;
	const patience = boundedNumber(raw.patience, 0, 0, MAX_EVOLVE_CANDIDATE_BUDGET);
	return {
		seedFiles: normalizeStringList(raw.seedFiles).map((file) => compactText(file, 240) ?? file).slice(0, 40),
		evaluatorCommand: compactText(evaluatorCommand, 500) ?? evaluatorCommand,
		primaryMetric: compactText(primaryMetric, 120) ?? primaryMetric,
		metricGoal: isEvolveMetricGoal(raw.metricGoal) ? raw.metricGoal : "maximize",
		archiveSize: boundedNumber(raw.archiveSize, DEFAULT_EVOLVE_ARCHIVE_SIZE, 1, MAX_EVOLVE_ARCHIVE_SIZE),
		candidateBudget: boundedNumber(raw.candidateBudget, DEFAULT_EVOLVE_CANDIDATE_BUDGET, 1, MAX_EVOLVE_CANDIDATE_BUDGET),
		patience: patience > 0 ? patience : undefined,
		mutationPolicy: isEvolveMutationPolicy(raw.mutationPolicy) ? raw.mutationPolicy : "small_diff",
		timeoutMs: boundedNumber(raw.timeoutMs, DEFAULT_EVOLVE_TIMEOUT_MS, 1_000, MAX_EVOLVE_TIMEOUT_MS),
		maxEvaluatorOutputBytes: boundedNumber(raw.maxEvaluatorOutputBytes, DEFAULT_EVOLVE_OUTPUT_BYTES, 1_000, MAX_EVOLVE_OUTPUT_BYTES),
		maxPromptCandidates: boundedNumber(raw.maxPromptCandidates, DEFAULT_EVOLVE_PROMPT_CANDIDATES, 1, MAX_EVOLVE_PROMPT_CANDIDATES),
		isolation: isEvolveIsolation(raw.isolation) ? raw.isolation : "advisory_patch",
	};
}

function migrateEvolveMetrics(value: unknown): Record<string, number | string> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, metric]) => typeof metric === "string" || (typeof metric === "number" && Number.isFinite(metric))).slice(0, 20)) as Record<string, number | string>;
}

function migrateEvolveCandidateArtifacts(value: unknown): EvolveCandidateArtifact[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((item): EvolveCandidateArtifact | null => {
			if (!item || typeof item !== "object") return null;
			const artifact = item as Partial<EvolveCandidateArtifact> & Record<string, unknown>;
			const summary = typeof artifact.summary === "string" ? artifact.summary.trim() : "";
			if (!summary) return null;
			return {
				kind: isEvolveCandidateArtifactKind(artifact.kind) ? artifact.kind : "benchmark",
				path: typeof artifact.path === "string" && artifact.path.trim() ? compactText(artifact.path.trim(), 240) ?? artifact.path.trim() : undefined,
				summary: compactText(summary, 500) ?? summary,
			};
		})
		.filter((artifact): artifact is EvolveCandidateArtifact => artifact !== null)
		.slice(0, 20);
}

function migrateEvolveCandidates(value: unknown): EvolveCandidate[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((item, index): EvolveCandidate | null => {
			if (!item || typeof item !== "object") return null;
			const candidate = item as Partial<EvolveCandidate> & Record<string, unknown>;
			const summary = typeof candidate.summary === "string" ? candidate.summary.trim() : "";
			if (!summary) return null;
			const now = new Date().toISOString();
			const primaryScore = typeof candidate.primaryScore === "number" && Number.isFinite(candidate.primaryScore) ? candidate.primaryScore : undefined;
			return {
				id: normalizeId(candidate.id, `ec${index + 1}`),
				parentId: typeof candidate.parentId === "string" && candidate.parentId.trim() ? normalizeId(candidate.parentId, candidate.parentId.trim()) : undefined,
				iteration: boundedNumber(candidate.iteration, index + 1, 0, Number.MAX_SAFE_INTEGER),
				summary: compactText(summary, 500) ?? summary,
				patchFile: typeof candidate.patchFile === "string" && candidate.patchFile.trim() ? compactText(candidate.patchFile.trim(), 240) ?? candidate.patchFile.trim() : undefined,
				changedFiles: normalizeStringList(candidate.changedFiles).map((file) => compactText(file, 240) ?? file).slice(0, 40),
				metrics: migrateEvolveMetrics(candidate.metrics),
				primaryScore,
				criterionIds: normalizeStringList(candidate.criterionIds),
				evidenceSummary: typeof candidate.evidenceSummary === "string" && candidate.evidenceSummary.trim() ? compactText(candidate.evidenceSummary.trim(), 500) ?? candidate.evidenceSummary.trim() : undefined,
				verificationArtifacts: migrateEvolveCandidateArtifacts(candidate.verificationArtifacts),
				status: isEvolveCandidateStatus(candidate.status) ? candidate.status : "invalid",
				evaluatorOutputFile: typeof candidate.evaluatorOutputFile === "string" && candidate.evaluatorOutputFile.trim() ? compactText(candidate.evaluatorOutputFile.trim(), 240) ?? candidate.evaluatorOutputFile.trim() : undefined,
				createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : now,
			};
		})
		.filter((candidate): candidate is EvolveCandidate => candidate !== null)
		.slice(0, MAX_EVOLVE_CANDIDATE_BUDGET);
}

export function migrateEvolveModeState(value: unknown): EvolveModeState {
	if (!value || typeof value !== "object") return defaultEvolveModeState();
	const raw = value as Partial<EvolveModeState> & Record<string, unknown>;
	const setup = migrateEvolveSetup(raw.setup);
	const candidates = migrateEvolveCandidates(raw.candidates);
	const bestCandidateId = typeof raw.bestCandidateId === "string" && candidates.some((candidate) => candidate.id === raw.bestCandidateId) ? raw.bestCandidateId : undefined;
	const gates = normalizeStringList(raw.implementationGates).filter((gate): gate is EvolveImplementationGate => (EVOLVE_IMPLEMENTATION_GATES as string[]).includes(gate));
	return {
		kind: "evolve",
		setup,
		candidates,
		bestCandidateId,
		archive: normalizeStringList(raw.archive).map((item) => compactText(item, 240) ?? item).slice(0, setup?.archiveSize ?? DEFAULT_EVOLVE_ARCHIVE_SIZE),
		consecutiveNonImproving: boundedNumber(raw.consecutiveNonImproving, 0, 0, MAX_EVOLVE_CANDIDATE_BUDGET),
		implementationGates: gates.length > 0 ? gates : [...EVOLVE_IMPLEMENTATION_GATES],
	};
}
