/**
 * Manual WorkerReport slice for Stardock.
 */

import type { ExtensionAPI,ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { normalizeBatchInputs, runOrderedBatch } from "./app/batch.ts";
import { FollowupToolParameter, type FollowupToolRequest } from "./runtime/followups.ts";
import { formatCriterionCounts } from "./ledger.ts";
import { type ChangedFileReport, compactText, type LoopState, nextSequentialId, type WorkerReport } from "./state/core.ts";
import { isAdvisoryHandoffRole, isValidationResult, isWorkerReportStatus, normalizeId, normalizeStringList } from "./state/migration.ts";
import { loadState, saveState } from "./state/store.ts";

export interface WorkerReportToolDeps {
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

function normalizeChangedFiles(value: unknown): ChangedFileReport[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((item): ChangedFileReport | null => {
			if (!item || typeof item !== "object") return null;
			const file = item as Partial<ChangedFileReport> & Record<string, unknown>;
			const filePath = typeof file.path === "string" ? file.path.trim() : "";
			if (!filePath) return null;
			const summary = typeof file.summary === "string" && file.summary.trim() ? file.summary.trim() : "Changed file reported by worker.";
			return {
				path: compactText(filePath, 240) ?? filePath,
				summary: compactText(summary, 240) ?? summary,
				reviewReason: typeof file.reviewReason === "string" && file.reviewReason.trim() ? compactText(file.reviewReason.trim(), 240) ?? file.reviewReason.trim() : undefined,
			};
		})
		.filter((file): file is ChangedFileReport => file !== null)
		.slice(0, 40);
}

function normalizeValidation(value: unknown): WorkerReport["validation"] {
	if (!Array.isArray(value)) return [];
	return value
		.map((item): WorkerReport["validation"][number] | null => {
			if (!item || typeof item !== "object") return null;
			const record = item as WorkerReport["validation"][number] & Record<string, unknown>;
			const summary = typeof record.summary === "string" ? record.summary.trim() : "";
			if (!summary) return null;
			return {
				command: typeof record.command === "string" && record.command.trim() ? compactText(record.command.trim(), 240) : undefined,
				result: isValidationResult(record.result) ? record.result : "skipped",
				summary: compactText(summary, 500) ?? summary,
				artifactIds: normalizeStringList(record.artifactIds),
			};
		})
		.filter((record): record is WorkerReport["validation"][number] => record !== null)
		.slice(0, 30);
}

function validateRefs(state: LoopState, input: { evaluatedCriterionIds?: unknown; artifactIds?: unknown; advisoryHandoffIds?: unknown; validation?: unknown }, loopName: string): { ok: true; evaluatedCriterionIds: string[]; artifactIds: string[]; advisoryHandoffIds: string[]; validation: WorkerReport["validation"] } | { ok: false; error: string } {
	const evaluatedCriterionIds = normalizeStringList(input.evaluatedCriterionIds);
	const artifactIds = normalizeStringList(input.artifactIds);
	const advisoryHandoffIds = normalizeStringList(input.advisoryHandoffIds);
	const validation = normalizeValidation(input.validation);
	const criterionSet = idSet(state.criterionLedger.criteria);
	const artifactSet = idSet(state.verificationArtifacts);
	const handoffSet = idSet(state.advisoryHandoffs);
	const missingCriterion = evaluatedCriterionIds.find((id) => !criterionSet.has(id));
	if (missingCriterion) return { ok: false, error: `Criterion "${missingCriterion}" not found in loop "${loopName}".` };
	const allArtifactIds = [...artifactIds, ...validation.flatMap((record) => record.artifactIds ?? [])];
	const missingArtifact = allArtifactIds.find((id) => !artifactSet.has(id));
	if (missingArtifact) return { ok: false, error: `Artifact "${missingArtifact}" not found in loop "${loopName}".` };
	const missingHandoff = advisoryHandoffIds.find((id) => !handoffSet.has(id));
	if (missingHandoff) return { ok: false, error: `Advisory handoff "${missingHandoff}" not found in loop "${loopName}".` };
	return { ok: true, evaluatedCriterionIds, artifactIds, advisoryHandoffIds, validation };
}

export function formatWorkerReportOverview(state: LoopState): string {
	const lines = [`Worker reports for ${state.name}`, `Reports: ${state.workerReports.length} total`, formatCriterionCounts(state.criterionLedger), `Artifacts: ${state.verificationArtifacts.length} total`, `Handoffs: ${state.advisoryHandoffs.length} total`];
	if (state.workerReports.length > 0) {
		lines.push("");
		for (const report of state.workerReports.slice(0, 10)) {
			lines.push(`- ${report.id} [${report.status}/${report.role}] ${compactText(report.summary, 140)}`);
			if (report.evaluatedCriterionIds.length) lines.push(`  Criteria: ${report.evaluatedCriterionIds.join(",")}`);
			if (report.changedFiles.length) lines.push(`  Files: ${report.changedFiles.slice(0, 3).map((file) => file.path).join(",")}${report.changedFiles.length > 3 ? ",..." : ""}`);
			if (report.reviewHints.length) lines.push(`  Review hints: ${compactList(report.reviewHints, 3, 100).join("; ")}`);
		}
		if (state.workerReports.length > 10) lines.push(`... ${state.workerReports.length - 10} more worker reports`);
	}
	return lines.join("\n");
}

type WorkerReportInput = Omit<Partial<WorkerReport>, "changedFiles"> & { changedFiles?: unknown };

export function buildWorkerReportPayload(state: LoopState, input: WorkerReportInput): { ok: true; payload: string } | { ok: false; error: string } {
	const refs = validateRefs(state, input, state.name);
	if (!refs.ok) return refs;
	const role = isAdvisoryHandoffRole(input.role) ? input.role : "reviewer";
	const objective = typeof input.objective === "string" && input.objective.trim() ? input.objective.trim() : "Return a compact WorkerReport with evidence, risks, review hints, and suggested next move.";
	const selectedCriteria = refs.evaluatedCriterionIds.length ? state.criterionLedger.criteria.filter((criterion) => refs.evaluatedCriterionIds.includes(criterion.id)) : state.criterionLedger.criteria.slice(0, 8);
	const selectedArtifacts = refs.artifactIds.length ? state.verificationArtifacts.filter((artifact) => refs.artifactIds.includes(artifact.id)) : state.verificationArtifacts.slice(-6);
	const selectedHandoffs = refs.advisoryHandoffIds.length ? state.advisoryHandoffs.filter((handoff) => refs.advisoryHandoffIds.includes(handoff.id)) : state.advisoryHandoffs.slice(-4);
	const lines = [
		`WorkerReport payload for loop "${state.name}"`,
		`Role: ${role}`,
		`Objective: ${compactText(objective, 500)}`,
		`Mode: ${state.mode}`,
		`Iteration: ${state.iteration}${state.maxIterations > 0 ? `/${state.maxIterations}` : ""}`,
		formatCriterionCounts(state.criterionLedger),
		"",
		"Worker report contract:",
		"Return compact results that the parent/governor can use for selective review. Do not apply edits, call tools, spawn agents, or assume a provider-specific output format unless separately instructed.",
	];
	appendSection(lines, "Criteria to evaluate", selectedCriteria.map((criterion) => `- ${criterion.id} [${criterion.status}] ${compactText(criterion.description, 140)} | Pass: ${compactText(criterion.passCondition, 140)}`));
	appendSection(lines, "Artifacts", selectedArtifacts.map((artifact) => `- ${artifact.id} [${artifact.kind}] ${compactText(artifact.summary, 160)}${artifact.path ? ` | Path: ${artifact.path}` : ""}`));
	appendSection(lines, "Related advisory handoffs", selectedHandoffs.map((handoff) => `- ${handoff.id} [${handoff.status}/${handoff.role}] ${compactText(handoff.summary, 160)}${handoff.resultSummary ? ` | Result: ${compactText(handoff.resultSummary, 120)}` : ""}`));
	appendSection(lines, "Changed file hints", normalizeChangedFiles(input.changedFiles).map((file) => `- ${file.path}: ${compactText(file.summary, 140)}${file.reviewReason ? ` | Review: ${compactText(file.reviewReason, 100)}` : ""}`));
	appendSection(lines, "Review hints", compactList(normalizeStringList(input.reviewHints), 8, 180).map((hint) => `- ${hint}`));
	lines.push("", "Expected response fields:", "- status: submitted | accepted | needs_review | dismissed", "- summary", "- evaluatedCriterionIds", "- changedFiles with summary and optional reviewReason", "- validation records and artifactIds", "- risks", "- openQuestions", "- suggestedNextMove", "- reviewHints");
	return { ok: true, payload: lines.join("\n") };
}

export function recordWorkerReport(ctx: ExtensionContext, loopName: string, input: WorkerReportInput): { ok: true; state: LoopState; report: WorkerReport; created: boolean } | { ok: false; error: string } {
	const state = loadState(ctx, loopName);
	if (!state) return { ok: false, error: `Loop "${loopName}" not found.` };
	const id = normalizeId(input.id, nextSequentialId("wr", state.workerReports));
	const existingIndex = state.workerReports.findIndex((report) => report.id === id);
	const existing = existingIndex >= 0 ? state.workerReports[existingIndex] : undefined;
	const objective = typeof input.objective === "string" && input.objective.trim() ? input.objective.trim() : existing?.objective;
	const summary = typeof input.summary === "string" && input.summary.trim() ? input.summary.trim() : existing?.summary;
	if (!objective && !summary) return { ok: false, error: "Worker report requires objective or summary." };
	const refs = validateRefs(state, input, loopName);
	if (!refs.ok) return refs;
	const now = new Date().toISOString();
	const report: WorkerReport = {
		id,
		status: isWorkerReportStatus(input.status) ? input.status : existing?.status ?? "submitted",
		role: isAdvisoryHandoffRole(input.role) ? input.role : existing?.role ?? "reviewer",
		objective: objective ? compactText(objective, 500) ?? objective : existing?.objective ?? compactText(summary, 500) ?? summary ?? "Worker report",
		summary: summary ? compactText(summary, 500) ?? summary : existing?.summary ?? compactText(objective, 500) ?? objective ?? "Worker report",
		advisoryHandoffIds: input.advisoryHandoffIds !== undefined ? refs.advisoryHandoffIds : existing?.advisoryHandoffIds ?? [],
		evaluatedCriterionIds: input.evaluatedCriterionIds !== undefined ? refs.evaluatedCriterionIds : existing?.evaluatedCriterionIds ?? [],
		artifactIds: input.artifactIds !== undefined ? refs.artifactIds : existing?.artifactIds ?? [],
		changedFiles: input.changedFiles !== undefined ? normalizeChangedFiles(input.changedFiles) : existing?.changedFiles ?? [],
		validation: input.validation !== undefined ? refs.validation : existing?.validation ?? [],
		risks: input.risks !== undefined ? compactList(normalizeStringList(input.risks), 20, 240) : existing?.risks ?? [],
		openQuestions: input.openQuestions !== undefined ? compactList(normalizeStringList(input.openQuestions), 20, 240) : existing?.openQuestions ?? [],
		suggestedNextMove: typeof input.suggestedNextMove === "string" && input.suggestedNextMove.trim() ? compactText(input.suggestedNextMove.trim(), 500) ?? input.suggestedNextMove.trim() : existing?.suggestedNextMove,
		reviewHints: input.reviewHints !== undefined ? compactList(normalizeStringList(input.reviewHints), 20, 240) : existing?.reviewHints ?? [],
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
	};
	if (existingIndex >= 0) state.workerReports[existingIndex] = report;
	else state.workerReports.push(report);
	state.workerReports.sort((a, b) => a.id.localeCompare(b.id));
	saveState(ctx, state);
	return { ok: true, state, report, created: existingIndex < 0 };
}

const workerStatusSchema = Type.Union([Type.Literal("draft"), Type.Literal("submitted"), Type.Literal("accepted"), Type.Literal("needs_review"), Type.Literal("dismissed")]);
const workerRoleSchema = Type.Union([Type.Literal("explorer"), Type.Literal("test_runner"), Type.Literal("researcher"), Type.Literal("reviewer"), Type.Literal("governor"), Type.Literal("auditor"), Type.Literal("implementer")]);
const changedFileSchema = Type.Object({ path: Type.String(), summary: Type.Optional(Type.String()), reviewReason: Type.Optional(Type.String()) });
const workerValidationSchema = Type.Object({ command: Type.Optional(Type.String()), result: Type.Union([Type.Literal("passed"), Type.Literal("failed"), Type.Literal("skipped")]), summary: Type.String(), artifactIds: Type.Optional(Type.Array(Type.String())) });

const workerReportInputSchema = Type.Object({
	id: Type.Optional(Type.String({ description: "Worker report id. Generated for record when omitted." })),
	status: Type.Optional(workerStatusSchema),
	role: Type.Optional(workerRoleSchema),
	objective: Type.Optional(Type.String({ description: "Worker objective or assigned task." })),
	summary: Type.Optional(Type.String({ description: "Compact worker result summary." })),
	advisoryHandoffIds: Type.Optional(Type.Array(Type.String(), { description: "Related advisory handoff ids." })),
	evaluatedCriterionIds: Type.Optional(Type.Array(Type.String(), { description: "Criteria evaluated by the worker." })),
	artifactIds: Type.Optional(Type.Array(Type.String(), { description: "Artifact ids referenced by the report." })),
	changedFiles: Type.Optional(Type.Array(changedFileSchema, { description: "Changed files plus summary/review reason." })),
	validation: Type.Optional(Type.Array(workerValidationSchema, { description: "Validation records returned by the worker." })),
	risks: Type.Optional(Type.Array(Type.String(), { description: "Compact risks." })),
	openQuestions: Type.Optional(Type.Array(Type.String(), { description: "Compact open questions." })),
	suggestedNextMove: Type.Optional(Type.String({ description: "Suggested next move from the worker." })),
	reviewHints: Type.Optional(Type.Array(Type.String(), { description: "Selective parent review hints." })),
});

export function registerWorkerReportTool(pi: ExtensionAPI, deps: WorkerReportToolDeps): void {
	pi.registerTool({
		name: "stardock_worker_report",
		label: "Manage Stardock Worker Reports",
		description: "Build provider-neutral WorkerReport payloads and record compact worker results for selective parent review.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("list"), Type.Literal("payload"), Type.Literal("record")], { description: "list returns worker reports; payload builds a provider-neutral report contract; record creates or updates one report." }),
			loopName: Type.Optional(Type.String({ description: "Loop name. Defaults to the active loop." })),
			id: Type.Optional(Type.String({ description: "Worker report id. Generated for record when omitted." })),
			status: Type.Optional(workerStatusSchema),
			role: Type.Optional(workerRoleSchema),
			objective: Type.Optional(Type.String({ description: "Worker objective or assigned task." })),
			summary: Type.Optional(Type.String({ description: "Compact worker result summary." })),
			advisoryHandoffIds: Type.Optional(Type.Array(Type.String(), { description: "Related advisory handoff ids." })),
			evaluatedCriterionIds: Type.Optional(Type.Array(Type.String(), { description: "Criteria evaluated by the worker." })),
			artifactIds: Type.Optional(Type.Array(Type.String(), { description: "Artifact ids referenced by the report." })),
			changedFiles: Type.Optional(Type.Array(changedFileSchema, { description: "Changed files plus summary/review reason." })),
			validation: Type.Optional(Type.Array(workerValidationSchema, { description: "Validation records returned by the worker." })),
			risks: Type.Optional(Type.Array(Type.String(), { description: "Compact risks." })),
			openQuestions: Type.Optional(Type.Array(Type.String(), { description: "Compact open questions." })),
			suggestedNextMove: Type.Optional(Type.String({ description: "Suggested next move from the worker." })),
			reviewHints: Type.Optional(Type.Array(Type.String(), { description: "Selective parent review hints." })),
			reports: Type.Optional(Type.Array(workerReportInputSchema, { description: "Batch worker reports for record. Single-report fields remain compatibility sugar." })),
			includeState: Type.Optional(Type.Boolean({ description: "Include compact loop summary in details after mutation." })),
			includeOverview: Type.Optional(Type.Boolean({ description: "Include text overview in details after mutation." })),
			followupTool: FollowupToolParameter,
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const loopName = params.loopName ?? deps.getCurrentLoop();
			if (!loopName) return { content: [{ type: "text", text: "No active Stardock loop." }], details: {} };
			const state = loadState(ctx, loopName);
			if (!state) return { content: [{ type: "text", text: `Loop "${loopName}" not found.` }], details: { loopName } };
			if (params.action === "list") return { content: [{ type: "text", text: formatWorkerReportOverview(state) }], details: { loopName, workerReports: state.workerReports } };
			if (params.action === "payload") {
				const payload = buildWorkerReportPayload(state, params);
				if (!payload.ok) return { content: [{ type: "text", text: payload.error }], details: { loopName } };
				return { content: [{ type: "text", text: payload.payload }], details: { loopName, workerReports: state.workerReports } };
			}
			const inputs = normalizeBatchInputs(params, params.reports);
			const batch = runOrderedBatch(inputs.inputs, inputs.isBatch, (input) => {
				const result = recordWorkerReport(ctx, loopName, input);
				return result.ok ? { state: result.state, item: result.report, created: result.created } : result;
			});
			if (!batch.ok) return { content: [{ type: "text", text: batch.error }], details: { loopName, failedIndex: batch.index } };
			deps.updateUI(ctx);
			const updatedState = batch.lastState;
			if (batch.isBatch) {
				return {
					content: [{ type: "text", text: `Recorded ${batch.items.length} worker reports in loop "${loopName}".` }],
					details: { loopName, reports: batch.items, workerReports: updatedState.workerReports, ...deps.optionalLoopDetails(ctx, updatedState, params) },
				};
			}
			const result = batch.results[0];
			return {
				content: [{ type: "text", text: `${result.created ? "Recorded" : "Updated"} worker report ${result.item.id} in loop "${loopName}".` }],
				details: { loopName, report: result.item, workerReports: updatedState.workerReports, ...deps.optionalLoopDetails(ctx, updatedState, params) },
			};
		},
	});
}
