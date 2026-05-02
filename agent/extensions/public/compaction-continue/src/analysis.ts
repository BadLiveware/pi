import type { SessionEntry } from "@mariozechner/pi-coding-agent";

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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isContextLengthError(message: string | undefined): boolean {
	return message?.includes("context_length_exceeded") === true || message?.includes("exceeds the context window") === true;
}

export function assistantStoppedForContextLimit(message: unknown): boolean {
	const stopReason = isRecord(message) && message.role === "assistant" && typeof message.stopReason === "string" ? message.stopReason : undefined;
	return stopReason === "length" || (stopReason === "error" && isContextLengthError(isRecord(message) && typeof message.errorMessage === "string" ? message.errorMessage : undefined));
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
