import { Type } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import {
	appendLog,
	categoryForTool,
	feedbackLogPath,
	feedbackPrompt,
	feedbackRecord,
	isRecord,
	loadToolFeedbackConfig,
	logSafeFeedbackRecord,
	makeTurnSummary,
	matchesWatch,
	modeIncludesAsk,
	modeIncludesPassive,
	resultErrorKind,
	resultOk,
	resultTruncated,
	stringValue,
	unique,
	type AgentUsage,
	type FeedbackMode,
	type LoadedConfig,
	type TurnUsage,
	type WatchedToolCall,
	type WatchedToolResult,
} from "./src/core.ts";

export { feedbackLogPath, loadToolFeedbackConfig } from "./src/core.ts";

const MESSAGE_TYPE_TOOL_FEEDBACK_REQUEST = "tool-feedback:request";

interface FeedbackRequestDetails {
	kind: "tool_feedback_request";
	watchedTools: string[];
}

function runtimeModeFromArgs(args: string): FeedbackMode | undefined {
	return args === "off" || args === "passive" || args === "ask-agent" || args === "both" ? args : undefined;
}

function statusText(loaded: LoadedConfig): string {
	return `tool-feedback ${loaded.config.mode}; watching ${loaded.config.watch.map((rule) => rule.name ?? `${rule.prefix}*`).join(", ") || "nothing"}`;
}

function feedbackRequestDetails(agent: AgentUsage): FeedbackRequestDetails {
	return {
		kind: "tool_feedback_request",
		watchedTools: unique(agent.watchedCalls.map((call) => call.toolName)),
	};
}

function statePayload(loaded: LoadedConfig, agent: AgentUsage | undefined): Record<string, unknown> {
	return {
		mode: loaded.config.mode,
		watch: loaded.config.watch,
		excludeTools: loaded.config.excludeTools,
		cooldownTurns: loaded.config.cooldownTurns,
		skipWhenPendingMessages: loaded.config.skipWhenPendingMessages,
		appendSessionEntries: loaded.config.appendSessionEntries,
		log: loaded.config.log,
		loadedConfig: loaded.paths,
		diagnostics: loaded.diagnostics,
		currentAgent: agent ? {
			watchedTools: unique(agent.watchedCalls.map((call) => call.toolName)),
			watchedCallCount: agent.watchedCalls.length,
			watchedResultCount: agent.watchedResults.length,
			feedbackRecorded: agent.feedbackRecorded,
			afterWatchedCategories: unique(agent.afterWatchedCategories),
		} : undefined,
	};
}

function registerFeedbackRequestRenderer(pi: ExtensionAPI): void {
	pi.registerMessageRenderer<FeedbackRequestDetails>(MESSAGE_TYPE_TOOL_FEEDBACK_REQUEST, (message, _options, theme) => {
		const details = message.details;
		if (!details || details.kind !== "tool_feedback_request") return undefined;
		const watched = details.watchedTools.join(", ") || "watched tools";
		return new Text(`${theme.fg("warning", "✦ tool feedback requested ")}${theme.fg("accent", watched)}`);
	});
}

export default function toolFeedback(pi: ExtensionAPI): void {
	let loadedConfig: LoadedConfig | undefined;
	let runtimeMode: FeedbackMode | undefined;
	let activeTurnIndex = 0;
	let sequence = 0;
	let currentTurn: TurnUsage | undefined;
	let currentAgent: AgentUsage | undefined;
	let lastPromptedTurn = Number.NEGATIVE_INFINITY;
	const pendingCalls = new Map<string, WatchedToolCall & { startedAt: number }>();

	registerFeedbackRequestRenderer(pi);

	const getLoadedConfig = (ctx: ExtensionContext): LoadedConfig => {
		loadedConfig = loadToolFeedbackConfig(ctx);
		if (runtimeMode) loadedConfig.config.mode = runtimeMode;
		return loadedConfig;
	};

	const getConfig = (ctx: ExtensionContext) => getLoadedConfig(ctx).config;

	const ensureTurn = (): TurnUsage => {
		if (currentTurn) return currentTurn;
		currentTurn = { turnIndex: activeTurnIndex, startedAt: Date.now(), toolCalls: [], watchedCalls: [], watchedResults: [] };
		return currentTurn;
	};

	const ensureAgent = (): AgentUsage => {
		if (currentAgent) return currentAgent;
		currentAgent = { startedAt: Date.now(), watchedCalls: [], watchedResults: [], feedbackRecorded: false, afterWatchedCategories: [], turnSummaries: [] };
		return currentAgent;
	};

	pi.registerTool({
		name: "tool_feedback_state",
		label: "Tool Feedback State",
		description: "Inspect generic watched-tool feedback configuration and current prompt usage.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const payload = statePayload(getLoadedConfig(ctx), currentAgent);
			return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], details: payload };
		},
	});

	pi.registerTool({
		name: "tool_feedback",
		label: "Tool Feedback",
		description: "Record concise structured feedback after using watched tools. This stores feedback only; it does not change the watched tool.",
		parameters: Type.Object({
			watchedTools: Type.Array(Type.String(), { description: "Watched tool names this feedback covers." }),
			perceivedUsefulness: Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low"), Type.Literal("none"), Type.Literal("unknown")], { description: "How useful the tool felt for this task." }),
			wouldUseAgainSameSituation: Type.Union([Type.Literal("yes"), Type.Literal("no"), Type.Literal("unsure"), Type.Literal("unknown")], { description: "Whether you would use the same tool again for a similar situation." }),
			followupWasRoutine: Type.Optional(Type.Union([Type.Literal("yes"), Type.Literal("no"), Type.Literal("unknown")], { description: "Whether follow-up work felt routine rather than caused by tool insufficiency." })),
			followupNeededBecauseToolWasInsufficient: Type.Optional(Type.Union([Type.Literal("yes"), Type.Literal("no"), Type.Literal("unknown")], { description: "Whether follow-up work was needed because the watched tool was insufficient." })),
			outputSeemedTooNoisy: Type.Optional(Type.Union([Type.Literal("yes"), Type.Literal("no"), Type.Literal("unknown")], { description: "Whether the output felt too noisy to use efficiently." })),
			outputSeemedIncomplete: Type.Optional(Type.Union([Type.Literal("yes"), Type.Literal("no"), Type.Literal("unknown")], { description: "Whether the output felt incomplete for the task." })),
			missedImportantContext: Type.Optional(Type.Union([Type.Literal("yes"), Type.Literal("no"), Type.Literal("unknown")], { description: "Whether important context was later found outside the watched tool output." })),
			confidence: Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")], { description: "Confidence in this subjective feedback." }),
			improvement: Type.Optional(Type.Union([Type.Literal("better_ranking"), Type.Literal("higher_cap"), Type.Literal("better_summary"), Type.Literal("better_docs"), Type.Literal("less_noise"), Type.Literal("faster"), Type.Literal("other")], { description: "Most useful improvement area." })),
			note: Type.Optional(Type.String({ description: "Short optional note. Stored in the session entry; logs keep only length/hash." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const config = getConfig(ctx);
			const record = feedbackRecord(params as Record<string, unknown>, ctx);
			ensureAgent().feedbackRecorded = true;
			if (config.appendSessionEntries) pi.appendEntry("tool-feedback:agent-feedback", record);
			appendLog(config, record.sessionId, logSafeFeedbackRecord(record));
			const payload = { recorded: true, watchedTools: record.watchedTools, perceivedUsefulness: record.perceivedUsefulness, confidence: record.confidence };
			return { content: [{ type: "text", text: `Recorded feedback for ${record.watchedTools.length || 0} watched tool(s).` }], details: payload };
		},
	});

	pi.registerCommand("tool-feedback", {
		description: "Show or set watched-tool feedback mode: status, off, passive, ask-agent, both",
		handler: async (args, ctx) => {
			runtimeMode = runtimeModeFromArgs(args.trim()) ?? runtimeMode;
			ctx.ui.notify(statusText(getLoadedConfig(ctx)), "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		const loaded = getLoadedConfig(ctx);
		ctx.ui.setStatus("tool-feedback", loaded.config.mode === "off" || loaded.config.watch.length === 0 ? undefined : `tf:${loaded.config.mode}`);
	});

	pi.on("agent_start", async (_event, ctx) => {
		getLoadedConfig(ctx);
		currentAgent = { startedAt: Date.now(), watchedCalls: [], watchedResults: [], feedbackRecorded: false, afterWatchedCategories: [], turnSummaries: [] };
	});

	pi.on("turn_start", async (event) => {
		activeTurnIndex = event.turnIndex;
		currentTurn = { turnIndex: event.turnIndex, startedAt: event.timestamp, toolCalls: [], watchedCalls: [], watchedResults: [] };
	});

	pi.on("tool_call", async (event, ctx) => {
		const config = getConfig(ctx);
		const toolName = stringValue(event.toolName);
		const toolCallId = stringValue(event.toolCallId);
		if (!toolName || !toolCallId) return;

		const category = categoryForTool(toolName, event.input);
		const callSequence = ++sequence;
		const turn = ensureTurn();
		turn.toolCalls.push({ toolName, category, sequence: callSequence });

		const agent = ensureAgent();
		if (agent.lastWatchedSequence !== undefined && callSequence > agent.lastWatchedSequence) agent.afterWatchedCategories.push(category);
		if (config.mode === "off" || !matchesWatch(toolName, config)) return;

		const inputRecord = isRecord(event.input) ? event.input as Record<string, unknown> : undefined;
		const watched: WatchedToolCall & { startedAt: number } = {
			toolName,
			toolCallId,
			category,
			confirmReferences: inputRecord ? stringValue(inputRecord.confirmReferences) : undefined,
			turnIndex: turn.turnIndex,
			sequence: callSequence,
			startedAt: Date.now(),
		};
		pendingCalls.set(toolCallId, watched);
		turn.watchedCalls.push(watched);
		agent.watchedCalls.push(watched);
		agent.lastWatchedSequence = callSequence;
	});

	pi.on("tool_result", async (event) => {
		const toolName = stringValue(event.toolName);
		const toolCallId = stringValue(event.toolCallId);
		if (!toolName || !toolCallId) return;
		const pending = pendingCalls.get(toolCallId);
		pendingCalls.delete(toolCallId);
		if (!pending) return;

		const result: WatchedToolResult = {
			...pending,
			ok: resultOk(event.details, event.isError === true),
			isError: event.isError === true,
			truncated: resultTruncated(event.details),
			errorKind: resultErrorKind(event.details, event.isError === true),
			durationMs: Date.now() - pending.startedAt,
		};
		ensureTurn().watchedResults.push(result);
		ensureAgent().watchedResults.push(result);
	});

	pi.on("turn_end", async (event, ctx) => {
		const config = getConfig(ctx);
		const turn = currentTurn;
		if (!turn || turn.watchedCalls.length === 0) return;
		const summary = makeTurnSummary(turn, ctx);
		ensureAgent().turnSummaries.push(summary);
		if (modeIncludesPassive(config.mode)) {
			if (config.appendSessionEntries) pi.appendEntry("tool-feedback:turn-summary", summary);
			appendLog(config, summary.sessionId, summary as unknown as Record<string, unknown>);
		}
		if (event.turnIndex === turn.turnIndex) currentTurn = undefined;
	});

	pi.on("agent_end", async (_event, ctx) => {
		const config = getConfig(ctx);
		const agent = currentAgent;
		if (!agent || agent.watchedCalls.length === 0) return;
		if (!modeIncludesAsk(config.mode)) return;
		if (agent.feedbackRecorded) return;
		if (config.skipWhenPendingMessages && ctx.hasPendingMessages()) return;
		if (activeTurnIndex - lastPromptedTurn <= config.cooldownTurns) return;
		lastPromptedTurn = activeTurnIndex;
		pi.sendMessage(
			{
				customType: MESSAGE_TYPE_TOOL_FEEDBACK_REQUEST,
				content: feedbackPrompt(config, agent),
				display: true,
				details: feedbackRequestDetails(agent),
			},
			{ triggerTurn: true },
		);
	});

	pi.on("session_shutdown", async () => {
		pendingCalls.clear();
		currentTurn = undefined;
		currentAgent = undefined;
	});
}
