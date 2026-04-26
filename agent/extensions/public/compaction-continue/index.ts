import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

type RalphStatus = "active" | "paused" | "completed";

interface RalphState {
	name: string;
	taskFile: string;
	iteration: number;
	maxIterations: number;
	status?: RalphStatus;
	active?: boolean;
}

const RECOVERY_DELAY_MS = 1_000;
const CONTINUE_PROMPT = "continue";

function ralphDir(ctx: ExtensionContext): string {
	return path.resolve(ctx.cwd, ".ralph");
}

function stateStatus(state: RalphState): RalphStatus {
	return state.status ?? (state.active ? "active" : "paused");
}

function readState(filePath: string): RalphState | undefined {
	try {
		const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Partial<RalphState>;
		if (!parsed.name || !parsed.taskFile) return undefined;
		return {
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

function findMostRecentActiveLoop(ctx: ExtensionContext): RalphState | undefined {
	const dir = ralphDir(ctx);
	if (!fs.existsSync(dir)) return undefined;

	const candidates: Array<{ state: RalphState; mtimeMs: number }> = [];
	for (const file of fs.readdirSync(dir)) {
		if (!file.endsWith(".state.json")) continue;
		const filePath = path.join(dir, file);
		const state = readState(filePath);
		if (!state || stateStatus(state) !== "active") continue;

		let mtimeMs = 0;
		try {
			mtimeMs = fs.statSync(filePath).mtimeMs;
		} catch {
			// Keep a deterministic fallback if stat fails.
		}
		candidates.push({ state, mtimeMs });
	}

	candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
	return candidates[0]?.state;
}

function latestLeafCompactionId(ctx: ExtensionContext): string | undefined {
	const branch = ctx.sessionManager.getBranch();
	const leaf = branch[branch.length - 1] as { type?: string; id?: string } | undefined;
	return leaf?.type === "compaction" ? leaf.id : undefined;
}

function isContextLengthError(message: string | undefined): boolean {
	return message?.includes("context_length_exceeded") === true || message?.includes("exceeds the context window") === true;
}

function isOverflowCompaction(ctx: ExtensionContext, compactionId: string): boolean {
	const compaction = ctx.sessionManager.getEntry(compactionId) as { parentId?: string | null } | undefined;
	if (!compaction?.parentId) return false;

	const parent = ctx.sessionManager.getEntry(compaction.parentId) as
		| { type?: string; message?: { role?: string; stopReason?: string; errorMessage?: string } }
		| undefined;
	return parent?.type === "message" && parent.message?.role === "assistant" && parent.message.stopReason === "error" && isContextLengthError(parent.message.errorMessage);
}

export default function compactionContinue(pi: ExtensionAPI): void {
	let enabled = true;
	let pendingTimer: ReturnType<typeof setTimeout> | undefined;
	let lastRecoveredCompactionId: string | undefined;

	function updateStatus(ctx: ExtensionContext): void {
		const state = enabled ? ctx.ui.theme.fg("success", "on") : ctx.ui.theme.fg("error", "off");
		ctx.ui.setStatus("compaction-continue", `${ctx.ui.theme.fg("muted", "watchdog:")}${state}`);
	}

	function scheduleRecovery(compactionId: string, ctx: ExtensionContext): void {
		if (pendingTimer) clearTimeout(pendingTimer);

		pendingTimer = setTimeout(() => {
			pendingTimer = undefined;
			if (!enabled) return;
			if (lastRecoveredCompactionId === compactionId) return;

			// If pi is still running or another extension/tool already queued the next prompt, leave it alone.
			if (!ctx.isIdle() || ctx.hasPendingMessages()) return;

			const activeLoop = findMostRecentActiveLoop(ctx);
			const isOverflow = isOverflowCompaction(ctx, compactionId);
			if (!activeLoop && !isOverflow) return;

			lastRecoveredCompactionId = compactionId;
			pi.appendEntry("compaction-continue", {
				compactionId,
				kind: activeLoop ? "ralph" : "overflow",
				loop: activeLoop?.name,
				iteration: activeLoop?.iteration,
				timestamp: new Date().toISOString(),
			});

			ctx.ui.notify(
				activeLoop
					? `Compaction left active Ralph loop idle; sending ${CONTINUE_PROMPT}.`
					: `Context overflow compaction finished; sending ${CONTINUE_PROMPT}.`,
				"info",
			);
			pi.sendUserMessage(CONTINUE_PROMPT);
		}, RECOVERY_DELAY_MS);
	}

	function reportStatus(args: string, ctx: ExtensionContext): void {
		const value = args.trim().toLowerCase();
		if (value === "on" || value === "enable") enabled = true;
		else if (value === "off" || value === "disable") enabled = false;

		updateStatus(ctx);
		const activeLoop = findMostRecentActiveLoop(ctx);
		ctx.ui.notify(
			`Compaction continue: ${enabled ? "enabled" : "disabled"}${
				activeLoop ? `\nActive loop: ${activeLoop.name} (iteration ${activeLoop.iteration})` : "\nNo active loop detected"
			}`,
			"info",
		);
	}

	pi.registerCommand("compaction-continue", {
		description: "Toggle/status for auto-sending continue after idle compactions",
		handler: async (args, ctx) => reportStatus(args, ctx),
	});

	pi.registerCommand("ralph-compact-watchdog", {
		description: "Deprecated alias for /compaction-continue",
		handler: async (args, ctx) => reportStatus(args, ctx),
	});

	pi.on("session_compact", async (event, ctx) => {
		if (!enabled) return;
		if (!findMostRecentActiveLoop(ctx) && !isOverflowCompaction(ctx, event.compactionEntry.id)) return;
		scheduleRecovery(event.compactionEntry.id, ctx);
	});

	pi.on("session_start", async (_event, ctx) => {
		updateStatus(ctx);

		// Some pi versions rebuild extension runtimes as part of compaction. If
		// that happens, an in-memory timer scheduled by session_compact would be
		// lost, so also recover when the restored session leaf is the compaction
		// entry itself.
		const compactionId = latestLeafCompactionId(ctx);
		if (enabled && compactionId && (findMostRecentActiveLoop(ctx) || isOverflowCompaction(ctx, compactionId))) {
			scheduleRecovery(compactionId, ctx);
		}
	});

	pi.on("session_shutdown", async () => {
		if (pendingTimer) clearTimeout(pendingTimer);
		pendingTimer = undefined;
	});
}
