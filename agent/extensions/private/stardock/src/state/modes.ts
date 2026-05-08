/** Stardock loop mode defaults and normalization. */

import type { LoopMode, LoopModeState, RecursiveModeState } from "./core.ts";
import { defaultEvolveModeState, migrateEvolveModeState } from "./evolve.ts";

export function defaultRecursiveModeState(objective = "Continue improving the task outcome"): RecursiveModeState {
	return {
		kind: "recursive",
		objective,
		resetPolicy: "manual",
		stopWhen: ["target_reached", "idea_exhaustion", "max_iterations"],
		outsideHelpOnStagnation: false,
		attempts: [],
	};
}

export function defaultModeState(mode: LoopMode): LoopModeState {
	if (mode === "recursive") return defaultRecursiveModeState();
	if (mode === "evolve") return defaultEvolveModeState();
	return { kind: "checklist" };
}

export function migrateModeState(mode: LoopMode, rawModeState: unknown): LoopModeState {
	if (rawModeState && typeof rawModeState === "object" && (rawModeState as { kind?: unknown }).kind === mode) {
		if (mode === "recursive") {
			const raw = rawModeState as Partial<RecursiveModeState>;
			return {
				...defaultRecursiveModeState(raw.objective),
				...raw,
				attempts: Array.isArray(raw.attempts) ? raw.attempts : [],
				outsideHelpOnStagnation: raw.outsideHelpOnStagnation === true,
			};
		}
		if (mode === "evolve") return migrateEvolveModeState(rawModeState);
		return rawModeState as LoopModeState;
	}
	return defaultModeState(mode);
}

export function numberOrDefault(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
