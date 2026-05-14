/**
 * Stardock run-file path and filesystem helpers.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { STARDOCK_DIR } from "./core.ts";

export const stardockDir = (ctx: ExtensionContext) => path.resolve(ctx.cwd, STARDOCK_DIR);
export const runsDir = (ctx: ExtensionContext) => path.join(stardockDir(ctx), "runs");
export const archiveDir = (ctx: ExtensionContext) => path.join(stardockDir(ctx), "archive");
export const sanitize = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_");

export function runDir(ctx: ExtensionContext, name: string, archived = false): string {
	return path.join(archived ? archiveDir(ctx) : runsDir(ctx), sanitize(name));
}

export function statePath(ctx: ExtensionContext, name: string, archived = false): string {
	return path.join(runDir(ctx, name, archived), "state.json");
}

export function taskPath(ctx: ExtensionContext, name: string, archived = false): string {
	return path.join(runDir(ctx, name, archived), "task.md");
}

export function defaultTaskFile(name: string): string {
	return path.join(STARDOCK_DIR, "runs", sanitize(name), "task.md");
}

export function legacyPath(ctx: ExtensionContext, name: string, ext: string, archived = false): string {
	const dir = archived ? archiveDir(ctx) : stardockDir(ctx);
	return path.join(dir, `${sanitize(name)}${ext}`);
}

export function existingStatePath(ctx: ExtensionContext, name: string, archived = false): string {
	const currentPath = statePath(ctx, name, archived);
	return fs.existsSync(currentPath) ? currentPath : legacyPath(ctx, name, ".state.json", archived);
}

export function ensureDir(filePath: string): void {
	const dir = path.dirname(filePath);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function tryDelete(filePath: string): void {
	try {
		if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
	} catch {
		/* ignore */
	}
}

export function tryRead(filePath: string): string | null {
	try {
		return fs.readFileSync(filePath, "utf-8");
	} catch {
		return null;
	}
}

export function safeMtimeMs(filePath: string): number {
	try {
		return fs.statSync(filePath).mtimeMs;
	} catch {
		return 0;
	}
}

export function tryRemoveDir(dirPath: string): boolean {
	try {
		if (fs.existsSync(dirPath)) {
			fs.rmSync(dirPath, { recursive: true, force: true });
		}
		return true;
	} catch {
		return false;
	}
}
