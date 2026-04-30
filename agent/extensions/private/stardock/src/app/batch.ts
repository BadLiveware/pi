/** Pi-free ordered batch helpers for Stardock tool mutations. */

export interface AppToolMutationResponse<TState = unknown> {
	contentText: string;
	details: Record<string, unknown>;
	state?: TState;
	error?: string;
}

export interface BatchMutationResult<TState, TItem> {
	state: TState;
	item: TItem;
	created?: boolean;
}

export interface BatchMutationSuccess<TState, TItem> {
	ok: true;
	inputs: unknown[];
	results: Array<BatchMutationResult<TState, TItem>>;
	items: TItem[];
	lastState: TState;
	isBatch: boolean;
}

export interface BatchMutationFailure {
	ok: false;
	error: string;
	index: number;
	input: unknown;
	isBatch: boolean;
}

export interface BatchResponseShape<TItem> {
	contentText: string;
	detailKey: string;
	detailValue: TItem | TItem[];
}

export function normalizeBatchInputs<TSingle, TBatch>(singleInput: TSingle, batchInput: TBatch[] | undefined): { inputs: Array<TSingle | TBatch>; isBatch: boolean } {
	if (Array.isArray(batchInput) && batchInput.length > 0) return { inputs: batchInput, isBatch: true };
	return { inputs: [singleInput], isBatch: false };
}

export function batchFailureDetails<TFailure extends BatchMutationFailure>(loopName: string, failure: TFailure): { loopName: string; failedIndex: number; failedInput: unknown } {
	return { loopName, failedIndex: failure.index, failedInput: failure.input };
}

export interface DescribeBatchMutationOptions<TItem> {
	verb: string;
	singularName: string;
	pluralName: string;
	pluralDetailKey?: string;
	singleItemText(item: TItem, result: BatchMutationResult<unknown, TItem>): string;
}

export function describeBatchMutation<TItem>(batch: BatchMutationSuccess<unknown, TItem>, options: DescribeBatchMutationOptions<TItem>): BatchResponseShape<TItem> {
	if (batch.isBatch) {
		return {
			contentText: `${options.verb} ${batch.items.length} ${options.pluralName}`,
			detailKey: options.pluralDetailKey ?? options.pluralName,
			detailValue: batch.items,
		};
	}
	const result = batch.results[0];
	return {
		contentText: options.singleItemText(result.item, result),
		detailKey: options.singularName,
		detailValue: result.item,
	};
}

export function batchMutationResponse<TState, TItem>(loopName: string, batch: BatchMutationSuccess<TState, TItem>, options: DescribeBatchMutationOptions<TItem> & { stateDetails?: (state: TState) => Record<string, unknown> }): AppToolMutationResponse<TState> {
	const response = describeBatchMutation(batch as BatchMutationSuccess<unknown, TItem>, options);
	return {
		contentText: `${response.contentText} in loop "${loopName}".`,
		details: { loopName, [response.detailKey]: response.detailValue, ...(options.stateDetails?.(batch.lastState) ?? {}) },
		state: batch.lastState,
	};
}

export function runOrderedBatch<TInput, TState, TItem>(
	inputs: TInput[],
	isBatch: boolean,
	mutate: (input: TInput) => BatchMutationResult<TState, TItem> | { ok: false; error: string },
): BatchMutationSuccess<TState, TItem> | BatchMutationFailure {
	const results: Array<BatchMutationResult<TState, TItem>> = [];
	for (const [index, input] of inputs.entries()) {
		const result = mutate(input);
		if ("ok" in result && result.ok === false) return { ok: false, error: result.error, index, input, isBatch };
		results.push(result as BatchMutationResult<TState, TItem>);
	}
	if (results.length === 0) throw new Error("runOrderedBatch requires at least one input");
	return {
		ok: true,
		inputs,
		results,
		items: results.map((result) => result.item),
		lastState: results[results.length - 1].state,
		isBatch,
	};
}
