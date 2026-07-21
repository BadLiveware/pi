import type { RunReadyLaneResult, RunReadyRequest, RunReadyResult } from "./run-ready.ts";

export function combineRunReadyAbort(parent: AbortSignal | undefined, timeoutMs: number): { controller: AbortController; timedOut: () => boolean; dispose: () => void } {
	const controller = new AbortController();
	let timeoutExpired = false;
	const abort = () => controller.abort(parent?.reason ?? new Error("runReady cancelled."));
	if (parent?.aborted) abort();
	else parent?.addEventListener("abort", abort, { once: true });
	const timer = setTimeout(() => {
		timeoutExpired = true;
		controller.abort(new Error(`runReady timed out after ${timeoutMs}ms.`));
	}, timeoutMs);
	return {
		controller,
		timedOut: () => timeoutExpired,
		dispose: () => {
			clearTimeout(timer);
			parent?.removeEventListener("abort", abort);
		},
	};
}

export async function runBounded<T, R>(
	items: T[],
	concurrency: number,
	signal: AbortSignal,
	run: (item: T) => Promise<R>,
	skip: (item: T) => R,
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	async function worker(): Promise<void> {
		while (true) {
			const index = next;
			next += 1;
			if (index >= items.length) return;
			if (signal.aborted) {
				results[index] = skip(items[index]);
				continue;
			}
			results[index] = await run(items[index]);
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
	return results;
}

export function aggregateRunReadyResult(
	request: RunReadyRequest,
	stateRevision: number,
	lanes: RunReadyLaneResult[],
	setupFailed: boolean,
	cancelled: boolean,
	timedOut: boolean,
): RunReadyResult {
	const counts: RunReadyResult["counts"] = { needs_review: 0, failed: 0, detached: 0, not_started: 0 };
	for (const lane of lanes) counts[lane.status] += 1;
	return {
		ok: !setupFailed && !cancelled && counts.failed === 0 && counts.detached === 0 && counts.not_started === 0,
		graphId: request.graphId,
		stageId: request.stageId,
		stateRevision,
		selectedNodeIds: lanes.map((lane) => lane.nodeId),
		lanes,
		counts,
		setupFailed,
		cancelled,
		timedOut,
	};
}
