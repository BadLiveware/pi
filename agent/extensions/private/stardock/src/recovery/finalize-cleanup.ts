import { randomUUID } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadState, mutateState } from "../state/store.ts";
import { isFinalizationAuditEvent } from "../state/recovery-ownership.ts";
import {
	acquireMutationMutex, clearTerminalOwnerEvidence, digestOwnershipToken, generateOwnershipToken, isProcessAlive,
	ownershipSessionForContext, OwnershipProtocolError, quarantineOwnershipFile, readMutationRecord, readOwnerRecord,
	releaseMatchingMutationMutex, removeOwnershipToken,
	type StateMutationRecord,
} from "../stages/ownership-records.ts";

export function finalizeSettledOwnerCleanup(ctx: ExtensionContext, input: {
	loopName: string; graphId: string; stageId: string; expectedGraphRevision: number;
	rationale: string; approvalRef: string;
}) {
	const state = loadState(ctx, input.loopName);
	const graph = state?.executionGraph;
	const stage = graph?.stages.find((item) => item.id === input.stageId);
	const expected = stage?.terminalOwnershipCleanup;
	if (!graph || graph.id !== input.graphId || graph.revision !== input.expectedGraphRevision || !stage || !expected) {
		throw new OwnershipProtocolError("evidence_changed", "Terminal cleanup evidence or graph revision changed; inspect again.");
	}
	if (graph.ownership || !["settled", "integrated", "abandoned"].includes(stage.status)
		|| state.workerRuns.some((run) => run.graphId === graph.id && run.stageId === stage.id && run.status === "running")) {
		throw new OwnershipProtocolError("stage_nonterminal", "Cannot finalize owner cleanup while stage ownership or active work remains.");
	}
	if (expected.graphId !== graph.id || expected.stageId !== stage.id) throw new OwnershipProtocolError("state_mismatch", "Terminal cleanup identity does not match the stage.");
	// A crash can leave this tool's mutex after the owner was cleared. Quarantine
	// only matching dead-process evidence; never remove a live mutation mutex.
	const staleMutex = readMutationRecord(ctx, input.loopName);
	if (staleMutex) {
		if (staleMutex.graphId !== graph.id || staleMutex.stageId !== stage.id || isProcessAlive(staleMutex.pid)) {
			throw new OwnershipProtocolError("mutex_busy", "Another or live mutation mutex still owns this loop; inspect its evidence before recovery.");
		}
		quarantineOwnershipFile(ctx, input.loopName, "mutex", staleMutex.tokenDigest);
	}
	const owner = readOwnerRecord(ctx, input.loopName);
	if (owner && graph.revision !== expected.stateRevision + 1) throw new OwnershipProtocolError("state_mismatch", "Terminal cleanup needs the exact ownership release revision.");
	// Once graph ownership is absent, the old owner cannot mutate or heartbeat.
	// Serialize the exact proof against other recovery and lifecycle actions.
	const mutex: StateMutationRecord = {
		version: 1, graphId: graph.id, stageId: stage.id,
		sessionId: ownershipSessionForContext(ctx) ?? `process-${process.pid}`,
		pid: process.pid, tokenDigest: digestOwnershipToken(generateOwnershipToken()), acquiredAt: new Date().toISOString(),
	};
	if (owner) {
		acquireMutationMutex(ctx, input.loopName, mutex);
		try {
			const current = loadState(ctx, input.loopName);
			const currentGraph = current?.executionGraph;
			const currentStage = currentGraph?.stages.find((item) => item.id === input.stageId);
			if (!currentGraph || currentGraph.id !== input.graphId || currentGraph.revision !== input.expectedGraphRevision
				|| currentGraph.ownership || currentStage?.status !== stage.status
				|| JSON.stringify(currentStage?.terminalOwnershipCleanup) !== JSON.stringify(expected)
				|| current?.workerRuns.some((run) => run.graphId === graph.id && run.stageId === stage.id && run.status === "running")) {
				throw new OwnershipProtocolError("evidence_changed", "Terminal cleanup evidence changed while waiting for the mutation mutex.");
			}
			clearTerminalOwnerEvidence(ctx, input.loopName, expected, currentGraph.revision);
			removeOwnershipToken(ctx, input.loopName, expected.sessionId);
		} finally {
			releaseMatchingMutationMutex(ctx, input.loopName, mutex.tokenDigest);
		}
	}
	const currentState = loadState(ctx, input.loopName)!;
	const alreadyAudited = currentState.recoveryEvents?.find((event) => isFinalizationAuditEvent(event, graph.id, stage.id, expected.sessionId));
	if (alreadyAudited) return { ok: true, alreadyClean: !owner, stateRevision: currentState.executionGraph?.revision, recoveryEvent: alreadyAudited };
	const saved = mutateState(ctx, input.loopName, (candidate) => {
		const latest = candidate.executionGraph;
		const latestStage = latest?.stages.find((item) => item.id === stage.id);
		if (!latest || latest.id !== graph.id || latest.ownership || !latestStage
			|| JSON.stringify(latestStage.terminalOwnershipCleanup) !== JSON.stringify(expected)
			|| candidate.workerRuns.some((run) => run.graphId === graph.id && run.stageId === stage.id && run.status === "running")) {
			throw new OwnershipProtocolError("evidence_changed", "Terminal cleanup changed before the audit record could be appended.");
		}
		(candidate.recoveryEvents ??= []).push({
			id: randomUUID(), action: "finalizeCleanup", at: new Date().toISOString(),
			graphId: graph.id, stageId: stage.id, previousOwnerSessionId: expected.sessionId,
			rationale: input.rationale.trim(), approvalRef: input.approvalRef.trim(),
		});
	}, { expectedGraphRevision: currentState.executionGraph?.revision });
	return { ok: true, alreadyClean: !owner, stateRevision: saved.executionGraph?.revision, recoveryEvent: saved.recoveryEvents?.at(-1) };
}
