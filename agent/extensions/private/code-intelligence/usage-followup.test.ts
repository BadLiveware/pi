import { execFileSync } from "node:child_process";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import codeIntelligence from "./index.ts";

function loadExtension(): { tools: Map<string, any>; handlers: Map<string, Array<(...args: any[]) => any>> } {
	const tools = new Map<string, any>();
	const handlers = new Map<string, Array<(...args: any[]) => any>>();
	codeIntelligence({
		on(eventName: string, handler: (...args: any[]) => any) {
			const existing = handlers.get(eventName) ?? [];
			existing.push(handler);
			handlers.set(eventName, existing);
		},
		registerTool(tool: { name: string; execute: (...args: any[]) => Promise<any> }) {
			tools.set(tool.name, tool);
		},
	} as any);
	return { tools, handlers };
}

async function emit(handlers: Map<string, Array<(...args: any[]) => any>>, eventName: string, event: any, ctx: any): Promise<void> {
	for (const handler of handlers.get(eventName) ?? []) await handler(event, ctx);
}

function fixtureRepo(): string {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-code-intel-usage-followup-"));
	execFileSync("git", ["init", "-q"], { cwd: repo });
	fs.writeFileSync(path.join(repo, "main.ts"), `export function target() { return true }
export function caller() { return target() }
`);
	return repo;
}

test("usage logs invocation ids, returned-file counts, and matched read follow-up", async () => {
	const repo = fixtureRepo();
	const logPath = path.join(repo, "usage.jsonl");
	const oldLog = process.env.PI_CODE_INTEL_USAGE_LOG;
	process.env.PI_CODE_INTEL_USAGE_LOG = logPath;
	try {
		const { tools, handlers } = loadExtension();
		const ctx = { cwd: repo, sessionManager: { getSessionId: () => "usage-followup-session" }, ui: { notify() {}, setStatus() {}, theme: { fg: (_style: string, text: string) => text } } };
		const input = { symbols: ["target"], maxResults: 5, detail: "locations" };
		await emit(handlers, "tool_call", { toolName: "code_intel_impact_map", toolCallId: "impact", input }, ctx);
		const result = await tools.get("code_intel_impact_map")!.execute("impact", input, undefined, undefined, ctx);
		await emit(handlers, "tool_result", { toolName: "code_intel_impact_map", toolCallId: "impact", input, details: result.details, content: result.content, isError: false }, ctx);
		await emit(handlers, "tool_call", { toolName: "read", toolCallId: "read-main", input: { path: "main.ts" } }, ctx);
		await emit(handlers, "tool_result", { toolName: "read", toolCallId: "read-main", input: { path: "main.ts" }, details: {}, content: [], isError: false }, ctx);

		const records = fs.readFileSync(logPath, "utf-8").trim().split(/\r?\n/).map((line) => JSON.parse(line));
		const impactResult = records.find((record: any) => record.kind === "tool_result" && record.toolName === "code_intel_impact_map");
		assert.equal(typeof impactResult.invocationId, "string");
		assert.equal(impactResult.resultShape.returnedFileCount, 1);
		assert.equal(impactResult.resultShape.relatedCount, 1);
		const readCall = records.find((record: any) => record.kind === "tool_call" && record.toolName === "read");
		assert.equal(readCall.followupShape.followupKind, "returned-file-read");
		assert.equal(readCall.followupShape.minReturnedFileRank, 1);
		assert.equal(readCall.followupShape.matchedReturnedFiles[0].invocationId, impactResult.invocationId);
	} finally {
		if (oldLog === undefined) delete process.env.PI_CODE_INTEL_USAGE_LOG;
		else process.env.PI_CODE_INTEL_USAGE_LOG = oldLog;
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("usage logs returned source segments and write follow-ups", async () => {
	const repo = fixtureRepo();
	const logPath = path.join(repo, "usage-segment.jsonl");
	const oldLog = process.env.PI_CODE_INTEL_USAGE_LOG;
	process.env.PI_CODE_INTEL_USAGE_LOG = logPath;
	try {
		const { tools, handlers } = loadExtension();
		const ctx = { cwd: repo, sessionManager: { getSessionId: () => "usage-segment-session" }, ui: { notify() {}, setStatus() {}, theme: { fg: (_style: string, text: string) => text } } };
		const input = { path: "main.ts", symbol: "target" };
		await emit(handlers, "tool_call", { toolName: "code_intel_read_symbol", toolCallId: "symbol", input }, ctx);
		const result = await tools.get("code_intel_read_symbol")!.execute("symbol", input, undefined, undefined, ctx);
		await emit(handlers, "tool_result", { toolName: "code_intel_read_symbol", toolCallId: "symbol", input, details: result.details, content: result.content, isError: false }, ctx);
		await emit(handlers, "tool_call", { toolName: "read", toolCallId: "read-segment", input: { path: "main.ts", offset: 1, limit: 1 } }, ctx);
		await emit(handlers, "tool_result", { toolName: "read", toolCallId: "read-segment", input: { path: "main.ts", offset: 1, limit: 1 }, details: {}, content: [], isError: false }, ctx);
		await emit(handlers, "tool_call", { toolName: "write", toolCallId: "write-main", input: { path: "main.ts", content: "export function target() { return false }\n" } }, ctx);
		await emit(handlers, "tool_result", { toolName: "write", toolCallId: "write-main", input: { path: "main.ts", content: "export function target() { return false }\n" }, details: {}, content: [], isError: false }, ctx);
		const postResult = await tools.get("code_intel_post_edit_map")!.execute("post", { includeCallers: false, includeTests: false }, undefined, undefined, ctx);
		assert.equal(postResult.details.touchedFileSource, "session-tracker");
		assert.deepEqual(postResult.details.changedFiles, ["main.ts"]);
		await emit(handlers, "tool_call", { toolName: "code_intel_post_edit_map", toolCallId: "post", input: { changedFiles: ["main.ts"] } }, ctx);

		const records = fs.readFileSync(logPath, "utf-8").trim().split(/\r?\n/).map((line) => JSON.parse(line));
		const symbolResult = records.find((record: any) => record.kind === "tool_result" && record.toolName === "code_intel_read_symbol");
		assert.equal(symbolResult.resultShape.returnedSegmentCount, 1);
		assert.equal(symbolResult.resultShape.sourceCompleteness, "complete-segment");
		const readCall = records.find((record: any) => record.kind === "tool_call" && record.toolName === "read");
		assert.equal(readCall.followupShape.followupKind, "returned-segment-read");
		assert.equal(readCall.followupShape.possibleDuplicateRead, true);
		const writeCall = records.find((record: any) => record.kind === "tool_call" && record.toolName === "write");
		assert.equal(writeCall.followupShape.followupKind, "returned-file-write");
		const postCall = records.find((record: any) => record.kind === "tool_call" && record.toolName === "code_intel_post_edit_map");
		assert.equal(postCall.followupShape.followupKind, "post-edit-map-after-write");
	} finally {
		if (oldLog === undefined) delete process.env.PI_CODE_INTEL_USAGE_LOG;
		else process.env.PI_CODE_INTEL_USAGE_LOG = oldLog;
		fs.rmSync(repo, { recursive: true, force: true });
	}
});
