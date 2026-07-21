import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

interface ActiveStageRun {
	loopName: string;
	sessionId: string;
	controller: AbortController;
	settled?: Promise<void>;
}

const runsByContext = new WeakMap<object, Map<string, ActiveStageRun>>();

function registry(ctx: ExtensionContext): Map<string, ActiveStageRun> {
	let value = runsByContext.get(ctx as object);
	if (!value) {
		value = new Map();
		runsByContext.set(ctx as object, value);
	}
	return value;
}

export function registerActiveStageRun(ctx: ExtensionContext, run: ActiveStageRun): () => void {
	const values = registry(ctx);
	if (values.has(run.loopName)) throw new Error(`A runReady invocation is already active for loop "${run.loopName}".`);
	values.set(run.loopName, run);
	return () => {
		if (values.get(run.loopName) === run) values.delete(run.loopName);
	};
}

export async function cancelActiveStageRuns(ctx: ExtensionContext, sessionId: string): Promise<string[]> {
	const cancelled: string[] = [];
	const settlements: Promise<void>[] = [];
	for (const run of registry(ctx).values()) {
		if (run.sessionId !== sessionId) continue;
		run.controller.abort(new Error("Stardock session shutdown cancelled runReady."));
		cancelled.push(run.loopName);
		if (run.settled) settlements.push(run.settled);
	}
	await Promise.allSettled(settlements);
	return cancelled;
}
