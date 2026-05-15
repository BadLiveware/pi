/**
 * Parent-owned advisory adapter payloads for Stardock.
 *
 * This slice intentionally does not execute providers. It formats ready-to-run
 * invocation data that a parent/orchestrator can inspect and pass to an
 * external runner such as pi-subagents.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { AdvisoryHandoffRole, LoopState } from "./state/core.ts";
import { loadState } from "./state/store.ts";
import { buildBriefWorkerInvocation } from "./worker-role-registry.ts";

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
	model?: string;
	thinking?: string;
	fallbackModel?: string;
	context?: AdapterContext;
}

function adapterRole(value: unknown): AdvisoryAdapterRole {
	return value === "test_runner" ? "test_runner" : "explorer";
}

function adapterContext(value: unknown): AdapterContext {
	return value === "fork" ? "fork" : "fresh";
}

function currentModelId(ctx: ExtensionContext): string | undefined {
	const model = ctx.model;
	return model ? `${model.provider}/${model.id}` : undefined;
}

export function buildAdvisoryAdapterPayload(state: LoopState, cwd: string, input: AdapterPayloadInput): { ok: true; payload: string; invocation: Record<string, unknown>; role: AdvisoryAdapterRole } | { ok: false; error: string } {
	const role = adapterRole(input.role);
	const built = buildBriefWorkerInvocation(state, cwd, { role, briefId: input.briefId, agentName: input.agentName, model: input.model, thinking: input.thinking, fallbackModel: input.fallbackModel, context: adapterContext(input.context) });
	if (!built.ok) return built;
	const invocation = built.invocation;
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
const modelSchema = Type.String({ description: "Optional subagent model override. When choosing a non-default model, use list_pi_models and pick an enabled/supported model whose capability, cost, and thinkingLevels fit the brief complexity." });
const thinkingSchema = Type.String({ description: "Optional Pi thinking level such as off, minimal, low, medium, high, or xhigh. Use list_pi_models to inspect the selected model's thinkingLevels first; provider 'none' is exposed as Pi 'off'. Stardock applies this as a model suffix for pi-subagents." });

export function registerAdvisoryAdapterTool(pi: ExtensionAPI, deps: AdvisoryAdapterToolDeps): void {
	pi.registerTool({
		name: "stardock_advisory_adapter",
		label: "Build Stardock Advisory Adapter Payloads",
		description: "Build ready-to-run parent-owned explorer/test-runner adapter payloads, optionally with subagent model and thinking-level overrides, without executing providers or mutating Stardock state.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("payload")], { description: "payload builds a ready-to-run parent-owned adapter invocation." }),
			loopName: Type.Optional(Type.String({ description: "Loop name. Defaults to the active loop." })),
			target: Type.Optional(adapterTargetSchema),
			role: Type.Optional(adapterRoleSchema),
			briefId: Type.Optional(Type.String({ description: "Brief id. Defaults to the active brief." })),
			agentName: Type.Optional(Type.String({ description: "Subagent name to use in the suggested invocation. Defaults to Stardock's current transport agent for the role." })),
			model: Type.Optional(modelSchema),
			thinking: Type.Optional(thinkingSchema),
			context: Type.Optional(adapterContextSchema),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
			const target: AdapterTarget = params.target ?? "pi_subagents";
			if (target !== "pi_subagents") return { content: [{ type: "text", text: `Unsupported advisory adapter target: ${target}` }], details: { target } };
			const loopName = params.loopName ?? deps.getCurrentLoop();
			if (!loopName) return { content: [{ type: "text", text: "No active Stardock loop." }], details: {} };
			const state = loadState(ctx, loopName);
			if (!state) return { content: [{ type: "text", text: `Loop "${loopName}" not found.` }], details: { loopName } };
			const payload = buildAdvisoryAdapterPayload(state, ctx.cwd, { ...params, fallbackModel: currentModelId(ctx) });
			if (!payload.ok) return { content: [{ type: "text", text: payload.error }], details: { loopName, target } };
			return { content: [{ type: "text", text: payload.payload }], details: { loopName, target, role: payload.role, invocation: payload.invocation } };
		},
	});
}
