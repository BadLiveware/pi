import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { StardockRuntime } from "../runtime/types.ts";
import type { LoopState } from "../state/core.ts";
import { loadState } from "../state/store.ts";

export const PRIMARY_STARDOCK_TOOLS = [
	"stardock_plan",
	"stardock_run",
	"stardock_review",
	"stardock_integrate",
	"stardock_status",
	"stardock_recover",
	"stardock_complete",
] as const;

export const LEGACY_STARDOCK_TOOLS = [
	"stardock_start",
	"stardock_done",
	"stardock_state",
	"stardock_ledger",
	"stardock_brief",
	"stardock_final_report",
	"stardock_governor_state",
	"stardock_handoff",
	"stardock_auditor",
	"stardock_breakout",
	"stardock_policy",
	"stardock_worker_report",
	"stardock_worker",
	"stardock_brief_worker",
	"stardock_advisory_adapter",
	"stardock_attempt_report",
	"stardock_govern",
	"stardock_outside_payload",
	"stardock_outside_requests",
	"stardock_outside_answer",
	"stardock_stage",
] as const;

function hasToolActivation(pi: ExtensionAPI): pi is ExtensionAPI & { getActiveTools(): string[]; setActiveTools(names: string[]): void } {
	const candidate = pi as unknown as { getActiveTools?: unknown; setActiveTools?: unknown };
	return typeof candidate.getActiveTools === "function" && typeof candidate.setActiveTools === "function";
}

function setLegacySurface(pi: ExtensionAPI, enabled: boolean): void {
	if (!hasToolActivation(pi)) return;
	const legacy = new Set<string>(LEGACY_STARDOCK_TOOLS);
	const active = pi.getActiveTools().filter((name) => !legacy.has(name));
	if (enabled) active.push(...LEGACY_STARDOCK_TOOLS);
	active.push(...PRIMARY_STARDOCK_TOOLS);
	pi.setActiveTools([...new Set(active)]);
}

export function syncExecutionPlanSurface(pi: ExtensionAPI, state: LoopState | null | undefined): void {
	setLegacySurface(pi, Boolean(state && !state.executionPlan));
}

export function registerExecutionPlanSurface(pi: ExtensionAPI, runtime: StardockRuntime): void {
	let legacyEnabled = false;
	pi.on("session_start", (_event, ctx) => {
		const activeState = runtime.ref.currentLoop ? loadState(ctx, runtime.ref.currentLoop) : undefined;
		legacyEnabled = Boolean(activeState && !activeState.executionPlan);
		syncExecutionPlanSurface(pi, activeState);
	});
	pi.registerCommand("stardock-legacy", {
		description: "Enable or disable legacy Stardock diagnostic/recovery tools for this session.",
		handler: async (args, ctx) => {
			const value = args.trim().toLowerCase();
			if (value !== "on" && value !== "off") {
				if (ctx.hasUI) ctx.ui.notify("Usage: /stardock-legacy on|off", "info");
				return;
			}
			legacyEnabled = value === "on";
			setLegacySurface(pi, legacyEnabled);
			if (ctx.hasUI) ctx.ui.notify(`Legacy Stardock tools ${legacyEnabled ? "enabled" : "disabled"} for this session.`, "info");
		},
	});
}
