/**
 * Manual auditor review slice for Stardock.
 */

import type { ExtensionAPI,ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { FollowupToolParameter, type FollowupToolRequest } from "./runtime/followups.ts";
import { formatCriterionCounts } from "./ledger.ts";
import { latestGovernorDecision } from "./outside-requests.ts";
import { type AuditorReview, compactText, type LoopState, nextSequentialId } from "./state/core.ts";
import { isAuditorReviewStatus, normalizeId, normalizeStringList } from "./state/migration.ts";
import { loadState, saveState } from "./state/store.ts";

export interface AuditorToolDeps {
	getCurrentLoop(): string | null;
	updateUI(ctx: ExtensionContext): void;
	optionalLoopDetails(ctx: ExtensionContext, state: LoopState, options: { includeState?: boolean; includeOverview?: boolean; followupTool?: FollowupToolRequest }): Record<string, unknown>;
}

function compactList(items: string[], maxItems = 5, maxLength = 160): string[] {
	return items.slice(0, maxItems).map((item) => compactText(item, maxLength) ?? item);
}

export function formatAuditorReviewOverview(state: LoopState): string {
	const lines = [`Auditor reviews for ${state.name}`, `Reviews: ${state.auditorReviews.length} total`, formatCriterionCounts(state.criterionLedger), `Final reports: ${state.finalVerificationReports.length} total`];
	if (state.auditorReviews.length > 0) {
		lines.push("");
		for (const review of state.auditorReviews.slice(0, 10)) {
			lines.push(`- ${review.id} [${review.status}] ${compactText(review.summary, 140)}`);
			lines.push(`  Focus: ${compactText(review.focus, 140)}`);
			if (review.concerns.length) lines.push(`  Concerns: ${compactList(review.concerns, 3, 100).join("; ")}`);
			if (review.requiredFollowups.length) lines.push(`  Followups: ${compactList(review.requiredFollowups, 3, 100).join("; ")}`);
		}
		if (state.auditorReviews.length > 10) lines.push(`... ${state.auditorReviews.length - 10} more reviews`);
	}
	return lines.join("\n");
}

function appendSection(lines: string[], title: string, items: string[]): void {
	if (!items.length) return;
	lines.push("", title, ...items);
}

export function buildAuditorPayload(state: LoopState, focus?: string): string {
	const lines = [
		`Auditor review payload for loop "${state.name}"`,
		`Focus: ${compactText(focus?.trim() || "Review evidence, trajectory, unresolved gaps, and readiness risks.", 240)}`,
		`Mode: ${state.mode}`,
		`Iteration: ${state.iteration}${state.maxIterations > 0 ? `/${state.maxIterations}` : ""}`,
		formatCriterionCounts(state.criterionLedger),
		`Artifacts: ${state.verificationArtifacts.length}`,
		`Final reports: ${state.finalVerificationReports.length}`,
		`Prior auditor reviews: ${state.auditorReviews.length}`,
		"",
		"Auditor task:",
		"Review whether the evidence supports the current trajectory. Identify concerns, missing evidence, risky assumptions, and required follow-ups. Do not execute code or call tools unless separately instructed; return a concise review suitable for stardock_auditor record.",
	];

	appendSection(
		lines,
		"Criteria",
		state.criterionLedger.criteria.slice(0, 12).map((criterion) => `- ${criterion.id} [${criterion.status}] ${compactText(criterion.description, 140)} | Pass: ${compactText(criterion.passCondition, 140)}${criterion.evidence ? ` | Evidence: ${compactText(criterion.evidence, 100)}` : ""}`),
	);
	if (state.criterionLedger.criteria.length > 12) lines.push(`- ... ${state.criterionLedger.criteria.length - 12} more criteria`);

	appendSection(
		lines,
		"Verification artifacts",
		state.verificationArtifacts.slice(0, 10).map((artifact) => `- ${artifact.id} [${artifact.kind}] ${compactText(artifact.summary, 160)}${artifact.path ? ` | Path: ${artifact.path}` : ""}${artifact.criterionIds?.length ? ` | Criteria: ${artifact.criterionIds.join(",")}` : ""}`),
	);
	if (state.verificationArtifacts.length > 10) lines.push(`- ... ${state.verificationArtifacts.length - 10} more artifacts`);

	appendSection(
		lines,
		"Final verification reports",
		state.finalVerificationReports.slice(0, 8).map((report) => `- ${report.id} [${report.status}] ${compactText(report.summary, 160)}${report.unresolvedGaps.length ? ` | Gaps: ${compactList(report.unresolvedGaps, 2, 100).join("; ")}` : ""}`),
	);
	if (state.finalVerificationReports.length > 8) lines.push(`- ... ${state.finalVerificationReports.length - 8} more final reports`);

	if (state.modeState.kind === "recursive") {
		appendSection(
			lines,
			"Recent attempts",
			state.modeState.attempts.slice(-5).map((attempt) => `- ${attempt.id} [${attempt.status}${attempt.kind ? `/${attempt.kind}` : ""}${attempt.result ? `/${attempt.result}` : ""}] ${compactText(attempt.summary || attempt.hypothesis || attempt.actionSummary, 180)}`),
		);
	}

	appendSection(
		lines,
		"Outside requests and governor decisions",
		state.outsideRequests.slice(-6).map((request) => `- ${request.id} [${request.status}/${request.kind}/${request.trigger}] ${compactText(request.decision?.requiredNextMove ?? request.answer ?? request.prompt, 180)}`),
	);
	const decision = latestGovernorDecision(state);
	if (decision) {
		lines.push(`Latest governor verdict: ${decision.verdict}; ${compactText(decision.rationale, 180)}`);
		if (decision.requiredNextMove) lines.push(`Required next move: ${compactText(decision.requiredNextMove, 180)}`);
	}

	appendSection(
		lines,
		"Prior auditor reviews",
		state.auditorReviews.slice(-5).map((review) => `- ${review.id} [${review.status}] ${compactText(review.summary, 160)}${review.requiredFollowups.length ? ` | Followups: ${compactList(review.requiredFollowups, 2, 100).join("; ")}` : ""}`),
	);

	lines.push("", "Expected response fields:", "- status: draft | passed | concerns | blocked", "- summary", "- concerns", "- recommendations", "- requiredFollowups", "- referenced criterionIds/artifactIds/finalReportIds, if applicable");
	return lines.join("\n");
}

export function recordAuditorReview(ctx: ExtensionContext, loopName: string, input: Partial<AuditorReview> & { summary?: string }): { ok: true; state: LoopState; review: AuditorReview; created: boolean } | { ok: false; error: string } {
	const state = loadState(ctx, loopName);
	if (!state) return { ok: false, error: `Loop "${loopName}" not found.` };
	const id = normalizeId(input.id, nextSequentialId("ar", state.auditorReviews));
	const existingIndex = state.auditorReviews.findIndex((review) => review.id === id);
	const existing = existingIndex >= 0 ? state.auditorReviews[existingIndex] : undefined;
	const summary = typeof input.summary === "string" && input.summary.trim() ? input.summary.trim() : existing?.summary;
	if (!summary) return { ok: false, error: "Auditor review requires summary." };

	const criterionIds = input.criterionIds !== undefined ? normalizeStringList(input.criterionIds) : existing?.criterionIds ?? [];
	const artifactIds = input.artifactIds !== undefined ? normalizeStringList(input.artifactIds) : existing?.artifactIds ?? [];
	const finalReportIds = input.finalReportIds !== undefined ? normalizeStringList(input.finalReportIds) : existing?.finalReportIds ?? [];
	const criterionSet = new Set(state.criterionLedger.criteria.map((criterion) => criterion.id));
	const artifactSet = new Set(state.verificationArtifacts.map((artifact) => artifact.id));
	const finalReportSet = new Set(state.finalVerificationReports.map((report) => report.id));
	const missingCriterion = criterionIds.find((criterionId) => !criterionSet.has(criterionId));
	if (missingCriterion) return { ok: false, error: `Criterion "${missingCriterion}" not found in loop "${loopName}".` };
	const missingArtifact = artifactIds.find((artifactId) => !artifactSet.has(artifactId));
	if (missingArtifact) return { ok: false, error: `Artifact "${missingArtifact}" not found in loop "${loopName}".` };
	const missingFinalReport = finalReportIds.find((reportId) => !finalReportSet.has(reportId));
	if (missingFinalReport) return { ok: false, error: `Final report "${missingFinalReport}" not found in loop "${loopName}".` };

	const now = new Date().toISOString();
	const review: AuditorReview = {
		id,
		status: isAuditorReviewStatus(input.status) ? input.status : existing?.status ?? "draft",
		summary: compactText(summary, 500) ?? summary,
		focus: typeof input.focus === "string" && input.focus.trim() ? compactText(input.focus.trim(), 240) ?? input.focus.trim() : existing?.focus ?? "General auditor review",
		criterionIds,
		artifactIds,
		finalReportIds,
		concerns: input.concerns !== undefined ? compactList(normalizeStringList(input.concerns), 12, 240) : existing?.concerns ?? [],
		recommendations: input.recommendations !== undefined ? compactList(normalizeStringList(input.recommendations), 12, 240) : existing?.recommendations ?? [],
		requiredFollowups: input.requiredFollowups !== undefined ? compactList(normalizeStringList(input.requiredFollowups), 12, 240) : existing?.requiredFollowups ?? [],
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
	};
	if (existingIndex >= 0) state.auditorReviews[existingIndex] = review;
	else state.auditorReviews.push(review);
	state.auditorReviews.sort((a, b) => a.id.localeCompare(b.id));
	saveState(ctx, state);
	return { ok: true, state, review, created: existingIndex < 0 };
}

export function registerAuditorTool(pi: ExtensionAPI, deps: AuditorToolDeps): void {
	pi.registerTool({
		name: "stardock_auditor",
		label: "Manage Stardock Auditor Reviews",
		description: "Build manual auditor review payloads and record compact auditor review results for a Stardock loop.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("list"), Type.Literal("payload"), Type.Literal("record")], { description: "list returns auditor reviews; payload builds a ready-to-copy review task; record creates or updates one compact review." }),
			loopName: Type.Optional(Type.String({ description: "Loop name. Defaults to the active loop." })),
			id: Type.Optional(Type.String({ description: "Auditor review id. Generated for record when omitted." })),
			status: Type.Optional(Type.Union([Type.Literal("draft"), Type.Literal("passed"), Type.Literal("concerns"), Type.Literal("blocked")], { description: "Auditor review status." })),
			summary: Type.Optional(Type.String({ description: "Compact auditor review summary. Required for new records." })),
			focus: Type.Optional(Type.String({ description: "Review focus for payloads or records." })),
			criterionIds: Type.Optional(Type.Array(Type.String(), { description: "Criterion ids referenced by this review." })),
			artifactIds: Type.Optional(Type.Array(Type.String(), { description: "Artifact ids referenced by this review." })),
			finalReportIds: Type.Optional(Type.Array(Type.String(), { description: "Final report ids referenced by this review." })),
			concerns: Type.Optional(Type.Array(Type.String(), { description: "Compact concerns found by the auditor." })),
			recommendations: Type.Optional(Type.Array(Type.String(), { description: "Compact auditor recommendations." })),
			requiredFollowups: Type.Optional(Type.Array(Type.String(), { description: "Required follow-up checks or actions." })),
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
				return {
					content: [{ type: "text", text: formatAuditorReviewOverview(state) }],
					details: { loopName, auditorReviews: state.auditorReviews },
				};
			}
			if (params.action === "payload") {
				return {
					content: [{ type: "text", text: buildAuditorPayload(state, params.focus) }],
					details: { loopName, focus: params.focus, auditorReviews: state.auditorReviews },
				};
			}
			const result = recordAuditorReview(ctx, loopName, {
				id: params.id,
				status: params.status,
				summary: params.summary,
				focus: params.focus,
				criterionIds: params.criterionIds,
				artifactIds: params.artifactIds,
				finalReportIds: params.finalReportIds,
				concerns: params.concerns,
				recommendations: params.recommendations,
				requiredFollowups: params.requiredFollowups,
			});
			if (!result.ok) return { content: [{ type: "text", text: result.error }], details: { loopName } };
			deps.updateUI(ctx);
			return {
				content: [{ type: "text", text: `${result.created ? "Recorded" : "Updated"} auditor review ${result.review.id} in loop "${loopName}".` }],
				details: { loopName, review: result.review, auditorReviews: result.state.auditorReviews, ...deps.optionalLoopDetails(ctx, result.state, params) },
			};
		},
	});
}
