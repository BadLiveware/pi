import { batchFailureDetails, describeBatchMutation, normalizeBatchInputs, runOrderedBatch, type AppToolMutationResponse } from "./batch.ts";
import type { AuditorReview, LoopState } from "../state/core.ts";

export interface AuditorReviewMutationParams extends Partial<AuditorReview> {
	reviews?: Array<Partial<AuditorReview> & { summary?: string }>;
}

export interface AuditorReviewOperations {
	record(input: Partial<AuditorReview> & { summary?: string }): { ok: true; state: LoopState; review: AuditorReview; created: boolean } | { ok: false; error: string };
}

export function runAuditorReviewRecord(loopName: string, params: AuditorReviewMutationParams, operations: AuditorReviewOperations): AppToolMutationResponse<LoopState> {
	const inputs = normalizeBatchInputs(params, params.reviews);
	const batch = runOrderedBatch(inputs.inputs, inputs.isBatch, (input) => {
		const result = operations.record(input);
		return result.ok ? { state: result.state, item: result.review, created: result.created } : result;
	});
	if (!batch.ok) return { contentText: batch.error, details: batchFailureDetails(loopName, batch), error: batch.error };
	const updatedState = batch.lastState;
	const response = describeBatchMutation(batch, { verb: "Recorded", singularName: "review", pluralName: "auditor reviews", pluralDetailKey: "reviews", singleItemText: (review, result) => `${result.created ? "Recorded" : "Updated"} auditor review ${review.id}` });
	return {
		contentText: `${response.contentText} in loop "${loopName}".`,
		details: { loopName, [response.detailKey]: response.detailValue, auditorReviews: updatedState.auditorReviews },
		state: updatedState,
	};
}
