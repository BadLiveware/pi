/**
 * Outside help and governor request slice for Stardock.
 */

import type { ExtensionAPI,ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type GovernorDecision, type LoopState, type OutsideRequest, type OutsideRequestKind, type OutsideRequestTrigger, type RecursiveAttempt, type RecursiveAttemptKind, type RecursiveModeState } from "./state/core.ts";
import { loadState, saveState } from "./state/store.ts";

export interface OutsideRequestDeps {
	getCurrentLoop(): string | null;
	updateUI(ctx: ExtensionContext): void;
}

export function pendingOutsideRequests(state: LoopState): OutsideRequest[] {
	return state.outsideRequests.filter((request) => request.status === "requested" || request.status === "in_progress");
}

export function latestGovernorDecision(state: LoopState): GovernorDecision | undefined {
	return [...state.outsideRequests]
		.reverse()
		.find((request) => request.kind === "governor_review" && request.decision)?.decision;
}

function addOutsideRequest(state: LoopState, request: Omit<OutsideRequest, "requestedAt" | "status">): OutsideRequest {
	const existing = state.outsideRequests.find((item) => item.id === request.id);
	if (existing) return existing;
	const next: OutsideRequest = { ...request, status: "requested", requestedAt: new Date().toISOString() };
	state.outsideRequests.push(next);
	return next;
}

function findGovernorRequestForIteration(state: LoopState, iteration = state.iteration): OutsideRequest | undefined {
	return state.outsideRequests.find((request) => request.kind === "governor_review" && request.requestedByIteration === iteration);
}

function buildRecentAttemptSummary(modeState: RecursiveModeState, count = 3): string {
	const attempts = modeState.attempts.slice(-count);
	return attempts.length > 0 ? attempts.map(formatAttemptForPayload).join("\n") : "- No structured attempt reports yet.";
}

function buildGovernorPrompt(state: LoopState, modeState: RecursiveModeState, trigger: OutsideRequestTrigger): string {
	return [
		`Review recursive loop "${state.name}" after attempt ${state.iteration}.`,
		`Objective: ${modeState.objective}`,
		`Attempts recorded: ${modeState.attempts.length}`,
		`Trigger: ${trigger}`,
		"Decide whether the next move should continue, pivot, stop, measure, exploit scaffold, or ask the user.",
		"If useful, provide requiredNextMove, forbiddenNextMoves, and evidenceGaps.",
	].join("\n");
}

function createGovernorRequest(state: LoopState, modeState: RecursiveModeState, trigger: OutsideRequestTrigger, idPrefix = "governor"): OutsideRequest {
	const existing = findGovernorRequestForIteration(state);
	if (existing) return existing;
	return addOutsideRequest(state, {
		id: `${idPrefix}-${state.iteration}`,
		kind: "governor_review",
		requestedByIteration: state.iteration,
		trigger,
		prompt: buildGovernorPrompt(state, modeState, trigger),
	});
}

export function maybeCreateRecursiveOutsideRequests(state: LoopState, modeState: RecursiveModeState): void {
	const governorCadence = modeState.governEvery ?? modeState.outsideHelpEvery;
	if (governorCadence && state.iteration % governorCadence === 0) {
		createGovernorRequest(state, modeState, "every_n_iterations");
	}

	if (!modeState.outsideHelpOnStagnation) return;
	const reported = modeState.attempts.filter((attempt) => attempt.status === "reported");
	const recentTwo = reported.slice(-2);
	if (recentTwo.length === 2 && recentTwo.every((attempt) => attempt.result && ["neutral", "worse", "invalid", "blocked"].includes(attempt.result))) {
		addOutsideRequest(state, {
			id: `research-stagnation-${state.iteration}`,
			kind: "failure_analysis",
			requestedByIteration: state.iteration,
			trigger: "stagnation",
			prompt: [
				`Analyze why recursive loop "${state.name}" appears stagnant after attempt ${state.iteration}.`,
				`Objective: ${modeState.objective}`,
				"Recent attempts:",
				buildRecentAttemptSummary(modeState),
				"Suggest discriminating checks or a different next attempt.",
			].join("\n"),
		});
	}

	const recentThree = reported.slice(-3);
	const scaffoldKinds: Array<RecursiveAttemptKind | undefined> = ["setup", "refactor", "instrumentation", "benchmark_scaffold"];
	if (recentThree.length === 3 && recentThree.every((attempt) => scaffoldKinds.includes(attempt.kind)) && recentThree.every((attempt) => attempt.result !== "improved")) {
		addOutsideRequest(state, {
			id: `research-scaffold-${state.iteration}`,
			kind: "mutation_suggestions",
			requestedByIteration: state.iteration,
			trigger: "scaffolding_drift",
			prompt: [
				`Suggest candidate changes for recursive loop "${state.name}" after repeated scaffold/setup attempts.`,
				`Objective: ${modeState.objective}`,
				"Recent attempts:",
				buildRecentAttemptSummary(modeState),
				"Focus on measured candidate changes that use the scaffold rather than more setup.",
			].join("\n"),
		});
	}
}

function formatAttemptForPayload(attempt: RecursiveAttempt): string {
	return [
		`- Attempt ${attempt.iteration} (${attempt.status}${attempt.kind ? `, ${attempt.kind}` : ""}${attempt.result ? `, ${attempt.result}` : ""})`,
		attempt.hypothesis ? `  - Hypothesis: ${attempt.hypothesis}` : undefined,
		attempt.actionSummary ? `  - Action: ${attempt.actionSummary}` : undefined,
		attempt.validation ? `  - Validation: ${attempt.validation}` : undefined,
		attempt.evidence ? `  - Evidence: ${attempt.evidence}` : undefined,
		attempt.followupIdeas?.length ? `  - Follow-up ideas: ${attempt.followupIdeas.join("; ")}` : undefined,
	]
		.filter((line): line is string => Boolean(line))
		.join("\n");
}

export function buildOutsideRequestPayload(state: LoopState, request: OutsideRequest): string {
	const modeState = state.modeState.kind === "recursive" ? state.modeState : undefined;
	const attempts = modeState?.attempts.slice(-5).map(formatAttemptForPayload).join("\n") || "- No structured attempt reports yet.";
	const common = [
		`Loop: ${state.name}`,
		`Mode: ${state.mode}`,
		`Iteration: ${state.iteration}${state.maxIterations > 0 ? `/${state.maxIterations}` : ""}`,
		modeState ? `Objective: ${modeState.objective}` : undefined,
		modeState?.baseline ? `Baseline/current best: ${modeState.baseline}` : undefined,
		modeState?.validationCommand ? `Validation command/check: ${modeState.validationCommand}` : undefined,
		`Request: ${request.id} (${request.kind}, ${request.trigger})`,
		"",
		"Request prompt:",
		request.prompt,
		"",
		"Recent structured attempts:",
		attempts,
	]
		.filter((line): line is string => line !== undefined)
		.join("\n");

	if (request.kind === "governor_review") {
		return `${common}\n\nGovernor task:\nReview the trajectory and decide the next move. Look for scaffolding drift, low-value lanes, missing measurements, and whether to continue, pivot, stop, measure, exploit existing scaffold, request research, or ask the user.\n\nReturn a concise answer plus structured decision fields:\n- verdict: continue | pivot | stop | measure | exploit_scaffold | ask_user\n- rationale\n- requiredNextMove, if any\n- forbiddenNextMoves, if any\n- evidenceGaps, if any`;
	}

	const researcherTasks: Record<OutsideRequestKind, string> = {
		ideas: "Generate fresh plausible next hypotheses or implementation strategies. Prefer diverse, testable ideas over generic advice.",
		research: "Find relevant prior art, examples, docs, or external evidence that can inform the next bounded attempt.",
		mutation_suggestions: "Suggest concrete mutations to the current approach that can be tested in one bounded attempt.",
		failure_analysis: "Analyze why recent attempts may have failed or stalled and propose discriminating checks.",
		governor_review: "Review the trajectory and decide the next move.",
	};
	return `${common}\n\nResearcher task:\n${researcherTasks[request.kind]}\n\nReturn concise, actionable findings with suggested next attempts and any evidence or sources used.`;
}

function formatOutsideRequest(request: OutsideRequest): string {
	return `${request.id} [${request.status}] ${request.kind} from iteration ${request.requestedByIteration}: ${request.prompt}`;
}

export function formatOutsideRequests(state: LoopState): string {
	if (state.outsideRequests.length === 0) return `No outside requests for ${state.name}.`;
	return state.outsideRequests
		.map((request) => `${formatOutsideRequest(request)}\nPayload: run stardock_outside_payload for a ready-to-copy task.`)
		.join("\n\n");
}

export function getOutsideRequestPayload(ctx: ExtensionContext, loopName: string, requestId: string): { ok: true; payload: string; request: OutsideRequest } | { ok: false; error: string } {
	const state = loadState(ctx, loopName);
	if (!state) return { ok: false, error: `Loop "${loopName}" not found.` };
	const request = state.outsideRequests.find((item) => item.id === requestId);
	if (!request) return { ok: false, error: `Outside request "${requestId}" not found in loop "${loopName}".` };
	return { ok: true, payload: buildOutsideRequestPayload(state, request), request };
}

export function answerOutsideRequest(
	ctx: ExtensionContext,
	loopName: string,
	requestId: string,
	answer: string,
	updateUI: (ctx: ExtensionContext) => void,
	decision?: GovernorDecision,
): { ok: true; state: LoopState; request: OutsideRequest } | { ok: false; error: string } {
	const state = loadState(ctx, loopName);
	if (!state) return { ok: false, error: `Loop "${loopName}" not found.` };
	const request = state.outsideRequests.find((item) => item.id === requestId);
	if (!request) return { ok: false, error: `Outside request "${requestId}" not found in loop "${loopName}".` };
	request.status = "answered";
	request.answer = answer;
	request.decision = decision;
	request.consumedAt = new Date().toISOString();
	saveState(ctx, state);
	updateUI(ctx);
	return { ok: true, state, request };
}

export function createManualGovernorPayload(ctx: ExtensionContext, loopName: string, updateUI: (ctx: ExtensionContext) => void): { ok: true; state: LoopState; request: OutsideRequest; payload: string } | { ok: false; error: string } {
	const state = loadState(ctx, loopName);
	if (!state) return { ok: false, error: `Loop "${loopName}" not found.` };
	if (state.mode !== "recursive" || state.modeState.kind !== "recursive") {
		return { ok: false, error: `Loop "${loopName}" is not a recursive loop.` };
	}
	const request = createGovernorRequest(state, state.modeState, "manual", "governor-manual");
	saveState(ctx, state);
	updateUI(ctx);
	return { ok: true, state, request, payload: buildOutsideRequestPayload(state, request) };
}

export function appendOutsideRequestPromptSections(parts: string[], state: LoopState): void {
	const pending = pendingOutsideRequests(state);
	if (pending.length > 0) {
		parts.push("## Pending Outside Requests");
		for (const request of pending.slice(0, 5)) {
			parts.push(`- ${request.id} (${request.kind}, ${request.trigger}): ${request.prompt}`);
		}
		parts.push("Use stardock_outside_payload to build a task payload, then stardock_outside_answer to record the answer.", "");
	}

	const decision = latestGovernorDecision(state);
	if (decision) {
		parts.push("## Latest Governor Decision");
		parts.push(`- Verdict: ${decision.verdict}`);
		parts.push(`- Rationale: ${decision.rationale}`);
		if (decision.requiredNextMove) parts.push(`- Required next move: ${decision.requiredNextMove}`);
		if (decision.forbiddenNextMoves?.length) parts.push(`- Forbidden next moves: ${decision.forbiddenNextMoves.join("; ")}`);
		if (decision.evidenceGaps?.length) parts.push(`- Evidence gaps: ${decision.evidenceGaps.join("; ")}`);
		parts.push("");
	}
}

export function registerOutsideRequestTools(pi: ExtensionAPI, deps: OutsideRequestDeps): void {
	pi.registerTool({
		name: "stardock_govern",
		label: "Create Stardock Governor Payload",
		description: "Create or reuse a manual governor review request and return a ready-to-copy payload. Does not spawn subagents or call a model.",
		parameters: Type.Object({
			loopName: Type.Optional(Type.String({ description: "Loop name. Defaults to the active loop." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const loopName = params.loopName ?? deps.getCurrentLoop();
			if (!loopName) return { content: [{ type: "text", text: "No active Stardock loop." }], details: {} };
			const result = createManualGovernorPayload(ctx, loopName, deps.updateUI);
			if (!result.ok) return { content: [{ type: "text", text: result.error }], details: { loopName } };
			return {
				content: [{ type: "text", text: result.payload }],
				details: { loopName, request: result.request, payload: result.payload },
			};
		},
	});

	pi.registerTool({
		name: "stardock_outside_payload",
		label: "Build Stardock Outside Request Payload",
		description: "Return a ready-to-copy governor or researcher task payload for a pending Stardock outside request.",
		parameters: Type.Object({
			loopName: Type.Optional(Type.String({ description: "Loop name. Defaults to the active loop." })),
			requestId: Type.String({ description: "Outside request id." }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const loopName = params.loopName ?? deps.getCurrentLoop();
			if (!loopName) return { content: [{ type: "text", text: "No active Stardock loop." }], details: {} };
			const result = getOutsideRequestPayload(ctx, loopName, params.requestId);
			if (!result.ok) return { content: [{ type: "text", text: result.error }], details: { loopName, requestId: params.requestId } };
			return {
				content: [{ type: "text", text: result.payload }],
				details: { loopName, request: result.request, payload: result.payload },
			};
		},
	});

	pi.registerTool({
		name: "stardock_outside_requests",
		label: "List Stardock Outside Requests",
		description: "List pending or answered outside help/governor requests for a Stardock loop.",
		parameters: Type.Object({
			loopName: Type.Optional(Type.String({ description: "Loop name. Defaults to the active loop." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const loopName = params.loopName ?? deps.getCurrentLoop();
			if (!loopName) return { content: [{ type: "text", text: "No active Stardock loop." }], details: {} };
			const state = loadState(ctx, loopName);
			if (!state) return { content: [{ type: "text", text: `Loop "${loopName}" not found.` }], details: { loopName } };
			return {
				content: [{ type: "text", text: formatOutsideRequests(state) }],
				details: { loopName, outsideRequests: state.outsideRequests },
			};
		},
	});

	pi.registerTool({
		name: "stardock_outside_answer",
		label: "Answer Stardock Outside Request",
		description: "Record an answer or governor decision for a Stardock outside request without editing state files manually.",
		parameters: Type.Object({
			loopName: Type.Optional(Type.String({ description: "Loop name. Defaults to the active loop." })),
			requestId: Type.String({ description: "Outside request id to answer." }),
			answer: Type.String({ description: "Answer text from governor, researcher, or manual review." }),
			verdict: Type.Optional(Type.Union([Type.Literal("continue"), Type.Literal("pivot"), Type.Literal("stop"), Type.Literal("measure"), Type.Literal("exploit_scaffold"), Type.Literal("ask_user")])),
			rationale: Type.Optional(Type.String({ description: "Governor rationale. Required to store a structured decision." })),
			requiredNextMove: Type.Optional(Type.String({ description: "Governor-required next move." })),
			forbiddenNextMoves: Type.Optional(Type.Array(Type.String(), { description: "Moves the next iteration should avoid." })),
			evidenceGaps: Type.Optional(Type.Array(Type.String(), { description: "Evidence gaps the next iteration should address." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const loopName = params.loopName ?? deps.getCurrentLoop();
			if (!loopName) return { content: [{ type: "text", text: "No active Stardock loop." }], details: {} };
			const decision = params.verdict
				? {
						verdict: params.verdict,
						rationale: params.rationale ?? params.answer,
						requiredNextMove: params.requiredNextMove,
						forbiddenNextMoves: params.forbiddenNextMoves,
						evidenceGaps: params.evidenceGaps,
					}
				: undefined;
			const result = answerOutsideRequest(ctx, loopName, params.requestId, params.answer, deps.updateUI, decision);
			if (!result.ok) return { content: [{ type: "text", text: result.error }], details: { loopName, requestId: params.requestId } };
			return {
				content: [{ type: "text", text: `Recorded answer for ${params.requestId} in loop "${loopName}".` }],
				details: { loopName, request: result.request },
			};
		},
	});
}
