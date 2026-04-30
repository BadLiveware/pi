import { batchFailureDetails, describeBatchMutation, normalizeBatchInputs, runOrderedBatch, type AppToolMutationResponse } from "./batch.ts";
import type { LoopState, WorkerReport } from "../state/core.ts";

export type WorkerReportMutationInput = Omit<Partial<WorkerReport>, "changedFiles"> & { changedFiles?: unknown };

export interface WorkerReportMutationParams extends WorkerReportMutationInput {
	reports?: WorkerReportMutationInput[];
}

export interface WorkerReportOperations {
	record(input: WorkerReportMutationInput): { ok: true; state: LoopState; report: WorkerReport; created: boolean } | { ok: false; error: string };
}

export function runWorkerReportRecord(loopName: string, params: WorkerReportMutationParams, operations: WorkerReportOperations): AppToolMutationResponse<LoopState> {
	const inputs = normalizeBatchInputs(params, params.reports);
	const batch = runOrderedBatch(inputs.inputs, inputs.isBatch, (input) => {
		const result = operations.record(input);
		return result.ok ? { state: result.state, item: result.report, created: result.created } : result;
	});
	if (!batch.ok) return { contentText: batch.error, details: batchFailureDetails(loopName, batch), error: batch.error };
	const updatedState = batch.lastState;
	const response = describeBatchMutation(batch, { verb: "Recorded", singularName: "report", pluralName: "worker reports", pluralDetailKey: "reports", singleItemText: (report, result) => `${result.created ? "Recorded" : "Updated"} worker report ${report.id}` });
	return {
		contentText: `${response.contentText} in loop "${loopName}".`,
		details: { loopName, [response.detailKey]: response.detailValue, workerReports: updatedState.workerReports },
		state: updatedState,
	};
}
