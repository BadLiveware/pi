import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import toolFeedback, { feedbackLogPath } from "./index.ts";

function loadExtension() {
	const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const sentUserMessages: Array<{ content: unknown; options: unknown }> = [];
	const sentMessages: Array<{ message: unknown; options: unknown }> = [];
	const entries: Array<{ customType: string; data: unknown }> = [];
	const statuses: Array<{ key: string; value: string | undefined }> = [];
	const pi = {
		on(event: string, handler: (event: any, ctx: any) => any) {
			const existing = handlers.get(event) ?? [];
			existing.push(handler);
			handlers.set(event, existing);
		},
		registerTool(tool: any) {
			tools.set(tool.name, tool);
		},
		registerCommand(name: string, command: any) {
			commands.set(name, command);
		},
		sendUserMessage(content: unknown, options: unknown) {
			sentUserMessages.push({ content, options });
		},
		sendMessage(message: unknown, options: unknown) {
			sentMessages.push({ message, options });
		},
		registerMessageRenderer() {},
		appendEntry(customType: string, data: unknown) {
			entries.push({ customType, data });
		},
	} as any;
	toolFeedback(pi);
	const ctx = {
		cwd: fs.mkdtempSync(path.join(os.tmpdir(), "pi-tool-feedback-repo-")),
		sessionManager: { getSessionId: () => `tool-feedback-test-${process.pid}` },
		ui: {
			notify() {},
			setStatus(key: string, value: string | undefined) {
				statuses.push({ key, value });
			},
		},
		hasPendingMessages: () => false,
	};
	return { handlers, tools, commands, sentUserMessages, sentMessages, entries, statuses, ctx };
}

async function emit(handlers: Map<string, Array<(event: any, ctx: any) => any>>, eventName: string, event: any, ctx: any): Promise<void> {
	for (const handler of handlers.get(eventName) ?? []) await handler(event, ctx);
}

async function withConfig(config: unknown, run: () => Promise<void>): Promise<void> {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-tool-feedback-config-"));
	const configPath = path.join(dir, "tool-feedback.json");
	const agentDir = path.join(dir, "agent");
	const logPath = path.join(dir, "feedback.jsonl");
	fs.mkdirSync(agentDir);
	fs.writeFileSync(configPath, JSON.stringify(config));
	const oldConfig = process.env.PI_TOOL_FEEDBACK_CONFIG;
	const oldAgentDir = process.env.PI_AGENT_DIR;
	const oldLog = process.env.PI_TOOL_FEEDBACK_LOG;
	process.env.PI_TOOL_FEEDBACK_CONFIG = configPath;
	process.env.PI_AGENT_DIR = agentDir;
	process.env.PI_TOOL_FEEDBACK_LOG = logPath;
	try {
		await run();
	} finally {
		if (oldConfig === undefined) delete process.env.PI_TOOL_FEEDBACK_CONFIG;
		else process.env.PI_TOOL_FEEDBACK_CONFIG = oldConfig;
		if (oldAgentDir === undefined) delete process.env.PI_AGENT_DIR;
		else process.env.PI_AGENT_DIR = oldAgentDir;
		if (oldLog === undefined) delete process.env.PI_TOOL_FEEDBACK_LOG;
		else process.env.PI_TOOL_FEEDBACK_LOG = oldLog;
	}
}

describe("tool-feedback", () => {
	it("records passive turn summaries and asks for feedback after watched tools", async () => {
		await withConfig({ mode: "both", watch: [{ prefix: "code_intel_" }] }, async () => {
			const { handlers, sentUserMessages, sentMessages, entries, statuses, ctx } = loadExtension();
			await emit(handlers, "session_start", {}, ctx);
			assert.deepEqual(statuses.at(-1), { key: "tool-feedback", value: "tf:both" });
			await emit(handlers, "agent_start", {}, ctx);
			await emit(handlers, "turn_start", { turnIndex: 1, timestamp: 100 }, ctx);
			await emit(handlers, "tool_call", { toolName: "code_intel_impact_map", toolCallId: "ci-1", input: { confirmReferences: "typescript" } }, ctx);
			await emit(handlers, "tool_result", { toolName: "code_intel_impact_map", toolCallId: "ci-1", input: {}, details: { ok: true, coverage: { truncated: true } }, isError: false }, ctx);
			await emit(handlers, "tool_call", { toolName: "read", toolCallId: "read-1", input: { path: "src/file.ts" } }, ctx);
			await emit(handlers, "turn_end", { turnIndex: 1, message: {}, toolResults: [] }, ctx);
			await emit(handlers, "agent_end", { messages: [] }, ctx);

			const summaryEntry = entries.find((entry) => entry.customType === "tool-feedback:turn-summary");
			assert.ok(summaryEntry);
			const summary = summaryEntry.data as any;
			assert.deepEqual(summary.watchedTools, ["code_intel_impact_map"]);
			assert.equal(summary.anyTruncated, true);
			assert.deepEqual(summary.confirmReferences, ["typescript"]);
			assert.deepEqual(summary.categoriesAfterFirstWatchedCall, ["read"]);
			assert.equal(sentUserMessages.length, 0);
			assert.equal(sentMessages.length, 1);
			assert.deepEqual(sentMessages[0].options, { triggerTurn: true });
			assert.match(JSON.stringify(sentMessages[0].message), /tool-feedback:request/);
			const promptMessage = sentMessages[0].message as any;
			assert.match(JSON.stringify(promptMessage), /tool_feedback/);
			assert.match(promptMessage.content, /perceivedUsefulness: `high`, `medium`, `low`, `none`, or `unknown`/);
			assert.match(promptMessage.content, /improvement \(optional\): `better_ranking`, `higher_cap`, `better_summary`/);
			assert.match(promptMessage.content, /do not need to inspect extension source/i);
			assert.doesNotMatch(promptMessage.content, /Observed follow-up signals/);
			assert.doesNotMatch(promptMessage.content, /truncated/);
			assert.doesNotMatch(JSON.stringify(promptMessage.details), /truncated|source-read|follow-up-search/);

			const log = fs.readFileSync(feedbackLogPath(`tool-feedback-test-${process.pid}`), "utf-8");
			assert.match(log, /turn_summary/);
			assert.match(log, /code_intel_impact_map/);
		});
	});

	it("does not ask when feedback was already recorded", async () => {
		await withConfig({ mode: "both", watch: [{ name: "example_tool" }] }, async () => {
			const { handlers, tools, sentUserMessages, entries, ctx } = loadExtension();
			await emit(handlers, "agent_start", {}, ctx);
			await emit(handlers, "turn_start", { turnIndex: 2, timestamp: 100 }, ctx);
			await emit(handlers, "tool_call", { toolName: "example_tool", toolCallId: "watched", input: {} }, ctx);
			await emit(handlers, "tool_result", { toolName: "example_tool", toolCallId: "watched", details: { ok: true }, isError: false }, ctx);
			await tools.get("tool_feedback")!.execute("feedback", {
				watchedTools: ["example_tool"],
				perceivedUsefulness: "medium",
				wouldUseAgainSameSituation: "yes",
				followupWasRoutine: "no",
				followupNeededBecauseToolWasInsufficient: "yes",
				outputSeemedTooNoisy: "no",
				outputSeemedIncomplete: "unknown",
				missedImportantContext: "unknown",
				confidence: "medium",
				note: "This note should stay in the session entry but not the JSONL log.",
			}, undefined, undefined, ctx);
			await emit(handlers, "turn_end", { turnIndex: 2, message: {}, toolResults: [] }, ctx);
			await emit(handlers, "agent_end", { messages: [] }, ctx);

			assert.equal(sentUserMessages.length, 0);
			const feedbackEntry = entries.find((entry) => entry.customType === "tool-feedback:agent-feedback");
			assert.ok(feedbackEntry);
			assert.equal((feedbackEntry.data as any).perceivedUsefulness, "medium");
			assert.equal((feedbackEntry.data as any).wouldUseAgainSameSituation, "yes");
			assert.equal((feedbackEntry.data as any).confidence, "medium");
			assert.equal((feedbackEntry.data as any).note, "This note should stay in the session entry but not the JSONL log.");
			const log = fs.readFileSync(feedbackLogPath(`tool-feedback-test-${process.pid}`), "utf-8");
			assert.match(log, /agent_feedback/);
			assert.match(log, /noteHash/);
			assert.doesNotMatch(log, /This note should stay/);
		});
	});

	it("prompts for configured custom fields and validates fieldResponses", async () => {
		await withConfig({
			mode: "both",
			watch: [{ name: "example_tool" }],
			feedbackFields: [
				{ name: "rankingQuality", type: "enum", values: ["good", "mixed", "poor", "unknown"], required: true, description: "How good was result ranking?" },
				{ name: "latencyAcceptable", type: "yes_no_unknown", required: false },
				{ name: "resultCount", type: "number", required: false },
			],
		}, async () => {
			const { handlers, tools, sentMessages, entries, ctx } = loadExtension();
			await emit(handlers, "agent_start", {}, ctx);
			await emit(handlers, "turn_start", { turnIndex: 4, timestamp: 100 }, ctx);
			await emit(handlers, "tool_call", { toolName: "example_tool", toolCallId: "watched", input: {} }, ctx);
			await emit(handlers, "tool_result", { toolName: "example_tool", toolCallId: "watched", details: { ok: true }, isError: false }, ctx);
			await emit(handlers, "turn_end", { turnIndex: 4, message: {}, toolResults: [] }, ctx);
			await emit(handlers, "agent_end", { messages: [] }, ctx);

			assert.equal(sentMessages.length, 1);
			const promptMessage = sentMessages[0].message as any;
			assert.match(promptMessage.content, /Configured extra feedback fields/);
			assert.match(promptMessage.content, /rankingQuality/);
			assert.match(promptMessage.content, /good \| mixed \| poor \| unknown/);
			assert.match(promptMessage.content, /latencyAcceptable/);
			const state = await tools.get("tool_feedback_state")!.execute("state", {}, undefined, undefined, ctx);
			const statePayload = JSON.parse(state.content[0].text);
			assert.equal(statePayload.feedbackFields[0].name, "rankingQuality");

			const result = await tools.get("tool_feedback")!.execute("feedback", {
				watchedTools: ["example_tool"],
				perceivedUsefulness: "high",
				wouldUseAgainSameSituation: "yes",
				confidence: "high",
				fieldResponses: {
					rankingQuality: "poor",
					latencyAcceptable: "yes",
					resultCount: 12,
					unknownField: "ignored",
				},
			}, undefined, undefined, ctx);

			assert.deepEqual(result.details.fieldResponseErrors, [{ name: "unknownField", reason: "unknown configured field" }]);
			const feedbackEntry = entries.find((entry) => entry.customType === "tool-feedback:agent-feedback");
			assert.ok(feedbackEntry);
			assert.deepEqual((feedbackEntry.data as any).fieldResponses, { rankingQuality: "poor", latencyAcceptable: "yes", resultCount: 12 });
			assert.deepEqual((feedbackEntry.data as any).fieldResponseErrors, [{ name: "unknownField", reason: "unknown configured field" }]);
			const log = fs.readFileSync(feedbackLogPath(`tool-feedback-test-${process.pid}`), "utf-8");
			assert.match(log, /"fieldResponses":\{"rankingQuality":"poor","latencyAcceptable":"yes","resultCount":12\}/);
		});
	});

	it("does not let cooldown suppress the first eligible feedback prompt", async () => {
		await withConfig({ mode: "ask-agent", watch: [{ name: "example_tool" }], cooldownTurns: 5 }, async () => {
			const { handlers, sentMessages, ctx } = loadExtension();
			await emit(handlers, "agent_start", {}, ctx);
			await emit(handlers, "turn_start", { turnIndex: 0, timestamp: 100 }, ctx);
			await emit(handlers, "tool_call", { toolName: "example_tool", toolCallId: "watched", input: {} }, ctx);
			await emit(handlers, "tool_result", { toolName: "example_tool", toolCallId: "watched", details: { ok: true }, isError: false }, ctx);
			await emit(handlers, "turn_end", { turnIndex: 0, message: {}, toolResults: [] }, ctx);
			await emit(handlers, "agent_end", { messages: [] }, ctx);

			assert.equal(sentMessages.length, 1);
			assert.match(JSON.stringify(sentMessages[0].message), /example_tool/);
		});
	});

	it("honors off mode and exposes state", async () => {
		await withConfig({ mode: "off", watch: [{ prefix: "code_intel_" }] }, async () => {
			const { handlers, tools, sentUserMessages, entries, ctx } = loadExtension();
			await emit(handlers, "agent_start", {}, ctx);
			await emit(handlers, "turn_start", { turnIndex: 3, timestamp: 100 }, ctx);
			await emit(handlers, "tool_call", { toolName: "code_intel_state", toolCallId: "ci-state", input: {} }, ctx);
			await emit(handlers, "tool_result", { toolName: "code_intel_state", toolCallId: "ci-state", details: { ok: true }, isError: false }, ctx);
			await emit(handlers, "turn_end", { turnIndex: 3, message: {}, toolResults: [] }, ctx);
			await emit(handlers, "agent_end", { messages: [] }, ctx);
			assert.equal(sentUserMessages.length, 0);
			assert.equal(entries.length, 0);

			const state = await tools.get("tool_feedback_state")!.execute("state", {}, undefined, undefined, ctx);
			const payload = JSON.parse(state.content[0].text);
			assert.equal(payload.mode, "off");
			assert.deepEqual(payload.watch, [{ prefix: "code_intel_" }]);
		});
	});
});
