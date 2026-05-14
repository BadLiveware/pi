import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import compactionContinue from "../index.ts";
import { trackingLogPath } from "../src/tracking.ts";
import { messageEntry, stardockPrompt } from "./shared.ts";

function loadExtension(options: { branchEntry?: any; compactionEntry?: any; leafBranch?: any[]; branchByParent?: Record<string, any[]> } = {}) {
	const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const sentMessages: Array<{ message: unknown; options: unknown }> = [];
	const entries: Array<{ customType: string; data: unknown }> = [];
	const statuses: Array<{ key: string; value: string | undefined }> = [];
	const branchEntry = options.branchEntry ?? {
		id: "assistant-overflow",
		type: "message",
		message: { role: "assistant", stopReason: "length", content: [{ type: "text", text: "cut off" }] },
	};
	const compactionEntry = options.compactionEntry ?? { id: "compact-1", type: "compaction", parentId: "assistant-overflow" };
	const branchByParent = options.branchByParent ?? { [branchEntry.id]: [branchEntry] };
	const leafBranch = options.leafBranch ?? [];
	const entryMap = new Map<string, any>();
	for (const entry of [branchEntry, compactionEntry, ...leafBranch, ...Object.values(branchByParent).flat()]) {
		if (entry?.id) entryMap.set(entry.id, entry);
	}
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
		registerMessageRenderer() {},
		sendMessage(message: unknown, options: unknown) {
			sentMessages.push({ message, options });
		},
		appendEntry(customType: string, data: unknown) {
			entries.push({ customType, data });
		},
	} as any;
	compactionContinue(pi);
	const ctx = {
		cwd: fs.mkdtempSync(path.join(os.tmpdir(), "pi-compaction-continue-repo-")),
		isIdle: () => true,
		hasPendingMessages: () => false,
		sessionManager: {
			getSessionId: () => `compaction-continue-test-${process.pid}`,
			getBranch(parentId?: string) {
				if (parentId !== undefined) return branchByParent[parentId] ?? [];
				return leafBranch;
			},
			getEntry(id: string) {
				return entryMap.get(id);
			},
		},
		ui: {
			notify() {},
			setStatus(key: string, value: string | undefined) {
				statuses.push({ key, value });
			},
			theme: {
				fg(_name: string, value: string) {
					return value;
				},
			},
		},
	};
	return { handlers, tools, commands, sentMessages, entries, statuses, ctx };
}

async function emit(handlers: Map<string, Array<(event: any, ctx: any) => any>>, eventName: string, event: any, ctx: any): Promise<void> {
	for (const handler of handlers.get(eventName) ?? []) await handler(event, ctx);
}

async function withTrackingConfig(config: unknown, run: (logPath: string) => Promise<void>): Promise<void> {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-compaction-continue-config-"));
	const configPath = path.join(dir, "compaction-continue.json");
	const agentDir = path.join(dir, "agent");
	const logPath = path.join(dir, "tracking.jsonl");
	fs.mkdirSync(agentDir);
	if (config !== undefined) fs.writeFileSync(configPath, JSON.stringify(config));
	const oldConfig = process.env.PI_COMPACTION_CONTINUE_CONFIG;
	const oldAgentDir = process.env.PI_AGENT_DIR;
	const oldLog = process.env.PI_COMPACTION_CONTINUE_LOG;
	process.env.PI_COMPACTION_CONTINUE_CONFIG = configPath;
	process.env.PI_AGENT_DIR = agentDir;
	process.env.PI_COMPACTION_CONTINUE_LOG = logPath;
	try {
		await run(logPath);
	} finally {
		if (oldConfig === undefined) delete process.env.PI_COMPACTION_CONTINUE_CONFIG;
		else process.env.PI_COMPACTION_CONTINUE_CONFIG = oldConfig;
		if (oldAgentDir === undefined) delete process.env.PI_AGENT_DIR;
		else process.env.PI_AGENT_DIR = oldAgentDir;
		if (oldLog === undefined) delete process.env.PI_COMPACTION_CONTINUE_LOG;
		else process.env.PI_COMPACTION_CONTINUE_LOG = oldLog;
	}
}

async function withImmediateTimers(run: () => Promise<void>): Promise<void> {
	const originalSetTimeout = global.setTimeout;
	const originalClearTimeout = global.clearTimeout;
	(global as typeof globalThis & { setTimeout: typeof setTimeout }).setTimeout = ((callback: (...args: any[]) => void) => {
		callback();
		return 1 as unknown as ReturnType<typeof setTimeout>;
	}) as typeof setTimeout;
	(global as typeof globalThis & { clearTimeout: typeof clearTimeout }).clearTimeout = (() => {}) as typeof clearTimeout;
	try {
		await run();
	} finally {
		(global as typeof globalThis & { setTimeout: typeof setTimeout }).setTimeout = originalSetTimeout;
		(global as typeof globalThis & { clearTimeout: typeof clearTimeout }).clearTimeout = originalClearTimeout;
	}
}

function writeActiveStardockState(cwd: string, name: string): void {
	const runDir = path.join(cwd, ".stardock", "runs", name);
	fs.mkdirSync(runDir, { recursive: true });
	fs.writeFileSync(path.join(runDir, "state.json"), JSON.stringify({ name, taskFile: path.join(".stardock", "runs", name, "task.md"), iteration: 1, maxIterations: 120, active: true, status: "active" }));
}

describe("compaction-continue tracking", () => {
	it("defaults tracking off even when watchdog_answer is used", async () => {
		await withTrackingConfig(undefined, async () => {
			const { handlers, tools, entries, ctx } = loadExtension();
			await emit(handlers, "session_start", {}, ctx);
			await tools.get("watchdog_answer")!.execute("answer-1", { done: false, confidence: "medium", note: "unfinished" }, undefined, undefined, ctx);
			assert.equal(entries.length, 0);
			const state = await tools.get("compaction_continue_state")!.execute("state", {}, undefined, undefined, ctx);
			assert.equal(state.details.tracking.enabled, false);
			assert.deepEqual(state.details.recentEvents, []);
		});
	});

	it("records candidate, nudge, and answer when tracking is enabled", async () => {
		await withTrackingConfig({ enabled: true, appendSessionEntries: true, log: true, maxRecentEvents: 10 }, async (logPath) => {
			await withImmediateTimers(async () => {
				const { handlers, tools, sentMessages, entries, statuses, ctx } = loadExtension();
				await emit(handlers, "session_start", {}, ctx);
				assert.deepEqual(statuses.at(-1), { key: "compaction-continue", value: "watchdog:on" });
				await emit(handlers, "session_compact", { compactionEntry: { id: "compact-1" } }, ctx);
				assert.equal(sentMessages.length, 1);
				assert.deepEqual(sentMessages[0].options, { triggerTurn: true });
				assert.ok(entries.some((entry) => entry.customType === "compaction-continue:watchdog-candidate"));
				assert.ok(entries.some((entry) => entry.customType === "compaction-continue:watchdog-nudge"));

				await tools.get("watchdog_answer")!.execute("answer-2", { done: false, confidence: "high", note: "still working" }, undefined, undefined, ctx);
				const answerEntry = entries.find((entry) => entry.customType === "compaction-continue:watchdog-answer");
				assert.ok(answerEntry);
				assert.equal((answerEntry!.data as any).done, false);
				assert.equal((answerEntry!.data as any).note, "still working");

				const state = await tools.get("compaction_continue_state")!.execute("state", {}, undefined, undefined, ctx);
				assert.equal(state.details.tracking.enabled, true);
				assert.equal(state.details.recentEvents.length, 3);
				assert.equal(state.details.tracking.logPath, trackingLogPath());

				const log = fs.readFileSync(logPath, "utf-8");
				assert.match(log, /watchdog_candidate/);
				assert.match(log, /watchdog_nudge/);
				assert.match(log, /watchdog_answer/);
				assert.match(log, /noteHash/);
				assert.doesNotMatch(log, /still working/);
			});
		});
	});

	it("nudges after an MRC-wrapped Stardock compaction follows only a context acknowledgement", async () => {
		await withTrackingConfig(undefined, async () => {
			await withImmediateTimers(async () => {
				const loopName = "excession-phase-6-solver-and-model-checking-prototypes";
				const userPrompt = messageEntry("user-stardock", "user", [{ type: "text", text: stardockPrompt }]);
				const assistantTool = messageEntry("assistant-tool", "assistant", [{ type: "toolCall", name: "edit", arguments: { path: ".stardock/runs/excession-phase-6-solver-and-model-checking-prototypes/progress-log.md" } }]);
				const toolResult = messageEntry("tool-result", "toolResult", [{ type: "text", text: "Successfully replaced 1 block(s)." }], { toolName: "edit", isError: false });
				const assistantAck = messageEntry("assistant-context-ack", "assistant", [{ type: "text", text: "Understood. I’ll prefer visible context and reread files directly; I’ll only use `mrc_lookup` if needed." }]);
				const mrcAnchor = { id: "mrc-anchor", type: "custom_message", parentId: "assistant-context-ack", customType: "pi-mrc-anchor" };
				const compactionEntry = { id: "compact-stardock", type: "compaction", parentId: "mrc-anchor" };
				const { handlers, sentMessages, ctx } = loadExtension({ branchByParent: { "mrc-anchor": [userPrompt, assistantTool, toolResult, assistantAck, mrcAnchor] }, compactionEntry });
				writeActiveStardockState(ctx.cwd, loopName);

				await emit(handlers, "session_start", {}, ctx);
				await emit(handlers, "session_compact", { compactionEntry }, ctx);

				assert.equal(sentMessages.length, 1);
				assert.equal((sentMessages[0].message as any).details.recoveryKind, "stardock");
				assert.equal((sentMessages[0].message as any).details.loop, loopName);
				assert.equal((sentMessages[0].message as any).details.reason, "stardock-context-ack-after-tool-progress");
			});
		});
	});

	it("nudges after an MRC-wrapped Stardock overflow compaction is left unresolved", async () => {
		await withTrackingConfig(undefined, async () => {
			await withImmediateTimers(async () => {
				const loopName = "excession-phase-6-solver-and-model-checking-prototypes";
				const userPrompt = messageEntry("user-stardock", "user", [{ type: "text", text: stardockPrompt }]);
				const assistantTool = messageEntry("assistant-tool", "assistant", [{ type: "toolCall", name: "read", arguments: { path: ".stardock/runs/excession-phase-6-solver-and-model-checking-prototypes/task.md" } }]);
				const toolResult = messageEntry("tool-result", "toolResult", [{ type: "text", text: "Implement all slice items." }], { toolName: "read", isError: false });
				const assistantLength = messageEntry("assistant-length", "assistant", [{ type: "thinking", thinking: "Need to continue." }], { stopReason: "length" });
				const mrcAnchor = { id: "mrc-anchor", type: "custom_message", parentId: "assistant-length", customType: "pi-mrc-anchor" };
				const compactionEntry = { id: "compact-stardock", type: "compaction", parentId: "mrc-anchor" };
				const { handlers, sentMessages, ctx } = loadExtension({ branchByParent: { "mrc-anchor": [userPrompt, assistantTool, toolResult, assistantLength, mrcAnchor] }, compactionEntry });
				writeActiveStardockState(ctx.cwd, loopName);

				await emit(handlers, "session_start", {}, ctx);
				await emit(handlers, "session_compact", { compactionEntry }, ctx);

				assert.equal(sentMessages.length, 1);
				assert.deepEqual(sentMessages[0].options, { triggerTurn: true });
				assert.equal((sentMessages[0].message as any).details.recoveryKind, "stardock");
				assert.equal((sentMessages[0].message as any).details.loop, loopName);
				assert.equal((sentMessages[0].message as any).details.reason, "context-overflow-compaction");
			});
		});
	});
});
