/**
 * Parent-owned advisory adapter payloads for Stardock.
 *
 * This slice intentionally does not execute providers. It formats ready-to-run
 * invocation data that a parent/orchestrator can inspect and pass to an
 * external runner such as pi-subagents.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { buildBriefWorkerPayload } from "./briefs.ts";
import type { AdvisoryHandoffRole, LoopState } from "./state/core.ts";
import { loadState } from "./state/store.ts";

export interface AdvisoryAdapterToolDeps {
	getCurrentLoop(): string | null;
}

type AdvisoryAdapterRole = Extract<AdvisoryHandoffRole, "explorer" | "test_runner">;
type AdapterTarget = "pi_subagents";
type AdapterContext = "fresh" | "fork";

interface AdapterPayloadInput {
	role?: AdvisoryAdapterRole;
	briefId?: string;
	agentName?: string;
	context?: AdapterContext;
}

function adapterRole(value: unknown): AdvisoryAdapterRole {
	return value === "test_runner" ? "test_runner" : "explorer";
}

function adapterContext(value: unknown): AdapterContext {
	return value === "fork" ? "fork" : "fresh";
}

function defaultAgent(role: AdvisoryAdapterRole): string {
	return role === "test_runner" ? "delegate" : "scout";
}

function outputContract(role: AdvisoryAdapterRole): string {
	if (role === "test_runner") {
		return [
			"Return a compact test-runner WorkerReport. Run only bounded validation commands that are named in this brief or are necessary to verify the selected criteria.",
			"Do not edit files, fix failures, spawn agents, or change Stardock state.",
			"Report commands run, pass/fail/skipped results, compact failure summaries, artifact/log refs when available, evaluatedCriterionIds, risks, openQuestions, and reviewHints for parent inspection.",
		].join(" ");
	}
	return [
		"Return a compact explorer WorkerReport. Inspect the repository only enough to map relevant files/symbols/tests, likely validation commands, context gaps, risks, openQuestions, suggestedNextMove, and reviewHints.",
		"Do not edit files, run broad validation, spawn agents, or change Stardock state.",
	].join(" ");
}

function adapterInstructions(role: AdvisoryAdapterRole): string {
	if (role === "test_runner") {
		return [
			"Adapter role: test_runner",
			"You are an advisory validator. Prefer focused commands tied to selected criteria and brief verification requirements.",
			"Keep full logs out of the chat when they are large; summarize and return paths/artifact refs when available.",
			"Parent records useful outputs with stardock_ledger recordArtifact(s) and stardock_worker_report record.",
		].join("\n");
	}
	return [
		"Adapter role: explorer",
		"You are an advisory scout. Build a read-next map and validation plan for the parent/governor.",
		"Do not make edits. Do not treat discovered files as defects until the parent inspects or validates them.",
		"Parent records useful outputs with stardock_worker_report record or stardock_handoff record.",
	].join("\n");
}

export function buildAdvisoryAdapterPayload(state: LoopState, cwd: string, input: AdapterPayloadInput): { ok: true; payload: string; invocation: Record<string, unknown>; role: AdvisoryAdapterRole } | { ok: false; error: string } {
	const role = adapterRole(input.role);
	const briefPayload = buildBriefWorkerPayload(state, { briefId: input.briefId, role, requestedOutput: outputContract(role) });
	if (!briefPayload.ok) return briefPayload;
	const task = [
		adapterInstructions(role),
		"",
		briefPayload.payload,
	].join("\n");
	const invocation = {
		agent: input.agentName?.trim() || defaultAgent(role),
		task,
		cwd,
		context: adapterContext(input.context),
	};
	const payload = [
		`Parent-owned ${role} adapter payload for loop "${state.name}"`,
		"Target: pi-subagents subagent tool invocation",
		"This is a ready-to-run parent/orchestrator payload only. Stardock does not execute it, persist provider-specific state, apply edits, or spawn hidden workers.",
		"",
		"Suggested subagent arguments:",
		"```json",
		JSON.stringify(invocation, null, 2),
		"```",
		"",
		"After the worker returns, the parent should inspect the result and record compact findings through stardock_worker_report or stardock_handoff. Use stardock_policy({ action: \"parentReview\" }) before relying on risky worker output.",
	].join("\n");
	return { ok: true, payload, invocation, role };
}

const adapterRoleSchema = Type.Union([Type.Literal("explorer"), Type.Literal("test_runner")], { description: "Advisory adapter role. explorer maps context; test_runner runs bounded validation. Default: explorer." });
const adapterTargetSchema = Type.Union([Type.Literal("pi_subagents")], { description: "Adapter target. Currently only pi_subagents is formatted." });
const adapterContextSchema = Type.Union([Type.Literal("fresh"), Type.Literal("fork")], { description: "Subagent context mode for the suggested invocation. Default: fresh." });

export function registerAdvisoryAdapterTool(pi: ExtensionAPI, deps: AdvisoryAdapterToolDeps): void {
	pi.registerTool({
		name: "stardock_advisory_adapter",
		label: "Build Stardock Advisory Adapter Payloads",
		description: "Build ready-to-run parent-owned explorer/test-runner adapter payloads without executing providers or mutating Stardock state.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("payload")], { description: "payload builds a ready-to-run parent-owned adapter invocation." }),
			loopName: Type.Optional(Type.String({ description: "Loop name. Defaults to the active loop." })),
			target: Type.Optional(adapterTargetSchema),
			role: Type.Optional(adapterRoleSchema),
			briefId: Type.Optional(Type.String({ description: "Brief id. Defaults to the active brief." })),
			agentName: Type.Optional(Type.String({ description: "Subagent name to use in the suggested invocation. Defaults to scout for explorer and delegate for test_runner." })),
			context: Type.Optional(adapterContextSchema),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
			const target: AdapterTarget = params.target ?? "pi_subagents";
			if (target !== "pi_subagents") return { content: [{ type: "text", text: `Unsupported advisory adapter target: ${target}` }], details: { target } };
			const loopName = params.loopName ?? deps.getCurrentLoop();
			if (!loopName) return { content: [{ type: "text", text: "No active Stardock loop." }], details: {} };
			const state = loadState(ctx, loopName);
			if (!state) return { content: [{ type: "text", text: `Loop "${loopName}" not found.` }], details: { loopName } };
			const payload = buildAdvisoryAdapterPayload(state, ctx.cwd, params);
			if (!payload.ok) return { content: [{ type: "text", text: payload.error }], details: { loopName, target } };
			return { content: [{ type: "text", text: payload.payload }], details: { loopName, target, role: payload.role, invocation: payload.invocation } };
		},
	});
}
