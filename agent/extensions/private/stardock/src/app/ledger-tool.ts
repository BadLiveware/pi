import { batchFailureDetails, runOrderedBatch, type AppToolMutationResponse } from "./batch.ts";
import type { Criterion, LoopState, VerificationArtifact } from "../state/core.ts";

export interface CriterionMutationParams extends Partial<Criterion> {
	criteria?: Array<Partial<Criterion>>;
}

export interface ArtifactMutationParams extends Partial<VerificationArtifact> {
	artifacts?: Array<Partial<VerificationArtifact>>;
}

export interface LedgerOperations {
	upsertCriterion(input: Partial<Criterion>): { ok: true; state: LoopState; criterion: Criterion; created: boolean } | { ok: false; error: string };
	recordArtifact(input: Partial<VerificationArtifact>): { ok: true; state: LoopState; artifact: VerificationArtifact; created: boolean } | { ok: false; error: string };
}

export function runLedgerCriteriaUpsert(loopName: string, inputs: Array<Partial<Criterion>>, isBatch: boolean, operations: Pick<LedgerOperations, "upsertCriterion">): AppToolMutationResponse<LoopState> {
	if (inputs.length === 0) return { contentText: "No criteria provided.", details: { loopName }, error: "No criteria provided." };
	const batch = runOrderedBatch(inputs, isBatch, (input) => {
		const result = operations.upsertCriterion(input);
		return result.ok ? { state: result.state, item: result.criterion, created: result.created } : result;
	});
	if (!batch.ok) return { contentText: batch.error, details: { ...batchFailureDetails(loopName, batch), criteria: [] }, error: batch.error };
	const created = batch.results.filter((result) => result.created).length;
	const contentText = batch.isBatch ? `Upserted ${batch.items.length} criteria in loop "${loopName}" (${created} created, ${batch.items.length - created} updated).` : `${created === 1 ? "Created" : "Updated"} criterion ${batch.items[0].id} in loop "${loopName}".`;
	return {
		contentText,
		details: { loopName, criteria: batch.items, criterion: batch.items[0], criterionLedger: batch.lastState.criterionLedger },
		state: batch.lastState,
	};
}

export function runLedgerArtifactRecord(loopName: string, inputs: Array<Partial<VerificationArtifact>>, isBatch: boolean, operations: Pick<LedgerOperations, "recordArtifact">): AppToolMutationResponse<LoopState> {
	if (inputs.length === 0) return { contentText: "No artifacts provided.", details: { loopName }, error: "No artifacts provided." };
	const batch = runOrderedBatch(inputs, isBatch, (input) => {
		const result = operations.recordArtifact(input);
		return result.ok ? { state: result.state, item: result.artifact, created: result.created } : result;
	});
	if (!batch.ok) return { contentText: batch.error, details: { ...batchFailureDetails(loopName, batch), artifacts: [] }, error: batch.error };
	const created = batch.results.filter((result) => result.created).length;
	const contentText = batch.isBatch ? `Recorded ${batch.items.length} artifacts in loop "${loopName}" (${created} created, ${batch.items.length - created} updated).` : `${created === 1 ? "Recorded" : "Updated"} artifact ${batch.items[0].id} in loop "${loopName}".`;
	return {
		contentText,
		details: { loopName, artifacts: batch.items, artifact: batch.items[0], verificationArtifacts: batch.lastState.verificationArtifacts },
		state: batch.lastState,
	};
}
