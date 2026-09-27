import type { ExecutionPlan } from "../execution-plan/contracts.ts";
import { createEmptyExecutionGraph } from "../stages/contracts.ts";
import type { LoopMode, LoopModeState, LoopState } from "./core.ts";
import { DEFAULT_REFLECT_INSTRUCTIONS } from "./core.ts";
import { defaultCriterionLedger, defaultGovernorState } from "./migration.ts";

export interface CreateLoopStateInput {
	name: string;
	taskFile: string;
	mode: LoopMode;
	modeState: LoopModeState;
	maxIterations?: number;
	itemsPerIteration?: number;
	reflectEvery?: number;
	executionPlan?: ExecutionPlan;
	now?: string;
}

export function createLoopState(input: CreateLoopStateInput): LoopState {
	const now = input.now ?? new Date().toISOString();
	return {
		schemaVersion: 3,
		name: input.name,
		taskFile: input.taskFile,
		mode: input.mode,
		iteration: 1,
		maxIterations: input.maxIterations ?? 50,
		itemsPerIteration: input.itemsPerIteration ?? 0,
		reflectEvery: input.reflectEvery ?? 0,
		reflectInstructions: DEFAULT_REFLECT_INSTRUCTIONS,
		active: true,
		status: "active",
		startedAt: now,
		lastReflectionAt: 0,
		modeState: input.modeState,
		governorState: defaultGovernorState(),
		outsideRequests: [],
		criterionLedger: defaultCriterionLedger(),
		verificationArtifacts: [],
		baselineValidations: [],
		briefs: [],
		finalVerificationReports: [],
		auditorReviews: [],
		advisoryHandoffs: [],
		breakoutPackages: [],
		workerReports: [],
		workerRuns: [],
		executionPlan: input.executionPlan,
		executionGraph: createEmptyExecutionGraph(`${input.name}:execution`, now),
	};
}
