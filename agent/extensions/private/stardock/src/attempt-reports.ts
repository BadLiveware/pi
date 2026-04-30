/**
 * Recursive attempt report slice for Stardock.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import {
	type LoopState,
	type RecursiveAttempt,
	type RecursiveAttemptKind,
	type RecursiveAttemptResult,
	loadState,
	saveState,
} from "./state.ts";

export interface AttemptReportDeps {
	getCurrentLoop(): string | null;
	updateUI(ctx: ExtensionContext): void;
}

function summarizeAttemptReport(input: {
	hypothesis?: string;
	actionSummary?: string;
	validation?: string;
	result?: RecursiveAttemptResult;
}): string {
	return [input.result ? `Result: ${input.result}.` : undefined, input.hypothesis, input.actionSummary, input.validation]
		.filter((part): part is string => Boolean(part && part.trim()))
		.join(" ");
}

export function isAttemptKind(value: unknown): value is RecursiveAttemptKind {
	return typeof value === "string" && ["candidate_change", "setup", "refactor", "instrumentation", "benchmark_scaffold", "research", "other"].includes(value);
}

export function isAttemptResult(value: unknown): value is RecursiveAttemptResult {
	return typeof value === "string" && ["improved", "neutral", "worse", "invalid", "blocked"].includes(value);
}

export function recordAttemptReport(
	ctx: ExtensionContext,
	loopName: string,
	input: {
		iteration?: number;
		kind?: RecursiveAttemptKind;
		hypothesis?: string;
		actionSummary?: string;
		validation?: string;
		result?: RecursiveAttemptResult;
		kept?: boolean;
		evidence?: string;
		followupIdeas?: string[];
	},
	updateUI: (ctx: ExtensionContext) => void,
): { ok: true; state: LoopState; attempt: RecursiveAttempt } | { ok: false; error: string } {
	const state = loadState(ctx, loopName);
	if (!state) return { ok: false, error: `Loop "${loopName}" not found.` };
	if (state.mode !== "recursive" || state.modeState.kind !== "recursive") {
		return { ok: false, error: `Loop "${loopName}" is not a recursive loop.` };
	}
	const iteration = input.iteration ?? Math.max(1, state.iteration - 1);
	const modeState = state.modeState;
	let attempt = modeState.attempts.find((item) => item.iteration === iteration);
	if (!attempt) {
		attempt = {
			id: `attempt-${iteration}`,
			iteration,
			createdAt: new Date().toISOString(),
			status: "pending_report",
			summary: "",
		};
		modeState.attempts.push(attempt);
	}
	attempt.status = "reported";
	attempt.updatedAt = new Date().toISOString();
	attempt.kind = input.kind;
	attempt.hypothesis = input.hypothesis;
	attempt.actionSummary = input.actionSummary;
	attempt.validation = input.validation;
	attempt.result = input.result;
	attempt.kept = input.kept;
	attempt.evidence = input.evidence;
	attempt.followupIdeas = input.followupIdeas;
	attempt.summary = summarizeAttemptReport(input) || attempt.summary || `Attempt ${iteration} reported.`;
	modeState.attempts.sort((a, b) => a.iteration - b.iteration);
	state.modeState = modeState;
	saveState(ctx, state);
	updateUI(ctx);
	return { ok: true, state, attempt };
}

export function registerAttemptReportTool(pi: ExtensionAPI, deps: AttemptReportDeps): void {
	pi.registerTool({
		name: "stardock_attempt_report",
		label: "Record Stardock Attempt Report",
		description: "Record a structured report for one bounded recursive Stardock attempt.",
		parameters: Type.Object({
			loopName: Type.Optional(Type.String({ description: "Loop name. Defaults to the active loop." })),
			iteration: Type.Optional(Type.Number({ description: "Attempt iteration. Defaults to the most recently completed attempt." })),
			kind: Type.Optional(Type.Union([Type.Literal("candidate_change"), Type.Literal("setup"), Type.Literal("refactor"), Type.Literal("instrumentation"), Type.Literal("benchmark_scaffold"), Type.Literal("research"), Type.Literal("other")])),
			hypothesis: Type.Optional(Type.String({ description: "Hypothesis tested by this bounded attempt." })),
			actionSummary: Type.Optional(Type.String({ description: "What changed or was tried." })),
			validation: Type.Optional(Type.String({ description: "Validation command/check and result summary." })),
			result: Type.Optional(Type.Union([Type.Literal("improved"), Type.Literal("neutral"), Type.Literal("worse"), Type.Literal("invalid"), Type.Literal("blocked")])),
			kept: Type.Optional(Type.Boolean({ description: "Whether this attempt's changes/evidence should be kept." })),
			evidence: Type.Optional(Type.String({ description: "Evidence path, output, or concise result details." })),
			followupIdeas: Type.Optional(Type.Array(Type.String(), { description: "Follow-up ideas discovered by this attempt." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const loopName = params.loopName ?? deps.getCurrentLoop();
			if (!loopName) return { content: [{ type: "text", text: "No active Stardock loop." }], details: {} };
			const result = recordAttemptReport(
				ctx,
				loopName,
				{
					iteration: params.iteration,
					kind: isAttemptKind(params.kind) ? params.kind : undefined,
					hypothesis: params.hypothesis,
					actionSummary: params.actionSummary,
					validation: params.validation,
					result: isAttemptResult(params.result) ? params.result : undefined,
					kept: params.kept,
					evidence: params.evidence,
					followupIdeas: params.followupIdeas,
				},
				deps.updateUI,
			);
			if (!result.ok) return { content: [{ type: "text", text: result.error }], details: { loopName } };
			return {
				content: [{ type: "text", text: `Recorded report for attempt ${result.attempt.iteration} in loop "${loopName}".` }],
				details: { loopName, attempt: result.attempt },
			};
		},
	});
}
