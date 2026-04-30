import { batchFailureDetails, describeBatchMutation, normalizeBatchInputs, runOrderedBatch, type AppToolMutationResponse } from "./batch.ts";
import type { FinalVerificationReport, LoopState } from "../state/core.ts";

export interface FinalReportMutationParams extends Partial<FinalVerificationReport> {
	reports?: Array<Partial<FinalVerificationReport> & { summary?: string }>;
}

export interface FinalReportOperations {
	record(input: Partial<FinalVerificationReport> & { summary?: string }): { ok: true; state: LoopState; report: FinalVerificationReport; created: boolean } | { ok: false; error: string };
}

export function runFinalReportRecord(loopName: string, params: FinalReportMutationParams, operations: FinalReportOperations): AppToolMutationResponse<LoopState> {
	const inputs = normalizeBatchInputs(params, params.reports);
	const batch = runOrderedBatch(inputs.inputs, inputs.isBatch, (input) => {
		const result = operations.record(input);
		return result.ok ? { state: result.state, item: result.report, created: result.created } : result;
	});
	if (!batch.ok) return { contentText: batch.error, details: batchFailureDetails(loopName, batch), error: batch.error };
	const updatedState = batch.lastState;
	const response = describeBatchMutation(batch, { verb: "Recorded", singularName: "report", pluralName: "final reports", pluralDetailKey: "reports", singleItemText: (report, result) => `${result.created ? "Recorded" : "Updated"} final report ${report.id}` });
	return {
		contentText: `${response.contentText} in loop "${loopName}".`,
		details: { loopName, [response.detailKey]: response.detailValue, finalVerificationReports: updatedState.finalVerificationReports },
		state: updatedState,
	};
}
