/** Compatibility/convenience wrapper for brief-scoped Stardock worker execution. */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { executeStardockWorkerTool, type WorkerRunParams } from "./stardock-worker-tool.ts";

export interface BriefWorkerRunDeps {
	getCurrentLoop(): string | null;
	updateUI(ctx: ExtensionContext): void;
}

const roleSchema = Type.Union([Type.Literal("explorer"), Type.Literal("test_runner"), Type.Literal("implementer")], { description: "Worker role. For non-trivial active-brief implementation, pass implementer before parent edit/write. explorer maps context and test_runner validates; those roles do not satisfy implementation delegation. Default: explorer for compatibility only." });
const contextSchema = Type.Union([Type.Literal("fresh"), Type.Literal("fork")], { description: "Subagent context mode. Default: fresh." });
const modelSchema = Type.String({ description: "Optional subagent model override. When choosing a non-default model, use list_pi_models and pick an enabled/supported model whose capability, cost, and thinkingLevels fit the brief complexity." });
const thinkingSchema = Type.String({ description: "Optional Pi thinking level such as off, minimal, low, medium, high, or xhigh. Use list_pi_models to inspect the selected model's thinkingLevels first; provider 'none' is exposed as Pi 'off'. Stardock applies this as a model suffix for pi-subagents." });
const outputModeSchema = Type.Union([Type.Literal("inline"), Type.Literal("file-only")], { description: "Return subagent output inline or as a concise file reference. Default: file-only." });
const outputSchema = Type.Unsafe({ anyOf: [{ type: "string" }, { type: "boolean" }], description: "Output file path for subagent findings, or false to disable saved output. Default is a .stardock/runs/<loop>/workers path." });

export function registerBriefWorkerRunTool(pi: ExtensionAPI, deps: BriefWorkerRunDeps): void {
	pi.registerTool({
		name: "stardock_brief_worker",
		label: "Run Stardock Brief Worker",
		description: "Compatibility/convenience wrapper for brief-scoped Stardock worker roles, with optional model and thinking-level overrides. Prefer stardock_worker for new workflows; this tool uses the same execution path for explorer, test_runner, and implementer. For non-trivial brief implementation, run implementer before parent edit/write; explorer/test_runner do not satisfy implementation delegation. Implementer runs are serial, mutable, and require parent review before another implementer can run.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("run"), Type.Literal("list"), Type.Literal("review")], { description: "list inspects WorkerRuns; run starts one explicit brief-scoped subagent; review accepts or dismisses an implementer run. Run implementer before non-trivial active-brief edits unless a direct-parent-edit exception is explicit; trivial/surgical means single-file, <=2 localized hunks, no new files/contracts/config/runtime behavior changes." }),
			loopName: Type.Optional(Type.String({ description: "Loop name. Defaults to the active loop." })),
			role: Type.Optional(roleSchema),
			briefId: Type.Optional(Type.String({ description: "Brief id. Defaults to the active brief." })),
			runId: Type.Optional(Type.String({ description: "WorkerRun id for review. Defaults to the open implementer run." })),
			reviewStatus: Type.Optional(Type.Union([Type.Literal("accepted"), Type.Literal("dismissed")], { description: "Review outcome for an implementer WorkerRun. Default: accepted." })),
			reviewRationale: Type.Optional(Type.String({ description: "Parent/governor rationale when accepting or dismissing an implementer WorkerRun." })),
			agentName: Type.Optional(Type.String({ description: "Subagent name. Defaults to Stardock's current transport agent for the role." })),
			model: Type.Optional(modelSchema),
			thinking: Type.Optional(thinkingSchema),
			context: Type.Optional(contextSchema),
			output: Type.Optional(outputSchema),
			outputMode: Type.Optional(outputModeSchema),
			recordResult: Type.Optional(Type.Boolean({ description: "Record the returned result as a compact WorkerReport. Default: true." })),
			reportId: Type.Optional(Type.String({ description: "WorkerReport id to create/update when recordResult is true. Generated when omitted." })),
			allowDirtyWorkspace: Type.Optional(Type.Boolean({ description: "Allow mutable implementer runs when git workspace is dirty or cleanliness cannot be verified. Default false. Do not use a parent-created dirty workspace as a reason to bypass implementer delegation; restore clean state, accept this risk explicitly, or record a direct-edit exception." })),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx: ExtensionContext) {
			return executeStardockWorkerTool(pi, deps, params as WorkerRunParams, signal, onUpdate, ctx);
		},
	});
}
