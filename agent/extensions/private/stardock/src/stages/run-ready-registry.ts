import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

interface ActiveStageRun {
	loopName: string;
	sessionId: string;
	controller: AbortController;
	settled?: Promise<void>;
}

// Pi can provide different context objects to a tool and a slash command in
// the same session. Key cancellation by session and loop instead of context.
const activeRuns = new Map<string, ActiveStageRun>();

function runKey(sessionId: string, loopName: string): string {
	return `${sessionId}\u0000${loopName}`;
}

export function registerActiveStageRun(_ctx: ExtensionContext, run: ActiveStageRun): () => void {
	const key = runKey(run.sessionId, run.loopName);
	if (activeRuns.has(key)) throw new Error(`A runReady invocation is already active for loop "${run.loopName}".`);
	activeRuns.set(key, run);
	return () => {
		if (activeRuns.get(key) === run) activeRuns.delete(key);
	};
}

/** Request cancellation without waiting indefinitely for a bridge to acknowledge it. */
export function requestActiveStageRunCancellation(sessionId: string, loopName: string): boolean {
	const run = activeRuns.get(runKey(sessionId, loopName));
	if (!run) return false;
	run.controller.abort(new Error("Stardock stop requested cancellation of runReady."));
	return true;
}

export async function cancelActiveStageRuns(_ctx: ExtensionContext, sessionId: string): Promise<string[]> {
	const runs = [...activeRuns.values()].filter((run) => run.sessionId === sessionId);
	for (const run of runs) run.controller.abort(new Error("Stardock session shutdown cancelled runReady."));
	await Promise.allSettled(runs.map((run) => run.settled).filter((settled): settled is Promise<void> => Boolean(settled)));
	return runs.map((run) => run.loopName);
}
