import { batchFailureDetails, batchMutationResponse, normalizeBatchInputs, runOrderedBatch, type AppToolMutationResponse } from "./batch.ts";
import type { BreakoutPackage, BreakoutPackageStatus, LoopState } from "../state/core.ts";
import type { BreakoutPackageInput } from "../breakout-packages.ts";

export interface BreakoutPackageMutationParams extends BreakoutPackageInput {
	packages?: BreakoutPackageInput[];
}

export interface BreakoutPackageOperations {
	record(input: BreakoutPackageInput): { ok: true; state: LoopState; breakout: BreakoutPackage; created: boolean; normalizedStatus?: { from: string; to: BreakoutPackageStatus } } | { ok: false; error: string };
}

export function runBreakoutPackageRecord(loopName: string, params: BreakoutPackageMutationParams, operations: BreakoutPackageOperations): AppToolMutationResponse<LoopState> {
	const inputs = normalizeBatchInputs(params, params.packages);
	const batch = runOrderedBatch(inputs.inputs, inputs.isBatch, (input) => {
		const result = operations.record(input);
		return result.ok ? { state: result.state, item: result.breakout, created: result.created, normalizedStatus: result.normalizedStatus } : result;
	});
	if (!batch.ok) return { contentText: batch.error, details: batchFailureDetails(loopName, batch), error: batch.error };
	const response = batchMutationResponse(loopName, batch, { verb: "Recorded", singularName: "breakout", pluralName: "breakout packages", pluralDetailKey: "packages", singleItemText: (breakout, result) => `${result.created ? "Recorded" : "Updated"} breakout package ${breakout.id}`, stateDetails: (state) => ({ breakoutPackages: state.breakoutPackages }) });
	const normalizedStatuses = (batch.results as Array<(typeof batch.results)[number] & { normalizedStatus?: { from: string; to: BreakoutPackageStatus } }>).map((result) => result.normalizedStatus).filter((item): item is { from: string; to: BreakoutPackageStatus } => Boolean(item));
	return normalizedStatuses.length ? { ...response, details: { ...response.details, normalizedStatus: normalizedStatuses[0], normalizedStatuses } } : response;
}
