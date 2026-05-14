/**
 * Explicit brief-scoped worker execution for Stardock.
 *
 * This slice is intentionally tool-gated: Stardock never starts a worker when a
 * brief is created. A parent/governor must call this tool to run a selected
 * brief through the pi-subagents bridge, then Stardock records compact evidence.
 */

import { randomUUID } from "node:crypto";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { buildAdvisoryAdapterPayload } from "./advisory-adapters.ts";
import { buildBriefWorkerPayload, currentBrief } from "./briefs.ts";
import { finalOutput, outputRefs, runSubagentThroughBridge, type EventBus, type SubagentResponse } from "./brief-worker-run-bridge.ts";
import { formatChangedFiles, gitStatusSnapshot } from "./brief-worker-run-git.ts";
import { recordWorkerReport } from "./worker-reports.ts";
import { formatWorkerRunOverview, openMutableWorkerRun, reviewWorkerRun, updateWorkerRun } from "./worker-runs.ts";
import { compactText, nextSequentialId, type AdvisoryHandoffRole, type ChangedFileReport, type IterationBrief, type LoopState, type WorkerRun, type WorkerRunStatus } from "./state/core.ts";
import { sanitize } from "./state/paths.ts";
import { loadState, saveState } from "./state/store.ts";

type BriefWorkerRole = Extract<AdvisoryHandoffRole, "explorer" | "test_runner" | "implementer">;
type BriefWorkerContext = "fresh" | "fork";
type OutputMode = "inline" | "file-only";

interface BuildInvocationInput {
	role: BriefWorkerRole;
	briefId: string;
	agentName?: string;
	context?: BriefWorkerContext;
}

export interface BriefWorkerRunDeps {
	getCurrentLoop(): string | null;
	updateUI(ctx: ExtensionContext): void;
}

function selectedBrief(state: LoopState, briefId?: string): IterationBrief | undefined {
	return briefId ? state.briefs.find((brief) => brief.id === briefId) : currentBrief(state);
}

function defaultWorkerOutputPath(state: LoopState, brief: IterationBrief, role: BriefWorkerRole): string {
	const stamp = new Date().toISOString().replace(/[^0-9A-Za-z]+/g, "-").replace(/-$/, "");
	return path.join(".stardock", "runs", sanitize(state.name), "workers", `${stamp}-${sanitize(brief.id)}-${role}.md`);
}

function defaultAgent(role: BriefWorkerRole): string {
	if (role === "implementer") return "implementer";
	return role === "test_runner" ? "delegate" : "scout";
}

function implementerOutputContract(): string {
	return [
		"Return a compact implementer WorkerReport for the parent/governor.",
		"Include changedFiles with summaries and review reasons, validation commands/results, risks, openQuestions, and suggestedNextMove.",
		"Do not call Stardock tools, mark criteria complete, call stardock_done, complete the loop, spawn agents, or start another worker.",
	].join(" ");
}

function implementerTask(state: LoopState, cwd: string, input: BuildInvocationInput): { ok: true; invocation: Record<string, unknown> } | { ok: false; error: string } {
	const payload = buildBriefWorkerPayload(state, { briefId: input.briefId, role: "implementer", requestedOutput: implementerOutputContract() });
	if (!payload.ok) return payload;
	const task = [
		"Adapter role: implementer",
		"You are a bounded Stardock implementer running in the parent's current workspace with no isolation.",
		"Edit only files necessary for the selected brief. Preserve unrelated local changes and avoid broad refactors.",
		"Do not spawn agents, run hidden fanout, mutate Stardock state, call stardock_done, or declare the loop complete.",
		"If the workspace state or brief scope is unsafe, stop and report the blocker instead of making edits.",
		"The parent/governor must review and accept or dismiss your result before another mutable worker may run.",
		"",
		payload.payload,
	].join("\n");
	return {
		ok: true,
		invocation: {
			agent: input.agentName?.trim() || defaultAgent("implementer"),
			task,
			cwd,
			context: input.context === "fork" ? "fork" : "fresh",
		},
	};
}

function buildInvocation(state: LoopState, cwd: string, input: BuildInvocationInput): { ok: true; invocation: Record<string, unknown> } | { ok: false; error: string } {
	if (input.role === "implementer") return implementerTask(state, cwd, input);
	const adapter = buildAdvisoryAdapterPayload(state, cwd, { role: input.role, briefId: input.briefId, agentName: input.agentName, context: input.context });
	if (!adapter.ok) return adapter;
	return { ok: true, invocation: adapter.invocation };
}

function contentSummary(response: SubagentResponse, reportId?: string, run?: WorkerRun): string {
	const output = compactText(finalOutput(response), 800) ?? "(no output)";
	const refs = outputRefs(response);
	const lines = [
		response.isError ? "Subagent completed with errors." : "Subagent completed.",
		run ? `WorkerRun ${run.id} is ${run.status}.` : undefined,
		reportId ? `Recorded WorkerReport ${reportId}.` : undefined,
		refs.length ? `Refs: ${refs.map((ref) => `\`${ref}\``).join(", ")}` : undefined,
		run?.changedFiles.length ? "Changed files:" : undefined,
		...(run?.changedFiles.length ? formatChangedFiles(run.changedFiles) : []),
		"",
		"Summary:",
		output,
	].filter((line): line is string => line !== undefined);
	return lines.join("\n");
}

function runStatusFor(role: BriefWorkerRole, response: SubagentResponse, changedFiles: ChangedFileReport[]): WorkerRunStatus {
	if (role === "implementer") {
		if (!response.isError || changedFiles.length > 0) return "needs_review";
		return "failed";
	}
	return response.isError ? "failed" : "succeeded";
}

const roleSchema = Type.Union([Type.Literal("explorer"), Type.Literal("test_runner"), Type.Literal("implementer")], { description: "Worker role. explorer maps context; test_runner runs bounded validation; implementer performs one serial mutable brief-scoped edit. Default: explorer." });
const contextSchema = Type.Union([Type.Literal("fresh"), Type.Literal("fork")], { description: "Subagent context mode. Default: fresh." });
const outputModeSchema = Type.Union([Type.Literal("inline"), Type.Literal("file-only")], { description: "Return subagent output inline or as a concise file reference. Default: file-only." });
const outputSchema = Type.Unsafe({ anyOf: [{ type: "string" }, { type: "boolean" }], description: "Output file path for subagent findings, or false to disable saved output. Default is a .stardock/runs/<loop>/workers path." });

export function registerBriefWorkerRunTool(pi: ExtensionAPI, deps: BriefWorkerRunDeps): void {
	pi.registerTool({
		name: "stardock_brief_worker",
		label: "Run Stardock Brief Worker",
		description: "Explicitly run a brief-scoped subagent through pi-subagents and optionally record a compact WorkerReport. Implementer runs are serial, mutable, and require parent review before another implementer can run.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("run"), Type.Literal("list"), Type.Literal("review")], { description: "list inspects WorkerRuns; run starts one explicit brief-scoped subagent; review accepts or dismisses an implementer run." }),
			loopName: Type.Optional(Type.String({ description: "Loop name. Defaults to the active loop." })),
			role: Type.Optional(roleSchema),
			briefId: Type.Optional(Type.String({ description: "Brief id. Defaults to the active brief." })),
			runId: Type.Optional(Type.String({ description: "WorkerRun id for review. Defaults to the open implementer run." })),
			reviewStatus: Type.Optional(Type.Union([Type.Literal("accepted"), Type.Literal("dismissed")], { description: "Review outcome for an implementer WorkerRun. Default: accepted." })),
			reviewRationale: Type.Optional(Type.String({ description: "Parent/governor rationale when accepting or dismissing an implementer WorkerRun." })),
			agentName: Type.Optional(Type.String({ description: "Subagent name. Defaults to scout for explorer, delegate for test_runner, and implementer for implementer." })),
			context: Type.Optional(contextSchema),
			output: Type.Optional(outputSchema),
			outputMode: Type.Optional(outputModeSchema),
			recordResult: Type.Optional(Type.Boolean({ description: "Record the returned result as a compact WorkerReport. Default: true." })),
			reportId: Type.Optional(Type.String({ description: "WorkerReport id to create/update when recordResult is true. Generated when omitted." })),
			allowDirtyWorkspace: Type.Optional(Type.Boolean({ description: "Allow mutable implementer runs when git workspace is dirty or cleanliness cannot be verified. Default false." })),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx: ExtensionContext) {
			const loopName = params.loopName ?? deps.getCurrentLoop();
			if (!loopName) return { content: [{ type: "text", text: "No active Stardock loop." }], details: {} };
			const state = loadState(ctx, loopName);
			if (!state) return { content: [{ type: "text", text: `Loop "${loopName}" not found.` }], details: { loopName }, isError: true };
			if (params.action === "list") return { content: [{ type: "text", text: formatWorkerRunOverview(state) }], details: { loopName, workerRuns: state.workerRuns } };
			if (params.action === "review") return reviewWorkerRun(ctx, loopName, params, deps.updateUI);

			const role = (params.role ?? "explorer") as BriefWorkerRole;
			const brief = selectedBrief(state, params.briefId);
			if (!brief) return { content: [{ type: "text", text: params.briefId ? `Brief "${params.briefId}" not found in loop "${loopName}".` : "No active brief. Pass briefId or activate a brief first." }], details: { loopName }, isError: true };
			const agentName = params.agentName?.trim() || defaultAgent(role);

			if (role === "implementer") {
				const openRun = openMutableWorkerRun(state);
				if (openRun) {
					return { content: [{ type: "text", text: `Cannot start implementer worker: WorkerRun ${openRun.id} is ${openRun.status}. Review, dismiss, or wait for it before starting another mutable worker.` }], details: { loopName, workerRun: openRun }, isError: true };
				}
				const before = gitStatusSnapshot(ctx.cwd);
				if (params.allowDirtyWorkspace !== true) {
					if (!before.ok) return { content: [{ type: "text", text: `Cannot verify clean git workspace for implementer run: ${before.error ?? "unknown git error"}. Pass allowDirtyWorkspace: true to override.` }], details: { loopName, gitStatus: before }, isError: true };
					if (before.dirty) return { content: [{ type: "text", text: [`Workspace has uncommitted changes. Implementer runs require a clean workspace unless allowDirtyWorkspace is true.`, "Dirty files:", ...formatChangedFiles(before.files)].join("\n") }], details: { loopName, gitStatus: before }, isError: true };
				}
			}

			const built = buildInvocation(state, ctx.cwd, { role, briefId: brief.id, agentName, context: params.context });
			if (!built.ok) return { content: [{ type: "text", text: built.error }], details: { loopName, role, briefId: brief.id }, isError: true };
			const output = params.output === false ? false : typeof params.output === "string" ? params.output : defaultWorkerOutputPath(state, brief, role);
			const outputMode: OutputMode = params.outputMode ?? (output === false ? "inline" : "file-only");
			const invocation = { ...built.invocation, output, outputMode, async: false, clarify: false };
			const requestId = `stardock-${sanitize(state.name)}-${sanitize(brief.id)}-${role}-${randomUUID().slice(0, 8)}`;
			const now = new Date().toISOString();
			const run: WorkerRun = {
				id: nextSequentialId("run", state.workerRuns),
				role,
				status: "running",
				briefId: brief.id,
				requestId,
				agentName,
				context: params.context === "fork" ? "fork" : "fresh",
				outputMode,
				outputPath: typeof output === "string" ? output : undefined,
				outputRefs: [],
				changedFiles: [],
				allowDirtyWorkspace: params.allowDirtyWorkspace === true,
				startedAt: now,
				updatedAt: now,
			};
			state.workerRuns.push(run);
			saveState(ctx, state);
			deps.updateUI(ctx);

			try {
				const response = await runSubagentThroughBridge({
					events: (pi as unknown as { events?: EventBus }).events,
					requestId,
					params: invocation,
					signal,
					onUpdate: (text, details) => onUpdate?.({ content: [{ type: "text", text }], details }),
				});
				const changedFiles = role === "implementer" ? gitStatusSnapshot(ctx.cwd).files : [];
				let report: ReturnType<typeof recordWorkerReport> extends { ok: true; report: infer R } ? R : unknown;
				let reportError: string | undefined;
				if (params.recordResult !== false) {
					const refs = outputRefs(response);
					const recorded = recordWorkerReport(ctx, loopName, {
						id: params.reportId,
						status: role === "implementer" || response.isError ? "needs_review" : "submitted",
						role,
						objective: `Brief ${brief.id}: ${brief.objective}`,
						summary: finalOutput(response),
						evaluatedCriterionIds: brief.criterionIds,
						changedFiles,
						reviewHints: [
							...(refs.length ? [`Worker output refs: ${refs.slice(0, 4).join(", ")}`] : []),
							...(role === "implementer" ? ["Mutable implementer run requires parent/governor review before another implementer run or completion."] : []),
							...(response.isError ? ["Subagent run returned an error; inspect output before continuing."] : []),
						],
					});
					if (recorded.ok) report = recorded.report;
					else reportError = recorded.error;
				}
				const reportId = report && typeof report === "object" && "id" in report ? String((report as { id: string }).id) : undefined;
				const updatedRun = updateWorkerRun(ctx, loopName, run.id, (item) => {
					item.status = runStatusFor(role, response, changedFiles);
					item.completedAt = new Date().toISOString();
					item.summary = finalOutput(response);
					item.outputRefs = outputRefs(response);
					item.changedFiles = changedFiles;
					item.reportId = reportId;
				}) ?? run;
				deps.updateUI(ctx);
				const text = reportError ? `${contentSummary(response, undefined, updatedRun)}\n\nWorkerReport recording failed: ${reportError}` : contentSummary(response, reportId, updatedRun);
				return {
					content: [{ type: "text", text }],
					details: { loopName, role, brief, requestId, invocation, workerRun: updatedRun, subagent: response, report, outputRefs: outputRefs(response), reportError },
					...(response.isError || reportError ? { isError: true } : {}),
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const updatedRun = updateWorkerRun(ctx, loopName, run.id, (item) => {
					item.status = message.toLowerCase().includes("cancel") ? "cancelled" : "failed";
					item.completedAt = new Date().toISOString();
					item.summary = message;
				}) ?? run;
				deps.updateUI(ctx);
				return { content: [{ type: "text", text: message }], details: { loopName, role, brief, requestId, invocation, workerRun: updatedRun }, isError: true };
			}
		},
	});
}
