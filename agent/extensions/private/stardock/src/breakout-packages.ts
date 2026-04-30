/**
 * Manual breakout package slice for Stardock.
 */

import type { ExtensionAPI,ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { batchFailureDetails, describeBatchMutation, normalizeBatchInputs, runOrderedBatch } from "./app/batch.ts";
import { FollowupToolParameter, type FollowupToolRequest } from "./runtime/followups.ts";
import { formatCriterionCounts } from "./ledger.ts";
import { type BreakoutPackage, compactText, type LoopState, nextSequentialId } from "./state/core.ts";
import { isBreakoutPackageStatus, normalizeId, normalizeStringList } from "./state/migration.ts";
import { loadState, saveState } from "./state/store.ts";

export interface BreakoutToolDeps {
	getCurrentLoop(): string | null;
	updateUI(ctx: ExtensionContext): void;
	optionalLoopDetails(ctx: ExtensionContext, state: LoopState, options: { includeState?: boolean; includeOverview?: boolean; followupTool?: FollowupToolRequest }): Record<string, unknown>;
}

function compactList(items: string[], maxItems = 8, maxLength = 180): string[] {
	return items.slice(0, maxItems).map((item) => compactText(item, maxLength) ?? item);
}

function appendSection(lines: string[], title: string, items: string[]): void {
	if (!items.length) return;
	lines.push("", title, ...items);
}

function idSet(items: Array<{ id: string }>): Set<string> {
	return new Set(items.map((item) => item.id));
}

function attemptIds(state: LoopState): Set<string> {
	if (state.modeState.kind !== "recursive") return new Set();
	return idSet(state.modeState.attempts);
}

function validateRefs(
	state: LoopState,
	input: {
		blockedCriterionIds?: unknown;
		attemptIds?: unknown;
		artifactIds?: unknown;
		finalReportIds?: unknown;
		auditorReviewIds?: unknown;
		advisoryHandoffIds?: unknown;
		outsideRequestIds?: unknown;
	},
	loopName: string,
):
	| { ok: true; blockedCriterionIds: string[]; attemptIds: string[]; artifactIds: string[]; finalReportIds: string[]; auditorReviewIds: string[]; advisoryHandoffIds: string[]; outsideRequestIds: string[] }
	| { ok: false; error: string } {
	const blockedCriterionIds = normalizeStringList(input.blockedCriterionIds);
	const normalizedAttemptIds = normalizeStringList(input.attemptIds);
	const artifactIds = normalizeStringList(input.artifactIds);
	const finalReportIds = normalizeStringList(input.finalReportIds);
	const auditorReviewIds = normalizeStringList(input.auditorReviewIds);
	const advisoryHandoffIds = normalizeStringList(input.advisoryHandoffIds);
	const outsideRequestIds = normalizeStringList(input.outsideRequestIds);
	const sets = {
		criterion: idSet(state.criterionLedger.criteria),
		attempt: attemptIds(state),
		artifact: idSet(state.verificationArtifacts),
		finalReport: idSet(state.finalVerificationReports),
		auditorReview: idSet(state.auditorReviews),
		advisoryHandoff: idSet(state.advisoryHandoffs),
		outsideRequest: idSet(state.outsideRequests),
	};
	const missingCriterion = blockedCriterionIds.find((id) => !sets.criterion.has(id));
	if (missingCriterion) return { ok: false, error: `Criterion "${missingCriterion}" not found in loop "${loopName}".` };
	const missingAttempt = normalizedAttemptIds.find((id) => !sets.attempt.has(id));
	if (missingAttempt) return { ok: false, error: `Attempt "${missingAttempt}" not found in loop "${loopName}".` };
	const missingArtifact = artifactIds.find((id) => !sets.artifact.has(id));
	if (missingArtifact) return { ok: false, error: `Artifact "${missingArtifact}" not found in loop "${loopName}".` };
	const missingFinalReport = finalReportIds.find((id) => !sets.finalReport.has(id));
	if (missingFinalReport) return { ok: false, error: `Final report "${missingFinalReport}" not found in loop "${loopName}".` };
	const missingAuditorReview = auditorReviewIds.find((id) => !sets.auditorReview.has(id));
	if (missingAuditorReview) return { ok: false, error: `Auditor review "${missingAuditorReview}" not found in loop "${loopName}".` };
	const missingAdvisoryHandoff = advisoryHandoffIds.find((id) => !sets.advisoryHandoff.has(id));
	if (missingAdvisoryHandoff) return { ok: false, error: `Advisory handoff "${missingAdvisoryHandoff}" not found in loop "${loopName}".` };
	const missingOutsideRequest = outsideRequestIds.find((id) => !sets.outsideRequest.has(id));
	if (missingOutsideRequest) return { ok: false, error: `Outside request "${missingOutsideRequest}" not found in loop "${loopName}".` };
	return { ok: true, blockedCriterionIds, attemptIds: normalizedAttemptIds, artifactIds, finalReportIds, auditorReviewIds, advisoryHandoffIds, outsideRequestIds };
}

export function formatBreakoutPackageOverview(state: LoopState): string {
	const lines = [`Breakout packages for ${state.name}`, `Packages: ${state.breakoutPackages.length} total`, formatCriterionCounts(state.criterionLedger), `Artifacts: ${state.verificationArtifacts.length} total`, `Final reports: ${state.finalVerificationReports.length} total`];
	if (state.breakoutPackages.length > 0) {
		lines.push("");
		for (const breakout of state.breakoutPackages.slice(0, 10)) {
			lines.push(`- ${breakout.id} [${breakout.status}] ${compactText(breakout.summary, 140)}`);
			if (breakout.blockedCriterionIds.length) lines.push(`  Blocked criteria: ${breakout.blockedCriterionIds.join(",")}`);
			lines.push(`  Decision: ${compactText(breakout.requestedDecision, 140)}`);
			if (breakout.recommendedNextActions.length) lines.push(`  Next: ${compactList(breakout.recommendedNextActions, 3, 100).join("; ")}`);
		}
		if (state.breakoutPackages.length > 10) lines.push(`... ${state.breakoutPackages.length - 10} more breakout packages`);
	}
	return lines.join("\n");
}

export function buildBreakoutPayload(state: LoopState, input: Partial<BreakoutPackage>): { ok: true; payload: string } | { ok: false; error: string } {
	const refs = validateRefs(state, input, state.name);
	if (!refs.ok) return refs;
	const summary = typeof input.summary === "string" && input.summary.trim() ? input.summary.trim() : "Loop is blocked, stuck, or lacks enough evidence to continue confidently.";
	const requestedDecision = typeof input.requestedDecision === "string" && input.requestedDecision.trim() ? input.requestedDecision.trim() : "Decide whether to resume, pivot, narrow scope, request help, or stop.";
	const selectedCriteria = refs.blockedCriterionIds.length ? state.criterionLedger.criteria.filter((criterion) => refs.blockedCriterionIds.includes(criterion.id)) : state.criterionLedger.criteria.filter((criterion) => ["failed", "blocked", "pending"].includes(criterion.status)).slice(0, 8);
	const selectedArtifacts = refs.artifactIds.length ? state.verificationArtifacts.filter((artifact) => refs.artifactIds.includes(artifact.id)) : state.verificationArtifacts.slice(-6);
	const selectedReports = refs.finalReportIds.length ? state.finalVerificationReports.filter((report) => refs.finalReportIds.includes(report.id)) : state.finalVerificationReports.slice(-4);
	const lines = [
		`Breakout package payload for loop "${state.name}"`,
		`Status: ${isBreakoutPackageStatus(input.status) ? input.status : "open"}`,
		`Mode: ${state.mode}`,
		`Iteration: ${state.iteration}${state.maxIterations > 0 ? `/${state.maxIterations}` : ""}`,
		formatCriterionCounts(state.criterionLedger),
		"",
		"Breakout task:",
		"Use this compact package to decide whether to resume, pivot, narrow scope, request help, or stop. Do not execute tools, call models, spawn agents, or apply edits unless separately instructed by the parent/orchestrator.",
		"",
		`Summary: ${compactText(summary, 500)}`,
		`Requested decision: ${compactText(requestedDecision, 500)}`,
	];
	appendSection(lines, "Blocked or relevant criteria", selectedCriteria.map((criterion) => `- ${criterion.id} [${criterion.status}] ${compactText(criterion.description, 140)} | Pass: ${compactText(criterion.passCondition, 140)}${criterion.evidence ? ` | Evidence: ${compactText(criterion.evidence, 100)}` : ""}`));
	appendSection(lines, "Last errors", compactList(normalizeStringList(input.lastErrors), 8, 180).map((error) => `- ${error}`));
	appendSection(lines, "Suspected root causes", compactList(normalizeStringList(input.suspectedRootCauses), 8, 180).map((cause) => `- ${cause}`));
	appendSection(lines, "Resume criteria", compactList(normalizeStringList(input.resumeCriteria), 8, 180).map((criterion) => `- ${criterion}`));
	appendSection(lines, "Recommended next actions", compactList(normalizeStringList(input.recommendedNextActions), 8, 180).map((action) => `- ${action}`));
	appendSection(lines, "Verification artifacts", selectedArtifacts.map((artifact) => `- ${artifact.id} [${artifact.kind}] ${compactText(artifact.summary, 160)}${artifact.path ? ` | Path: ${artifact.path}` : ""}`));
	appendSection(lines, "Final reports", selectedReports.map((report) => `- ${report.id} [${report.status}] ${compactText(report.summary, 160)}${report.unresolvedGaps.length ? ` | Gaps: ${compactList(report.unresolvedGaps, 2, 100).join("; ")}` : ""}`));
	appendSection(lines, "Auditor reviews", state.auditorReviews.filter((review) => refs.auditorReviewIds.includes(review.id)).map((review) => `- ${review.id} [${review.status}] ${compactText(review.summary, 160)}`));
	appendSection(lines, "Advisory handoffs", state.advisoryHandoffs.filter((handoff) => refs.advisoryHandoffIds.includes(handoff.id)).map((handoff) => `- ${handoff.id} [${handoff.status}/${handoff.role}] ${compactText(handoff.summary, 160)}`));
	appendSection(lines, "Outside requests", state.outsideRequests.filter((request) => refs.outsideRequestIds.includes(request.id)).map((request) => `- ${request.id} [${request.status}/${request.kind}] ${compactText(request.decision?.requiredNextMove ?? request.answer ?? request.prompt, 160)}`));
	if (state.modeState.kind === "recursive") appendSection(lines, "Attempts", state.modeState.attempts.filter((attempt) => refs.attemptIds.includes(attempt.id)).map((attempt) => `- ${attempt.id} [${attempt.status}${attempt.result ? `/${attempt.result}` : ""}] ${compactText(attempt.summary || attempt.hypothesis || attempt.actionSummary, 180)}`));
	appendSection(lines, "Prior breakout packages", state.breakoutPackages.slice(-5).map((breakout) => `- ${breakout.id} [${breakout.status}] ${compactText(breakout.summary, 160)} | Decision: ${compactText(breakout.requestedDecision, 120)}`));
	lines.push("", "Expected response fields:", "- status: open | resolved | dismissed", "- requestedDecision outcome or rationale", "- resumeCriteria", "- recommendedNextActions", "- remaining evidence gaps or blockers");
	return { ok: true, payload: lines.join("\n") };
}

export function recordBreakoutPackage(ctx: ExtensionContext, loopName: string, input: Partial<BreakoutPackage>): { ok: true; state: LoopState; breakout: BreakoutPackage; created: boolean } | { ok: false; error: string } {
	const state = loadState(ctx, loopName);
	if (!state) return { ok: false, error: `Loop "${loopName}" not found.` };
	const id = normalizeId(input.id, nextSequentialId("bp", state.breakoutPackages));
	const existingIndex = state.breakoutPackages.findIndex((breakout) => breakout.id === id);
	const existing = existingIndex >= 0 ? state.breakoutPackages[existingIndex] : undefined;
	const summary = typeof input.summary === "string" && input.summary.trim() ? input.summary.trim() : existing?.summary;
	const requestedDecision = typeof input.requestedDecision === "string" && input.requestedDecision.trim() ? input.requestedDecision.trim() : existing?.requestedDecision;
	if (!summary && !requestedDecision) return { ok: false, error: "Breakout package requires summary or requestedDecision." };
	const refs = validateRefs(state, input, loopName);
	if (!refs.ok) return refs;
	const now = new Date().toISOString();
	const breakout: BreakoutPackage = {
		id,
		status: isBreakoutPackageStatus(input.status) ? input.status : existing?.status ?? "draft",
		summary: summary ? compactText(summary, 500) ?? summary : compactText(requestedDecision, 500) ?? requestedDecision ?? "Breakout package",
		blockedCriterionIds: input.blockedCriterionIds !== undefined ? refs.blockedCriterionIds : existing?.blockedCriterionIds ?? [],
		attemptIds: input.attemptIds !== undefined ? refs.attemptIds : existing?.attemptIds ?? [],
		artifactIds: input.artifactIds !== undefined ? refs.artifactIds : existing?.artifactIds ?? [],
		finalReportIds: input.finalReportIds !== undefined ? refs.finalReportIds : existing?.finalReportIds ?? [],
		auditorReviewIds: input.auditorReviewIds !== undefined ? refs.auditorReviewIds : existing?.auditorReviewIds ?? [],
		advisoryHandoffIds: input.advisoryHandoffIds !== undefined ? refs.advisoryHandoffIds : existing?.advisoryHandoffIds ?? [],
		outsideRequestIds: input.outsideRequestIds !== undefined ? refs.outsideRequestIds : existing?.outsideRequestIds ?? [],
		lastErrors: input.lastErrors !== undefined ? compactList(normalizeStringList(input.lastErrors), 20, 240) : existing?.lastErrors ?? [],
		suspectedRootCauses: input.suspectedRootCauses !== undefined ? compactList(normalizeStringList(input.suspectedRootCauses), 20, 240) : existing?.suspectedRootCauses ?? [],
		requestedDecision: requestedDecision ? compactText(requestedDecision, 500) ?? requestedDecision : existing?.requestedDecision ?? "Decide whether to resume, pivot, narrow scope, request help, or stop.",
		resumeCriteria: input.resumeCriteria !== undefined ? compactList(normalizeStringList(input.resumeCriteria), 20, 240) : existing?.resumeCriteria ?? [],
		recommendedNextActions: input.recommendedNextActions !== undefined ? compactList(normalizeStringList(input.recommendedNextActions), 20, 240) : existing?.recommendedNextActions ?? [],
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
	};
	if (existingIndex >= 0) state.breakoutPackages[existingIndex] = breakout;
	else state.breakoutPackages.push(breakout);
	state.breakoutPackages.sort((a, b) => a.id.localeCompare(b.id));
	saveState(ctx, state);
	return { ok: true, state, breakout, created: existingIndex < 0 };
}

const breakoutStatusSchema = Type.Union([Type.Literal("draft"), Type.Literal("open"), Type.Literal("resolved"), Type.Literal("dismissed")]);

const breakoutPackageInputSchema = Type.Object({
	id: Type.Optional(Type.String({ description: "Breakout package id. Generated for record when omitted." })),
	status: Type.Optional(breakoutStatusSchema),
	summary: Type.Optional(Type.String({ description: "Compact stuck/blocked loop summary." })),
	blockedCriterionIds: Type.Optional(Type.Array(Type.String(), { description: "Blocked, failed, or relevant criterion ids." })),
	attemptIds: Type.Optional(Type.Array(Type.String(), { description: "Recursive attempt ids referenced by this package." })),
	artifactIds: Type.Optional(Type.Array(Type.String(), { description: "Verification artifact ids referenced by this package." })),
	finalReportIds: Type.Optional(Type.Array(Type.String(), { description: "Final report ids referenced by this package." })),
	auditorReviewIds: Type.Optional(Type.Array(Type.String(), { description: "Auditor review ids referenced by this package." })),
	advisoryHandoffIds: Type.Optional(Type.Array(Type.String(), { description: "Advisory handoff ids referenced by this package." })),
	outsideRequestIds: Type.Optional(Type.Array(Type.String(), { description: "Outside request ids referenced by this package." })),
	lastErrors: Type.Optional(Type.Array(Type.String(), { description: "Compact recent errors or failure observations." })),
	suspectedRootCauses: Type.Optional(Type.Array(Type.String(), { description: "Compact suspected root causes." })),
	requestedDecision: Type.Optional(Type.String({ description: "Decision requested from user/governor/auditor/advisor." })),
	resumeCriteria: Type.Optional(Type.Array(Type.String(), { description: "Conditions that make resuming safe or useful." })),
	recommendedNextActions: Type.Optional(Type.Array(Type.String(), { description: "Compact recommended next actions." })),
});

export function registerBreakoutTool(pi: ExtensionAPI, deps: BreakoutToolDeps): void {
	pi.registerTool({
		name: "stardock_breakout",
		label: "Manage Stardock Breakout Packages",
		description: "Build manual breakout decision payloads and record compact breakout packages for stuck or blocked Stardock loops.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("list"), Type.Literal("payload"), Type.Literal("record")], { description: "list returns breakout packages; payload builds a decision package; record creates or updates one compact package." }),
			loopName: Type.Optional(Type.String({ description: "Loop name. Defaults to the active loop." })),
			id: Type.Optional(Type.String({ description: "Breakout package id. Generated for record when omitted." })),
			status: Type.Optional(breakoutStatusSchema),
			summary: Type.Optional(Type.String({ description: "Compact stuck/blocked loop summary." })),
			blockedCriterionIds: Type.Optional(Type.Array(Type.String(), { description: "Blocked, failed, or relevant criterion ids." })),
			attemptIds: Type.Optional(Type.Array(Type.String(), { description: "Recursive attempt ids referenced by this package." })),
			artifactIds: Type.Optional(Type.Array(Type.String(), { description: "Verification artifact ids referenced by this package." })),
			finalReportIds: Type.Optional(Type.Array(Type.String(), { description: "Final report ids referenced by this package." })),
			auditorReviewIds: Type.Optional(Type.Array(Type.String(), { description: "Auditor review ids referenced by this package." })),
			advisoryHandoffIds: Type.Optional(Type.Array(Type.String(), { description: "Advisory handoff ids referenced by this package." })),
			outsideRequestIds: Type.Optional(Type.Array(Type.String(), { description: "Outside request ids referenced by this package." })),
			lastErrors: Type.Optional(Type.Array(Type.String(), { description: "Compact recent errors or failure observations." })),
			suspectedRootCauses: Type.Optional(Type.Array(Type.String(), { description: "Compact suspected root causes." })),
			requestedDecision: Type.Optional(Type.String({ description: "Decision requested from user/governor/auditor/advisor." })),
			resumeCriteria: Type.Optional(Type.Array(Type.String(), { description: "Conditions that make resuming safe or useful." })),
			recommendedNextActions: Type.Optional(Type.Array(Type.String(), { description: "Compact recommended next actions." })),
			packages: Type.Optional(Type.Array(breakoutPackageInputSchema, { description: "Batch breakout packages for record. Single-package fields remain compatibility sugar." })),
			includeState: Type.Optional(Type.Boolean({ description: "Include compact loop summary in details after mutation." })),
			includeOverview: Type.Optional(Type.Boolean({ description: "Include text overview in details after mutation." })),
			followupTool: FollowupToolParameter,
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const loopName = params.loopName ?? deps.getCurrentLoop();
			if (!loopName) return { content: [{ type: "text", text: "No active Stardock loop." }], details: {} };
			const state = loadState(ctx, loopName);
			if (!state) return { content: [{ type: "text", text: `Loop "${loopName}" not found.` }], details: { loopName } };
			if (params.action === "list") return { content: [{ type: "text", text: formatBreakoutPackageOverview(state) }], details: { loopName, breakoutPackages: state.breakoutPackages } };
			if (params.action === "payload") {
				const payload = buildBreakoutPayload(state, params);
				if (!payload.ok) return { content: [{ type: "text", text: payload.error }], details: { loopName } };
				return { content: [{ type: "text", text: payload.payload }], details: { loopName, breakoutPackages: state.breakoutPackages } };
			}
			const inputs = normalizeBatchInputs(params, params.packages);
			const batch = runOrderedBatch(inputs.inputs, inputs.isBatch, (input) => {
				const result = recordBreakoutPackage(ctx, loopName, input);
				return result.ok ? { state: result.state, item: result.breakout, created: result.created } : result;
			});
			if (!batch.ok) return { content: [{ type: "text", text: batch.error }], details: batchFailureDetails(loopName, batch) };
			deps.updateUI(ctx);
			const updatedState = batch.lastState;
			const response = describeBatchMutation(batch, { verb: "Recorded", singularName: "breakout", pluralName: "breakout packages", pluralDetailKey: "packages", singleItemText: (breakout, result) => `${result.created ? "Recorded" : "Updated"} breakout package ${breakout.id}` });
			return {
				content: [{ type: "text", text: `${response.contentText} in loop "${loopName}".` }],
				details: { loopName, [response.detailKey]: response.detailValue, breakoutPackages: updatedState.breakoutPackages, ...deps.optionalLoopDetails(ctx, updatedState, params) },
			};
		},
	});
}
