/**
 * Iteration brief slice for Stardock.
 */

import type { ExtensionAPI,ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { runBriefActivate, runBriefClear, runBriefComplete, runBriefUpsert } from "./app/brief-tool.ts";
import { FollowupToolParameter, type FollowupToolRequest, withFollowupTool } from "./runtime/followups.ts";
import { type BriefLifecycleAction, compactText, type Criterion, type CriterionStatus, type IterationBrief, type LoopState, nextSequentialId } from "./state/core.ts";
import { isBriefSource, normalizeId, normalizeStringList } from "./state/migration.ts";
import { loadState, saveState } from "./state/store.ts";

export interface BriefToolDeps {
	getCurrentLoop(): string | null;
	updateUI(ctx: ExtensionContext): void;
	optionalLoopDetails(ctx: ExtensionContext, state: LoopState, options: { includeState?: boolean; includeOverview?: boolean; includePromptPreview?: boolean; followupTool?: FollowupToolRequest }): Record<string, unknown>;
}

export function currentBrief(state: LoopState): IterationBrief | undefined {
	return state.briefs.find((brief) => brief.id === state.currentBriefId && brief.status === "active");
}

export function upsertBrief(
	ctx: ExtensionContext,
	loopName: string,
	input: Partial<IterationBrief> & { id?: string; objective?: string; task?: string },
	updateUI: (ctx: ExtensionContext) => void,
): { ok: true; state: LoopState; brief: IterationBrief; created: boolean } | { ok: false; error: string } {
	const state = loadState(ctx, loopName);
	if (!state) return { ok: false, error: `Loop "${loopName}" not found.` };

	const id = normalizeId(input.id, nextSequentialId("b", state.briefs));
	const existingIndex = state.briefs.findIndex((brief) => brief.id === id);
	const existing = existingIndex >= 0 ? state.briefs[existingIndex] : undefined;
	const objective = typeof input.objective === "string" && input.objective.trim() ? input.objective.trim() : existing?.objective;
	const task = typeof input.task === "string" && input.task.trim() ? input.task.trim() : existing?.task;
	if (!objective || !task) return { ok: false, error: "Iteration brief requires objective and task." };

	const source = isBriefSource(input.source) ? input.source : existing?.source ?? "manual";
	const requestId = typeof input.requestId === "string" && input.requestId.trim() ? input.requestId.trim() : existing?.requestId;
	if (source === "governor" && requestId) {
		const request = state.outsideRequests.find((item) => item.id === requestId);
		if (!request) return { ok: false, error: `Outside request "${requestId}" not found in loop "${loopName}".` };
		if (request.kind !== "governor_review") return { ok: false, error: `Outside request "${requestId}" is not a governor review.` };
	}

	const now = new Date().toISOString();
	const brief: IterationBrief = {
		id,
		status: existing?.status ?? "draft",
		source,
		requestId: source === "governor" ? requestId : undefined,
		objective,
		task,
		criterionIds: input.criterionIds !== undefined ? normalizeStringList(input.criterionIds) : existing?.criterionIds ?? [],
		acceptanceCriteria: input.acceptanceCriteria !== undefined ? normalizeStringList(input.acceptanceCriteria) : existing?.acceptanceCriteria ?? [],
		verificationRequired: input.verificationRequired !== undefined ? normalizeStringList(input.verificationRequired) : existing?.verificationRequired ?? [],
		requiredContext: input.requiredContext !== undefined ? normalizeStringList(input.requiredContext) : existing?.requiredContext ?? [],
		constraints: input.constraints !== undefined ? normalizeStringList(input.constraints) : existing?.constraints ?? [],
		avoid: input.avoid !== undefined ? normalizeStringList(input.avoid) : existing?.avoid ?? [],
		outputContract: typeof input.outputContract === "string" && input.outputContract.trim() ? input.outputContract.trim() : existing?.outputContract ?? "Record changed files, validation evidence, risks, and the suggested next move.",
		sourceRefs: input.sourceRefs !== undefined ? normalizeStringList(input.sourceRefs) : existing?.sourceRefs ?? [],
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
		completedAt: existing?.completedAt,
	};

	if (existingIndex >= 0) state.briefs[existingIndex] = brief;
	else state.briefs.push(brief);
	state.briefs.sort((a, b) => a.id.localeCompare(b.id));
	saveState(ctx, state);
	updateUI(ctx);
	return { ok: true, state, brief, created: existingIndex < 0 };
}

export function setCurrentBrief(ctx: ExtensionContext, loopName: string, briefId: string, updateUI: (ctx: ExtensionContext) => void): { ok: true; state: LoopState; brief: IterationBrief } | { ok: false; error: string } {
	const state = loadState(ctx, loopName);
	if (!state) return { ok: false, error: `Loop "${loopName}" not found.` };
	const brief = state.briefs.find((item) => item.id === briefId);
	if (!brief) return { ok: false, error: `Brief "${briefId}" not found in loop "${loopName}".` };
	const now = new Date().toISOString();
	for (const item of state.briefs) {
		if (item.status === "active" && item.id !== brief.id) {
			item.status = "draft";
			item.updatedAt = now;
		}
	}
	brief.status = "active";
	brief.completedAt = undefined;
	brief.updatedAt = now;
	state.currentBriefId = brief.id;
	saveState(ctx, state);
	updateUI(ctx);
	return { ok: true, state, brief };
}

export function clearCurrentBrief(ctx: ExtensionContext, loopName: string, updateUI: (ctx: ExtensionContext) => void): { ok: true; state: LoopState; brief?: IterationBrief } | { ok: false; error: string } {
	const state = loadState(ctx, loopName);
	if (!state) return { ok: false, error: `Loop "${loopName}" not found.` };
	const brief = currentBrief(state);
	if (brief) {
		brief.status = "draft";
		brief.updatedAt = new Date().toISOString();
	}
	state.currentBriefId = undefined;
	saveState(ctx, state);
	updateUI(ctx);
	return { ok: true, state, brief };
}

export function completeBrief(ctx: ExtensionContext, loopName: string, updateUI: (ctx: ExtensionContext) => void, briefId?: string): { ok: true; state: LoopState; brief: IterationBrief } | { ok: false; error: string } {
	const state = loadState(ctx, loopName);
	if (!state) return { ok: false, error: `Loop "${loopName}" not found.` };
	const id = briefId ?? state.currentBriefId;
	if (!id) return { ok: false, error: "No current brief to complete." };
	const brief = state.briefs.find((item) => item.id === id);
	if (!brief) return { ok: false, error: `Brief "${id}" not found in loop "${loopName}".` };
	const now = new Date().toISOString();
	brief.status = "completed";
	brief.updatedAt = now;
	brief.completedAt = now;
	if (state.currentBriefId === brief.id) state.currentBriefId = undefined;
	saveState(ctx, state);
	updateUI(ctx);
	return { ok: true, state, brief };
}

export function applyActiveBriefLifecycle(state: LoopState, action: BriefLifecycleAction): IterationBrief | undefined {
	if (action === "keep") return undefined;
	const brief = currentBrief(state);
	if (!brief) return undefined;
	const now = new Date().toISOString();
	brief.updatedAt = now;
	if (action === "complete") {
		brief.status = "completed";
		brief.completedAt = now;
	} else {
		brief.status = "draft";
		brief.completedAt = undefined;
	}
	state.currentBriefId = undefined;
	return brief;
}

export function formatBriefOverview(state: LoopState): string {
	const active = currentBrief(state);
	const lines = [`Briefs for ${state.name}`, `Current brief: ${active?.id ?? "none"}`, `Briefs: ${state.briefs.length} total`];
	if (state.briefs.length > 0) {
		lines.push("");
		for (const brief of state.briefs.slice(0, 12)) {
			const current = active?.id === brief.id ? " · current" : "";
			const source = brief.source === "governor" ? ` · governor${brief.requestId ? `:${brief.requestId}` : ""}` : "";
			lines.push(`- ${brief.id} [${brief.status}]${current}${source} ${compactText(brief.objective, 120)}`);
			lines.push(`  Task: ${compactText(brief.task, 120)}`);
			if (brief.criterionIds.length) lines.push(`  Criteria: ${brief.criterionIds.join(",")}`);
		}
		if (state.briefs.length > 12) lines.push(`... ${state.briefs.length - 12} more briefs`);
	}
	return lines.join("\n");
}

function selectedCriteria(state: LoopState, brief: IterationBrief): Criterion[] {
	const ids = new Set(brief.criterionIds);
	return state.criterionLedger.criteria.filter((criterion) => ids.has(criterion.id));
}

function linkedArtifactIds(state: LoopState, brief: IterationBrief): string[] {
	const ids = new Set(brief.criterionIds);
	return state.verificationArtifacts
		.filter((artifact) => artifact.criterionIds?.some((criterionId) => ids.has(criterionId)))
		.map((artifact) => artifact.id)
		.slice(0, 8);
}

function appendBriefList(parts: string[], title: string, items: string[], maxItems = 8, maxLength = 180): void {
	if (items.length === 0) return;
	parts.push(title);
	for (const item of items.slice(0, maxItems)) parts.push(`- ${compactText(item, maxLength)}`);
	if (items.length > maxItems) parts.push(`- ... ${items.length - maxItems} more`);
}

export function appendActiveBriefPromptSection(parts: string[], state: LoopState): void {
	const brief = currentBrief(state);
	if (!brief) return;

	parts.push("## Active Iteration Brief");
	parts.push(`- Brief: ${brief.id}`);
	parts.push(`- Source: ${brief.source}${brief.requestId ? ` (${brief.requestId})` : ""}`);
	parts.push(`- Objective: ${compactText(brief.objective, 220)}`);
	parts.push(`- Task: ${compactText(brief.task, 260)}`);

	const criteria = selectedCriteria(state, brief);
	if (brief.criterionIds.length > 0) {
		parts.push("", "### Selected Criteria");
		for (const criterionId of brief.criterionIds.slice(0, 8)) {
			const criterion = criteria.find((item) => item.id === criterionId);
			if (!criterion) {
				parts.push(`- ${criterionId}: not found in criterion ledger`);
				continue;
			}
			parts.push(`- ${criterion.id} [${criterion.status}]: ${compactText(criterion.description, 160)}`);
			parts.push(`  Pass: ${compactText(criterion.passCondition, 180)}`);
			if (criterion.testMethod) parts.push(`  Verify: ${compactText(criterion.testMethod, 160)}`);
		}
		if (brief.criterionIds.length > 8) parts.push(`- ... ${brief.criterionIds.length - 8} more selected criteria`);
	}

	appendBriefList(parts, "### Acceptance Criteria", brief.acceptanceCriteria);
	appendBriefList(parts, "### Verification Required", brief.verificationRequired);
	appendBriefList(parts, "### Required Context", brief.requiredContext);
	appendBriefList(parts, "### Constraints", brief.constraints);
	appendBriefList(parts, "### Avoid", brief.avoid);
	appendBriefList(parts, "### Source Refs", brief.sourceRefs, 8, 160);
	const artifacts = linkedArtifactIds(state, brief);
	if (artifacts.length > 0) parts.push("### Linked Artifact Refs", `- ${artifacts.join(", ")}`);
	parts.push("### Output Contract", compactText(brief.outputContract, 240) ?? "Record changed files, validation evidence, risks, and the suggested next move.", "");
}

export function appendTaskSourceSection(parts: string[], state: LoopState, _taskContent: string): void {
	const brief = currentBrief(state);
	if (!brief) {
		if (state.mode === "checklist") {
			parts.push(
				"## Task Source",
				`Task file: ${state.taskFile} (not loaded into this prompt)`,
				"",
				"**No active brief.** Create one with `stardock_brief` to scope this iteration:",
				"- Set `objective` and `task` from the next chunk of work in your task file",
				"- Add `criterionIds` if you've already created criteria with `stardock_ledger`",
				"- Add `acceptanceCriteria` and `constraints` to keep the iteration bounded",
				"- Use `activate: true` to make it the active brief immediately",
				"",
				"---",
			);
		} else {
			parts.push(
				"## Task Source",
				`Task file: ${state.taskFile} (reference only — not loaded into this prompt)`,
				"The recursive objective and recent attempts above scope this iteration.",
				"Read the task file from disk if you need broader background context.",
				"---",
			);
		}
		return;
	}
	parts.push(
		"## Task Source",
		`Active brief ${brief.id} scopes this iteration.`,
		`Task file: ${state.taskFile} (reference only — not loaded into this prompt)`,
		"Read the task file from disk if you need broader context beyond this brief.",
		"---",
	);
}

const STATUS_ORDER: CriterionStatus[] = ["failed", "blocked", "pending", "passed", "skipped"];
const STATUS_ICON: Record<CriterionStatus, string> = { pending: "○", passed: "✓", failed: "✗", skipped: "⊘", blocked: "⊗" };

export function appendLedgerSummarySection(parts: string[], state: LoopState): void {
	const brief = currentBrief(state);
	let criteria = brief?.criterionIds.length
		? state.criterionLedger.criteria.filter((c) => brief.criterionIds.includes(c.id))
		: state.criterionLedger.criteria;
	// When no brief scopes the view, only show actionable criteria to keep the prompt focused.
	if (!brief) {
		criteria = criteria.filter((c) => c.status === "pending" || c.status === "failed" || c.status === "blocked");
	}
	if (criteria.length === 0) return;

	const counts = { total: criteria.length, pending: 0, passed: 0, failed: 0, skipped: 0, blocked: 0 };
	for (const c of criteria) counts[c.status]++;
	const summaryParts = [`${counts.passed}/${counts.total} passed`];
	if (counts.failed) summaryParts.push(`${counts.failed} failed`);
	if (counts.blocked) summaryParts.push(`${counts.blocked} blocked`);
	if (counts.pending) summaryParts.push(`${counts.pending} pending`);

	parts.push(`## Criteria (${summaryParts.join(", ")})`);
	const sorted = [...criteria].sort((a, b) => {
		const ai = STATUS_ORDER.indexOf(a.status);
		const bi = STATUS_ORDER.indexOf(b.status);
		if (ai !== bi) return ai - bi;
		return a.id.localeCompare(b.id);
	});
	for (const c of sorted.slice(0, 10)) {
		parts.push(`- ${STATUS_ICON[c.status]} **${c.id}** [${c.status}]: ${compactText(c.description, 120)}`);
		parts.push(`  Pass: ${compactText(c.passCondition, 140)}`);
		if (c.evidence) parts.push(`  Evidence: ${compactText(c.evidence, 140)}`);
	}
	if (sorted.length > 10) parts.push(`- ... ${sorted.length - 10} more criteria`);
	parts.push("");
}

const briefInputSchema = Type.Object({
	id: Type.Optional(Type.String({ description: "Brief id. Generated for upsert when omitted." })),
	objective: Type.Optional(Type.String({ description: "Brief objective. Required for new briefs." })),
	task: Type.Optional(Type.String({ description: "Bounded task text. Required for new briefs." })),
	source: Type.Optional(Type.Union([Type.Literal("manual"), Type.Literal("governor")], { description: "Brief source. Defaults to manual; governor records a governor-selected brief." })),
	requestId: Type.Optional(Type.String({ description: "Optional governor_review outside request id that selected this brief." })),
	criterionIds: Type.Optional(Type.Array(Type.String(), { description: "Criterion ids selected for this brief." })),
	acceptanceCriteria: Type.Optional(Type.Array(Type.String(), { description: "Brief-specific acceptance criteria." })),
	verificationRequired: Type.Optional(Type.Array(Type.String(), { description: "Validation or verification required for this brief." })),
	requiredContext: Type.Optional(Type.Array(Type.String(), { description: "Relevant plan excerpts, files, decisions, or constraints." })),
	constraints: Type.Optional(Type.Array(Type.String(), { description: "Constraints the worker should preserve." })),
	avoid: Type.Optional(Type.Array(Type.String(), { description: "Moves or scopes to avoid for this brief." })),
	outputContract: Type.Optional(Type.String({ description: "Expected report/evidence from the worker." })),
	sourceRefs: Type.Optional(Type.Array(Type.String(), { description: "Source refs for this brief." })),
});

export function registerBriefTool(pi: ExtensionAPI, deps: BriefToolDeps): void {
	pi.registerTool({
		name: "stardock_brief",
		label: "Manage Stardock Iteration Brief",
		description: "Inspect or update the current Stardock IterationBrief context packet.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("list"), Type.Literal("upsert"), Type.Literal("activate"), Type.Literal("clear"), Type.Literal("complete")], {
				description: "list returns briefs; upsert creates/updates a brief; activate selects one; clear removes the active brief; complete marks one complete.",
			}),
			loopName: Type.Optional(Type.String({ description: "Loop name. Defaults to the active loop." })),
			id: Type.Optional(Type.String({ description: "Brief id. Generated for upsert when omitted; required for activate." })),
			objective: Type.Optional(Type.String({ description: "Brief objective. Required for new briefs." })),
			task: Type.Optional(Type.String({ description: "Bounded task text. Required for new briefs." })),
			source: Type.Optional(Type.Union([Type.Literal("manual"), Type.Literal("governor")], { description: "Brief source. Defaults to manual; governor records a governor-selected brief." })),
			requestId: Type.Optional(Type.String({ description: "Optional governor_review outside request id that selected this brief." })),
			criterionIds: Type.Optional(Type.Array(Type.String(), { description: "Criterion ids selected for this brief." })),
			acceptanceCriteria: Type.Optional(Type.Array(Type.String(), { description: "Brief-specific acceptance criteria." })),
			verificationRequired: Type.Optional(Type.Array(Type.String(), { description: "Validation or verification required for this brief." })),
			requiredContext: Type.Optional(Type.Array(Type.String(), { description: "Relevant plan excerpts, files, decisions, or constraints." })),
			constraints: Type.Optional(Type.Array(Type.String(), { description: "Constraints the worker should preserve." })),
			avoid: Type.Optional(Type.Array(Type.String(), { description: "Moves or scopes to avoid for this brief." })),
			outputContract: Type.Optional(Type.String({ description: "Expected report/evidence from the worker." })),
			sourceRefs: Type.Optional(Type.Array(Type.String(), { description: "Source refs for this brief." })),
			activate: Type.Optional(Type.Boolean({ description: "For upsert, activate the brief in the same call." })),
			briefs: Type.Optional(Type.Array(briefInputSchema, { description: "Batch briefs for upsert. Single-brief fields remain compatibility sugar." })),
			ids: Type.Optional(Type.Array(Type.String(), { description: "Batch brief ids for complete. Single id remains compatibility sugar." })),
			includeState: Type.Optional(Type.Boolean({ description: "Include compact loop summary in details after mutation." })),
			includeOverview: Type.Optional(Type.Boolean({ description: "Include text overview in details after mutation." })),
			includePromptPreview: Type.Optional(Type.Boolean({ description: "Include a capped next-prompt preview in details after mutation." })),
			followupTool: FollowupToolParameter,
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const loopName = params.loopName ?? deps.getCurrentLoop();
			const detailsParams = { ...params, followupTool: undefined };
			if (!loopName) return { content: [{ type: "text", text: "No active Stardock loop." }], details: {} };
			const state = loadState(ctx, loopName);
			if (!state) return { content: [{ type: "text", text: `Loop "${loopName}" not found.` }], details: { loopName } };

			if (params.action === "list") {
				return {
					content: [{ type: "text", text: formatBriefOverview(state) }],
					details: { loopName, currentBriefId: state.currentBriefId, currentBrief: currentBrief(state), briefs: state.briefs },
				};
			}

			const operations = {
				upsert: (input: Parameters<typeof upsertBrief>[2]) => upsertBrief(ctx, loopName, input, deps.updateUI),
				activate: (id: string) => setCurrentBrief(ctx, loopName, id, deps.updateUI),
				clear: () => clearCurrentBrief(ctx, loopName, deps.updateUI),
				complete: (id?: string) => completeBrief(ctx, loopName, deps.updateUI, id),
			};
			const response = params.action === "upsert" ? runBriefUpsert(loopName, params, operations) : params.action === "activate" ? runBriefActivate(loopName, params.id, operations) : params.action === "clear" ? runBriefClear(loopName, operations) : runBriefComplete(loopName, params, operations);
			const details = response.state ? { ...response.details, ...deps.optionalLoopDetails(ctx, response.state, detailsParams) } : response.details;
			if (response.error) return { content: [{ type: "text", text: response.contentText }], details };
			return withFollowupTool({ content: [{ type: "text", text: response.contentText }], details }, ctx, deps.getCurrentLoop(), params.followupTool, ["stardock_brief:mutation"]);
		},
	});
}
