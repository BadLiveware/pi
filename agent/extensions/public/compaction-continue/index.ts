import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@mariozechner/pi-coding-agent";

type RalphStatus = "active" | "paused" | "completed";

interface RalphState {
	name: string;
	taskFile: string;
	iteration: number;
	maxIterations: number;
	status?: RalphStatus;
	active?: boolean;
}

export interface RalphPromptInfo {
	key: string;
	loop?: string;
	iteration?: number;
	maxIterations?: number;
	sourceEntryId?: string;
	timestamp: number;
}

export interface RalphBranchAnalysis {
	prompt?: RalphPromptInfo;
	ralphDoneAfterPrompt: boolean;
	latestAssistantText?: string;
	latestAssistantHasToolCall: boolean;
	shouldRecover: boolean;
	reason?: string;
}

export interface CompactionRecoveryAnalysis {
	shouldRecover: boolean;
	kind?: "overflow" | "ralph";
	reason: string;
	ralph?: RalphBranchAnalysis;
}

type WatchdogNudgeKind = "overflow" | "ralph" | "ralph-stall";

interface WatchdogNudgeDetails {
	kind: "watchdog_nudge";
	recoveryKind: WatchdogNudgeKind;
	title: string;
	reason: string;
	loop?: string;
	iteration?: number;
	compactionId?: string;
	promptKey?: string;
}

interface WatchdogNudgeRequest {
	content: string;
	details: WatchdogNudgeDetails;
	entry: Record<string, unknown>;
	notification: string;
}

const RECOVERY_DELAY_MS = 1_000;
const RALPH_IDLE_DELAY_MS = 2_000;
const MAX_RALPH_IDLE_RECOVERIES_PER_PROMPT = 1;
const MESSAGE_TYPE_WATCHDOG_NUDGE = "compaction-continue:watchdog-nudge";
export const WATCHDOG_NUDGE_PROMPT = [
	"Automated watchdog nudge: Pi became idle after compaction or after a watched loop turn.",
	"This is not a new user request and does not mean more work is required.",
	"Check the previous task or loop state. If all requested work is complete, stop and briefly say no further action is needed. If this is a Ralph loop, respond with `<promise>COMPLETE</promise>` when the loop is fully complete. If unfinished in-scope work remains, continue from the next concrete step.",
].join("\n\n");

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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) return content.map(textFromContent).filter(Boolean).join("\n");
	if (!isRecord(content)) return "";

	const type = typeof content.type === "string" ? content.type : undefined;
	if ((type === undefined || type === "text") && typeof content.text === "string") return content.text;
	if ("content" in content) return textFromContent(content.content);
	return "";
}

export function messageText(messageOrContent: unknown): string {
	const content = isRecord(messageOrContent) && "content" in messageOrContent ? messageOrContent.content : messageOrContent;
	return textFromContent(content).trim();
}

function messageRole(message: unknown): string | undefined {
	return isRecord(message) && typeof message.role === "string" ? message.role : undefined;
}

function messageToolName(message: unknown): string | undefined {
	return isRecord(message) && typeof message.toolName === "string" ? message.toolName : undefined;
}

function messageIsError(message: unknown): boolean {
	return isRecord(message) && message.isError === true;
}

function contentBlocks(message: unknown): unknown[] {
	if (!isRecord(message)) return [];
	return Array.isArray(message.content) ? message.content : [];
}

export function messageHasToolCall(message: unknown, toolName?: string): boolean {
	return contentBlocks(message).some((block) => {
		if (!isRecord(block)) return false;
		const type = typeof block.type === "string" ? block.type : undefined;
		if (type !== "toolCall" && type !== "tool_use") return false;
		return toolName ? block.name === toolName : true;
	});
}

function isRalphDoneToolResultMessage(message: unknown): boolean {
	return messageRole(message) === "toolResult" && messageToolName(message) === "ralph_done" && !messageIsError(message);
}

export function isRalphLoopPromptText(text: string): boolean {
	return /RALPH LOOP:/i.test(text) || (/You are in a Ralph loop/i.test(text) && /ralph_done/i.test(text));
}

function parsePositiveInt(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function makeRalphPromptKey(text: string, prompt: Omit<RalphPromptInfo, "key">): string {
	if (prompt.sourceEntryId) return prompt.sourceEntryId;
	const fingerprint = text.replace(/\s+/g, " ").slice(0, 80);
	return `${prompt.loop ?? "unknown"}:${prompt.iteration ?? 0}:${fingerprint}`;
}

export function parseRalphPrompt(text: string, timestamp = Date.now(), sourceEntryId?: string): RalphPromptInfo | undefined {
	if (!isRalphLoopPromptText(text)) return undefined;

	const header = text.match(/RALPH LOOP:\s*([^|\n]+)(?:\s*\|\s*Iteration\s+(\d+)\/(\d+))?/i);
	const instructionIteration = text.match(/You are in a Ralph loop\s*\(iteration\s+(\d+)\s+of\s+(\d+)\)/i);
	const taskFile = text.match(/\.ralph\/([^\s)]+)\b/i);
	const loop = (header?.[1] ?? taskFile?.[1]?.replace(/\.md$/i, ""))?.trim();
	const iteration = parsePositiveInt(header?.[2]) ?? parsePositiveInt(instructionIteration?.[1]);
	const maxIterations = parsePositiveInt(header?.[3]) ?? parsePositiveInt(instructionIteration?.[2]);
	const prompt = { loop, iteration, maxIterations, sourceEntryId, timestamp };
	return { ...prompt, key: makeRalphPromptKey(text, prompt) };
}

export function assistantRequestsRalphContinuation(text: string): boolean {
	const normalized = text.replace(/[’]/g, "'").trim().toLowerCase();
	if (!normalized) return false;
	if (normalized.includes("<promise>complete</promise>")) return false;
	if (/\b(blocked|paused|waiting for|cannot proceed|can't proceed|unable to proceed)\b/.test(normalized)) return false;
	if (/\bneed (your|user) (input|decision|confirmation|approval)\b/.test(normalized)) return false;
	if (/\bplease (confirm|advise|decide)|\bshould i\b|\bdo you want\b/.test(normalized)) return false;

	return [
		/\bi('ll| will)\s+(do|record|update|continue|proceed|work|start|run|check|inspect|implement|create|capture|execute)\b/,
		/\bi('m| am)\s+(proceeding|continuing|working|going to|gonna)\b/,
		/\bproceeding with (that|this|it) now\b/,
		/\bcontinue with (the )?(next|current|this)\b/,
		/\bnext[, ]+i('ll| will)\b/,
		/\blet me\s+(continue|proceed|check|run|update|record|implement|start|execute)\b/,
		/\blet('s| us)\s+(continue|proceed|check|run|update|record|implement|start|execute|inspect|create|capture|do)\b/,
	].some((pattern) => pattern.test(normalized));
}

export function shouldRecoverStalledRalphTurn(message: unknown): boolean {
	if (messageHasToolCall(message)) return false;
	return assistantRequestsRalphContinuation(messageText(message));
}

function entryMessage(entry: SessionEntry): unknown | undefined {
	return entry.type === "message" ? entry.message : undefined;
}

export function analyzeRalphBranchForStall(entries: SessionEntry[], timestamp = Date.now()): RalphBranchAnalysis {
	let promptIndex = -1;
	let prompt: RalphPromptInfo | undefined;

	for (let i = entries.length - 1; i >= 0; i -= 1) {
		const entry = entries[i];
		const message = entryMessage(entry);
		if (!message || messageRole(message) !== "user") continue;
		const candidate = parseRalphPrompt(messageText(message), timestamp, entry.id);
		if (!candidate) continue;
		promptIndex = i;
		prompt = candidate;
		break;
	}

	if (!prompt) {
		return { ralphDoneAfterPrompt: false, latestAssistantHasToolCall: false, shouldRecover: false };
	}

	let ralphDoneAfterPrompt = false;
	let latestAssistant: unknown;
	for (let i = promptIndex + 1; i < entries.length; i += 1) {
		const message = entryMessage(entries[i]);
		if (!message) continue;
		if (isRalphDoneToolResultMessage(message)) ralphDoneAfterPrompt = true;
		if (messageRole(message) === "assistant") latestAssistant = message;
	}

	const latestAssistantText = latestAssistant ? messageText(latestAssistant) : undefined;
	const latestAssistantHasToolCall = latestAssistant ? messageHasToolCall(latestAssistant) : false;
	const shouldRecover = Boolean(latestAssistant && !ralphDoneAfterPrompt && shouldRecoverStalledRalphTurn(latestAssistant));
	return {
		prompt,
		ralphDoneAfterPrompt,
		latestAssistantText,
		latestAssistantHasToolCall,
		shouldRecover,
		reason: shouldRecover ? "assistant-promised-ralph-continuation" : undefined,
	};
}

export function analyzeCompactionRecovery(
	entriesBeforeCompaction: SessionEntry[],
	options: { hasActiveLoop: boolean; isOverflow: boolean; timestamp?: number },
): CompactionRecoveryAnalysis {
	const ralph = analyzeRalphBranchForStall(entriesBeforeCompaction, options.timestamp ?? Date.now());

	if (options.isOverflow) {
		return {
			shouldRecover: true,
			kind: options.hasActiveLoop && ralph.prompt && !ralph.ralphDoneAfterPrompt ? "ralph" : "overflow",
			reason: "context-overflow-compaction",
			ralph,
		};
	}

	if (!options.hasActiveLoop) {
		return { shouldRecover: false, reason: "no-active-ralph-loop", ralph };
	}

	if (!ralph.prompt) {
		return { shouldRecover: false, reason: "active-loop-not-present-in-session-branch", ralph };
	}

	if (ralph.ralphDoneAfterPrompt) {
		return { shouldRecover: false, reason: "ralph-done-after-latest-prompt", ralph };
	}

	if (ralph.shouldRecover) {
		return { shouldRecover: true, kind: "ralph", reason: ralph.reason ?? "ralph-branch-appears-resumable", ralph };
	}

	if (!ralph.latestAssistantText) {
		return { shouldRecover: true, kind: "ralph", reason: "ralph-prompt-has-no-assistant-response", ralph };
	}

	return { shouldRecover: false, reason: "latest-ralph-assistant-did-not-request-continuation", ralph };
}

function branchBeforeCompaction(ctx: ExtensionContext, compactionId: string): SessionEntry[] {
	const compaction = ctx.sessionManager.getEntry(compactionId) as { parentId?: string | null } | undefined;
	return compaction?.parentId ? ctx.sessionManager.getBranch(compaction.parentId) : ctx.sessionManager.getBranch();
}

function registerWatchdogMessageRenderer(pi: ExtensionAPI): void {
	pi.registerMessageRenderer<WatchdogNudgeDetails>(MESSAGE_TYPE_WATCHDOG_NUDGE, (message, _options, theme) => {
		const details = message.details;
		if (!details || details.kind !== "watchdog_nudge") return undefined;

		const target = details.loop
			? ` · ${details.loop}${details.iteration ? ` iter ${details.iteration}` : ""}`
			: "";
		const text = theme.fg("warning", "✦ watchdog nudge ") + theme.fg("muted", `${details.title}${target}`);
		return {
			render: () => [text],
			invalidate: () => {},
		};
	});
}

export default function compactionContinue(pi: ExtensionAPI): void {
	let enabled = true;
	let pendingTimer: ReturnType<typeof setTimeout> | undefined;
	let pendingRalphIdleTimer: ReturnType<typeof setTimeout> | undefined;
	let lastRecoveredCompactionId: string | undefined;
	let lastPreCompactionAnalysis: CompactionRecoveryAnalysis | undefined;
	let lastRalphPrompt: RalphPromptInfo | undefined;
	let ralphDoneAfterLastPrompt = false;
	const ralphRecoveryCounts = new Map<string, number>();

	registerWatchdogMessageRenderer(pi);

	function updateStatus(ctx: ExtensionContext): void {
		const state = enabled ? ctx.ui.theme.fg("success", "on") : ctx.ui.theme.fg("error", "off");
		ctx.ui.setStatus("compaction-continue", `${ctx.ui.theme.fg("muted", "watchdog:")}${state}`);
	}

	function clearRalphIdleTimer(): void {
		if (pendingRalphIdleTimer) clearTimeout(pendingRalphIdleTimer);
		pendingRalphIdleTimer = undefined;
	}

	function canSendNudge(ctx: ExtensionContext): boolean {
		return enabled && ctx.isIdle() && !ctx.hasPendingMessages();
	}

	function sendNudge(ctx: ExtensionContext, request: WatchdogNudgeRequest): void {
		pi.appendEntry("compaction-continue", request.entry);
		ctx.ui.notify(request.notification, "info");
		pi.sendMessage(
			{
				customType: MESSAGE_TYPE_WATCHDOG_NUDGE,
				content: request.content,
				display: true,
				details: request.details,
			},
			{ triggerTurn: true },
		);
	}

	function noteRalphPromptFromText(text: string, timestamp = Date.now()): void {
		const prompt = parseRalphPrompt(text, timestamp);
		if (!prompt) return;
		lastRalphPrompt = prompt;
		ralphDoneAfterLastPrompt = false;
		clearRalphIdleTimer();
	}

	function syncRalphPromptFromBranch(ctx: ExtensionContext): RalphBranchAnalysis {
		const analysis = analyzeRalphBranchForStall(ctx.sessionManager.getBranch());
		if (analysis.prompt) {
			lastRalphPrompt = analysis.prompt;
			ralphDoneAfterLastPrompt = analysis.ralphDoneAfterPrompt;
		}
		return analysis;
	}

	function scheduleRecovery(compactionId: string, ctx: ExtensionContext, seedAnalysis?: CompactionRecoveryAnalysis): void {
		if (pendingTimer) clearTimeout(pendingTimer);

		pendingTimer = setTimeout(() => {
			pendingTimer = undefined;
			if (!enabled) return;
			if (lastRecoveredCompactionId === compactionId) return;

			// The watchdog only recovers idle gaps. If Pi is busy or another message
			// is queued, there is no idle gap to recover.
			if (!canSendNudge(ctx)) return;

			const activeLoop = findMostRecentActiveLoop(ctx);
			const isOverflow = isOverflowCompaction(ctx, compactionId);
			const analysis = analyzeCompactionRecovery(branchBeforeCompaction(ctx, compactionId), {
				hasActiveLoop: Boolean(activeLoop),
				isOverflow,
			});
			const recovery = analysis.shouldRecover ? analysis : seedAnalysis?.shouldRecover ? seedAnalysis : undefined;
			if (!recovery) return;

			lastRecoveredCompactionId = compactionId;
			const recoveryKind = recovery.kind ?? "overflow";
			const title = recoveryKind === "ralph" ? "Unresolved Ralph loop after compaction" : "Context overflow compaction finished";
			const loop = activeLoop?.name ?? recovery.ralph?.prompt?.loop;
			const iteration = activeLoop?.iteration || recovery.ralph?.prompt?.iteration;
			sendNudge(ctx, {
				content: WATCHDOG_NUDGE_PROMPT,
				details: {
					kind: "watchdog_nudge",
					recoveryKind,
					title,
					reason: recovery.reason,
					loop,
					iteration,
					compactionId,
				},
				entry: {
					compactionId,
					kind: recovery.kind,
					loop,
					iteration,
					reason: recovery.reason,
					timestamp: new Date().toISOString(),
				},
				notification:
					recoveryKind === "ralph"
						? "Compaction left an unresolved Ralph loop idle; sending watchdog nudge."
						: "Context overflow compaction finished; sending watchdog nudge.",
			});
		}, RECOVERY_DELAY_MS);
	}

	function scheduleRalphIdleRecovery(ctx: ExtensionContext, prompt: RalphPromptInfo, reason: string): void {
		clearRalphIdleTimer();
		const scheduledPromptKey = prompt.key;

		pendingRalphIdleTimer = setTimeout(() => {
			pendingRalphIdleTimer = undefined;
			if (!enabled) return;
			if (!canSendNudge(ctx)) return;

			const activeLoop = findMostRecentActiveLoop(ctx);
			if (!activeLoop) return;
			if (!lastRalphPrompt || lastRalphPrompt.key !== scheduledPromptKey || ralphDoneAfterLastPrompt) return;

			const recoveries = ralphRecoveryCounts.get(scheduledPromptKey) ?? 0;
			if (recoveries >= MAX_RALPH_IDLE_RECOVERIES_PER_PROMPT) return;
			ralphRecoveryCounts.set(scheduledPromptKey, recoveries + 1);

			const loop = activeLoop.name ?? prompt.loop;
			const iteration = activeLoop.iteration || prompt.iteration;
			sendNudge(ctx, {
				content: WATCHDOG_NUDGE_PROMPT,
				details: {
					kind: "watchdog_nudge",
					recoveryKind: "ralph-stall",
					title: "Ralph loop appears idle",
					reason,
					loop,
					iteration,
					promptKey: scheduledPromptKey,
				},
				entry: {
					kind: "ralph-stall",
					loop,
					iteration,
					reason,
					promptKey: scheduledPromptKey,
					timestamp: new Date().toISOString(),
				},
				notification: "Active Ralph loop went idle after saying it would continue; sending watchdog nudge.",
			});
		}, RALPH_IDLE_DELAY_MS);
	}

	function maybeWatchRalphStall(ctx: ExtensionContext, assistantMessage: unknown): void {
		if (!enabled) return;
		if (!findMostRecentActiveLoop(ctx)) return;
		if (!lastRalphPrompt) syncRalphPromptFromBranch(ctx);
		if (!lastRalphPrompt || ralphDoneAfterLastPrompt) return;
		if (!shouldRecoverStalledRalphTurn(assistantMessage)) return;
		scheduleRalphIdleRecovery(ctx, lastRalphPrompt, "assistant-promised-ralph-continuation");
	}

	function reportStatus(args: string, ctx: ExtensionContext): void {
		const value = args.trim().toLowerCase();
		if (value === "on" || value === "enable") enabled = true;
		else if (value === "off" || value === "disable") enabled = false;

		updateStatus(ctx);
		const activeLoop = findMostRecentActiveLoop(ctx);
		const analysis = syncRalphPromptFromBranch(ctx);
		ctx.ui.notify(
			`Compaction continue: ${enabled ? "enabled" : "disabled"}${
				activeLoop ? `\nActive loop: ${activeLoop.name} (iteration ${activeLoop.iteration})` : "\nNo active loop detected"
			}${analysis.prompt && !analysis.ralphDoneAfterPrompt ? "\nRalph idle watch: armed" : ""}`,
			"info",
		);
	}

	pi.registerCommand("compaction-continue", {
		description: "Toggle/status for watchdog nudges after idle compactions and Ralph stalls",
		handler: async (args, ctx) => reportStatus(args, ctx),
	});

	pi.registerCommand("ralph-compact-watchdog", {
		description: "Deprecated alias for /compaction-continue",
		handler: async (args, ctx) => reportStatus(args, ctx),
	});

	pi.on("session_before_compact", async (event, ctx) => {
		lastPreCompactionAnalysis = analyzeCompactionRecovery(event.branchEntries, {
			hasActiveLoop: Boolean(findMostRecentActiveLoop(ctx)),
			isOverflow: false,
		});
	});

	pi.on("session_compact", async (event, ctx) => {
		if (!enabled) return;
		const activeLoop = findMostRecentActiveLoop(ctx);
		const isOverflow = isOverflowCompaction(ctx, event.compactionEntry.id);
		const analysis = analyzeCompactionRecovery(branchBeforeCompaction(ctx, event.compactionEntry.id), {
			hasActiveLoop: Boolean(activeLoop),
			isOverflow,
		});
		if (!analysis.shouldRecover && !lastPreCompactionAnalysis?.shouldRecover) return;
		scheduleRecovery(event.compactionEntry.id, ctx, lastPreCompactionAnalysis);
	});

	pi.on("message_end", async (event) => {
		if (messageRole(event.message) === "user") noteRalphPromptFromText(messageText(event.message));
	});

	pi.on("tool_result", async (event) => {
		if (event.toolName !== "ralph_done" || event.isError) return;
		ralphDoneAfterLastPrompt = true;
		clearRalphIdleTimer();
	});

	pi.on("turn_end", async (event, ctx) => {
		if (messageRole(event.message) !== "assistant") return;
		maybeWatchRalphStall(ctx, event.message);
	});

	pi.on("session_start", async (_event, ctx) => {
		updateStatus(ctx);

		// Some pi versions rebuild extension runtimes as part of compaction. If
		// that happens, an in-memory timer scheduled by session_compact would be
		// lost, so also recover when the restored session leaf is the compaction
		// entry itself.
		const compactionId = latestLeafCompactionId(ctx);
		if (enabled && compactionId) {
			const analysis = analyzeCompactionRecovery(branchBeforeCompaction(ctx, compactionId), {
				hasActiveLoop: Boolean(findMostRecentActiveLoop(ctx)),
				isOverflow: isOverflowCompaction(ctx, compactionId),
			});
			if (analysis.shouldRecover) scheduleRecovery(compactionId, ctx, analysis);
		}

		const ralphAnalysis = syncRalphPromptFromBranch(ctx);
		if (enabled && ralphAnalysis.prompt && ralphAnalysis.shouldRecover) {
			scheduleRalphIdleRecovery(ctx, ralphAnalysis.prompt, ralphAnalysis.reason ?? "assistant-promised-ralph-continuation");
		}
	});

	pi.on("session_shutdown", async () => {
		if (pendingTimer) clearTimeout(pendingTimer);
		pendingTimer = undefined;
		clearRalphIdleTimer();
	});
}
