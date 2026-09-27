import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { StardockRuntime } from "../runtime/types.ts";
import { acquireStageOwnership, heartbeatStageOwnership, inspectStageOwnership, reconcileStageOwnership } from "./ownership.ts";
import { OwnershipProtocolError } from "./ownership-records.ts";

function textResult(text: string, details: Record<string, unknown>) {
	return { content: [{ type: "text" as const, text }], details };
}

function protocolFailure(error: unknown) {
	if (error instanceof OwnershipProtocolError) return textResult(error.message, { ok: false, code: error.code, blocked: true });
	throw error;
}

export function registerStageOwnershipTool(pi: ExtensionAPI, runtime: StardockRuntime): void {
	pi.registerTool({
		name: "stardock_stage",
		label: "Stardock Stage Ownership",
		description: "Acquire or inspect exclusive stage ownership. Reconciliation is read-only unless an approved dead-owner takeover is explicitly requested.",
		promptSnippet: "Inspect or acquire durable stage ownership before stage mutations.",
		promptGuidelines: [
			"Use stardock_stage list or read-only reconcile to inspect bounded owner, heartbeat, process, mutex, and state evidence.",
			"Never infer stardock_stage takeover from heartbeat expiry. takeOwnership requires confirmed dead process evidence, rationale, a governor authorization reference, and worker/Treehouse classification.",
		],
		parameters: Type.Object({
			action: StringEnum(["acquire", "list", "reconcile", "heartbeat"] as const),
			loopName: Type.Optional(Type.String()),
			graphId: Type.Optional(Type.String()),
			stageId: Type.Optional(Type.String()),
			expectedGraphRevision: Type.Optional(Type.Number()),
			takeOwnership: Type.Optional(Type.Boolean()),
			rationale: Type.Optional(Type.String()),
			approvalRef: Type.Optional(Type.String({ description: "Governor authorization reference for a confirmed-dead-owner takeover." })),
			classification: Type.Optional(Type.String()),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const loopName = params.loopName ?? runtime.ref.currentLoop;
			if (!loopName) return textResult("No Stardock loop selected.", { ok: false });
			try {
				if (params.action === "list") {
					const inspection = inspectStageOwnership(ctx, loopName);
					return textResult(`Ownership inspection for "${loopName}": ${inspection.nextAction}`, { ok: true, inspection });
				}
				if (params.action === "heartbeat") {
					const owner = heartbeatStageOwnership(ctx, loopName);
					return textResult(`Heartbeat refreshed for graph "${owner.graphId}" stage "${owner.stageId}".`, { ok: true, owner });
				}
				if (params.action === "reconcile") {
					const result = reconcileStageOwnership(ctx, {
						loopName,
						takeOwnership: params.takeOwnership,
						rationale: params.rationale,
						approvalRef: params.approvalRef,
						classification: params.classification,
						graphId: params.graphId,
						stageId: params.stageId,
						sessionId: runtime.ref.sessionId,
					});
					return textResult(`Ownership reconciliation inspected durable evidence for "${loopName}".`, { ok: true, result });
				}
				if (!params.graphId || !params.stageId || params.expectedGraphRevision === undefined) {
					return textResult("Acquire requires graphId, stageId, and expectedGraphRevision.", { ok: false });
				}
				const acquisition = acquireStageOwnership(ctx, {
					loopName,
					graphId: params.graphId,
					stageId: params.stageId,
					expectedGraphRevision: params.expectedGraphRevision,
					sessionId: runtime.ref.sessionId,
				});
				return textResult(`Acquired graph "${acquisition.graphId}" stage "${acquisition.stageId}" at revision ${acquisition.stateRevision}.`, { ok: true, acquisition });
			} catch (error) {
				return protocolFailure(error);
			}
		},
	});
}
