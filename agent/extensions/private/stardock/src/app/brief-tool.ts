import { batchFailureDetails, describeBatchMutation, normalizeBatchInputs, runOrderedBatch } from "./batch.ts";
import type { IterationBrief, LoopState } from "../state/core.ts";

export interface BriefMutationParams {
	id?: string;
	objective?: string;
	task?: string;
	source?: "manual" | "governor";
	requestId?: string;
	criterionIds?: string[];
	acceptanceCriteria?: string[];
	verificationRequired?: string[];
	requiredContext?: string[];
	constraints?: string[];
	avoid?: string[];
	outputContract?: string;
	sourceRefs?: string[];
	activate?: boolean;
	briefs?: BriefMutationInput[];
	ids?: string[];
}

export type BriefMutationInput = Omit<BriefMutationParams, "activate" | "briefs" | "ids">;

export interface BriefToolMutationResponse {
	contentText: string;
	details: Record<string, unknown>;
	state?: LoopState;
	error?: string;
}

export interface BriefToolOperations {
	upsert(input: BriefMutationInput): { ok: true; state: LoopState; brief: IterationBrief; created: boolean } | { ok: false; error: string };
	activate(id: string): { ok: true; state: LoopState; brief: IterationBrief } | { ok: false; error: string };
	clear(): { ok: true; state: LoopState; brief?: IterationBrief } | { ok: false; error: string };
	complete(id?: string): { ok: true; state: LoopState; brief: IterationBrief } | { ok: false; error: string };
}

export function runBriefUpsert(loopName: string, params: BriefMutationParams, operations: BriefToolOperations): BriefToolMutationResponse {
	const inputs = normalizeBatchInputs({ id: params.id, objective: params.objective, task: params.task, source: params.source, requestId: params.requestId, criterionIds: params.criterionIds, acceptanceCriteria: params.acceptanceCriteria, verificationRequired: params.verificationRequired, requiredContext: params.requiredContext, constraints: params.constraints, avoid: params.avoid, outputContract: params.outputContract, sourceRefs: params.sourceRefs }, params.briefs);
	const batch = runOrderedBatch(inputs.inputs, inputs.isBatch, (input) => {
		const result = operations.upsert(input);
		return result.ok ? { state: result.state, item: result.brief, created: result.created } : result;
	});
	if (!batch.ok) return { contentText: batch.error, details: batchFailureDetails(loopName, batch), error: batch.error };
	let updatedState = batch.lastState;
	let brief = batch.items[batch.items.length - 1];
	if (params.activate === true) {
		const activateResult = operations.activate(brief.id);
		if (!activateResult.ok) return { contentText: activateResult.error, details: { loopName, brief }, error: activateResult.error };
		updatedState = activateResult.state;
		brief = activateResult.brief;
	}
	const response = describeBatchMutation(batch, { verb: "Upserted", singularName: "brief", pluralName: "briefs", pluralDetailKey: "upsertedBriefs", singleItemText: (item, result) => `${result.created ? "Created" : "Updated"} brief ${item.id}${params.activate === true ? " and activated it" : ""}` });
	if (batch.isBatch && params.activate === true) response.contentText += ` and activated ${brief.id}`;
	return {
		contentText: `${response.contentText} in loop "${loopName}".`,
		details: { loopName, [response.detailKey]: response.detailValue, brief, briefs: updatedState.briefs, currentBriefId: updatedState.currentBriefId },
		state: updatedState,
	};
}

export function runBriefActivate(loopName: string, id: string | undefined, operations: BriefToolOperations): BriefToolMutationResponse {
	if (!id) return { contentText: "Brief id is required for activate.", details: { loopName }, error: "Brief id is required for activate." };
	const result = operations.activate(id);
	if (!result.ok) return { contentText: result.error, details: { loopName, id }, error: result.error };
	return {
		contentText: `Activated brief ${result.brief.id} in loop "${loopName}".`,
		details: { loopName, brief: result.brief, currentBriefId: result.state.currentBriefId },
		state: result.state,
	};
}

export function runBriefClear(loopName: string, operations: BriefToolOperations): BriefToolMutationResponse {
	const result = operations.clear();
	if (!result.ok) return { contentText: result.error, details: { loopName }, error: result.error };
	return {
		contentText: result.brief ? `Cleared current brief ${result.brief.id} in loop "${loopName}".` : `No current brief in loop "${loopName}".`,
		details: { loopName, brief: result.brief, currentBriefId: result.state.currentBriefId },
		state: result.state,
	};
}

export function runBriefComplete(loopName: string, params: Pick<BriefMutationParams, "id" | "ids">, operations: BriefToolOperations): BriefToolMutationResponse {
	const inputs = normalizeBatchInputs(params.id, params.ids);
	const batch = runOrderedBatch(inputs.inputs, inputs.isBatch, (id) => {
		const result = operations.complete(id);
		return result.ok ? { state: result.state, item: result.brief } : result;
	});
	if (!batch.ok) return { contentText: batch.error, details: batchFailureDetails(loopName, batch), error: batch.error };
	const updatedState = batch.lastState;
	const response = describeBatchMutation(batch, { verb: "Completed", singularName: "brief", pluralName: "briefs", pluralDetailKey: "completedBriefs", singleItemText: (brief) => `Completed brief ${brief.id}` });
	return {
		contentText: `${response.contentText} in loop "${loopName}".`,
		details: { loopName, [response.detailKey]: response.detailValue, currentBriefId: updatedState.currentBriefId },
		state: updatedState,
	};
}
