/** Core Stardock agent tools: start, done, and state inspection. */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { Type } from "typebox";
import { currentBrief } from "../briefs.ts";
import { loadChecklistLedgerDrift } from "../checklist-drift.ts";
import { formatCriterionCounts } from "../ledger.ts";
import { latestGovernorDecision, pendingOutsideRequests } from "../outside-requests.ts";
import { type BriefLifecycleAction, DEFAULT_REFLECT_INSTRUCTIONS, type LoopState, type StateView } from "../state/core.ts";
import { defaultCriterionLedger } from "../state/migration.ts";
import { defaultTaskFile, ensureDir, existingStatePath, sanitize, tryRead } from "../state/paths.ts";
import { listLoops, loadState, saveState } from "../state/store.ts";
import { formatRunOverview, formatRunTimeline, formatStateSummary, summarizeLoopState } from "../views.ts";
import { evaluateWorkflowStatus, formatWorkflowStatus, type WorkflowStatus } from "../workflow-status.ts";
import { applyActiveBriefLifecycle } from "../briefs.ts";
import { FollowupToolParameter, withFollowupTool } from "./followups.ts";
import { buildPrompt, createModeState, getModeHandler, isImplementedMode, unsupportedModeMessage } from "./prompts.ts";
import type { StardockRuntime } from "./types.ts";

function checklistDoneShouldQueueNext(status: WorkflowStatus): boolean {
	return status.state === "ready_for_work" || status.state === "active_work";
}

export function registerCoreTools(pi: ExtensionAPI, runtime: StardockRuntime): void {
	pi.registerTool({
		name: "stardock_start",
		label: "Start Stardock Loop",
		description: "Start a long-running development loop. Use for complex multi-iteration tasks.",
		promptSnippet: "Start a persistent multi-iteration development loop with pacing and reflection controls.",
		promptGuidelines: [
			"Use this tool when the user explicitly wants an iterative loop, autonomous repeated passes, or paced multi-step execution.",
			"After starting a loop, continue each finished iteration with stardock_done unless the completion marker has already been emitted.",
		],
		parameters: Type.Object({
			name: Type.String({ description: "Loop name (e.g., 'refactor-auth')" }),
			mode: Type.Optional(Type.Union([Type.Literal("checklist"), Type.Literal("recursive"), Type.Literal("evolve")], { description: "Loop mode. checklist and recursive are implemented; evolve is planned." })),
			taskContent: Type.String({ description: "Task in markdown with goals and checklist" }),
			objective: Type.Optional(Type.String({ description: "Recursive mode objective. Required when mode is recursive." })),
			baseline: Type.Optional(Type.String({ description: "Recursive mode starting point or current best evidence." })),
			validationCommand: Type.Optional(Type.String({ description: "Command or check the agent should run/describe for each recursive attempt." })),
			resetPolicy: Type.Optional(Type.Union([Type.Literal("manual"), Type.Literal("revert_failed_attempts"), Type.Literal("keep_best_only")], { description: "Recursive mode reset policy. Default: manual." })),
			stopWhen: Type.Optional(Type.Array(Type.Union([Type.Literal("target_reached"), Type.Literal("idea_exhaustion"), Type.Literal("max_failed_attempts"), Type.Literal("max_iterations"), Type.Literal("user_decision")]), { description: "Recursive mode stop criteria." })),
			maxFailedAttempts: Type.Optional(Type.Number({ description: "Stop criterion budget for failed recursive attempts." })),
			outsideHelpEvery: Type.Optional(Type.Number({ description: "Recursive mode prompt cue interval for outside help." })),
			governEvery: Type.Optional(Type.Number({ description: "Recursive mode interval for governor review requests. Defaults to outsideHelpEvery when omitted." })),
			outsideHelpOnStagnation: Type.Optional(Type.Boolean({ description: "Cue outside help when recursive attempts stagnate." })),
			itemsPerIteration: Type.Optional(Type.Number({ description: "Suggest N items per turn (0 = no limit)" })),
			reflectEvery: Type.Optional(Type.Number({ description: "Reflect every N iterations" })),
			maxIterations: Type.Optional(Type.Number({ description: "Max iterations (default: 50)", default: 50 })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const mode = params.mode ?? "checklist";
			if (!isImplementedMode(mode)) return { content: [{ type: "text", text: unsupportedModeMessage(mode) }], details: { mode } };
			const modeResult = createModeState(mode, params);
			if (modeResult.error || !modeResult.modeState) return { content: [{ type: "text", text: modeResult.error ?? "Could not create Stardock mode state." }], details: { mode } };

			const loopName = sanitize(params.name);
			const taskFile = defaultTaskFile(loopName);
			if (loadState(ctx, loopName)?.status === "active") return { content: [{ type: "text", text: `Loop "${loopName}" already active.` }], details: {} };

			const fullPath = path.resolve(ctx.cwd, taskFile);
			ensureDir(fullPath);
			fs.writeFileSync(fullPath, params.taskContent, "utf-8");

			const state: LoopState = {
				schemaVersion: 3,
				name: loopName,
				taskFile,
				mode,
				iteration: 1,
				maxIterations: params.maxIterations ?? 50,
				itemsPerIteration: params.itemsPerIteration ?? 0,
				reflectEvery: params.reflectEvery ?? 0,
				reflectInstructions: DEFAULT_REFLECT_INSTRUCTIONS,
				active: true,
				status: "active",
				startedAt: new Date().toISOString(),
				lastReflectionAt: 0,
				modeState: modeResult.modeState,
				outsideRequests: [],
				criterionLedger: defaultCriterionLedger(),
				verificationArtifacts: [],
				baselineValidations: [],
				briefs: [],
				finalVerificationReports: [],
				auditorReviews: [],
				advisoryHandoffs: [],
				breakoutPackages: [],
				workerReports: [],
				workerRuns: [],
			};

			saveState(ctx, state);
			runtime.ref.currentLoop = loopName;
			runtime.updateUI(ctx);
			pi.sendUserMessage(buildPrompt(state, params.taskContent, "iteration"), { deliverAs: "followUp" });
			return { content: [{ type: "text", text: `Started loop "${loopName}" (max ${state.maxIterations} iterations).` }], details: {} };
		},
	});

	pi.registerTool({
		name: "stardock_done",
		label: "Stardock Iteration Done",
		description: "Signal that you've completed this iteration of the Stardock loop. Call this after making progress to get the next iteration prompt. Do NOT call this if you've output the completion marker.",
		promptSnippet: "Advance an active Stardock loop after completing the current iteration.",
		promptGuidelines: ["Call this after making real iteration progress so Stardock can queue the next prompt.", "Do not call this if there is no active loop, if pending messages are already queued, or if the completion marker has already been emitted."],
		parameters: Type.Object({
			briefLifecycle: Type.Optional(Type.Union([Type.Literal("keep"), Type.Literal("complete"), Type.Literal("clear")], { description: "Opt-in active brief lifecycle action after the completed iteration. Default keep preserves existing behavior." })),
			includeState: Type.Optional(Type.Boolean({ description: "Include compact loop summary in details after mutation." })),
			followupTool: FollowupToolParameter,
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!runtime.ref.currentLoop) return { content: [{ type: "text", text: "No active Stardock loop." }], details: {} };
			const state = loadState(ctx, runtime.ref.currentLoop);
			if (!state || state.status !== "active") return { content: [{ type: "text", text: "Stardock loop is not active." }], details: {} };
			if (ctx.hasPendingMessages()) return { content: [{ type: "text", text: "Pending messages already queued. Skipping stardock_done." }], details: {} };

			getModeHandler(state.mode).onIterationDone(state);
			const briefLifecycle = (params.briefLifecycle ?? "keep") as BriefLifecycleAction;
			const lifecycleBrief = applyActiveBriefLifecycle(state, briefLifecycle);
			state.iteration++;
			if (state.maxIterations > 0 && state.iteration > state.maxIterations) {
				runtime.completeLoop(ctx, state, `───────────────────────────────────────────────────────────────────────
⚠️ STARDOCK LOOP STOPPED: ${state.name} | Max iterations (${state.maxIterations}) reached
───────────────────────────────────────────────────────────────────────`, "clear");
				return { content: [{ type: "text", text: "Max iterations reached. Loop stopped." }], details: {} };
			}

			const needsReflection = state.reflectEvery > 0 && (state.iteration - 1) % state.reflectEvery === 0;
			if (needsReflection) state.lastReflectionAt = state.iteration;
			saveState(ctx, state);
			runtime.updateUI(ctx);
			const workflowStatus = evaluateWorkflowStatus(state);
			if (state.mode === "checklist" && !checklistDoneShouldQueueNext(workflowStatus)) {
				const lifecycleText = lifecycleBrief ? ` ${briefLifecycle === "complete" ? "Completed" : "Cleared"} brief ${lifecycleBrief.id}.` : "";
				return withFollowupTool({ content: [{ type: "text", text: `Iteration ${state.iteration - 1} complete. No next checklist prompt queued because workflow is ${workflowStatus.state}.${lifecycleText}` }], details: { briefLifecycle, brief: lifecycleBrief, workflowStatus, ...(params.includeState ? { loop: summarizeLoopState(ctx, state, false, false) } : {}) } }, ctx, runtime.ref.currentLoop, params.followupTool, ["stardock_done"]);
			}
			const content = tryRead(path.resolve(ctx.cwd, state.taskFile));
			if (!content) {
				runtime.pauseLoop(ctx, state);
				return { content: [{ type: "text", text: `Error: Could not read task file: ${state.taskFile}` }], details: {} };
			}
			pi.sendUserMessage(buildPrompt(state, content, needsReflection ? "reflection" : "iteration"), { deliverAs: "followUp" });
			const lifecycleText = lifecycleBrief ? ` ${briefLifecycle === "complete" ? "Completed" : "Cleared"} brief ${lifecycleBrief.id}.` : "";
			return withFollowupTool({ content: [{ type: "text", text: `Iteration ${state.iteration - 1} complete. Next iteration queued.${lifecycleText}` }], details: { briefLifecycle, brief: lifecycleBrief, ...(params.includeState ? { loop: summarizeLoopState(ctx, state, false, false) } : {}) } }, ctx, runtime.ref.currentLoop, params.followupTool, ["stardock_done"]);
		},
	});

	pi.registerTool({
		name: "stardock_state",
		label: "Inspect Stardock State",
		description: "Inspect Stardock loop state or list loops without reading .stardock files directly.",
		parameters: Type.Object({
			loopName: Type.Optional(Type.String({ description: "Loop name to inspect. Omit to list loops." })),
			archived: Type.Optional(Type.Boolean({ description: "Inspect archived loops instead of current runs. Default false." })),
			includeDetails: Type.Optional(Type.Boolean({ description: "Include full mode state and outside requests in details. Default false." })),
			view: Type.Optional(Type.Union([Type.Literal("summary"), Type.Literal("overview"), Type.Literal("timeline")], { description: "Text view to return for one loop. summary is compact; overview includes timeline; timeline returns only timeline." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const archived = params.archived === true;
			const includeDetails = params.includeDetails === true;
			const view = (params.view ?? "summary") as StateView;
			if (params.loopName) {
				const state = loadState(ctx, params.loopName, archived);
				if (!state) return { content: [{ type: "text", text: `Loop "${params.loopName}" not found.` }], details: { loopName: params.loopName, archived } };
				const attempts = state.modeState.kind === "recursive" ? state.modeState.attempts : [];
				const latestDecision = latestGovernorDecision(state);
				const activeBrief = currentBrief(state);
				const checklistDrift = loadChecklistLedgerDrift(ctx, state);
				const workflowStatus = evaluateWorkflowStatus(state);
				const lines = [
					`Loop: ${state.name}`,
					`Status: ${state.status}`,
					`Mode: ${state.mode}`,
					`Iteration: ${state.iteration}${state.maxIterations > 0 ? `/${state.maxIterations}` : ""}`,
					formatWorkflowStatus(workflowStatus),
					`Task file: ${state.taskFile}`,
					`State file: ${path.relative(ctx.cwd, existingStatePath(ctx, state.name, archived))}`,
					state.modeState.kind === "recursive" ? `Objective: ${state.modeState.objective}` : undefined,
					attempts.length > 0 ? `Attempts: ${attempts.filter((attempt) => attempt.status === "reported").length}/${attempts.length} reported` : undefined,
					`Outside requests: ${pendingOutsideRequests(state).length}/${state.outsideRequests.length} pending`,
					formatCriterionCounts(state.criterionLedger),
					`Verification artifacts: ${state.verificationArtifacts.length}`,
					`Baseline validations: ${state.baselineValidations.length}`,
					`Final reports: ${state.finalVerificationReports.length}`,
					`Auditor reviews: ${state.auditorReviews.length}`,
					`Worker runs: ${state.workerRuns.length}`,
					`Briefs: ${state.briefs.length}${activeBrief ? ` (current ${activeBrief.id})` : ""}`,
					checklistDrift.length ? `Checklist/ledger drift: ${checklistDrift.length}` : undefined,
					activeBrief ? `Current brief task: ${activeBrief.task}` : undefined,
					latestDecision?.requiredNextMove ? `Latest governor required next move: ${latestDecision.requiredNextMove}` : undefined,
				].filter((line): line is string => Boolean(line));
				const text = view === "overview" ? formatRunOverview(ctx, state, archived) : view === "timeline" ? formatRunTimeline(state) : lines.join("\n");
				return { content: [{ type: "text", text }], details: { loopName: state.name, archived, view, loop: summarizeLoopState(ctx, state, archived, includeDetails) } };
			}

			const loops = listLoops(ctx, archived).sort((a, b) => a.name.localeCompare(b.name));
			const label = archived ? "Archived Stardock loops" : "Stardock loops";
			return { content: [{ type: "text", text: loops.length > 0 ? `${label}:\n${loops.map(formatStateSummary).join("\n")}` : `No ${archived ? "archived " : ""}Stardock loops found.` }], details: { archived, currentLoop: runtime.ref.currentLoop, loops: loops.map((state) => summarizeLoopState(ctx, state, archived, includeDetails)) } };
		},
	});
}
