/**
 * Explicit brief-scoped advisory worker execution for Stardock.
 *
 * This slice is intentionally tool-gated: Stardock never starts a worker when a
 * brief is created. A parent/governor must call this tool to run a selected
 * brief through the pi-subagents bridge, then Stardock records compact evidence.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { buildAdvisoryAdapterPayload } from "./advisory-adapters.ts";
import { currentBrief } from "./briefs.ts";
import { recordWorkerReport } from "./worker-reports.ts";
import { compactText, type IterationBrief, type LoopState } from "./state/core.ts";
import { sanitize } from "./state/paths.ts";
import { loadState } from "./state/store.ts";

const SUBAGENT_REQUEST_EVENT = "subagent:slash:request";
const SUBAGENT_STARTED_EVENT = "subagent:slash:started";
const SUBAGENT_RESPONSE_EVENT = "subagent:slash:response";
const SUBAGENT_UPDATE_EVENT = "subagent:slash:update";
const SUBAGENT_CANCEL_EVENT = "subagent:slash:cancel";
const START_TIMEOUT_MS = 15_000;
const MAX_SAVED_OUTPUT_EXCERPT_BYTES = 64_000;

type BriefWorkerRole = "explorer" | "test_runner";
type BriefWorkerContext = "fresh" | "fork";
type OutputMode = "inline" | "file-only";

type EventBus = {
	on(event: string, handler: (data: unknown) => void): (() => void) | void;
	emit(event: string, data: unknown): void;
};

type SubagentResult = {
	content?: Array<{ type?: string; text?: string }>;
	details?: {
		runId?: string;
		results?: Array<{
			agent?: string;
			exitCode?: number;
			finalOutput?: string;
			error?: string;
			sessionFile?: string;
			savedOutputPath?: string;
			outputReference?: { path?: string; message?: string };
			artifactPaths?: { outputPath?: string };
		}>;
	};
	isError?: boolean;
};

type SubagentResponse = {
	requestId: string;
	result: SubagentResult;
	isError: boolean;
	errorText?: string;
};

export interface BriefWorkerRunDeps {
	getCurrentLoop(): string | null;
	updateUI(ctx: ExtensionContext): void;
}

function firstText(content: SubagentResult["content"]): string | undefined {
	return content?.find((part) => part?.type === "text" && typeof part.text === "string")?.text;
}

function selectedBrief(state: LoopState, briefId?: string): IterationBrief | undefined {
	return briefId ? state.briefs.find((brief) => brief.id === briefId) : currentBrief(state);
}

function defaultWorkerOutputPath(state: LoopState, brief: IterationBrief, role: BriefWorkerRole): string {
	const stamp = new Date().toISOString().replace(/[^0-9A-Za-z]+/g, "-").replace(/-$/, "");
	return path.join(".stardock", "runs", sanitize(state.name), "workers", `${stamp}-${sanitize(brief.id)}-${role}.md`);
}

function readFilePrefix(filePath: string): string | undefined {
	try {
		const stat = fs.statSync(filePath);
		if (!stat.isFile()) return undefined;
		const limit = Math.min(stat.size, MAX_SAVED_OUTPUT_EXCERPT_BYTES);
		const buffer = Buffer.alloc(limit);
		const fd = fs.openSync(filePath, "r");
		try {
			const bytesRead = fs.readSync(fd, buffer, 0, limit, 0);
			const text = buffer.subarray(0, bytesRead).toString("utf-8").trim();
			if (!text) return undefined;
			return stat.size > limit ? `${text}\n...[truncated; full worker output saved to ${filePath}]` : text;
		} finally {
			fs.closeSync(fd);
		}
	} catch {
		return undefined;
	}
}

function savedOutputText(response: SubagentResponse): string | undefined {
	for (const result of response.result.details?.results ?? []) {
		const candidatePaths = [result.savedOutputPath, result.outputReference?.path, result.artifactPaths?.outputPath];
		for (const candidate of candidatePaths) {
			if (!candidate) continue;
			const text = readFilePrefix(candidate);
			if (text) return text;
		}
	}
	return undefined;
}

function finalOutput(response: SubagentResponse): string {
	const first = response.result.details?.results?.[0];
	return savedOutputText(response)
		?? first?.finalOutput
		?? first?.error
		?? firstText(response.result.content)
		?? response.errorText
		?? "(no output)";
}

function outputRefs(response: SubagentResponse): string[] {
	const refs = new Set<string>();
	for (const result of response.result.details?.results ?? []) {
		if (result.savedOutputPath) refs.add(result.savedOutputPath);
		if (result.outputReference?.path) refs.add(result.outputReference.path);
		if (result.artifactPaths?.outputPath) refs.add(result.artifactPaths.outputPath);
		if (result.sessionFile) refs.add(result.sessionFile);
	}
	return [...refs];
}

function subscribe(events: EventBus, event: string, handler: (data: unknown) => void, subscriptions: Array<() => void>): void {
	const unsubscribe = events.on(event, handler);
	if (typeof unsubscribe === "function") subscriptions.push(unsubscribe);
}

async function runSubagentThroughBridge(input: {
	events: EventBus | undefined;
	requestId: string;
	params: Record<string, unknown>;
	signal?: AbortSignal;
	onUpdate?: (text: string, details?: Record<string, unknown>) => void;
}): Promise<SubagentResponse> {
	const { events, requestId, params, signal, onUpdate } = input;
	if (!events || typeof events.on !== "function" || typeof events.emit !== "function") {
		throw new Error("pi-subagents event bridge is unavailable. Ensure pi-subagents is installed and loaded.");
	}

	return await new Promise<SubagentResponse>((resolve, reject) => {
		let done = false;
		let started = false;
		const subscriptions: Array<() => void> = [];
		let timeout: ReturnType<typeof setTimeout> | undefined;

		const finish = (next: () => void) => {
			if (done) return;
			done = true;
			if (timeout) clearTimeout(timeout);
			for (const unsubscribe of subscriptions) unsubscribe();
			if (signal) signal.removeEventListener("abort", abortHandler);
			next();
		};

		const abortHandler = () => {
			try {
				events.emit(SUBAGENT_CANCEL_EVENT, { requestId });
			} catch {
				// Cancellation is best-effort; finish still reports the abort.
			}
			finish(() => reject(new Error("Subagent run cancelled.")));
		};

		subscribe(events, SUBAGENT_STARTED_EVENT, (data) => {
			if (!data || typeof data !== "object") return;
			if ((data as { requestId?: unknown }).requestId !== requestId) return;
			started = true;
			if (timeout) clearTimeout(timeout);
			onUpdate?.("Subagent run started.", { requestId });
		}, subscriptions);

		subscribe(events, SUBAGENT_UPDATE_EVENT, (data) => {
			if (!data || typeof data !== "object") return;
			const update = data as { requestId?: unknown; currentTool?: unknown; toolCount?: unknown };
			if (update.requestId !== requestId) return;
			const tool = typeof update.currentTool === "string" && update.currentTool ? ` Current tool: ${update.currentTool}.` : "";
			onUpdate?.(`Subagent running.${tool}`, { requestId, update });
		}, subscriptions);

		subscribe(events, SUBAGENT_RESPONSE_EVENT, (data) => {
			if (!data || typeof data !== "object") return;
			const response = data as Partial<SubagentResponse>;
			if (response.requestId !== requestId || !response.result) return;
			finish(() => resolve({ requestId, result: response.result as SubagentResult, isError: response.isError === true, errorText: response.errorText }));
		}, subscriptions);

		if (signal?.aborted) return abortHandler();
		if (signal) signal.addEventListener("abort", abortHandler, { once: true });

		timeout = setTimeout(() => {
			finish(() => reject(new Error("Subagent bridge did not start within 15s. Ensure pi-subagents is loaded correctly.")));
		}, START_TIMEOUT_MS);

		events.emit(SUBAGENT_REQUEST_EVENT, { requestId, params });
		if (!started && !done) {
			finish(() => reject(new Error("No subagent bridge responded. Ensure pi-subagents is installed and loaded.")));
		}
	});
}

function contentSummary(response: SubagentResponse, reportId?: string): string {
	const output = compactText(finalOutput(response), 800) ?? "(no output)";
	const refs = outputRefs(response);
	const lines = [
		response.isError ? "Subagent completed with errors." : "Subagent completed.",
		reportId ? `Recorded WorkerReport ${reportId}.` : undefined,
		refs.length ? `Refs: ${refs.map((ref) => `\`${ref}\``).join(", ")}` : undefined,
		"",
		"Summary:",
		output,
	].filter((line): line is string => line !== undefined);
	return lines.join("\n");
}

const roleSchema = Type.Union([Type.Literal("explorer"), Type.Literal("test_runner")], { description: "Advisory worker role. explorer maps context; test_runner runs bounded validation. Default: explorer." });
const contextSchema = Type.Union([Type.Literal("fresh"), Type.Literal("fork")], { description: "Subagent context mode. Default: fresh." });
const outputModeSchema = Type.Union([Type.Literal("inline"), Type.Literal("file-only")], { description: "Return subagent output inline or as a concise file reference. Default: file-only." });
const outputSchema = Type.Unsafe({ anyOf: [{ type: "string" }, { type: "boolean" }], description: "Output file path for subagent findings, or false to disable saved output. Default is a .stardock/runs/<loop>/workers path." });

export function registerBriefWorkerRunTool(pi: ExtensionAPI, deps: BriefWorkerRunDeps): void {
	pi.registerTool({
		name: "stardock_brief_worker",
		label: "Run Stardock Brief Worker",
		description: "Explicitly run a brief-scoped advisory subagent through pi-subagents and optionally record a compact WorkerReport. Does not run automatically when briefs are created.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("run")], { description: "run starts one explicit brief-scoped advisory subagent." }),
			loopName: Type.Optional(Type.String({ description: "Loop name. Defaults to the active loop." })),
			role: Type.Optional(roleSchema),
			briefId: Type.Optional(Type.String({ description: "Brief id. Defaults to the active brief." })),
			agentName: Type.Optional(Type.String({ description: "Subagent name. Defaults to scout for explorer and delegate for test_runner." })),
			context: Type.Optional(contextSchema),
			output: Type.Optional(outputSchema),
			outputMode: Type.Optional(outputModeSchema),
			recordResult: Type.Optional(Type.Boolean({ description: "Record the returned result as a compact WorkerReport. Default: true." })),
			reportId: Type.Optional(Type.String({ description: "WorkerReport id to create/update when recordResult is true. Generated when omitted." })),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx: ExtensionContext) {
			const loopName = params.loopName ?? deps.getCurrentLoop();
			if (!loopName) return { content: [{ type: "text", text: "No active Stardock loop." }], details: {} };
			const state = loadState(ctx, loopName);
			if (!state) return { content: [{ type: "text", text: `Loop "${loopName}" not found.` }], details: { loopName } };
			const role = (params.role ?? "explorer") as BriefWorkerRole;
			const brief = selectedBrief(state, params.briefId);
			if (!brief) return { content: [{ type: "text", text: params.briefId ? `Brief "${params.briefId}" not found in loop "${loopName}".` : "No active brief. Pass briefId or activate a brief first." }], details: { loopName } };

			const adapter = buildAdvisoryAdapterPayload(state, ctx.cwd, { role, briefId: brief.id, agentName: params.agentName, context: params.context });
			if (!adapter.ok) return { content: [{ type: "text", text: adapter.error }], details: { loopName, role, briefId: brief.id } };
			const output = params.output === false ? false : typeof params.output === "string" ? params.output : defaultWorkerOutputPath(state, brief, role);
			const outputMode: OutputMode = params.outputMode ?? (output === false ? "inline" : "file-only");
			const invocation = {
				...adapter.invocation,
				output,
				outputMode,
				async: false,
				clarify: false,
			};
			const requestId = `stardock-${sanitize(state.name)}-${sanitize(brief.id)}-${role}-${randomUUID().slice(0, 8)}`;
			try {
				const response = await runSubagentThroughBridge({
					events: (pi as unknown as { events?: EventBus }).events,
					requestId,
					params: invocation,
					signal,
					onUpdate: (text, details) => onUpdate?.({ content: [{ type: "text", text }], details }),
				});
				let report: ReturnType<typeof recordWorkerReport> extends { ok: true; report: infer R } ? R : unknown;
				let reportError: string | undefined;
				if (params.recordResult !== false) {
					const refs = outputRefs(response);
					const recorded = recordWorkerReport(ctx, loopName, {
						id: params.reportId,
						status: response.isError ? "needs_review" : "submitted",
						role,
						objective: `Brief ${brief.id}: ${brief.objective}`,
						summary: finalOutput(response),
						evaluatedCriterionIds: brief.criterionIds,
						reviewHints: [
							...(refs.length ? [`Worker output refs: ${refs.slice(0, 4).join(", ")}`] : []),
							...(response.isError ? ["Subagent run returned an error; inspect output before continuing."] : []),
						],
					});
					if (recorded.ok) {
						report = recorded.report;
						deps.updateUI(ctx);
					} else {
						reportError = recorded.error;
					}
				}
				const reportId = report && typeof report === "object" && "id" in report ? String((report as { id: string }).id) : undefined;
				const text = reportError ? `${contentSummary(response, undefined)}\n\nWorkerReport recording failed: ${reportError}` : contentSummary(response, reportId);
				return {
					content: [{ type: "text", text }],
					details: { loopName, role, brief, requestId, invocation, subagent: response, report, outputRefs: outputRefs(response), reportError },
					...(response.isError || reportError ? { isError: true } : {}),
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { content: [{ type: "text", text: message }], details: { loopName, role, brief, requestId, invocation }, isError: true };
			}
		},
	});
}
