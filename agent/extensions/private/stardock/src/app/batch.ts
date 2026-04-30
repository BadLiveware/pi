/** Pi-free ordered batch helpers for Stardock tool mutations. */

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

export function normalizeBatchInputs<TSingle, TBatch>(singleInput: TSingle, batchInput: TBatch[] | undefined): { inputs: Array<TSingle | TBatch>; isBatch: boolean } {
	if (Array.isArray(batchInput) && batchInput.length > 0) return { inputs: batchInput, isBatch: true };
	return { inputs: [singleInput], isBatch: false };
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
