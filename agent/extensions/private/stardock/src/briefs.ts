/**
 * Iteration brief slice for Stardock.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import {
	type BriefLifecycleAction,
	type Criterion,
	type IterationBrief,
	type LoopState,
	compactText,
	isBriefSource,
	loadState,
	nextSequentialId,
	normalizeId,
	normalizeStringList,
	saveState,
} from "./state.ts";

export interface BriefToolDeps {
	getCurrentLoop(): string | null;
	updateUI(ctx: ExtensionContext): void;
	optionalLoopDetails(ctx: ExtensionContext, state: LoopState, options: { includeState?: boolean; includeOverview?: boolean; includePromptPreview?: boolean }): Record<string, unknown>;
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

export function appendTaskSourceSection(parts: string[], state: LoopState, taskContent: string): void {
	const brief = currentBrief(state);
	if (!brief) {
		parts.push(`## Current Task (from ${state.taskFile})\n\n${taskContent}\n\n---`);
		return;
	}
	parts.push(
		"## Task Source",
		`Active brief ${brief.id} is the selected context for this iteration.`,
		`Task file: ${state.taskFile}`,
		"Full task content is omitted from this prompt; read the task file if additional source context is needed.",
		"---",
	);
}

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
			includeState: Type.Optional(Type.Boolean({ description: "Include compact loop summary in details after mutation." })),
			includeOverview: Type.Optional(Type.Boolean({ description: "Include text overview in details after mutation." })),
			includePromptPreview: Type.Optional(Type.Boolean({ description: "Include a capped next-prompt preview in details after mutation." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const loopName = params.loopName ?? deps.getCurrentLoop();
			if (!loopName) return { content: [{ type: "text", text: "No active Stardock loop." }], details: {} };
			const state = loadState(ctx, loopName);
			if (!state) return { content: [{ type: "text", text: `Loop "${loopName}" not found.` }], details: { loopName } };

			if (params.action === "list") {
				return {
					content: [{ type: "text", text: formatBriefOverview(state) }],
					details: { loopName, currentBriefId: state.currentBriefId, currentBrief: currentBrief(state), briefs: state.briefs },
				};
			}

			if (params.action === "upsert") {
				const result = upsertBrief(ctx, loopName, { id: params.id, objective: params.objective, task: params.task, source: params.source, requestId: params.requestId, criterionIds: params.criterionIds, acceptanceCriteria: params.acceptanceCriteria, verificationRequired: params.verificationRequired, requiredContext: params.requiredContext, constraints: params.constraints, avoid: params.avoid, outputContract: params.outputContract, sourceRefs: params.sourceRefs }, deps.updateUI);
				if (!result.ok) return { content: [{ type: "text", text: result.error }], details: { loopName } };
				let state = result.state;
				let brief = result.brief;
				if (params.activate === true) {
					const activateResult = setCurrentBrief(ctx, loopName, result.brief.id, deps.updateUI);
					if (!activateResult.ok) return { content: [{ type: "text", text: activateResult.error }], details: { loopName, brief: result.brief } };
					state = activateResult.state;
					brief = activateResult.brief;
				}
				const actionText = `${result.created ? "Created" : "Updated"} brief ${brief.id}${params.activate === true ? " and activated it" : ""} in loop "${loopName}".`;
				return {
					content: [{ type: "text", text: actionText }],
					details: { loopName, brief, briefs: state.briefs, currentBriefId: state.currentBriefId, ...deps.optionalLoopDetails(ctx, state, params) },
				};
			}

			if (params.action === "activate") {
				if (!params.id) return { content: [{ type: "text", text: "Brief id is required for activate." }], details: { loopName } };
				const result = setCurrentBrief(ctx, loopName, params.id, deps.updateUI);
				if (!result.ok) return { content: [{ type: "text", text: result.error }], details: { loopName, id: params.id } };
				return {
					content: [{ type: "text", text: `Activated brief ${result.brief.id} in loop "${loopName}".` }],
					details: { loopName, brief: result.brief, currentBriefId: result.state.currentBriefId, ...deps.optionalLoopDetails(ctx, result.state, params) },
				};
			}

			if (params.action === "clear") {
				const result = clearCurrentBrief(ctx, loopName, deps.updateUI);
				if (!result.ok) return { content: [{ type: "text", text: result.error }], details: { loopName } };
				return {
					content: [{ type: "text", text: result.brief ? `Cleared current brief ${result.brief.id} in loop "${loopName}".` : `No current brief in loop "${loopName}".` }],
					details: { loopName, brief: result.brief, currentBriefId: result.state.currentBriefId, ...deps.optionalLoopDetails(ctx, result.state, params) },
				};
			}

			const result = completeBrief(ctx, loopName, deps.updateUI, params.id);
			if (!result.ok) return { content: [{ type: "text", text: result.error }], details: { loopName, id: params.id } };
			return {
				content: [{ type: "text", text: `Completed brief ${result.brief.id} in loop "${loopName}".` }],
				details: { loopName, brief: result.brief, currentBriefId: result.state.currentBriefId, ...deps.optionalLoopDetails(ctx, result.state, params) },
			};
		},
	});
}
