import { batchFailureDetails, batchMutationResponse, normalizeBatchInputs, runOrderedBatch, type AppToolMutationResponse } from "./batch.ts";
import type { BreakoutPackage, LoopState } from "../state/core.ts";

export interface BreakoutPackageMutationParams extends Partial<BreakoutPackage> {
	packages?: Partial<BreakoutPackage>[];
}

export interface BreakoutPackageOperations {
	record(input: Partial<BreakoutPackage>): { ok: true; state: LoopState; breakout: BreakoutPackage; created: boolean } | { ok: false; error: string };
}

export function runBreakoutPackageRecord(loopName: string, params: BreakoutPackageMutationParams, operations: BreakoutPackageOperations): AppToolMutationResponse<LoopState> {
	const inputs = normalizeBatchInputs(params, params.packages);
	const batch = runOrderedBatch(inputs.inputs, inputs.isBatch, (input) => {
		const result = operations.record(input);
		return result.ok ? { state: result.state, item: result.breakout, created: result.created } : result;
	});
	if (!batch.ok) return { contentText: batch.error, details: batchFailureDetails(loopName, batch), error: batch.error };
	return batchMutationResponse(loopName, batch, { verb: "Recorded", singularName: "breakout", pluralName: "breakout packages", pluralDetailKey: "packages", singleItemText: (breakout, result) => `${result.created ? "Recorded" : "Updated"} breakout package ${breakout.id}`, stateDetails: (state) => ({ breakoutPackages: state.breakoutPackages }) });
}
