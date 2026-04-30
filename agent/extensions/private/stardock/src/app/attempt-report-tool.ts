import { batchFailureDetails, batchMutationResponse, normalizeBatchInputs, runOrderedBatch, type AppToolMutationResponse } from "./batch.ts";
import type { LoopState, RecursiveAttempt, RecursiveAttemptKind, RecursiveAttemptResult } from "../state/core.ts";

export interface AttemptReportMutationInput {
	iteration?: number;
	kind?: RecursiveAttemptKind;
	hypothesis?: string;
	actionSummary?: string;
	validation?: string;
	result?: RecursiveAttemptResult;
	kept?: boolean;
	evidence?: string;
	followupIdeas?: string[];
}

export interface AttemptReportMutationParams extends AttemptReportMutationInput {
	reports?: AttemptReportMutationInput[];
}

export interface AttemptReportOperations {
	record(input: AttemptReportMutationInput): { ok: true; state: LoopState; attempt: RecursiveAttempt } | { ok: false; error: string };
}

export function runAttemptReportRecord(loopName: string, params: AttemptReportMutationParams, operations: AttemptReportOperations): AppToolMutationResponse<LoopState> {
	const inputs = normalizeBatchInputs(params, params.reports);
	const batch = runOrderedBatch(inputs.inputs, inputs.isBatch, (input) => {
		const result = operations.record(input);
		return result.ok ? { state: result.state, item: result.attempt } : result;
	});
	if (!batch.ok) return { contentText: batch.error, details: batchFailureDetails(loopName, batch), error: batch.error };
	return batchMutationResponse(loopName, batch, { verb: "Recorded", singularName: "attempt", pluralName: "attempt reports", pluralDetailKey: "attempts", singleItemText: (attempt) => `Recorded report for attempt ${attempt.iteration}` });
}
