import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { TestContext } from "node:test";
import compactionContinue from "../index.ts";
import { messageEntry } from "./shared.ts";

export function configHarness(t: TestContext, config?: unknown) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-watchdog-config-"));
	const agentDir = path.join(root, "agent");
	const cwd = path.join(root, "repo");
	fs.mkdirSync(agentDir);
	fs.mkdirSync(cwd);
	const file = path.join(agentDir, "compaction-continue.json");
	if (config !== undefined) fs.writeFileSync(file, JSON.stringify(config));
	const environment = {
		PI_CODING_AGENT_DIR: agentDir,
		PI_AGENT_DIR: agentDir,
		PI_COMPACTION_CONTINUE_CONFIG: undefined,
		PI_COMPACTION_CONTINUE_LOG: path.join(root, "tracking.jsonl"),
	};
	const previous = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
	for (const [key, value] of Object.entries(environment)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const statuses: string[] = [];
	const notifications: string[] = [];
	const messages: any[] = [];
	const entries: any[] = [];
	const overflow = messageEntry("overflow", "assistant", [{ type: "text", text: "cut off" }], { stopReason: "length" });
	const compaction = { id: "compact", type: "compaction", parentId: overflow.id };
	const leaf: any[] = [];
	const pi = {
		on(event: string, handler: (event: any, ctx: any) => any) { handlers.set(event, [...(handlers.get(event) ?? []), handler]); },
		registerTool(tool: any) { tools.set(tool.name, tool); },
		registerCommand(name: string, command: any) { commands.set(name, command); },
		registerMessageRenderer() {},
		sendMessage(message: any) { messages.push(message); },
		appendEntry(customType: string, data: any) { entries.push({ customType, data }); },
	};
	compactionContinue(pi as any);
	const ctx = {
		cwd, isIdle: () => true, hasPendingMessages: () => false,
		sessionManager: {
			getSessionId: () => "watchdog-config-test",
			getBranch: (parentId?: string) => parentId === overflow.id ? [overflow] : leaf,
			getEntry: (id: string) => id === compaction.id ? compaction : id === overflow.id ? overflow : undefined,
		},
		ui: {
			notify(text: string) { notifications.push(text); },
			setStatus(_key: string, text: string) { statuses.push(text); },
			theme: { fg: (_name: string, text: string) => text },
		},
	};
	const emit = async (event: string, data: any = {}) => {
		for (const handler of handlers.get(event) ?? []) await handler(data, ctx);
	};
	const state = async () => (await tools.get("compaction_continue_state").execute("state", {}, undefined, undefined, ctx)).details;
	const command = async (args: string) => commands.get("compaction-continue").handler(args, ctx);
	t.after(async () => {
		await emit("session_shutdown");
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		fs.rmSync(root, { recursive: true, force: true });
	});
	return { root, file, cwd, tools, ctx, emit, state, command, statuses, notifications, messages, entries, leaf, compaction };
}
