import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { assistantStoppedForContextLimit } from "./analysis.ts";

type LoopStatus = "active" | "paused" | "completed";
export type LoopKind = "ralph" | "stardock";

export interface RalphState {
	kind?: LoopKind;
	name: string;
	taskFile: string;
	iteration: number;
	maxIterations: number;
	status?: LoopStatus;
	active?: boolean;
}

type LoopCandidate = { state: RalphState; mtimeMs: number };

function ralphDir(ctx: ExtensionContext): string {
	return path.resolve(ctx.cwd, ".ralph");
}

function stardockRunsDir(ctx: ExtensionContext): string {
	return path.resolve(ctx.cwd, ".stardock", "runs");
}

function stateStatus(state: RalphState): LoopStatus {
	return state.status ?? (state.active ? "active" : "paused");
}

function readState(filePath: string, kind?: LoopKind): RalphState | undefined {
	try {
		const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Partial<RalphState>;
		if (!parsed.name || !parsed.taskFile) return undefined;
		return {
			kind,
			name: parsed.name,
			taskFile: parsed.taskFile,
			iteration: Number.isFinite(parsed.iteration) ? Number(parsed.iteration) : 0,
			maxIterations: Number.isFinite(parsed.maxIterations) ? Number(parsed.maxIterations) : 0,
			status: parsed.status,
			active: parsed.active,
		};
	} catch {
		return undefined;
	}
}

function mtimeMs(filePath: string): number {
	try {
		return fs.statSync(filePath).mtimeMs;
	} catch {
		// Keep a deterministic fallback if stat fails.
		return 0;
	}
}

function activeRalphCandidates(ctx: ExtensionContext): LoopCandidate[] {
	const dir = ralphDir(ctx);
	if (!fs.existsSync(dir)) return [];

	const candidates: LoopCandidate[] = [];
	for (const file of fs.readdirSync(dir)) {
		if (!file.endsWith(".state.json")) continue;
		const filePath = path.join(dir, file);
		const state = readState(filePath, "ralph");
		if (!state || stateStatus(state) !== "active") continue;
		candidates.push({ state, mtimeMs: mtimeMs(filePath) });
	}
	return candidates;
}

function activeStardockCandidates(ctx: ExtensionContext): LoopCandidate[] {
	const dir = stardockRunsDir(ctx);
	if (!fs.existsSync(dir)) return [];

	const candidates: LoopCandidate[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const filePath = path.join(dir, entry.name, "state.json");
		const state = readState(filePath, "stardock");
		if (!state || stateStatus(state) !== "active") continue;
		candidates.push({ state, mtimeMs: mtimeMs(filePath) });
	}
	return candidates;
}

export function findMostRecentActiveLoop(ctx: ExtensionContext): RalphState | undefined {
	const candidates = [...activeRalphCandidates(ctx), ...activeStardockCandidates(ctx)];
	candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
	return candidates[0]?.state;
}

export function latestLeafCompactionId(ctx: ExtensionContext): string | undefined {
	const branch = ctx.sessionManager.getBranch();
	const leaf = branch[branch.length - 1] as { type?: string; id?: string } | undefined;
	return leaf?.type === "compaction" ? leaf.id : undefined;
}

function nearestParentMessage(ctx: ExtensionContext, entryId: string, maxDepth = 8): { message?: unknown } | undefined {
	let current = ctx.sessionManager.getEntry(entryId) as { parentId?: string | null } | undefined;
	for (let depth = 0; depth < maxDepth; depth += 1) {
		const parentId = current?.parentId;
		if (!parentId) return undefined;
		const parent = ctx.sessionManager.getEntry(parentId) as { type?: string; parentId?: string | null; message?: unknown } | undefined;
		if (!parent) return undefined;
		if (parent.type === "message") return parent;
		current = parent;
	}
	return undefined;
}

export function isOverflowCompaction(ctx: ExtensionContext, compactionId: string): boolean {
	const parent = nearestParentMessage(ctx, compactionId);
	return parent?.message !== undefined && assistantStoppedForContextLimit(parent.message);
}

export function branchBeforeCompaction(ctx: ExtensionContext, compactionId: string): SessionEntry[] {
	const compaction = ctx.sessionManager.getEntry(compactionId) as { parentId?: string | null } | undefined;
	return compaction?.parentId ? ctx.sessionManager.getBranch(compaction.parentId) : ctx.sessionManager.getBranch();
}

export function messageRole(message: unknown): string | undefined {
	return typeof message === "object" && message !== null && "role" in message && typeof (message as { role?: unknown }).role === "string"
		? ((message as { role: string }).role)
		: undefined;
}
