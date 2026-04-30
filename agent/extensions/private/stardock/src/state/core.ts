/**
 * Shared Stardock constants, types, and tiny cross-slice helpers.
 */

/**
 * Shared Stardock state, migration, and file helpers.
 */

export const STARDOCK_DIR = ".stardock";
export const COMPLETE_MARKER = "<promise>COMPLETE</promise>";

export const DEFAULT_TEMPLATE = `# Task

Describe your task here.

## Goals
- Goal 1
- Goal 2

## Checklist
- [ ] Item 1
- [ ] Item 2

## Notes
(Update this as you work)
`;

export const DEFAULT_REFLECT_INSTRUCTIONS = `REFLECTION CHECKPOINT

Pause and reflect on your progress:
1. What has been accomplished so far?
2. What's working well?
3. What's not working or blocking progress?
4. Should the approach be adjusted?
5. What are the next priorities?

Update the task file with your reflection, then continue working.`;

export type LoopStatus = "active" | "paused" | "completed";
export type LoopMode = "checklist" | "recursive" | "evolve";

export interface ChecklistModeState {
	kind: "checklist";
}

export type RecursiveResetPolicy = "manual" | "revert_failed_attempts" | "keep_best_only";
export type RecursiveStopCriterion = "target_reached" | "idea_exhaustion" | "max_failed_attempts" | "max_iterations" | "user_decision";
export type RecursiveAttemptStatus = "pending_report" | "reported";
export type RecursiveAttemptKind = "candidate_change" | "setup" | "refactor" | "instrumentation" | "benchmark_scaffold" | "research" | "other";
export type RecursiveAttemptResult = "improved" | "neutral" | "worse" | "invalid" | "blocked";

export interface RecursiveAttempt {
	id: string;
	iteration: number;
	createdAt: string;
	updatedAt?: string;
	status: RecursiveAttemptStatus;
	kind?: RecursiveAttemptKind;
	hypothesis?: string;
	actionSummary?: string;
	validation?: string;
	result?: RecursiveAttemptResult;
	kept?: boolean;
	evidence?: string;
	followupIdeas?: string[];
	summary: string;
}

export interface RecursiveModeState {
	kind: "recursive";
	objective: string;
	baseline?: string;
	validationCommand?: string;
	resetPolicy: RecursiveResetPolicy;
	stopWhen: RecursiveStopCriterion[];
	maxFailedAttempts?: number;
	outsideHelpEvery?: number;
	governEvery?: number;
	outsideHelpOnStagnation: boolean;
	attempts: RecursiveAttempt[];
}

export interface EvolveModeState {
	kind: "evolve";
}

export type LoopModeState = ChecklistModeState | RecursiveModeState | EvolveModeState;
export type PromptReason = "iteration" | "reflection";
export type StateView = "summary" | "overview" | "timeline";
export type OutsideRequestKind = "ideas" | "research" | "mutation_suggestions" | "failure_analysis" | "governor_review";
export type OutsideRequestStatus = "requested" | "in_progress" | "answered" | "dismissed";
export type OutsideRequestTrigger = "every_n_iterations" | "out_of_ideas" | "manual" | "stagnation" | "scaffolding_drift" | "low_value_lane";

export interface GovernorDecision {
	verdict: "continue" | "pivot" | "stop" | "measure" | "exploit_scaffold" | "ask_user";
	rationale: string;
	requiredNextMove?: string;
	forbiddenNextMoves?: string[];
	evidenceGaps?: string[];
}

export interface OutsideRequest {
	id: string;
	kind: OutsideRequestKind;
	status: OutsideRequestStatus;
	requestedAt: string;
	requestedByIteration: number;
	trigger: OutsideRequestTrigger;
	prompt: string;
	answer?: string;
	decision?: GovernorDecision;
	consumedAt?: string;
}

export type CriterionStatus = "pending" | "passed" | "failed" | "skipped" | "blocked";
export type VerificationArtifactKind = "test" | "smoke" | "curl" | "browser" | "screenshot" | "walkthrough" | "benchmark" | "log" | "other";

export interface Criterion {
	id: string;
	taskId?: string;
	sourceRef?: string;
	requirement?: string;
	description: string;
	passCondition: string;
	testMethod?: string;
	status: CriterionStatus;
	evidence?: string;
	redEvidence?: string;
	greenEvidence?: string;
	lastCheckedAt?: string;
}

export interface CriterionLedger {
	criteria: Criterion[];
	requirementTrace: Array<{ requirement: string; criterionIds: string[] }>;
}

export interface VerificationArtifact {
	id: string;
	kind: VerificationArtifactKind;
	command?: string;
	path?: string;
	summary: string;
	criterionIds?: string[];
	createdAt: string;
}

export type IterationBriefStatus = "draft" | "active" | "completed" | "dismissed";
export type IterationBriefSource = "manual" | "governor";
export type BriefLifecycleAction = "keep" | "complete" | "clear";
export type FinalVerificationStatus = "draft" | "passed" | "failed" | "partial";
export type ValidationResult = "passed" | "failed" | "skipped";
export type AuditorReviewStatus = "draft" | "passed" | "concerns" | "blocked";

export interface FinalValidationRecord {
	command?: string;
	result: ValidationResult;
	summary: string;
	artifactIds?: string[];
}

export interface FinalVerificationReport {
	id: string;
	status: FinalVerificationStatus;
	summary: string;
	criterionIds: string[];
	artifactIds: string[];
	validation: FinalValidationRecord[];
	unresolvedGaps: string[];
	compatibilityNotes: string[];
	securityNotes: string[];
	performanceNotes: string[];
	createdAt: string;
	updatedAt: string;
}

export interface AuditorReview {
	id: string;
	status: AuditorReviewStatus;
	summary: string;
	focus: string;
	criterionIds: string[];
	artifactIds: string[];
	finalReportIds: string[];
	concerns: string[];
	recommendations: string[];
	requiredFollowups: string[];
	createdAt: string;
	updatedAt: string;
}

export interface IterationBrief {
	id: string;
	status: IterationBriefStatus;
	source: IterationBriefSource;
	requestId?: string;
	objective: string;
	task: string;
	criterionIds: string[];
	acceptanceCriteria: string[];
	verificationRequired: string[];
	requiredContext: string[];
	constraints: string[];
	avoid: string[];
	outputContract: string;
	sourceRefs: string[];
	createdAt: string;
	updatedAt: string;
	completedAt?: string;
}

export interface LoopModeHandler {
	mode: LoopMode;
	buildPrompt(state: LoopState, taskContent: string, reason: PromptReason): string;
	buildSystemInstructions(state: LoopState): string;
	onIterationDone(state: LoopState): void;
	summarize(state: LoopState): string[];
}

export interface LoopState {
	schemaVersion: 3;
	name: string;
	taskFile: string;
	mode: LoopMode;
	iteration: number;
	maxIterations: number;
	itemsPerIteration: number; // Prompt hint only - "process N items per turn"
	reflectEvery: number; // Reflect every N iterations
	reflectInstructions: string;
	active: boolean; // Backwards compat
	status: LoopStatus;
	startedAt: string;
	completedAt?: string;
	lastReflectionAt: number; // Last iteration we reflected at
	modeState: LoopModeState;
	outsideRequests: OutsideRequest[];
	criterionLedger: CriterionLedger;
	verificationArtifacts: VerificationArtifact[];
	briefs: IterationBrief[];
	currentBriefId?: string;
	finalVerificationReports: FinalVerificationReport[];
	auditorReviews: AuditorReview[];
}

export const STATUS_ICONS: Record<LoopStatus, string> = { active: "▶", paused: "⏸", completed: "✓" };

export function compactText(value: string | undefined, maxLength = 160): string | undefined {
	if (!value) return undefined;
	if (value.length <= maxLength) return value;
	return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function nextSequentialId(prefix: string, existing: Array<{ id: string }>): string {
	let index = existing.length + 1;
	const ids = new Set(existing.map((item) => item.id));
	while (ids.has(`${prefix}${index}`)) index++;
	return `${prefix}${index}`;
}
