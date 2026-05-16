import { execFileSync } from "node:child_process";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import codeIntelligence from "./index.ts";
import { rangeLineCount, sliceLines, type SourceRange } from "./src/source-range.ts";

function loadTools(): Map<string, { execute: (...args: any[]) => Promise<any> }> {
	const tools = new Map<string, any>();
	codeIntelligence({ on() {}, registerTool(tool: { name: string; execute: (...args: any[]) => Promise<any> }) { tools.set(tool.name, tool); } } as any);
	return tools;
}

function parseToolResult(result: any): any {
	return result.details;
}

function mockContext(cwd: string) {
	return { cwd, sessionManager: { getSessionId: () => `symbol-context-${process.pid}` }, ui: { notify() {}, setStatus() {}, theme: { fg: (_style: string, text: string) => text } } };
}

function fixtureRepo(): string {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-code-intel-symbol-context-"));
	execFileSync("git", ["init", "-q"], { cwd: repo });
	fs.mkdirSync(path.join(repo, "src"), { recursive: true });
	fs.writeFileSync(path.join(repo, "src", "api.ts"), `const MAX_RETRIES = 3;
let DEFAULT_TIMEOUT = MAX_RETRIES;
type RetryOptions = { attempts: number };
function shouldRetry() { return true; }

export function fetchWithRetry(options: RetryOptions) {
  if (shouldRetry()) return MAX_RETRIES + DEFAULT_TIMEOUT + options.attempts;
  return DEFAULT_TIMEOUT;
}

class ApiClient {
  field = MAX_RETRIES;
  request(options: RetryOptions) {
    return fetchWithRetry(options);
  }
}

const duplicate = 1;
function outer() {
  function duplicate() { return 2; }
  return duplicate();
}
`);
	fs.writeFileSync(path.join(repo, "main.go"), `package main

const MaxRetries = 3
var DefaultTimeout = MaxRetries
type RetryOptions struct { Attempts int }

func FetchWithRetry(options RetryOptions) int {
	return MaxRetries + DefaultTimeout + options.Attempts
}
`);
	return repo;
}

test("source range helpers slice normalized line ranges", () => {
	const source = "one\ntwo\nthree\n";
	const range: SourceRange = { startLine: 2, startColumn: 0, endLine: 3, endColumn: 5 };
	assert.equal(sliceLines(source, range), "two\nthree");
	assert.equal(rangeLineCount(range), 2);
});

test("file outline emits pass-through symbol targets and read hints", async () => {
	const repo = fixtureRepo();
	try {
		const tools = loadTools();
		const outlineResult = await tools.get("code_intel_file_outline")!.execute("outline", { path: "src/api.ts", maxSymbols: 50 }, undefined, undefined, mockContext(repo));
		const outline = parseToolResult(outlineResult);
		const fetchRow = outline.declarations.find((row: any) => row.name === "fetchWithRetry");
		assert.ok(fetchRow);
		assert.equal(outline.sourceIncluded, false);
		assert.equal(outline.sourceCompleteness, "locations-only");
		assert.equal(fetchRow.symbolTarget.name, "fetchWithRetry");
		assert.equal(fetchRow.symbolTarget.path, "src/api.ts");
		assert.match(fetchRow.symbolTarget.uri, /^file:\/\//);
		assert.equal(fetchRow.symbolTarget.source, "tree-sitter");
		assert.equal(fetchRow.symbolTarget.positionEncoding, "utf-16");
		assert.equal(typeof fetchRow.symbolTarget.targetRef, "string");
		assert.equal(typeof fetchRow.symbolTarget.symbolRef, "string");
		assert.equal(typeof fetchRow.symbolTarget.rangeId, "string");
		assert.equal(fetchRow.symbolTarget.targetRef !== fetchRow.symbolTarget.rangeId, true);
		assert.equal(fetchRow.symbolTarget.relocation.version, 1);
		assert.equal(Array.isArray(fetchRow.symbolTarget.relocation.before), true);
		assert.equal(Array.isArray(fetchRow.symbolTarget.relocation.after), true);
		assert.equal(fetchRow.symbolTarget.detail, fetchRow.symbolTarget.signature);
		assert.equal(fetchRow.symbolTarget.selectionRange.startLine, fetchRow.symbolTarget.range.startLine);
		assert.equal(fetchRow.symbolTarget.selectionRange.startColumn >= fetchRow.symbolTarget.range.startColumn, true);
		assert.equal(fetchRow.readHint.path, "src/api.ts");
		assert.equal(fetchRow.readHint.offset, fetchRow.symbolTarget.range.startLine);
		assert.equal(fetchRow.readHint.limit, fetchRow.symbolTarget.range.endLine - fetchRow.symbolTarget.range.startLine + 1);
		assert.match(outlineResult.content[0].text, /fn fetchWithRetry:\d+-\d+ ref=[a-f0-9]{16} read=\d+\+\d+/);
		assert.doesNotMatch(outlineResult.content[0].text, /relocation|before|after/);

		const overview = parseToolResult(await tools.get("code_intel_repo_overview")!.execute("overview", { tier: "files", paths: ["src"], maxSymbolsPerFile: 20 }, undefined, undefined, mockContext(repo)));
		const file = overview.directories[0].fileEntries.find((entry: any) => entry.path === "src/api.ts");
		assert.ok(file.declarations.some((row: any) => row.name === "fetchWithRetry" && row.symbolTarget?.symbolRef));
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("read symbol returns a complete target segment and bounded referenced definitions", async () => {
	const repo = fixtureRepo();
	try {
		const tools = loadTools();
		const ctx = mockContext(repo);
		const outline = parseToolResult(await tools.get("code_intel_file_outline")!.execute("outline", { path: "src/api.ts", maxSymbols: 50 }, undefined, undefined, ctx));
		const fetchTarget = outline.declarations.find((row: any) => row.name === "fetchWithRetry").symbolTarget;
		const toolResult = await tools.get("code_intel_read_symbol")!.execute("read", { target: fetchTarget, include: ["referenced-constants", "referenced-vars", "referenced-types"] }, undefined, undefined, ctx);
		const result = parseToolResult(toolResult);
		assert.equal(result.ok, true);
		assert.equal(result.sourceIncluded, true);
		assert.equal(result.sourceCompleteness, "complete-segment");
		assert.equal(result.nextReadRecommended, false);
		assert.match(result.targetSegment.source, /export function fetchWithRetry/);
		assert.match(result.targetSegment.source, /return DEFAULT_TIMEOUT/);
		assert.match(toolResult.content[0].text, /--- target src\/api\.ts:\d+-\d+ ref=[a-f0-9]{16} hash=[a-f0-9]{16} ---/);
		assert.match(toolResult.content[0].text, /export function fetchWithRetry/);
		assert.match(toolResult.content[0].text, /--- context src\/api\.ts:\d+ ref=[a-f0-9]{16} hash=[a-f0-9]{16} ---/);
		const contextNames = result.contextSegments.map((segment: any) => segment.target.name).sort();
		assert.deepEqual(contextNames, ["DEFAULT_TIMEOUT", "MAX_RETRIES", "RetryOptions"]);
		assert.equal(result.deferredReferences.some((row: any) => row.name === "shouldRetry" && row.reason === "function-reference-deferred"), true);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("read symbol relocates a stale duplicate target with independent sibling anchors", async () => {
	const repo = fixtureRepo();
	try {
		const tools = loadTools();
		const ctx = mockContext(repo);
		fs.writeFileSync(path.join(repo, "src", "dupes.ts"), `export function anchorBefore() { return "before"; }
export function target() { return "first"; }
export function middle() { return "middle"; }
export function target() { return "second"; }
export function anchorAfter() { return "after"; }
`);
		const outline = parseToolResult(await tools.get("code_intel_file_outline")!.execute("outline", { path: "src/dupes.ts", maxSymbols: 20 }, undefined, undefined, ctx));
		const duplicateTargets = outline.declarations.filter((row: any) => row.name === "target").map((row: any) => row.symbolTarget);
		assert.equal(duplicateTargets.length, 2);
		const staleTarget = duplicateTargets[1];
		assert.equal(staleTarget.targetRef, duplicateTargets[0].targetRef);
		assert.notEqual(staleTarget.rangeId, duplicateTargets[0].rangeId);
		fs.writeFileSync(path.join(repo, "src", "dupes.ts"), `export function anchorBefore() { return "before"; }
export function target() { return "first"; }
export function middle() { return "middle"; }
export function inserted() { return "inserted"; }
export function target() { return "second"; }
export function anchorAfter() { return "after"; }
`);
		const result = parseToolResult(await tools.get("code_intel_read_symbol")!.execute("read", { target: staleTarget }, undefined, undefined, ctx));
		assert.equal(result.ok, true);
		assert.match(result.targetSegment.source, /return "second"/);
		assert.doesNotMatch(result.targetSegment.source, /return "first"/);
		assert.equal(result.target.targetRef, staleTarget.targetRef);
		assert.notEqual(result.target.rangeId, staleTarget.rangeId);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("read symbol reports alternatives instead of silently choosing ambiguous names", async () => {
	const repo = fixtureRepo();
	try {
		const tools = loadTools();
		const result = parseToolResult(await tools.get("code_intel_read_symbol")!.execute("read", { path: "src/api.ts", symbol: "duplicate" }, undefined, undefined, mockContext(repo)));
		assert.equal(result.ok, false);
		assert.equal(result.nextReadReason, "ambiguous-or-missing-target");
		assert.equal(result.alternatives.length >= 2, true);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("read symbol supports Go constants, vars, types, and functions", async () => {
	const repo = fixtureRepo();
	try {
		const tools = loadTools();
		const ctx = mockContext(repo);
		const outline = parseToolResult(await tools.get("code_intel_file_outline")!.execute("outline", { path: "main.go", maxSymbols: 50 }, undefined, undefined, ctx));
		assert.equal(outline.declarations.some((row: any) => row.name === "MaxRetries"), true);
		assert.equal(outline.declarations.some((row: any) => row.name === "DefaultTimeout"), true);
		const target = outline.declarations.find((row: any) => row.name === "FetchWithRetry").symbolTarget;
		const result = parseToolResult(await tools.get("code_intel_read_symbol")!.execute("read", { target, include: ["referenced-constants", "referenced-vars", "referenced-types"] }, undefined, undefined, ctx));
		assert.equal(result.ok, true);
		assert.match(result.targetSegment.source, /func FetchWithRetry/);
		const contextNames = result.contextSegments.map((segment: any) => segment.target.name).sort();
		assert.deepEqual(contextNames, ["DefaultTimeout", "MaxRetries", "RetryOptions"]);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("read symbol rejects paths outside the repo", async () => {
	const repo = fixtureRepo();
	try {
		const tools = loadTools();
		const result = parseToolResult(await tools.get("code_intel_read_symbol")!.execute("read", { path: "../outside.ts", symbol: "x" }, undefined, undefined, mockContext(repo)));
		assert.equal(result.ok, false);
		assert.match(result.reason, /outside repository root/);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("post-edit map returns locator follow-up and diagnostic targets", async () => {
	const repo = fixtureRepo();
	try {
		const tools = loadTools();
		const result = parseToolResult(await tools.get("code_intel_post_edit_map")!.execute("post", { changedFiles: ["src/api.ts"], includeDiagnostics: true, diagnostics: [{ path: "src/api.ts", line: 7, column: 10, severity: "error", source: "typescript", code: "TS2345" }], maxResults: 10 }, undefined, undefined, mockContext(repo)));
		assert.equal(result.ok, true);
		assert.equal(result.sourceIncluded, false);
		assert.equal(result.sourceCompleteness, "locations-only");
		assert.equal(result.changedSymbols.some((row: any) => row.target?.name === "fetchWithRetry" && row.readHint), true);
		assert.equal(result.diagnosticTargets.some((row: any) => row.target?.name === "fetchWithRetry" && row.diagnostic?.code === "TS2345"), true);
		assert.equal(Array.isArray(result.testCandidates), true);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});
