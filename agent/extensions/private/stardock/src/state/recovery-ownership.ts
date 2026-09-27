import type { LoopState, StardockRecoveryEvent } from "./core.ts";
import type { ExecutionStageOwnership } from "../stages/contracts.ts";
import { assertNoActiveStageWork } from "../stages/active-work.ts";
import { OwnershipProtocolError, type StageOwnerRecord } from "../stages/ownership-records.ts";

export interface SettledRecoveryAuthority {
	rationale: string;
	approvalRef: string;
}

export function migrateRecoveryEvents(value: unknown): StardockRecoveryEvent[] | undefined {
	// Preserve array entries as-is; migration stores non-array evidence separately
	// so a normal state write cannot silently erase damaged audit history.
	return Array.isArray(value) ? value as StardockRecoveryEvent[] : undefined;
}

export function isFinalizationAuditEvent(value: unknown, graphId: string, stageId: string, previousOwnerSessionId: string): value is StardockRecoveryEvent {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const event = value as Record<string, unknown>;
	return event.action === "finalizeCleanup" && event.graphId === graphId && event.stageId === stageId
		&& event.previousOwnerSessionId === previousOwnerSessionId
		&& [event.id, event.at, event.rationale, event.approvalRef].every((field) => typeof field === "string" && field.trim().length > 0)
		&& Number.isFinite(Date.parse(event.at as string));
}

/** Only a settled, inactive stage may be fenced without the old session token. */
export function assertSettledRecoveryEvidence(
	state: LoopState,
	owner: StageOwnerRecord,
	expected: ExecutionStageOwnership | undefined,
	authority: SettledRecoveryAuthority,
	expectedRevision: number | undefined,
): void {
	if (!authority.rationale?.trim() || !authority.approvalRef?.trim()) {
		throw new OwnershipProtocolError("authorization_required", "Settled recovery requires a nonblank rationale and governor authorization reference.");
	}
	const graph = state.executionGraph;
	const ownership = graph?.ownership;
	if (!graph || !ownership || !expected || expectedRevision !== graph.revision || expected.stateRevision !== graph.revision) {
		throw new OwnershipProtocolError("stale_revision", "Settled recovery requires exact current graph ownership and revision; inspect again.");
	}
	if (owner.status !== "active" || !["active", "detached"].includes(ownership.status)
		|| owner.stateRevision !== graph.revision
		|| graph.id !== owner.graphId
		|| ["graphId", "stageId", "sessionId", "pid", "tokenDigest", "stateRevision"].some((key) =>
			(owner as unknown as Record<string, unknown>)[key] !== (ownership as unknown as Record<string, unknown>)[key]
			|| (expected as unknown as Record<string, unknown>)[key] !== (ownership as unknown as Record<string, unknown>)[key])) {
		throw new OwnershipProtocolError("evidence_changed", "Owner file, persisted graph ownership, and requested recovery identity must match exactly.");
	}
	const stage = graph.stages.find((item) => item.id === ownership.stageId);
	const decidedDetachedStage = stage?.status === "detached" && ownership.status === "detached" && state.executionPlan?.status === "completed";
	if (!stage || (!["settled", "integrated", "abandoned"].includes(stage.status) && !decidedDetachedStage)) {
		throw new OwnershipProtocolError("stage_nonterminal", "Only a terminal stage or a detached fully decided plan can relinquish foreign ownership; active stages require worker settlement or approved dead-owner takeover.");
	}
	assertNoActiveStageWork(state, graph.id, stage.id);
}
