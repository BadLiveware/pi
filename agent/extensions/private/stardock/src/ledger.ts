/**
 * Criterion ledger and verification artifact slice for Stardock.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import {
	type Criterion,
	type CriterionLedger,
	type CriterionStatus,
	type LoopState,
	type VerificationArtifact,
	compactText,
	isArtifactKind,
	isCriterionStatus,
	loadState,
	nextSequentialId,
	normalizeId,
	normalizeIds,
	rebuildRequirementTrace,
	saveState,
} from "./state.ts";

export interface LedgerToolDeps {
	getCurrentLoop(): string | null;
	updateUI(ctx: ExtensionContext): void;
	optionalLoopDetails(ctx: ExtensionContext, state: LoopState, options: { includeState?: boolean; includeOverview?: boolean }): Record<string, unknown>;
}

export function criterionCounts(ledger: CriterionLedger): Record<CriterionStatus, number> & { total: number } {
	const counts = { total: ledger.criteria.length, pending: 0, passed: 0, failed: 0, skipped: 0, blocked: 0 };
	for (const criterion of ledger.criteria) counts[criterion.status]++;
	return counts;
}

export function formatCriterionCounts(ledger: CriterionLedger): string {
	const counts = criterionCounts(ledger);
	return `Criteria: ${counts.total} total, ${counts.passed} passed, ${counts.failed} failed, ${counts.blocked} blocked, ${counts.skipped} skipped, ${counts.pending} pending`;
}

export function formatLedgerOverview(state: LoopState): string {
	const lines = [`Ledger for ${state.name}`, formatCriterionCounts(state.criterionLedger), `Artifacts: ${state.verificationArtifacts.length} total`];
	if (state.criterionLedger.criteria.length > 0) {
		lines.push("", "Criteria");
		for (const criterion of state.criterionLedger.criteria.slice(0, 12)) {
			lines.push(`- ${criterion.id} [${criterion.status}] ${compactText(criterion.description, 120)}`);
			lines.push(`  Pass: ${compactText(criterion.passCondition, 120)}`);
			if (criterion.evidence) lines.push(`  Evidence: ${compactText(criterion.evidence, 120)}`);
		}
		if (state.criterionLedger.criteria.length > 12) lines.push(`... ${state.criterionLedger.criteria.length - 12} more criteria`);
	}
	if (state.verificationArtifacts.length > 0) {
		lines.push("", "Artifacts");
		for (const artifact of state.verificationArtifacts.slice(0, 12)) {
			const criteria = artifact.criterionIds?.length ? ` · criteria ${artifact.criterionIds.join(",")}` : "";
			lines.push(`- ${artifact.id} [${artifact.kind}] ${compactText(artifact.summary, 120)}${criteria}`);
			if (artifact.path) lines.push(`  Path: ${artifact.path}`);
			if (artifact.command) lines.push(`  Command: ${compactText(artifact.command, 120)}`);
		}
		if (state.verificationArtifacts.length > 12) lines.push(`... ${state.verificationArtifacts.length - 12} more artifacts`);
	}
	return lines.join("\n");
}

export function upsertCriterion(
	ctx: ExtensionContext,
	loopName: string,
	input: Partial<Criterion> & { id?: string; description?: string; passCondition?: string },
	updateUI: (ctx: ExtensionContext) => void,
): { ok: true; state: LoopState; criterion: Criterion; created: boolean } | { ok: false; error: string } {
	const state = loadState(ctx, loopName);
	if (!state) return { ok: false, error: `Loop "${loopName}" not found.` };

	const id = normalizeId(input.id, nextSequentialId("c", state.criterionLedger.criteria));
	const existingIndex = state.criterionLedger.criteria.findIndex((criterion) => criterion.id === id);
	const existing = existingIndex >= 0 ? state.criterionLedger.criteria[existingIndex] : undefined;
	const description = typeof input.description === "string" && input.description.trim() ? input.description.trim() : existing?.description;
	const passCondition = typeof input.passCondition === "string" && input.passCondition.trim() ? input.passCondition.trim() : existing?.passCondition;
	if (!description || !passCondition) return { ok: false, error: "Criterion requires description and passCondition." };

	const evidenceChanged = input.status !== undefined || input.evidence !== undefined || input.redEvidence !== undefined || input.greenEvidence !== undefined;
	const criterion: Criterion = {
		id,
		taskId: typeof input.taskId === "string" && input.taskId.trim() ? input.taskId.trim() : existing?.taskId,
		sourceRef: typeof input.sourceRef === "string" && input.sourceRef.trim() ? input.sourceRef.trim() : existing?.sourceRef,
		requirement: typeof input.requirement === "string" && input.requirement.trim() ? input.requirement.trim() : existing?.requirement,
		description,
		passCondition,
		testMethod: typeof input.testMethod === "string" && input.testMethod.trim() ? input.testMethod.trim() : existing?.testMethod,
		status: isCriterionStatus(input.status) ? input.status : existing?.status ?? "pending",
		evidence: typeof input.evidence === "string" && input.evidence.trim() ? compactText(input.evidence, 500) : existing?.evidence,
		redEvidence: typeof input.redEvidence === "string" && input.redEvidence.trim() ? compactText(input.redEvidence, 500) : existing?.redEvidence,
		greenEvidence: typeof input.greenEvidence === "string" && input.greenEvidence.trim() ? compactText(input.greenEvidence, 500) : existing?.greenEvidence,
		lastCheckedAt: evidenceChanged ? new Date().toISOString() : existing?.lastCheckedAt,
	};

	if (existingIndex >= 0) state.criterionLedger.criteria[existingIndex] = criterion;
	else state.criterionLedger.criteria.push(criterion);
	state.criterionLedger.criteria.sort((a, b) => a.id.localeCompare(b.id));
	state.criterionLedger.requirementTrace = rebuildRequirementTrace(state.criterionLedger.criteria);
	saveState(ctx, state);
	updateUI(ctx);
	return { ok: true, state, criterion, created: existingIndex < 0 };
}

export function recordVerificationArtifact(
	ctx: ExtensionContext,
	loopName: string,
	input: Partial<VerificationArtifact> & { summary?: string },
	updateUI: (ctx: ExtensionContext) => void,
): { ok: true; state: LoopState; artifact: VerificationArtifact; created: boolean } | { ok: false; error: string } {
	const state = loadState(ctx, loopName);
	if (!state) return { ok: false, error: `Loop "${loopName}" not found.` };

	const id = normalizeId(input.id, nextSequentialId("a", state.verificationArtifacts));
	const existingIndex = state.verificationArtifacts.findIndex((artifact) => artifact.id === id);
	const existing = existingIndex >= 0 ? state.verificationArtifacts[existingIndex] : undefined;
	const summary = typeof input.summary === "string" && input.summary.trim() ? compactText(input.summary, 500) : existing?.summary;
	if (!summary) return { ok: false, error: "Verification artifact requires summary." };

	const artifact: VerificationArtifact = {
		id,
		kind: isArtifactKind(input.kind) ? input.kind : existing?.kind ?? "other",
		command: typeof input.command === "string" && input.command.trim() ? input.command.trim() : existing?.command,
		path: typeof input.path === "string" && input.path.trim() ? input.path.trim() : existing?.path,
		summary,
		criterionIds: normalizeIds(input.criterionIds) ?? existing?.criterionIds,
		createdAt: existing?.createdAt ?? new Date().toISOString(),
	};

	if (existingIndex >= 0) state.verificationArtifacts[existingIndex] = artifact;
	else state.verificationArtifacts.push(artifact);
	state.verificationArtifacts.sort((a, b) => a.id.localeCompare(b.id));
	saveState(ctx, state);
	updateUI(ctx);
	return { ok: true, state, artifact, created: existingIndex < 0 };
}

const criterionInputSchema = Type.Object({
	id: Type.Optional(Type.String()),
	taskId: Type.Optional(Type.String()),
	sourceRef: Type.Optional(Type.String()),
	requirement: Type.Optional(Type.String()),
	description: Type.Optional(Type.String()),
	passCondition: Type.Optional(Type.String()),
	testMethod: Type.Optional(Type.String()),
	status: Type.Optional(Type.Union([Type.Literal("pending"), Type.Literal("passed"), Type.Literal("failed"), Type.Literal("skipped"), Type.Literal("blocked")])),
	evidence: Type.Optional(Type.String()),
	redEvidence: Type.Optional(Type.String()),
	greenEvidence: Type.Optional(Type.String()),
});
const artifactInputSchema = Type.Object({
	id: Type.Optional(Type.String()),
	kind: Type.Optional(Type.Union([Type.Literal("test"), Type.Literal("smoke"), Type.Literal("curl"), Type.Literal("browser"), Type.Literal("screenshot"), Type.Literal("walkthrough"), Type.Literal("benchmark"), Type.Literal("log"), Type.Literal("other")])),
	command: Type.Optional(Type.String()),
	path: Type.Optional(Type.String()),
	summary: Type.Optional(Type.String()),
	criterionIds: Type.Optional(Type.Array(Type.String())),
});

export function registerLedgerTool(pi: ExtensionAPI, deps: LedgerToolDeps): void {
	pi.registerTool({
		name: "stardock_ledger",
		label: "Manage Stardock Ledger",
		description: "Inspect or update a Stardock criterion ledger and compact verification artifact refs.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("list"), Type.Literal("upsertCriterion"), Type.Literal("upsertCriteria"), Type.Literal("recordArtifact"), Type.Literal("recordArtifacts")], {
				description: "list returns the ledger; upsertCriterion/upsertCriteria create or update criteria; recordArtifact/recordArtifacts record compact verification artifact refs.",
			}),
			loopName: Type.Optional(Type.String({ description: "Loop name. Defaults to the active loop." })),
			id: Type.Optional(Type.String({ description: "Criterion or artifact id. Generated when omitted." })),
			taskId: Type.Optional(Type.String({ description: "Optional task/work item id for a criterion." })),
			sourceRef: Type.Optional(Type.String({ description: "Optional source reference such as a plan heading or file path." })),
			requirement: Type.Optional(Type.String({ description: "Original requirement text this criterion traces to." })),
			description: Type.Optional(Type.String({ description: "Criterion description. Required for new criteria." })),
			passCondition: Type.Optional(Type.String({ description: "Observable condition that makes the criterion pass. Required for new criteria." })),
			testMethod: Type.Optional(Type.String({ description: "How to verify this criterion." })),
			status: Type.Optional(Type.Union([Type.Literal("pending"), Type.Literal("passed"), Type.Literal("failed"), Type.Literal("skipped"), Type.Literal("blocked")], { description: "Criterion status." })),
			evidence: Type.Optional(Type.String({ description: "Compact criterion evidence summary or path." })),
			redEvidence: Type.Optional(Type.String({ description: "Compact failing/baseline evidence summary or path." })),
			greenEvidence: Type.Optional(Type.String({ description: "Compact passing evidence summary or path." })),
			kind: Type.Optional(
				Type.Union([Type.Literal("test"), Type.Literal("smoke"), Type.Literal("curl"), Type.Literal("browser"), Type.Literal("screenshot"), Type.Literal("walkthrough"), Type.Literal("benchmark"), Type.Literal("log"), Type.Literal("other")], {
					description: "Verification artifact kind.",
				}),
			),
			command: Type.Optional(Type.String({ description: "Command associated with an artifact." })),
			path: Type.Optional(Type.String({ description: "Path or URL for an artifact." })),
			summary: Type.Optional(Type.String({ description: "Compact artifact summary. Required for recordArtifact." })),
			criterionIds: Type.Optional(Type.Array(Type.String(), { description: "Criterion ids linked to an artifact." })),
			criteria: Type.Optional(Type.Array(criterionInputSchema, { description: "Batch criteria for upsertCriteria." })),
			artifacts: Type.Optional(Type.Array(artifactInputSchema, { description: "Batch artifacts for recordArtifacts." })),
			includeState: Type.Optional(Type.Boolean({ description: "Include compact loop summary in details after mutation." })),
			includeOverview: Type.Optional(Type.Boolean({ description: "Include text overview in details after mutation." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const loopName = params.loopName ?? deps.getCurrentLoop();
			if (!loopName) return { content: [{ type: "text", text: "No active Stardock loop." }], details: {} };
			const state = loadState(ctx, loopName);
			if (!state) return { content: [{ type: "text", text: `Loop "${loopName}" not found.` }], details: { loopName } };

			if (params.action === "list") {
				return {
					content: [{ type: "text", text: formatLedgerOverview(state) }],
					details: { loopName, criterionLedger: state.criterionLedger, verificationArtifacts: state.verificationArtifacts },
				};
			}

			if (params.action === "upsertCriterion" || params.action === "upsertCriteria") {
				const inputs = params.action === "upsertCriteria" ? params.criteria ?? [] : [{ id: params.id, taskId: params.taskId, sourceRef: params.sourceRef, requirement: params.requirement, description: params.description, passCondition: params.passCondition, testMethod: params.testMethod, status: params.status, evidence: params.evidence, redEvidence: params.redEvidence, greenEvidence: params.greenEvidence }];
				if (inputs.length === 0) return { content: [{ type: "text", text: "No criteria provided." }], details: { loopName } };
				const criteria: Criterion[] = [];
				let created = 0;
				let stateAfter: LoopState | undefined;
				for (const input of inputs) {
					const result = upsertCriterion(ctx, loopName, input, deps.updateUI);
					if (!result.ok) return { content: [{ type: "text", text: result.error }], details: { loopName, criteria } };
					criteria.push(result.criterion);
					if (result.created) created++;
					stateAfter = result.state;
				}
				const updatedState = stateAfter ?? loadState(ctx, loopName) ?? undefined;
				return {
					content: [{ type: "text", text: inputs.length === 1 ? `${created === 1 ? "Created" : "Updated"} criterion ${criteria[0].id} in loop "${loopName}".` : `Upserted ${criteria.length} criteria in loop "${loopName}" (${created} created, ${criteria.length - created} updated).` }],
					details: { loopName, criteria, criterion: criteria[0], criterionLedger: updatedState?.criterionLedger, ...(updatedState ? deps.optionalLoopDetails(ctx, updatedState, params) : {}) },
				};
			}

			const inputs = params.action === "recordArtifacts" ? params.artifacts ?? [] : [{ id: params.id, kind: params.kind, command: params.command, path: params.path, summary: params.summary, criterionIds: params.criterionIds }];
			if (inputs.length === 0) return { content: [{ type: "text", text: "No artifacts provided." }], details: { loopName } };
			const artifacts: VerificationArtifact[] = [];
			let created = 0;
			let stateAfter: LoopState | undefined;
			for (const input of inputs) {
				const result = recordVerificationArtifact(ctx, loopName, input, deps.updateUI);
				if (!result.ok) return { content: [{ type: "text", text: result.error }], details: { loopName, artifacts } };
				artifacts.push(result.artifact);
				if (result.created) created++;
				stateAfter = result.state;
			}
			const updatedState = stateAfter ?? loadState(ctx, loopName) ?? undefined;
			return {
				content: [{ type: "text", text: inputs.length === 1 ? `${created === 1 ? "Recorded" : "Updated"} artifact ${artifacts[0].id} in loop "${loopName}".` : `Recorded ${artifacts.length} artifacts in loop "${loopName}" (${created} created, ${artifacts.length - created} updated).` }],
				details: { loopName, artifacts, artifact: artifacts[0], verificationArtifacts: updatedState?.verificationArtifacts, ...(updatedState ? deps.optionalLoopDetails(ctx, updatedState, params) : {}) },
			};
		},
	});
}
