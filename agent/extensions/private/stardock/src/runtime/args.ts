/** Slash-command argument parsing and loop selection helpers. */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DEFAULT_REFLECT_INSTRUCTIONS, type LoopState } from "../state/core.ts";
import { existingStatePath, safeMtimeMs } from "../state/paths.ts";
import { listLoops, loadState } from "../state/store.ts";

export function parseLoopViewArgs(rest: string): { loopName?: string; archived: boolean } {
	const tokens = rest.trim().split(/\s+/).filter(Boolean);
	const archived = tokens.includes("--archived");
	const loopName = tokens.find((token) => token !== "--archived");
	return { loopName, archived };
}

export function selectLoopForView(ctx: ExtensionContext, currentLoop: string | null, loopName: string | undefined, archived: boolean): LoopState | null {
	if (loopName) return loadState(ctx, loopName, archived);
	if (currentLoop) {
		const current = loadState(ctx, currentLoop, archived);
		if (current) return current;
	}
	const loops = listLoops(ctx, archived);
	if (loops.length === 0) return null;
	return loops.reduce((best, candidate) => {
		const bestMtime = safeMtimeMs(existingStatePath(ctx, best.name, archived));
		const candidateMtime = safeMtimeMs(existingStatePath(ctx, candidate.name, archived));
		return candidateMtime > bestMtime ? candidate : best;
	});
}

export function parseArgs(argsStr: string) {
	const tokens = argsStr.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
	const result = {
		name: "",
		mode: "checklist",
		objective: "",
		baseline: undefined as string | undefined,
		validationCommand: undefined as string | undefined,
		resetPolicy: "manual",
		stopWhen: undefined as string | undefined,
		maxFailedAttempts: undefined as number | undefined,
		outsideHelpEvery: undefined as number | undefined,
		governEvery: undefined as number | undefined,
		outsideHelpOnStagnation: false,
		maxIterations: 50,
		itemsPerIteration: 0,
		reflectEvery: 0,
		reflectInstructions: DEFAULT_REFLECT_INSTRUCTIONS,
	};

	for (let i = 0; i < tokens.length; i++) {
		const tok = tokens[i];
		const next = tokens[i + 1];
		if (tok === "--max-iterations" && next) {
			result.maxIterations = parseInt(next, 10) || 0;
			i++;
		} else if (tok === "--mode" && next) {
			result.mode = next.replace(/^"|"$/g, "");
			i++;
		} else if (tok === "--objective" && next) {
			result.objective = next.replace(/^"|"$/g, "");
			i++;
		} else if (tok === "--baseline" && next) {
			result.baseline = next.replace(/^"|"$/g, "");
			i++;
		} else if (tok === "--validation-command" && next) {
			result.validationCommand = next.replace(/^"|"$/g, "");
			i++;
		} else if (tok === "--reset-policy" && next) {
			result.resetPolicy = next.replace(/^"|"$/g, "");
			i++;
		} else if (tok === "--stop-when" && next) {
			result.stopWhen = next.replace(/^"|"$/g, "");
			i++;
		} else if (tok === "--max-failed-attempts" && next) {
			result.maxFailedAttempts = parseInt(next, 10) || undefined;
			i++;
		} else if (tok === "--outside-help-every" && next) {
			result.outsideHelpEvery = parseInt(next, 10) || undefined;
			i++;
		} else if (tok === "--govern-every" && next) {
			result.governEvery = parseInt(next, 10) || undefined;
			i++;
		} else if (tok === "--outside-help-on-stagnation") {
			result.outsideHelpOnStagnation = true;
		} else if (tok === "--items-per-iteration" && next) {
			result.itemsPerIteration = parseInt(next, 10) || 0;
			i++;
		} else if (tok === "--reflect-every" && next) {
			result.reflectEvery = parseInt(next, 10) || 0;
			i++;
		} else if (tok === "--reflect-instructions" && next) {
			result.reflectInstructions = next.replace(/^"|"$/g, "");
			i++;
		} else if (!tok.startsWith("--")) {
			result.name = tok;
		}
	}
	return result;
}
