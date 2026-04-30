/**
 * Stardock state persistence.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import type { LoopState } from "./core.ts";
import { migrateState } from "./migration.ts";
import { archiveDir,ensureDir,existingStatePath,runsDir,stardockDir,statePath,tryRead } from "./paths.ts";

export function readStateFile(filePath: string): LoopState | null {
	const content = tryRead(filePath);
	return content ? migrateState(JSON.parse(content)) : null;
}

export function loadState(ctx: ExtensionContext, name: string, archived = false): LoopState | null {
	return readStateFile(existingStatePath(ctx, name, archived));
}

export function saveState(ctx: ExtensionContext, state: LoopState, archived = false): void {
	state.active = state.status === "active";
	const filePath = statePath(ctx, state.name, archived);
	ensureDir(filePath);
	fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
}

export function listLoops(ctx: ExtensionContext, archived = false): LoopState[] {
	const currentDir = archived ? archiveDir(ctx) : runsDir(ctx);
	const legacyDir = archived ? archiveDir(ctx) : stardockDir(ctx);
	const byName = new Map<string, LoopState>();

	if (fs.existsSync(currentDir)) {
		for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const state = readStateFile(path.join(currentDir, entry.name, "state.json"));
			if (state) byName.set(state.name, state);
		}
	}

	if (fs.existsSync(legacyDir)) {
		for (const entry of fs.readdirSync(legacyDir, { withFileTypes: true })) {
			if (!entry.isFile() || !entry.name.endsWith(".state.json")) continue;
			const state = readStateFile(path.join(legacyDir, entry.name));
			if (state && !byName.has(state.name)) byName.set(state.name, state);
		}
	}

	return [...byName.values()];
}
