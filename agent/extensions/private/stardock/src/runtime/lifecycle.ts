/** Stardock loop lifecycle transitions. */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { applyActiveBriefLifecycle } from "../briefs.ts";
import { pendingResourceCleanup } from "../execution-plan/resource-cleanup.ts";
import type { BriefLifecycleAction, LoopState } from "../state/core.ts";
import { loadState, mutateState, saveState } from "../state/store.ts";
import { markOwnershipDetachedCandidate } from "../stages/ownership.ts";
import { assertNoActiveStageWork } from "../stages/active-work.ts";
import { OwnershipProtocolError, removeOwnershipToken } from "../stages/ownership-records.ts";

export interface LoopRuntimeRef {
	currentLoop: string | null;
	sessionId: string;
	pendingStopLoop?: string;
}

export function pauseLoop(ctx: ExtensionContext, ref: LoopRuntimeRef, updateUI: (ctx: ExtensionContext) => void, state: LoopState, message?: string): void {
	const detachedOwnership = markOwnershipDetachedCandidate(state);
	applyActiveBriefLifecycle(state, "clear");
	state.status = "paused";
	state.active = false;
	saveState(ctx, state);
	if (detachedOwnership) removeOwnershipToken(ctx, state.name, ref.sessionId);
	ref.currentLoop = null;
	updateUI(ctx);
	if (message && ctx.hasUI) ctx.ui.notify(message, "info");
}

export function completeLoop(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	ref: LoopRuntimeRef,
	updateUI: (ctx: ExtensionContext) => void,
	state: LoopState,
	banner: string,
	activeBriefLifecycle: BriefLifecycleAction = "complete",
	allowRetainedOwnership = false,
): void {
	const owner = state.executionGraph?.ownership;
	const cleanup = pendingResourceCleanup(state);
	// A settled plan may be semantically complete even when Treehouse cannot
	// prove a lease safe to return. Preserve the attempt/lease evidence and
	// relinquish only the settled stage's session ownership; active mechanical
	// work still cannot be closed by this path.
	if (owner && (!allowRetainedOwnership || state.executionPlan?.status !== "completed" || !["settled", "integrated", "abandoned"].includes(cleanup?.stageStatus ?? "") || cleanup?.runningWorkers)) {
		throw new OwnershipProtocolError("owner_nonterminal", `Cannot complete loop "${state.name}" while graph "${owner.graphId}" stage "${owner.stageId}" retains active ownership. Settle the worker stage first.`);
	}
	if (owner) {
		// The stage is settled and no worker is running. Relinquish session custody
		// with the existing exact-owner release protocol, but keep every preserved
		// lease/attempt intact for independent, later Treehouse recovery.
		const released = mutateState(ctx, state.name, (candidate) => {
			const graph = candidate.executionGraph!;
			const stage = graph.stages.find((item) => item.id === owner.stageId);
			if (!stage || !["settled", "integrated", "abandoned"].includes(stage.status) || candidate.workerRuns.some((run) => run.graphId === graph.id && run.stageId === owner.stageId && run.status === "running")) {
				throw new OwnershipProtocolError("owner_nonterminal", "Worker stage changed before completion; inspect the latest state.");
			}
			// A completion decision does not prove a lease was returned. Keep
			// every unresolved lease explicitly preserved for later inspection.
			for (const nodeId of stage.implementationNodeIds) {
				for (const attempt of graph.nodes.find((node) => node.id === nodeId)?.attempts ?? []) {
					if (attempt.leaseDisposition !== "released" && (attempt.worktreePath || attempt.repositoryCommonDir || attempt.leaseHolder)) attempt.leaseDisposition = "preserved";
				}
			}
			stage.terminalOwnershipCleanup = structuredClone(owner);
			delete graph.ownership;
		}, { expectedGraphRevision: state.executionGraph!.revision, releaseOwnership: owner });
		Object.assign(state, released);
	}
	applyActiveBriefLifecycle(state, activeBriefLifecycle);
	state.status = "completed";
	state.completedAt = new Date().toISOString();
	state.active = false;
	saveState(ctx, state);
	ref.currentLoop = null;
	updateUI(ctx);
	pi.appendEntry("stardock", {
		kind: "completed",
		name: state.name,
		iteration: state.iteration,
		maxIterations: state.maxIterations,
		completedAt: state.completedAt,
		banner,
	});
	if (ctx.hasUI) ctx.ui.notify(banner, "info");
}

export function stopLoop(ctx: ExtensionContext, ref: LoopRuntimeRef, updateUI: (ctx: ExtensionContext) => void, state: LoopState, message?: string): void {
	if (state.executionGraph?.ownership) {
		pauseLoop(ctx, ref, updateUI, state, message);
		return;
	}
	applyActiveBriefLifecycle(state, "clear");
	state.status = "completed";
	state.completedAt = new Date().toISOString();
	state.active = false;
	saveState(ctx, state);
	ref.currentLoop = null;
	updateUI(ctx);
	if (message && ctx.hasUI) ctx.ui.notify(message, "info");
}

/** Interrupt this session without ever removing another worker's custody. */
export function forceStopLoop(ctx: ExtensionContext, ref: LoopRuntimeRef, updateUI: (ctx: ExtensionContext) => void, state: LoopState, message?: string, localRunCancellationRequested = false): void {
	const latest = loadState(ctx, state.name) ?? state;
	const graph = latest.executionGraph;
	let pendingReason: string | undefined = localRunCancellationRequested ? "a local stage run is awaiting cancellation acknowledgement" : undefined;
	if (graph) {
		const stageIds = new Set(graph.stages.map((stage) => stage.id));
		if (graph.ownership && !stageIds.has(graph.ownership.stageId)) pendingReason = "owned stage evidence is missing";
		for (const stage of graph.stages) {
			try { assertNoActiveStageWork(latest, graph.id, stage.id); }
			catch (error) {
				if (!(error instanceof OwnershipProtocolError)) throw error;
				pendingReason = error.message;
				break;
			}
		}
	}
	if (!pendingReason && latest.workerRuns.some((run) => run.status === "running")) pendingReason = "a WorkerRun is still running";
	if (!pendingReason && graph?.ownership && graph.ownership.sessionId !== ref.sessionId) pendingReason = "another session still owns the stage";
	if (!pendingReason) {
		try {
			// saveState takes the mutation mutex, rechecks ownership and revision,
			// and rejects a newly acquired owner instead of quarantining it.
			if (graph?.ownership) pauseLoop(ctx, ref, updateUI, latest, message);
			else stopLoop(ctx, ref, updateUI, latest, message);
			ref.pendingStopLoop = undefined;
			return;
		} catch (error) {
			if (!(error instanceof OwnershipProtocolError)) throw error;
			pendingReason = error.message;
		}
	}
	ref.currentLoop = null;
	ref.pendingStopLoop = latest.name;
	updateUI(ctx);
	if (ctx.hasUI) ctx.ui.notify(`Stardock stop pending for "${latest.name}": ${pendingReason}. Local cancellation was requested where possible; ownership and leases remain protected. Retry /stardock-stop after settlement, or inspect stardock_recover.`, "warning");
}
