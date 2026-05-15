/** General Stardock-owned worker execution tool. */

import { randomUUID } from "node:crypto";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { currentBrief } from "./briefs.ts";
import { finalOutput, outputRefs, runSubagentThroughBridge, type EventBus, type SubagentResponse } from "./brief-worker-run-bridge.ts";
import { formatChangedFiles, gitStatusSnapshot } from "./brief-worker-run-git.ts";
import { recordWorkerReport } from "./worker-reports.ts";
import { formatWorkerRunOverview, openMutableWorkerRun, reviewWorkerRun, updateWorkerRun } from "./worker-runs.ts";
import { compactText, nextSequentialId, type AdvisoryHandoffRole, type ChangedFileReport, type IterationBrief, type LoopState, type OutsideRequest, type OutsideRequestKind, type WorkerRun, type WorkerRunScope } from "./state/core.ts";
import { sanitize } from "./state/paths.ts";
import { loadState, saveState } from "./state/store.ts";
import { buildBriefWorkerInvocation, buildLoopWorkerInvocation, buildRequestWorkerInvocation, classifyWorkerReportStatus, classifyWorkerRunStatus, defaultWorkerAgent, isBriefScopedWorkerRole, isStardockWorkerRole, normalizeWorkerThinking, workerRoleDefinition, type StardockWorkerRole, type WorkerContext } from "./worker-role-registry.ts";

export interface StardockWorkerToolDeps {
	getCurrentLoop(): string | null;
	updateUI(ctx: ExtensionContext): void;
}

type OutputMode = "inline" | "file-only";

function textContent(text: string): { type: "text"; text: string } {
	return { type: "text", text };
}

export interface WorkerRunParams {
	action: "run" | "list" | "review";
	loopName?: string;
	role?: StardockWorkerRole;
	briefId?: string;
	requestId?: string;
	runId?: string;
	reviewStatus?: "accepted" | "dismissed";
	reviewRationale?: string;
	agentName?: string;
	model?: string;
	thinking?: string;
	context?: WorkerContext;
	output?: string | boolean;
	outputMode?: OutputMode;
	recordResult?: boolean;
	reportId?: string;
	allowDirtyWorkspace?: boolean;
}

function selectedBrief(state: LoopState, briefId?: string): IterationBrief | undefined {
	return briefId ? state.briefs.find((brief) => brief.id === briefId) : currentBrief(state);
}

function selectedRequest(state: LoopState, requestId?: string): OutsideRequest | undefined {
	return requestId ? state.outsideRequests.find((request) => request.id === requestId) : undefined;
}

function roleForRequestKind(kind: OutsideRequestKind): StardockWorkerRole {
	if (kind === "governor_review") return "governor";
	if (kind === "auditor_review") return "auditor";
	return "researcher";
}

function inferRole(params: WorkerRunParams, request?: OutsideRequest): StardockWorkerRole {
	if (isStardockWorkerRole(params.role)) return params.role;
	if (request) return roleForRequestKind(request.kind);
	return "explorer";
}

function defaultWorkerOutputPath(state: LoopState, scopeId: string, role: StardockWorkerRole): string {
	const stamp = new Date().toISOString().replace(/[^0-9A-Za-z]+/g, "-").replace(/-$/, "");
	return path.join(".stardock", "runs", sanitize(state.name), "workers", `${stamp}-${sanitize(scopeId)}-${role}.md`);
}

function currentModelId(ctx: ExtensionContext): string | undefined {
	const model = ctx.model;
	return model ? `${model.provider}/${model.id}` : undefined;
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

function markRequestInProgress(state: LoopState, request?: OutsideRequest): void {
	if (!request || request.status !== "requested") return;
	request.status = "in_progress";
}

function markRequestAnswered(ctx: ExtensionContext, loopName: string, requestId: string | undefined, answer: string): void {
	if (!requestId) return;
	const state = loadState(ctx, loopName);
	const request = state?.outsideRequests.find((item) => item.id === requestId);
	if (!state || !request) return;
	request.status = "answered";
	request.answer = compactText(answer, 2000) ?? answer;
	request.consumedAt = new Date().toISOString();
	saveState(ctx, state);
}

function buildInvocationForScope(state: LoopState, cwd: string, params: WorkerRunParams, role: StardockWorkerRole, brief: IterationBrief | undefined, request: OutsideRequest | undefined, fallbackModel?: string) {
	if (brief && isBriefScopedWorkerRole(role)) return buildBriefWorkerInvocation(state, cwd, { role, briefId: brief.id, agentName: params.agentName, model: params.model, thinking: params.thinking, fallbackModel, context: params.context });
	if (request) return buildRequestWorkerInvocation(state, cwd, { role, request, agentName: params.agentName, model: params.model, thinking: params.thinking, fallbackModel, context: params.context });
	if (workerRoleDefinition(role).scopes.includes("loop")) return buildLoopWorkerInvocation(state, cwd, { role, agentName: params.agentName, model: params.model, thinking: params.thinking, fallbackModel, context: params.context });
	return { ok: false as const, error: `Role "${role}" requires an active brief or briefId.` };
}

async function runWorker(pi: ExtensionAPI, deps: StardockWorkerToolDeps, params: WorkerRunParams, signal: AbortSignal | undefined, onUpdate: ((update: { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> }) => void) | undefined, ctx: ExtensionContext, loopName: string, state: LoopState) {
	const request = selectedRequest(state, params.requestId);
	const role = inferRole(params, request);
	const roleDefinition = workerRoleDefinition(role);
	const brief = params.briefId || !request ? selectedBrief(state, params.briefId) : undefined;
	if (params.briefId && !brief) return { content: [textContent(`Brief "${params.briefId}" not found in loop "${loopName}".`)], details: { loopName, role }, isError: true };
	if (params.requestId && !request) return { content: [textContent(`Outside request "${params.requestId}" not found in loop "${loopName}".`)], details: { loopName, role }, isError: true };
	if (!brief && !request && !roleDefinition.scopes.includes("loop")) return { content: [textContent("No active brief. Pass briefId or activate a brief first.")], details: { loopName, role }, isError: true };

	const agentName = params.agentName?.trim() || defaultWorkerAgent(role);
	const thinking = normalizeWorkerThinking(params.thinking);
	if (role === "implementer") {
		const openRun = openMutableWorkerRun(state);
		if (openRun) return { content: [textContent(`Cannot start implementer worker: WorkerRun ${openRun.id} is ${openRun.status}. Review, dismiss, or wait for it before starting another mutable worker.`)], details: { loopName, workerRun: openRun }, isError: true };
		const before = gitStatusSnapshot(ctx.cwd);
		if (params.allowDirtyWorkspace !== true) {
			if (!before.ok) return { content: [textContent(`Cannot verify clean git workspace for implementer run: ${before.error ?? "unknown git error"}. Pass allowDirtyWorkspace: true to override.`)], details: { loopName, gitStatus: before }, isError: true };
			if (before.dirty) return { content: [textContent(["Workspace has uncommitted changes. Implementer runs require a clean workspace unless allowDirtyWorkspace is true.", "Dirty files:", ...formatChangedFiles(before.files)].join("\n"))], details: { loopName, gitStatus: before }, isError: true };
		}
	}

	const built = buildInvocationForScope(state, ctx.cwd, params, role, brief, request, currentModelId(ctx));
	if (!built.ok) return { content: [textContent(built.error)], details: { loopName, role }, isError: true };
	const scope: WorkerRunScope = built.scope;
	const scopeId = brief?.id ?? request?.id ?? "loop";
	const output = params.output === false ? false : typeof params.output === "string" ? params.output : defaultWorkerOutputPath(state, scopeId, role);
	const outputMode: OutputMode = params.outputMode ?? (output === false ? "inline" : "file-only");
	const invocation = { ...built.invocation, output, outputMode, async: false, clarify: false };
	const model = typeof built.invocation.model === "string" ? built.invocation.model : undefined;
	const requestId = `stardock-${sanitize(state.name)}-${sanitize(scopeId)}-${role}-${randomUUID().slice(0, 8)}`;
	const now = new Date().toISOString();
	const run: WorkerRun = {
		id: nextSequentialId("run", state.workerRuns),
		role,
		status: "running",
		scope,
		briefId: brief?.id,
		outsideRequestId: request?.id,
		requestId,
		agentName,
		model,
		thinking,
		context: params.context === "fork" ? "fork" : "fresh",
		outputMode,
		outputPath: typeof output === "string" ? output : undefined,
		outputRefs: [],
		changedFiles: [],
		expectedMutation: roleDefinition.expectedMutation,
		allowDirtyWorkspace: params.allowDirtyWorkspace === true,
		startedAt: now,
		updatedAt: now,
	};
	state.workerRuns.push(run);
	markRequestInProgress(state, request);
	saveState(ctx, state);
	deps.updateUI(ctx);

	try {
		const response = await runSubagentThroughBridge({
			events: (pi as unknown as { events?: EventBus }).events,
			requestId,
			params: invocation,
			signal,
			onUpdate: (text, details) => onUpdate?.({ content: [textContent(text)], details: details ?? {} }),
		});
		const changedFiles = role === "implementer" ? gitStatusSnapshot(ctx.cwd).files : [];
		let report: ReturnType<typeof recordWorkerReport> extends { ok: true; report: infer R } ? R : unknown;
		let reportError: string | undefined;
		if (params.recordResult !== false) {
			const refs = outputRefs(response);
			const recorded = recordWorkerReport(ctx, loopName, {
				id: params.reportId,
				status: classifyWorkerReportStatus({ role, output: finalOutput(response), isError: response.isError, changedFiles }),
				role,
				objective: brief ? `Brief ${brief.id}: ${brief.objective}` : request ? `Request ${request.id}: ${request.kind}` : `Loop ${state.name}: ${role}`,
				summary: finalOutput(response),
				evaluatedCriterionIds: brief?.criterionIds ?? [],
				changedFiles,
				reviewHints: [
					...(refs.length ? [`Worker output refs: ${refs.slice(0, 4).join(", ")}`] : []),
					...(role === "implementer" ? ["Mutable implementer run requires parent/governor review before another implementer run or completion."] : []),
					...(request ? [`Worker answered outside request ${request.id}; parent should inspect and record structured follow-up if needed.`] : []),
					...(response.isError ? ["Subagent run returned an error; inspect output before continuing."] : []),
				],
			});
			if (recorded.ok) report = recorded.report;
			else reportError = recorded.error;
		}
		const reportId = report && typeof report === "object" && "id" in report ? String((report as { id: string }).id) : undefined;
		const updatedRun = updateWorkerRun(ctx, loopName, run.id, (item) => {
			item.status = classifyWorkerRunStatus({ role, output: finalOutput(response), isError: response.isError, changedFiles });
			item.completedAt = new Date().toISOString();
			item.summary = finalOutput(response);
			item.outputRefs = outputRefs(response);
			item.changedFiles = changedFiles;
			item.reportId = reportId;
		}) ?? run;
		if (!response.isError) markRequestAnswered(ctx, loopName, request?.id, finalOutput(response));
		deps.updateUI(ctx);
		const text = reportError ? `${contentSummary(response, undefined, updatedRun)}\n\nWorkerReport recording failed: ${reportError}` : contentSummary(response, reportId, updatedRun);
		return { content: [textContent(text)], details: { loopName, role, scope, brief, outsideRequest: request, requestId, invocation, workerRun: updatedRun, subagent: response, report, outputRefs: outputRefs(response), reportError }, ...(response.isError || reportError ? { isError: true } : {}) };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const updatedRun = updateWorkerRun(ctx, loopName, run.id, (item) => {
			item.status = message.toLowerCase().includes("cancel") ? "cancelled" : "failed";
			item.completedAt = new Date().toISOString();
			item.summary = message;
		}) ?? run;
		deps.updateUI(ctx);
		return { content: [textContent(message)], details: { loopName, role, scope, brief, outsideRequest: request, requestId, invocation, workerRun: updatedRun }, isError: true };
	}
}

const roleSchema = Type.Union([Type.Literal("explorer"), Type.Literal("test_runner"), Type.Literal("implementer"), Type.Literal("governor"), Type.Literal("auditor"), Type.Literal("researcher"), Type.Literal("reviewer")], { description: "Worker role. Roles are Stardock-owned prompt/output contracts; pi-subagents is only the execution transport." });
const contextSchema = Type.Union([Type.Literal("fresh"), Type.Literal("fork")], { description: "Subagent context mode. Default: fresh." });
const modelSchema = Type.String({ description: "Optional subagent model override. When choosing a non-default model, use list_pi_models and pick an enabled/supported model whose capability, cost, and thinkingLevels fit the role complexity." });
const thinkingSchema = Type.String({ description: "Optional Pi thinking level such as off, minimal, low, medium, high, or xhigh. Use list_pi_models to inspect the selected model's thinkingLevels first; provider 'none' is exposed as Pi 'off'. Stardock applies this as a model suffix for pi-subagents." });
const outputModeSchema = Type.Union([Type.Literal("inline"), Type.Literal("file-only")], { description: "Return subagent output inline or as a concise file reference. Default: file-only." });
const outputSchema = Type.Unsafe({ anyOf: [{ type: "string" }, { type: "boolean" }], description: "Output file path for subagent findings, or false to disable saved output. Default is a .stardock/runs/<loop>/workers path." });

export async function executeStardockWorkerTool(pi: ExtensionAPI, deps: StardockWorkerToolDeps, typedParams: WorkerRunParams, signal: AbortSignal | undefined, onUpdate: ((update: { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> }) => void) | undefined, ctx: ExtensionContext) {
	const loopName = typedParams.loopName ?? deps.getCurrentLoop();
	if (!loopName) return { content: [textContent("No active Stardock loop.")], details: {} };
	const state = loadState(ctx, loopName);
	if (!state) return { content: [textContent(`Loop "${loopName}" not found.`)], details: { loopName }, isError: true };
	if (typedParams.action === "list") return { content: [textContent(formatWorkerRunOverview(state))], details: { loopName, workerRuns: state.workerRuns } };
	if (typedParams.action === "review") return reviewWorkerRun(ctx, loopName, typedParams, deps.updateUI);
	return runWorker(pi, deps, typedParams, signal, onUpdate, ctx, loopName, state);
}

export function registerStardockWorkerTool(pi: ExtensionAPI, deps: StardockWorkerToolDeps): void {
	pi.registerTool({
		name: "stardock_worker",
		label: "Run Stardock Worker",
		description: "Run a Stardock-owned worker role through pi-subagents and record WorkerRun/WorkerReport evidence, with optional model and thinking-level overrides. Use this instead of raw subagent calls for Stardock work. Implementer runs are serial and require parent review.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("run"), Type.Literal("list"), Type.Literal("review")], { description: "list inspects WorkerRuns; run starts one explicit Stardock role worker; review accepts or dismisses an implementer run." }),
			loopName: Type.Optional(Type.String({ description: "Loop name. Defaults to the active loop." })),
			role: Type.Optional(roleSchema),
			briefId: Type.Optional(Type.String({ description: "Brief id. Defaults to the active brief for brief-scoped roles." })),
			requestId: Type.Optional(Type.String({ description: "Outside request id for governor/auditor/researcher/reviewer request-scoped workers." })),
			runId: Type.Optional(Type.String({ description: "WorkerRun id for review. Defaults to the open implementer run." })),
			reviewStatus: Type.Optional(Type.Union([Type.Literal("accepted"), Type.Literal("dismissed")], { description: "Review outcome for an implementer WorkerRun. Default: accepted." })),
			reviewRationale: Type.Optional(Type.String({ description: "Parent/governor rationale when accepting or dismissing an implementer WorkerRun." })),
			agentName: Type.Optional(Type.String({ description: "Transport subagent name. Defaults to Stardock's current transport agent for the role." })),
			model: Type.Optional(modelSchema),
			thinking: Type.Optional(thinkingSchema),
			context: Type.Optional(contextSchema),
			output: Type.Optional(outputSchema),
			outputMode: Type.Optional(outputModeSchema),
			recordResult: Type.Optional(Type.Boolean({ description: "Record the returned result as a compact WorkerReport. Default: true." })),
			reportId: Type.Optional(Type.String({ description: "WorkerReport id to create/update when recordResult is true. Generated when omitted." })),
			allowDirtyWorkspace: Type.Optional(Type.Boolean({ description: "Allow mutable implementer runs when git workspace is dirty or cleanliness cannot be verified. Default false." })),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx: ExtensionContext) {
			return executeStardockWorkerTool(pi, deps, params as WorkerRunParams, signal, onUpdate, ctx);
		},
	});
}
