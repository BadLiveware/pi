import { execFileSync } from "node:child_process";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import codeIntelligence from "../index.ts";

function loadExtension(): { tools: Map<string, any>; handlers: Map<string, Array<(...args: any[]) => any>>; sentMessages: Array<{ message: any; options: any }> } {
	const tools = new Map<string, any>();
	const handlers = new Map<string, Array<(...args: any[]) => any>>();
	const sentMessages: Array<{ message: any; options: any }> = [];
	codeIntelligence({
		on(eventName: string, handler: (...args: any[]) => any) {
			const existing = handlers.get(eventName) ?? [];
			existing.push(handler);
			handlers.set(eventName, existing);
		},
		registerTool(tool: { name: string; execute: (...args: any[]) => Promise<any> }) {
			tools.set(tool.name, tool);
		},
		sendMessage(message: any, options: any) {
			sentMessages.push({ message, options });
		},
	} as any);
	return { tools, handlers, sentMessages };
}

async function emit(handlers: Map<string, Array<(...args: any[]) => any>>, eventName: string, event: any, ctx: any): Promise<void> {
	for (const handler of handlers.get(eventName) ?? []) await handler(event, ctx);
}

function fixtureRepo(): string {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-code-intel-diagnostic-surface-"));
	execFileSync("git", ["init", "-q"], { cwd: repo });
	fs.mkdirSync(path.join(repo, "src"), { recursive: true });
	return repo;
}

function mockContext(repo: string, sessionId: string) {
	const notifications: Array<{ message: string; level: string }> = [];
	return {
		cwd: repo,
		sessionManager: { getSessionId: () => sessionId },
		hasPendingMessages: () => false,
		ui: {
			notify(message: string, level: string) { notifications.push({ message, level }); },
			setStatus() {},
			theme: { fg: (_style: string, text: string) => text },
		},
		notifications,
	};
}

async function recordWrite(handlers: Map<string, Array<(...args: any[]) => any>>, ctx: any, file: string): Promise<void> {
	await emit(handlers, "tool_result", { toolName: "write", toolCallId: `write-${file}`, input: { path: file }, details: {}, content: [], isError: false }, ctx);
}

test("agent_end surfaces TypeScript diagnostics for touched files", async () => {
	const repo = fixtureRepo();
	try {
		const { handlers, sentMessages } = loadExtension();
		const ctx = mockContext(repo, "diagnostic-surface-basic");
		fs.writeFileSync(path.join(repo, "src", "broken.ts"), `export const value: number = "wrong";\n`);
		await recordWrite(handlers, ctx, "src/broken.ts");

		await emit(handlers, "agent_end", { messages: [] }, ctx);

		assert.equal(sentMessages.length, 1);
		assert.deepEqual(sentMessages[0].options, { triggerTurn: true });
		assert.equal(sentMessages[0].message.customType, "code-intel:lsp-diagnostics");
		assert.equal(sentMessages[0].message.display, true);
		assert.match(sentMessages[0].message.content, /current touched-file diagnostic/);
		assert.doesNotMatch(sentMessages[0].message.content, /post_edit_map|post-edit map/i);
		assert.match(sentMessages[0].message.content, /src\/broken\.ts:1/);
		assert.match(sentMessages[0].message.content, /TS2322/);
		assert.equal(sentMessages[0].message.details.changedFiles[0], "src/broken.ts");
		assert.equal(sentMessages[0].message.details.touchedDiagnostics.some((row: any) => row.code === "TS2322"), true);

		await emit(handlers, "agent_end", { messages: [] }, ctx);
		assert.equal(sentMessages.length, 1);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("agent_end skips automatic diagnostics after post-edit map", async () => {
	const repo = fixtureRepo();
	try {
		const { handlers, sentMessages } = loadExtension();
		const ctx = mockContext(repo, "diagnostic-surface-post-edit");
		fs.writeFileSync(path.join(repo, "src", "broken.ts"), `export const value: number = "wrong";\n`);
		await recordWrite(handlers, ctx, "src/broken.ts");
		await emit(handlers, "tool_result", { toolName: "code_intel_post_edit_map", toolCallId: "post", input: { changedFiles: ["src/broken.ts"], includeDiagnostics: true }, details: { ok: true }, content: [], isError: false }, ctx);

		await emit(handlers, "agent_end", { messages: [] }, ctx);

		assert.equal(sentMessages.length, 0);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("agent_end does not surface when touched TypeScript files are clean", async () => {
	const repo = fixtureRepo();
	try {
		const { handlers, sentMessages } = loadExtension();
		const ctx = mockContext(repo, "diagnostic-surface-clean");
		fs.writeFileSync(path.join(repo, "src", "clean.ts"), `export const value: number = 1;\n`);
		await recordWrite(handlers, ctx, "src/clean.ts");

		await emit(handlers, "agent_end", { messages: [] }, ctx);

		assert.equal(sentMessages.length, 0);
		await emit(handlers, "agent_end", { messages: [] }, ctx);
		assert.equal(sentMessages.length, 0);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});
