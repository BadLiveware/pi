/**
 * Provider-neutral advisory handoff slice for Stardock.
 */

import type { ExtensionAPI,ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { runAdvisoryHandoffRecord } from "./app/advisory-handoff-tool.ts";
import { FollowupToolParameter, type FollowupToolRequest } from "./runtime/followups.ts";
import { formatCriterionCounts } from "./ledger.ts";
import { type AdvisoryHandoff, compactText, type LoopState, nextSequentialId } from "./state/core.ts";
import { isAdvisoryHandoffRole, isAdvisoryHandoffStatus, normalizeId, normalizeStringList } from "./state/migration.ts";
import { loadState, saveState } from "./state/store.ts";

export interface AdvisoryHandoffToolDeps {
	getCurrentLoop(): string | null;
	updateUI(ctx: ExtensionContext): void;
	optionalLoopDetails(ctx: ExtensionContext, state: LoopState, options: { includeState?: boolean; includeOverview?: boolean; followupTool?: FollowupToolRequest }): Record<string, unknown>;
}

function compactList(items: string[], maxItems = 8, maxLength = 180): string[] {
	return items.slice(0, maxItems).map((item) => compactText(item, maxLength) ?? item);
}

function normalizeProviderMetadata(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 20));
}

function appendSection(lines: string[], title: string, items: string[]): void {
	if (!items.length) return;
	lines.push("", title, ...items);
}

export function formatAdvisoryHandoffOverview(state: LoopState): string {
	const lines = [`Advisory handoffs for ${state.name}`, `Handoffs: ${state.advisoryHandoffs.length} total`, formatCriterionCounts(state.criterionLedger), `Artifacts: ${state.verificationArtifacts.length} total`, `Final reports: ${state.finalVerificationReports.length} total`];
	if (state.advisoryHandoffs.length > 0) {
		lines.push("");
		for (const handoff of state.advisoryHandoffs.slice(0, 10)) {
			lines.push(`- ${handoff.id} [${handoff.status}/${handoff.role}] ${compactText(handoff.summary, 140)}`);
			lines.push(`  Objective: ${compactText(handoff.objective, 140)}`);
			if (handoff.resultSummary) lines.push(`  Result: ${compactText(handoff.resultSummary, 140)}`);
			if (handoff.recommendations.length) lines.push(`  Recommendations: ${compactList(handoff.recommendations, 3, 100).join("; ")}`);
		}
		if (state.advisoryHandoffs.length > 10) lines.push(`... ${state.advisoryHandoffs.length - 10} more handoffs`);
	}
	return lines.join("\n");
}

export function buildAdvisoryHandoffPayload(state: LoopState, input: Partial<AdvisoryHandoff> & { objective?: string }): { ok: true; payload: string } | { ok: false; error: string } {
	const objective = typeof input.objective === "string" && input.objective.trim() ? input.objective.trim() : undefined;
	if (!objective) return { ok: false, error: "Advisory handoff payload requires objective." };
	const role = isAdvisoryHandoffRole(input.role) ? input.role : "explorer";
	const refs = validateRefs(state, input, state.name);
	if (!refs.ok) return refs;
	const selectedCriteria = refs.criterionIds.length ? state.criterionLedger.criteria.filter((criterion) => refs.criterionIds.includes(criterion.id)) : state.criterionLedger.criteria.slice(0, 8);
	const selectedArtifacts = refs.artifactIds.length ? state.verificationArtifacts.filter((artifact) => refs.artifactIds.includes(artifact.id)) : state.verificationArtifacts.slice(0, 6);
	const selectedReports = refs.finalReportIds.length ? state.finalVerificationReports.filter((report) => refs.finalReportIds.includes(report.id)) : state.finalVerificationReports.slice(-4);
	const requestedOutput = typeof input.requestedOutput === "string" && input.requestedOutput.trim() ? input.requestedOutput.trim() : "Return a compact advisory report with evidence, risks, recommendations, and follow-ups. Do not assume a provider-specific output format.";
	const lines = [
		`Advisory handoff payload for loop "${state.name}"`,
		`Role: ${role}`,
		`Objective: ${compactText(objective, 500)}`,
		`Mode: ${state.mode}`,
		`Iteration: ${state.iteration}${state.maxIterations > 0 ? `/${state.maxIterations}` : ""}`,
		"",
		"Provider-neutral contract:",
		"This payload is not tied to any runner. Execute it with any appropriate human, agent, model, CLI, or future adapter. Return compact findings that can be recorded with stardock_handoff record.",
		"Do not apply edits or mutate state unless a separate parent/orchestrator explicitly instructs you to do so.",
		"",
		"Requested output:",
		compactText(requestedOutput, 500) ?? requestedOutput,
	];
	appendSection(lines, "Criteria", selectedCriteria.map((criterion) => `- ${criterion.id} [${criterion.status}] ${compactText(criterion.description, 140)} | Pass: ${compactText(criterion.passCondition, 140)}`));
	appendSection(lines, "Artifacts", selectedArtifacts.map((artifact) => `- ${artifact.id} [${artifact.kind}] ${compactText(artifact.summary, 160)}${artifact.path ? ` | Path: ${artifact.path}` : ""}`));
	appendSection(lines, "Final reports", selectedReports.map((report) => `- ${report.id} [${report.status}] ${compactText(report.summary, 160)}${report.unresolvedGaps.length ? ` | Gaps: ${compactList(report.unresolvedGaps, 2, 100).join("; ")}` : ""}`));
	appendSection(lines, "Context refs", compactList(normalizeStringList(input.contextRefs), 8, 180).map((ref) => `- ${ref}`));
	appendSection(lines, "Constraints", compactList(normalizeStringList(input.constraints), 8, 180).map((constraint) => `- ${constraint}`));
	if (state.modeState.kind === "recursive") {
		appendSection(lines, "Recent attempts", state.modeState.attempts.slice(-5).map((attempt) => `- ${attempt.id} [${attempt.status}${attempt.kind ? `/${attempt.kind}` : ""}${attempt.result ? `/${attempt.result}` : ""}] ${compactText(attempt.summary || attempt.hypothesis || attempt.actionSummary, 180)}`));
	}
	appendSection(lines, "Prior handoffs", state.advisoryHandoffs.slice(-5).map((handoff) => `- ${handoff.id} [${handoff.status}/${handoff.role}] ${compactText(handoff.summary, 160)}${handoff.resultSummary ? ` | Result: ${compactText(handoff.resultSummary, 120)}` : ""}`));
	lines.push("", "Record response with:", "- status: answered | failed | dismissed", "- resultSummary", "- concerns", "- recommendations", "- artifactRefs", "- optional opaque provider metadata if useful");
	return { ok: true, payload: lines.join("\n") };
}

function validateRefs(state: LoopState, input: { criterionIds?: unknown; artifactIds?: unknown; finalReportIds?: unknown }, loopName: string): { ok: true; criterionIds: string[]; artifactIds: string[]; finalReportIds: string[] } | { ok: false; error: string } {
	const criterionIds = normalizeStringList(input.criterionIds);
	const artifactIds = normalizeStringList(input.artifactIds);
	const finalReportIds = normalizeStringList(input.finalReportIds);
	const criterionSet = new Set(state.criterionLedger.criteria.map((criterion) => criterion.id));
	const artifactSet = new Set(state.verificationArtifacts.map((artifact) => artifact.id));
	const finalReportSet = new Set(state.finalVerificationReports.map((report) => report.id));
	const missingCriterion = criterionIds.find((criterionId) => !criterionSet.has(criterionId));
	if (missingCriterion) return { ok: false, error: `Criterion "${missingCriterion}" not found in loop "${loopName}".` };
	const missingArtifact = artifactIds.find((artifactId) => !artifactSet.has(artifactId));
	if (missingArtifact) return { ok: false, error: `Artifact "${missingArtifact}" not found in loop "${loopName}".` };
	const missingFinalReport = finalReportIds.find((reportId) => !finalReportSet.has(reportId));
	if (missingFinalReport) return { ok: false, error: `Final report "${missingFinalReport}" not found in loop "${loopName}".` };
	return { ok: true, criterionIds, artifactIds, finalReportIds };
}

export function recordAdvisoryHandoff(ctx: ExtensionContext, loopName: string, input: Partial<AdvisoryHandoff> & { objective?: string }): { ok: true; state: LoopState; handoff: AdvisoryHandoff; created: boolean } | { ok: false; error: string } {
	const state = loadState(ctx, loopName);
	if (!state) return { ok: false, error: `Loop "${loopName}" not found.` };
	const id = normalizeId(input.id, nextSequentialId("ah", state.advisoryHandoffs));
	const existingIndex = state.advisoryHandoffs.findIndex((handoff) => handoff.id === id);
	const existing = existingIndex >= 0 ? state.advisoryHandoffs[existingIndex] : undefined;
	const objective = typeof input.objective === "string" && input.objective.trim() ? input.objective.trim() : existing?.objective;
	if (!objective) return { ok: false, error: "Advisory handoff requires objective." };
	const refs = validateRefs(state, input, loopName);
	if (!refs.ok) return refs;
	const now = new Date().toISOString();
	const handoff: AdvisoryHandoff = {
		id,
		role: isAdvisoryHandoffRole(input.role) ? input.role : existing?.role ?? "explorer",
		status: isAdvisoryHandoffStatus(input.status) ? input.status : existing?.status ?? "draft",
		objective: compactText(objective, 500) ?? objective,
		summary: typeof input.summary === "string" && input.summary.trim() ? compactText(input.summary.trim(), 500) ?? input.summary.trim() : existing?.summary ?? compactText(objective, 160) ?? objective,
		criterionIds: input.criterionIds !== undefined ? refs.criterionIds : existing?.criterionIds ?? [],
		artifactIds: input.artifactIds !== undefined ? refs.artifactIds : existing?.artifactIds ?? [],
		finalReportIds: input.finalReportIds !== undefined ? refs.finalReportIds : existing?.finalReportIds ?? [],
		contextRefs: input.contextRefs !== undefined ? compactList(normalizeStringList(input.contextRefs), 20, 240) : existing?.contextRefs ?? [],
		constraints: input.constraints !== undefined ? compactList(normalizeStringList(input.constraints), 20, 240) : existing?.constraints ?? [],
		requestedOutput: typeof input.requestedOutput === "string" && input.requestedOutput.trim() ? compactText(input.requestedOutput.trim(), 500) ?? input.requestedOutput.trim() : existing?.requestedOutput ?? "Return a compact advisory report with evidence, risks, recommendations, and follow-ups.",
		provider: input.provider !== undefined ? normalizeProviderMetadata(input.provider) : existing?.provider,
		resultSummary: typeof input.resultSummary === "string" && input.resultSummary.trim() ? compactText(input.resultSummary.trim(), 500) ?? input.resultSummary.trim() : existing?.resultSummary,
		concerns: input.concerns !== undefined ? compactList(normalizeStringList(input.concerns), 20, 240) : existing?.concerns ?? [],
		recommendations: input.recommendations !== undefined ? compactList(normalizeStringList(input.recommendations), 20, 240) : existing?.recommendations ?? [],
		artifactRefs: input.artifactRefs !== undefined ? compactList(normalizeStringList(input.artifactRefs), 20, 240) : existing?.artifactRefs ?? [],
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
	};
	if (existingIndex >= 0) state.advisoryHandoffs[existingIndex] = handoff;
	else state.advisoryHandoffs.push(handoff);
	state.advisoryHandoffs.sort((a, b) => a.id.localeCompare(b.id));
	saveState(ctx, state);
	return { ok: true, state, handoff, created: existingIndex < 0 };
}

const advisoryRoleSchema = Type.Union([Type.Literal("explorer"), Type.Literal("test_runner"), Type.Literal("researcher"), Type.Literal("reviewer"), Type.Literal("governor"), Type.Literal("auditor"), Type.Literal("implementer")]);
const advisoryStatusSchema = Type.Union([Type.Literal("draft"), Type.Literal("requested"), Type.Literal("answered"), Type.Literal("failed"), Type.Literal("dismissed")]);

const advisoryHandoffInputSchema = Type.Object({
	id: Type.Optional(Type.String({ description: "Handoff id. Generated for record when omitted." })),
	role: Type.Optional(advisoryRoleSchema),
	status: Type.Optional(advisoryStatusSchema),
	objective: Type.Optional(Type.String({ description: "Provider-neutral handoff objective. Required for payload and new records." })),
	summary: Type.Optional(Type.String({ description: "Compact handoff summary." })),
	criterionIds: Type.Optional(Type.Array(Type.String(), { description: "Criterion ids selected for this handoff." })),
	artifactIds: Type.Optional(Type.Array(Type.String(), { description: "Artifact ids selected for this handoff." })),
	finalReportIds: Type.Optional(Type.Array(Type.String(), { description: "Final report ids selected for this handoff." })),
	contextRefs: Type.Optional(Type.Array(Type.String(), { description: "Compact file/path/doc refs to include." })),
	constraints: Type.Optional(Type.Array(Type.String(), { description: "Provider-neutral constraints for the assignee." })),
	requestedOutput: Type.Optional(Type.String({ description: "Provider-neutral output contract." })),
	provider: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Opaque optional provider metadata. Not used as source of truth." })),
	resultSummary: Type.Optional(Type.String({ description: "Compact returned result summary." })),
	concerns: Type.Optional(Type.Array(Type.String(), { description: "Compact concerns returned by the assignee." })),
	recommendations: Type.Optional(Type.Array(Type.String(), { description: "Compact recommendations returned by the assignee." })),
	artifactRefs: Type.Optional(Type.Array(Type.String(), { description: "Paths/URLs/refs to external artifacts or transcripts." })),
});

export function registerAdvisoryHandoffTool(pi: ExtensionAPI, deps: AdvisoryHandoffToolDeps): void {
	pi.registerTool({
		name: "stardock_handoff",
		label: "Manage Stardock Advisory Handoffs",
		description: "Build provider-neutral advisory handoff payloads and record compact handoff results without executing a provider.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("list"), Type.Literal("payload"), Type.Literal("record")], { description: "list returns handoffs; payload builds a provider-neutral task; record creates or updates one compact handoff." }),
			loopName: Type.Optional(Type.String({ description: "Loop name. Defaults to the active loop." })),
			id: Type.Optional(Type.String({ description: "Handoff id. Generated for record when omitted." })),
			role: Type.Optional(advisoryRoleSchema),
			status: Type.Optional(advisoryStatusSchema),
			objective: Type.Optional(Type.String({ description: "Provider-neutral handoff objective. Required for payload and new records." })),
			summary: Type.Optional(Type.String({ description: "Compact handoff summary." })),
			criterionIds: Type.Optional(Type.Array(Type.String(), { description: "Criterion ids selected for this handoff." })),
			artifactIds: Type.Optional(Type.Array(Type.String(), { description: "Artifact ids selected for this handoff." })),
			finalReportIds: Type.Optional(Type.Array(Type.String(), { description: "Final report ids selected for this handoff." })),
			contextRefs: Type.Optional(Type.Array(Type.String(), { description: "Compact file/path/doc refs to include." })),
			constraints: Type.Optional(Type.Array(Type.String(), { description: "Provider-neutral constraints for the assignee." })),
			requestedOutput: Type.Optional(Type.String({ description: "Provider-neutral output contract." })),
			provider: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Opaque optional provider metadata. Not used as source of truth." })),
			resultSummary: Type.Optional(Type.String({ description: "Compact returned result summary." })),
			concerns: Type.Optional(Type.Array(Type.String(), { description: "Compact concerns returned by the assignee." })),
			recommendations: Type.Optional(Type.Array(Type.String(), { description: "Compact recommendations returned by the assignee." })),
			artifactRefs: Type.Optional(Type.Array(Type.String(), { description: "Paths/URLs/refs to external artifacts or transcripts." })),
			handoffs: Type.Optional(Type.Array(advisoryHandoffInputSchema, { description: "Batch advisory handoffs for record. Single-handoff fields remain compatibility sugar." })),
			includeState: Type.Optional(Type.Boolean({ description: "Include compact loop summary in details after mutation." })),
			includeOverview: Type.Optional(Type.Boolean({ description: "Include text overview in details after mutation." })),
			followupTool: FollowupToolParameter,
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const loopName = params.loopName ?? deps.getCurrentLoop();
			if (!loopName) return { content: [{ type: "text", text: "No active Stardock loop." }], details: {} };
			const state = loadState(ctx, loopName);
			if (!state) return { content: [{ type: "text", text: `Loop "${loopName}" not found.` }], details: { loopName } };
			if (params.action === "list") {
				return { content: [{ type: "text", text: formatAdvisoryHandoffOverview(state) }], details: { loopName, advisoryHandoffs: state.advisoryHandoffs } };
			}
			if (params.action === "payload") {
				const payload = buildAdvisoryHandoffPayload(state, params);
				if (!payload.ok) return { content: [{ type: "text", text: payload.error }], details: { loopName } };
				return { content: [{ type: "text", text: payload.payload }], details: { loopName, role: params.role, objective: params.objective, advisoryHandoffs: state.advisoryHandoffs } };
			}
			const response = runAdvisoryHandoffRecord(loopName, params, { record: (input) => recordAdvisoryHandoff(ctx, loopName, input) });
			if (response.error) return { content: [{ type: "text", text: response.contentText }], details: response.details };
			deps.updateUI(ctx);
			const details = response.state ? { ...response.details, ...deps.optionalLoopDetails(ctx, response.state, params) } : response.details;
			return {
				content: [{ type: "text", text: response.contentText }],
				details,
			};
		},
	});
}
