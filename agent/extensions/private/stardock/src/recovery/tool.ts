import { randomUUID } from "node:crypto";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { StardockRuntime } from "../runtime/types.ts";
import { loadState, mutateState } from "../state/store.ts";
import { pendingResourceCleanup } from "../execution-plan/resource-cleanup.ts";
import { inspectStageOwnership, reconcileStageOwnership } from "../stages/ownership.ts";
import { isProcessAlive, OwnershipProtocolError } from "../stages/ownership-records.ts";
import { assertSettledRecoveryEvidence, isFinalizationAuditEvent } from "../state/recovery-ownership.ts";
import { assertNoActiveStageWork, assertStageReviewDecided } from "../stages/active-work.ts";
import { reconcileStageResources, releaseStage } from "../stages/reconcile.ts";
import { finalizeSettledOwnerCleanup } from "./finalize-cleanup.ts";

function result(text: string, details: Record<string, unknown>, isError = false) {
	return { content: [{ type: "text" as const, text }], details, ...(isError ? { isError: true } : {}) };
}

interface RecoveryRequest {
	action: "inspect" | "relinquishSettled" | "takeover" | "reconcileResources" | "releaseLeases" | "finalizeCleanup";
	name?: string;
	graphId?: string;
	stageId?: string;
	expectedGraphRevision?: number;
	rationale?: string;
	approvalRef?: string;
	classification?: string;
	apply?: boolean;
}

export async function executeRecoveryTool(runtime: StardockRuntime, params: RecoveryRequest, ctx: ExtensionContext, signal?: AbortSignal) {
	const loopName = params.name ?? runtime.ref.currentLoop;
	if (!loopName) return result("Select a Stardock loop by name or activate one first.", { ok: false, code: "loop_required" }, true);
	try {
		const state = loadState(ctx, loopName);
		if (!state) return result(`Loop "${loopName}" not found.`, { ok: false, code: "state_missing" }, true);
		if (params.action === "inspect") {
			let ownership: ReturnType<typeof inspectStageOwnership> | undefined;
			let evidenceError: { code: string; message: string } | undefined;
			try { ownership = inspectStageOwnership(ctx, loopName); }
			catch (error) {
				if (!(error instanceof OwnershipProtocolError)) throw error;
				evidenceError = { code: error.code, message: error.message };
			}
			const graph = state.executionGraph;
			const cleanup = pendingResourceCleanup(state);
			if (params.stageId && !graph?.stages.some((item) => item.id === params.stageId)) {
				return result(`Stage "${params.stageId}" was not found; inspect the listed stages again.`, { ok: false, code: "stage_missing", stages: graph?.stages.map((item) => item.id) ?? [] }, true);
			}
			const ownerDigest = ownership?.owner?.tokenDigest;
			const stageId = params.stageId ?? graph?.ownership?.stageId
				?? (ownerDigest ? graph?.stages.find((item) => item.terminalOwnershipCleanup?.tokenDigest === ownerDigest)?.id : undefined)
				?? cleanup?.stageId
				?? (graph?.stages.length === 1 ? graph.stages[0].id : undefined);
			const stage = graph?.stages.find((item) => item.id === stageId);
			const runningWorkerRunIds = state.workerRuns.filter((run) => run.graphId === graph?.id && run.stageId === stage?.id && run.status === "running").map((run) => run.id);
			const pendingLeaseAttemptIds = stage?.implementationNodeIds.flatMap((id) => graph?.nodes.find((node) => node.id === id)?.attempts.filter((attempt) => attempt.leaseDisposition !== "released" && (attempt.worktreePath || attempt.repositoryCommonDir || attempt.leaseHolder)).map((attempt) => attempt.id) ?? []) ?? [];
			const actions = ["inspect"];
			let settledRecoveryBlock;
			let takeoverBlock;
			let leaseReleaseBlock;
			if (graph && stage && graph.ownership?.stageId === stage.id && !["completed", "abandoned"].includes(graph.status)
				&& (ownership?.ownerProcess === "dead" || (!ownership?.owner && ownership?.stateOwnership && !isProcessAlive(ownership.stateOwnership.pid)))) {
				try {
					assertNoActiveStageWork(state, graph.id, stage.id);
					actions.push("takeover (requires confirmed death and classification)");
				} catch (error) {
					if (!(error instanceof OwnershipProtocolError)) throw error;
					takeoverBlock = error.message;
				}
			}
			if (graph && stage && graph.ownership?.stageId === stage.id && ownership?.owner) {
				try {
					assertSettledRecoveryEvidence(state, ownership.owner, graph.ownership, { rationale: "read-only inspection", approvalRef: "read-only inspection" }, graph.revision);
					actions.push("relinquishSettled (exact revision, rationale, authorization)");
				} catch (error) {
					if (!(error instanceof OwnershipProtocolError)) throw error;
					settledRecoveryBlock = error.message;
				}
			}
			const terminalCleanup = stage?.terminalOwnershipCleanup;
			const cleanupAuditRecorded = graph && stage && terminalCleanup && state.recoveryEvents?.some((event) => isFinalizationAuditEvent(event, graph.id, stage.id, terminalCleanup.sessionId));
			if (!evidenceError && graph && !graph.ownership && stage && terminalCleanup
				&& ((ownership?.owner?.tokenDigest === terminalCleanup.tokenDigest && graph.revision === terminalCleanup.stateRevision + 1)
					|| (!ownership?.owner && !cleanupAuditRecorded))) actions.push("finalizeCleanup (exact terminal release evidence or idempotent audit)");
			if (stage && pendingLeaseAttemptIds.length > 0 && !evidenceError) actions.push("reconcileResources (read-only by default; apply requires ownership)");
			if (!evidenceError && graph && stage && (!graph.ownership || graph.ownership.stageId === stage.id)
				&& ["contracts_ready", "settled", "integrated", "failed", "abandoned"].includes(stage.status)
				&& (pendingLeaseAttemptIds.length > 0 || (!graph.ownership && !["completed", "abandoned"].includes(graph.status)))) {
				try {
					assertNoActiveStageWork(state, graph.id, stage.id);
					assertStageReviewDecided(state, stage.id);
					actions.push("releaseLeases (requires current owner token or released custody; exact Treehouse/Git verification)");
				} catch (error) {
					if (!(error instanceof OwnershipProtocolError)) throw error;
					leaseReleaseBlock = error.message;
				}
			}
			const summary = [
				`Recovery inspection: ${loopName} (${state.status}; plan ${state.executionPlan?.status ?? "none"})`,
				`Graph: ${graph?.id ?? "none"}; revision: ${graph?.revision ?? "none"}`,
				`Stage: ${stage?.id ?? "none"}; status: ${stage?.status ?? "unknown"}`,
				...(graph && stage ? [`Mutation identity: graphId=${graph.id}, stageId=${stage.id}, expectedGraphRevision=${graph.revision}`] : []),
				`Owner: ${ownership?.owner ? `session ${ownership.owner.sessionId}, pid ${ownership.owner.pid} (${ownership.ownerProcess})` : ownership?.stateOwnership ? `orphaned session ${ownership.stateOwnership.sessionId}, pid ${ownership.stateOwnership.pid}` : "none"}`,
				`Running worker runs: ${runningWorkerRunIds.join(", ") || "none"}`,
				`Unreleased lease attempts: ${pendingLeaseAttemptIds.join(", ") || "none"}`,
				...(cleanup?.stageIds.length ? [`Stages with pending leases: ${cleanup.stageIds.join(", ")}${stage ? "" : "; inspect one using stageId to get its release options"}`] : []),
				...(evidenceError ? [`Ownership evidence error: ${evidenceError.code}: ${evidenceError.message}`] : []),
				...(state.recoveryEventsUnparsed !== undefined ? ["Damaged recovery audit evidence was preserved separately; inspect it before further repair."] : []),
				...(settledRecoveryBlock ? [`Settled recovery blocked: ${settledRecoveryBlock}`] : []),
				...(takeoverBlock ? [`Takeover blocked: ${takeoverBlock}`] : []),
				...(leaseReleaseBlock ? [`Lease release blocked: ${leaseReleaseBlock}`] : []),
				...(cleanup ? [cleanup.warning] : []),
				`Available recovery actions: ${actions.join(", ")}`,
			];
			return result(summary.join("\n"), {
				ok: !evidenceError, loopName, loopStatus: state.status, planStatus: state.executionPlan?.status,
				graphId: graph?.id, graphRevision: graph?.revision, stageId: stage?.id, stageStatus: stage?.status,
				stages: graph?.stages.map((item) => ({ id: item.id, status: item.status, terminalOwnerCleanup: Boolean(item.terminalOwnershipCleanup) })) ?? [], pendingLeaseStageIds: cleanup?.stageIds ?? [],
				ownership, evidenceError, settledRecoveryBlock, takeoverBlock, leaseReleaseBlock, runningWorkerRunIds, pendingLeaseAttemptIds,
				recentRecoveryEvents: state.recoveryEvents?.slice(-5) ?? [], unparsedRecoveryEvidence: state.recoveryEventsUnparsed !== undefined, actions,
			});
		}
		if (!params.graphId || !params.stageId || params.expectedGraphRevision === undefined) {
			return result(`${params.action} requires graphId, stageId, and expectedGraphRevision from a fresh inspection.`, { ok: false, code: "identity_required" }, true);
		}
		if (state.executionGraph?.id !== params.graphId || state.executionGraph.revision !== params.expectedGraphRevision) {
			return result("Execution graph identity or revision changed; inspect again before recovery.", { ok: false, code: "stale_revision" }, true);
		}
		if (params.action === "reconcileResources") {
			const stage = state.executionGraph.stages.find((item) => item.id === params.stageId);
			if (!stage) return result(`Stage "${params.stageId}" was not found.`, { ok: false, code: "stage_missing" }, true);
			if (params.apply === true) assertNoActiveStageWork(state, state.executionGraph.id, stage.id);
			if (params.apply === true && ["settled", "integrated", "abandoned"].includes(stage.status)) {
				return result("Terminal stages may be inspected but not reclassified by recovery.", { ok: false, code: "stage_terminal" }, true);
			}
			if (params.apply === true && state.executionGraph.ownership?.stageId !== stage.id) {
				return result("Applying resource classification requires stage ownership; use read-only inspection first.", { ok: false, code: "stage_owner_required" }, true);
			}
			if (params.apply === true && !stage.implementationNodeIds.some((id) => state.executionGraph!.nodes.find((node) => node.id === id)?.attempts.length)) {
				return result("No attempt evidence exists to apply; inspect the stage instead.", { ok: false, code: "attempt_missing" }, true);
			}
			const reconciled = await reconcileStageResources(ctx, {
				loopName, graphId: params.graphId, stageId: params.stageId,
				expectedGraphRevision: params.expectedGraphRevision, apply: params.apply === true,
			}, signal);
			if (params.apply === true) runtime.updateUI(ctx);
			const lines = reconciled.attempts.map((attempt) => `- ${attempt.attemptId}: ${attempt.classification}; ${attempt.reason}`);
			return result(`Resource reconciliation ${reconciled.readOnly ? "inspected" : "applied"} for stage "${params.stageId}" at graph revision ${reconciled.stateRevision}. No lease was force-returned.${lines.length ? `\n${lines.join("\n")}` : " No tracked attempts."}`, { ...reconciled }, !reconciled.ok);
		}
		if (params.action === "releaseLeases") {
			const released = await releaseStage(ctx, { loopName, graphId: params.graphId, stageId: params.stageId, expectedGraphRevision: params.expectedGraphRevision }, signal);
			runtime.updateUI(ctx);
			const releaseText = released.ok ? "Safe lease release completed." : `Lease release remains pending: ${released.preserved.map((item) => `${item.attemptId}: ${item.reason}`).join("; ")}`;
			return result(`${releaseText} Graph revision: ${released.stateRevision}.`, { ...released }, !released.ok);
		}
		if (!params.rationale?.trim() || !params.approvalRef?.trim()) {
			return result(`${params.action} requires a rationale and explicit governor authorization reference.`, { ok: false, code: "authorization_required" }, true);
		}
		if (params.action === "finalizeCleanup") {
			const finalized = finalizeSettledOwnerCleanup(ctx, { loopName, graphId: params.graphId, stageId: params.stageId, expectedGraphRevision: params.expectedGraphRevision, rationale: params.rationale, approvalRef: params.approvalRef });
			runtime.updateUI(ctx);
			return result(`${finalized.alreadyClean ? "Terminal owner evidence was already cleared." : `Finalized terminal owner cleanup for stage "${params.stageId}".`} Graph revision: ${finalized.stateRevision}.`, finalized);
		}
		if (params.action === "takeover") {
			if (!params.classification?.trim()) return result("Takeover requires worker and Treehouse classification evidence.", { ok: false, code: "classification_required" }, true);
			const before = inspectStageOwnership(ctx, loopName);
			const takeover = reconcileStageOwnership(ctx, {
				loopName, takeOwnership: true, graphId: params.graphId, stageId: params.stageId,
				rationale: params.rationale, approvalRef: params.approvalRef, classification: params.classification,
				sessionId: runtime.ref.sessionId,
			});
			runtime.updateUI(ctx);
			return result(`Recovered ownership for stage "${params.stageId}" from ${before.ownerProcess} prior owner at graph revision ${takeover.stateRevision}. Worker and Treehouse state still require inspection.`, { ok: true, takeover, previousOwner: before.owner?.sessionId ?? before.stateOwnership?.sessionId });
		}
		const owner = state.executionGraph.ownership;
		if (!owner) return result("No persisted stage ownership exists to relinquish.", { ok: false, code: "owner_missing" }, true);
		if (owner.stageId !== params.stageId) return result("Requested stage does not match persisted ownership.", { ok: false, code: "stage_mismatch" }, true);
		const saved = mutateState(ctx, loopName, (candidate) => {
			const graph = candidate.executionGraph!;
			const stage = graph.stages.find((item) => item.id === owner.stageId)!;
			if (stage.status === "detached") stage.status = "settled";
			for (const nodeId of stage.implementationNodeIds) {
				for (const attempt of graph.nodes.find((node) => node.id === nodeId)?.attempts ?? []) {
					if (attempt.leaseDisposition !== "released" && (attempt.worktreePath || attempt.repositoryCommonDir || attempt.leaseHolder)) attempt.leaseDisposition = "preserved";
				}
			}
			stage.terminalOwnershipCleanup = structuredClone(owner);
			delete graph.ownership;
			(candidate.recoveryEvents ??= []).push({ id: randomUUID(), action: "relinquishSettled", at: new Date().toISOString(), graphId: graph.id, stageId: stage.id, previousOwnerSessionId: owner.sessionId, rationale: params.rationale!.trim(), approvalRef: params.approvalRef!.trim() });
		}, { expectedGraphRevision: params.expectedGraphRevision, releaseOwnership: owner, recoverSettledOwnership: { rationale: params.rationale, approvalRef: params.approvalRef } });
		runtime.updateUI(ctx);
		return result(`Relinquished settled stage "${params.stageId}" ownership at graph revision ${saved.executionGraph?.revision}; unresolved leases remain preserved. The governor may now decide whether to complete the loop.`, {
			ok: true, loopName, graphId: params.graphId, stageId: params.stageId, stateRevision: saved.executionGraph?.revision,
			recoveryEvent: saved.recoveryEvents?.at(-1), pendingCleanup: pendingResourceCleanup(saved)?.warning,
		});
	} catch (error) {
		if (!(error instanceof OwnershipProtocolError)) throw error;
		return result(error.message, { ok: false, code: error.code, blocked: true }, true);
	}
}

export function registerRecoveryTool(pi: ExtensionAPI, runtime: StardockRuntime): void {
	pi.registerTool({
		name: "stardock_recover",
		label: "Recover Stardock State",
		description: "Inspect stuck custody or pending workspace cleanup after review or completion. Select a stage when multiple leases remain; retry release only after exact Treehouse/Git verification. Relinquish decided custody, take over a confirmed-dead inactive owner, inspect preserved attempts, or finalize interrupted cleanup without bypassing guards.",
		promptSnippet: "Diagnose blocked Stardock ownership and make an explicit, evidence-preserving governor recovery decision.",
		promptGuidelines: [
			"When stardock_review or stardock_status reports preserved leases, inspect recovery and select stageId for multiple pending stages; releaseLeases verifies clean Treehouse/Git evidence, never discards dirty work.",
			"When ordinary mutations are blocked by foreign ownership, inspect recovery rather than editing .stardock files or repeatedly retrying blocked tools.",
			"Use exact graphId, stageId, and expectedGraphRevision from inspection for mutations. RelinquishSettled, takeover, and finalizeCleanup also require a rationale and authorization reference; releaseLeases does not. Never treat a live worker, stale heartbeat, or held Treehouse lease as already resolved.",
		],
		parameters: Type.Object({
			action: StringEnum(["inspect", "relinquishSettled", "takeover", "reconcileResources", "releaseLeases", "finalizeCleanup"] as const),
			name: Type.Optional(Type.String({ description: "Loop name; defaults to the active Stardock loop." })),
			graphId: Type.Optional(Type.String()),
			stageId: Type.Optional(Type.String({ description: "Stage to inspect or repair. For multiple pending stages, pass a stageId from inspect.pendingLeaseStageIds." })),
			expectedGraphRevision: Type.Optional(Type.Integer({ minimum: 0 })),
			rationale: Type.Optional(Type.String({ description: "Why the governor is intervening. Required for relinquishSettled and takeover." })),
			approvalRef: Type.Optional(Type.String({ description: "Explicit governor/user authorization reference for the recovery decision; not a substitute for mechanical proof." })),
			classification: Type.Optional(Type.String({ description: "Worker and Treehouse ownership classification; required for confirmed-dead takeover." })),
			apply: Type.Optional(Type.Boolean({ description: "For reconcileResources only: persist classifications after read-only inspection. Default false." })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			return executeRecoveryTool(runtime, params, ctx, signal);
		},
	});
}
