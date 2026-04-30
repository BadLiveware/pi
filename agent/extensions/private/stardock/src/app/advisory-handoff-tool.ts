import { batchFailureDetails, batchMutationResponse, normalizeBatchInputs, runOrderedBatch, type AppToolMutationResponse } from "./batch.ts";
import type { AdvisoryHandoff, LoopState } from "../state/core.ts";

export interface AdvisoryHandoffMutationParams extends Partial<AdvisoryHandoff> {
	handoffs?: Array<Partial<AdvisoryHandoff> & { objective?: string }>;
}

export interface AdvisoryHandoffOperations {
	record(input: Partial<AdvisoryHandoff> & { objective?: string }): { ok: true; state: LoopState; handoff: AdvisoryHandoff; created: boolean } | { ok: false; error: string };
}

export function runAdvisoryHandoffRecord(loopName: string, params: AdvisoryHandoffMutationParams, operations: AdvisoryHandoffOperations): AppToolMutationResponse<LoopState> {
	const inputs = normalizeBatchInputs(params, params.handoffs);
	const batch = runOrderedBatch(inputs.inputs, inputs.isBatch, (input) => {
		const result = operations.record(input);
		return result.ok ? { state: result.state, item: result.handoff, created: result.created } : result;
	});
	if (!batch.ok) return { contentText: batch.error, details: batchFailureDetails(loopName, batch), error: batch.error };
	return batchMutationResponse(loopName, batch, { verb: "Recorded", singularName: "handoff", pluralName: "advisory handoffs", pluralDetailKey: "handoffs", singleItemText: (handoff, result) => `${result.created ? "Recorded" : "Updated"} advisory handoff ${handoff.id}`, stateDetails: (state) => ({ advisoryHandoffs: state.advisoryHandoffs }) });
}
