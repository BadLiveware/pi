/**
 * Final verification report slice for Stardock.
 */

import type { ExtensionAPI,ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { compactText, type FinalValidationRecord, type FinalVerificationReport, type LoopState, nextSequentialId } from "./state/core.ts";
import { isFinalVerificationStatus, isValidationResult, normalizeId, normalizeIds, normalizeStringList } from "./state/migration.ts";
import { loadState, saveState } from "./state/store.ts";

export interface FinalReportToolDeps {
	getCurrentLoop(): string | null;
	updateUI(ctx: ExtensionContext): void;
	optionalLoopDetails(ctx: ExtensionContext, state: LoopState, options: { includeState?: boolean; includeOverview?: boolean }): Record<string, unknown>;
}

export function migrateFinalValidationRecords(value: unknown): FinalValidationRecord[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((item): FinalValidationRecord | null => {
			if (!item || typeof item !== "object") return null;
			const record = item as Partial<FinalValidationRecord> & Record<string, unknown>;
			const summary = typeof record.summary === "string" ? record.summary.trim() : "";
			if (!summary) return null;
			return {
				command: typeof record.command === "string" && record.command.trim() ? compactText(record.command, 240) : undefined,
				result: isValidationResult(record.result) ? record.result : "skipped",
				summary: compactText(summary, 500) ?? summary,
				artifactIds: normalizeIds(record.artifactIds),
			};
		})
		.filter((record): record is FinalValidationRecord => record !== null);
}

export function migrateFinalVerificationReports(value: unknown): FinalVerificationReport[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((item, index): FinalVerificationReport | null => {
			if (!item || typeof item !== "object") return null;
			const report = item as Partial<FinalVerificationReport> & Record<string, unknown>;
			const summary = typeof report.summary === "string" ? report.summary.trim() : "";
			if (!summary) return null;
			const now = new Date().toISOString();
			return {
				id: normalizeId(report.id, `fr${index + 1}`),
				status: isFinalVerificationStatus(report.status) ? report.status : "draft",
				summary: compactText(summary, 500) ?? summary,
				criterionIds: normalizeStringList(report.criterionIds),
				artifactIds: normalizeStringList(report.artifactIds),
				validation: migrateFinalValidationRecords(report.validation),
				unresolvedGaps: normalizeStringList(report.unresolvedGaps).map((gap) => compactText(gap, 240) ?? gap),
				compatibilityNotes: normalizeStringList(report.compatibilityNotes).map((note) => compactText(note, 240) ?? note),
				securityNotes: normalizeStringList(report.securityNotes).map((note) => compactText(note, 240) ?? note),
				performanceNotes: normalizeStringList(report.performanceNotes).map((note) => compactText(note, 240) ?? note),
				createdAt: typeof report.createdAt === "string" ? report.createdAt : now,
				updatedAt: typeof report.updatedAt === "string" ? report.updatedAt : now,
			};
		})
		.filter((report): report is FinalVerificationReport => report !== null);
}

export function formatFinalReportOverview(state: LoopState, formatCriterionCounts: (ledger: LoopState["criterionLedger"]) => string): string {
	const lines = [`Final verification reports for ${state.name}`, `Reports: ${state.finalVerificationReports.length} total`, formatCriterionCounts(state.criterionLedger), `Artifacts: ${state.verificationArtifacts.length} total`];
	if (state.finalVerificationReports.length > 0) {
		lines.push("");
		for (const report of state.finalVerificationReports.slice(0, 8)) {
			lines.push(`- ${report.id} [${report.status}] ${compactText(report.summary, 140)}`);
			if (report.criterionIds.length) lines.push(`  Criteria: ${report.criterionIds.join(",")}`);
			if (report.artifactIds.length) lines.push(`  Artifacts: ${report.artifactIds.join(",")}`);
			if (report.unresolvedGaps.length) lines.push(`  Gaps: ${report.unresolvedGaps.slice(0, 3).map((gap) => compactText(gap, 100)).join("; ")}`);
		}
		if (state.finalVerificationReports.length > 8) lines.push(`... ${state.finalVerificationReports.length - 8} more reports`);
	}
	return lines.join("\n");
}

export function recordFinalVerificationReport(ctx: ExtensionContext, loopName: string, input: Partial<FinalVerificationReport> & { summary?: string }): { ok: true; state: LoopState; report: FinalVerificationReport; created: boolean } | { ok: false; error: string } {
	const state = loadState(ctx, loopName);
	if (!state) return { ok: false, error: `Loop "${loopName}" not found.` };
	const id = normalizeId(input.id, nextSequentialId("fr", state.finalVerificationReports));
	const existingIndex = state.finalVerificationReports.findIndex((report) => report.id === id);
	const existing = existingIndex >= 0 ? state.finalVerificationReports[existingIndex] : undefined;
	const summary = typeof input.summary === "string" && input.summary.trim() ? input.summary.trim() : existing?.summary;
	if (!summary) return { ok: false, error: "Final verification report requires summary." };
	const criterionIds = input.criterionIds !== undefined ? normalizeStringList(input.criterionIds) : existing?.criterionIds ?? [];
	const artifactIds = input.artifactIds !== undefined ? normalizeStringList(input.artifactIds) : existing?.artifactIds ?? [];
	const criterionSet = new Set(state.criterionLedger.criteria.map((criterion) => criterion.id));
	const artifactSet = new Set(state.verificationArtifacts.map((artifact) => artifact.id));
	const missingCriterion = criterionIds.find((criterionId) => !criterionSet.has(criterionId));
	if (missingCriterion) return { ok: false, error: `Criterion "${missingCriterion}" not found in loop "${loopName}".` };
	const validation = input.validation !== undefined ? migrateFinalValidationRecords(input.validation) : existing?.validation ?? [];
	const allArtifactIds = [...artifactIds, ...validation.flatMap((record) => record.artifactIds ?? [])];
	const missingArtifact = allArtifactIds.find((artifactId) => !artifactSet.has(artifactId));
	if (missingArtifact) return { ok: false, error: `Artifact "${missingArtifact}" not found in loop "${loopName}".` };
	const now = new Date().toISOString();
	const report: FinalVerificationReport = {
		id,
		status: isFinalVerificationStatus(input.status) ? input.status : existing?.status ?? "draft",
		summary: compactText(summary, 500) ?? summary,
		criterionIds,
		artifactIds,
		validation,
		unresolvedGaps: input.unresolvedGaps !== undefined ? normalizeStringList(input.unresolvedGaps).map((gap) => compactText(gap, 240) ?? gap) : existing?.unresolvedGaps ?? [],
		compatibilityNotes: input.compatibilityNotes !== undefined ? normalizeStringList(input.compatibilityNotes).map((note) => compactText(note, 240) ?? note) : existing?.compatibilityNotes ?? [],
		securityNotes: input.securityNotes !== undefined ? normalizeStringList(input.securityNotes).map((note) => compactText(note, 240) ?? note) : existing?.securityNotes ?? [],
		performanceNotes: input.performanceNotes !== undefined ? normalizeStringList(input.performanceNotes).map((note) => compactText(note, 240) ?? note) : existing?.performanceNotes ?? [],
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
	};
	if (existingIndex >= 0) state.finalVerificationReports[existingIndex] = report;
	else state.finalVerificationReports.push(report);
	state.finalVerificationReports.sort((a, b) => a.id.localeCompare(b.id));
	saveState(ctx, state);
	return { ok: true, state, report, created: existingIndex < 0 };
}

const finalValidationRecordInputSchema = Type.Object({
	command: Type.Optional(Type.String({ description: "Validation command, check, or manual verification performed." })),
	result: Type.Union([Type.Literal("passed"), Type.Literal("failed"), Type.Literal("skipped")], { description: "Validation result." }),
	summary: Type.String({ description: "Compact validation summary." }),
	artifactIds: Type.Optional(Type.Array(Type.String(), { description: "Artifact ids supporting this validation record." })),
});

export function registerFinalReportTool(pi: ExtensionAPI, deps: FinalReportToolDeps, formatCriterionCounts: (ledger: LoopState["criterionLedger"]) => string): void {
	pi.registerTool({
		name: "stardock_final_report",
		label: "Manage Stardock Final Verification Report",
		description: "Record or inspect compact final verification reports for a Stardock loop.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("list"), Type.Literal("record")], { description: "list returns final reports; record creates or updates one compact report." }),
			loopName: Type.Optional(Type.String({ description: "Loop name. Defaults to the active loop." })),
			id: Type.Optional(Type.String({ description: "Report id. Generated for record when omitted." })),
			status: Type.Optional(Type.Union([Type.Literal("draft"), Type.Literal("passed"), Type.Literal("failed"), Type.Literal("partial")], { description: "Final verification status." })),
			summary: Type.Optional(Type.String({ description: "Compact final verification summary. Required for new reports." })),
			criterionIds: Type.Optional(Type.Array(Type.String(), { description: "Criterion ids covered by this report." })),
			artifactIds: Type.Optional(Type.Array(Type.String(), { description: "Verification artifact ids referenced by this report." })),
			validation: Type.Optional(Type.Array(finalValidationRecordInputSchema, { description: "Validation commands/checks and compact results." })),
			unresolvedGaps: Type.Optional(Type.Array(Type.String(), { description: "Known unresolved gaps or skipped verification." })),
			compatibilityNotes: Type.Optional(Type.Array(Type.String(), { description: "Compatibility notes or public contract considerations." })),
			securityNotes: Type.Optional(Type.Array(Type.String(), { description: "Security notes or verification gaps." })),
			performanceNotes: Type.Optional(Type.Array(Type.String(), { description: "Performance notes or measurement gaps." })),
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
					content: [{ type: "text", text: formatFinalReportOverview(state, formatCriterionCounts) }],
					details: { loopName, finalVerificationReports: state.finalVerificationReports },
				};
			}
			const result = recordFinalVerificationReport(ctx, loopName, {
				id: params.id,
				status: params.status,
				summary: params.summary,
				criterionIds: params.criterionIds,
				artifactIds: params.artifactIds,
				validation: params.validation,
				unresolvedGaps: params.unresolvedGaps,
				compatibilityNotes: params.compatibilityNotes,
				securityNotes: params.securityNotes,
				performanceNotes: params.performanceNotes,
			});
			if (!result.ok) return { content: [{ type: "text", text: result.error }], details: { loopName } };
			deps.updateUI(ctx);
			return {
				content: [{ type: "text", text: `${result.created ? "Recorded" : "Updated"} final report ${result.report.id} in loop "${loopName}".` }],
				details: { loopName, report: result.report, finalVerificationReports: result.state.finalVerificationReports, ...deps.optionalLoopDetails(ctx, result.state, params) },
			};
		},
	});
}
