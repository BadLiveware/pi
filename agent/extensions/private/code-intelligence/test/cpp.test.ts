import { execFileSync } from "node:child_process";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import codeIntelligence from "../index.ts";
import { collectTouchedDiagnostics } from "code-intel/pi-integration";
import { DEFAULT_CONFIG } from "code-intel/pi-integration";

function loadTools(): Map<string, { execute: (...args: any[]) => Promise<any> }> {
	const tools = new Map<string, any>();
	codeIntelligence({ on() {}, registerTool(tool: { name: string; execute: (...args: any[]) => Promise<any> }) { tools.set(tool.name, tool); } } as any);
	return tools;
}

function parseToolResult(result: any): any {
	return result.details;
}

function mockContext(cwd: string) {
	return { cwd, sessionManager: { getSessionId: () => `test-${process.pid}` }, ui: { notify() {}, setStatus() {}, theme: { fg: (_style: string, text: string) => text } } };
}

function cppRepo(): string {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-code-intel-cpp-"));
	execFileSync("git", ["init", "-q"], { cwd: repo });
	fs.writeFileSync(path.join(repo, "storage.cpp"), `#include <vector>
#define STORAGE_LIMIT 5
namespace DB {
template <typename T> T identity(T value) { return value; }
class StorageSystemTables {
public:
    int count;
    StorageSystemTables();
    ~StorageSystemTables();
    void fillData();
};

StorageSystemTables::StorageSystemTables() {}
StorageSystemTables::~StorageSystemTables() {}

void helper() {
    fillDataFree();
}

void StorageSystemTables::fillData() {
    helper();
}

void fillDataFree() {
    StorageSystemTables storage;
    storage.fillData();
}
}
`);
	return repo;
}

async function withPath(pathValue: string, run: () => Promise<void>): Promise<void> {
	const originalPath = process.env.PATH;
	process.env.PATH = pathValue;
	try {
		await run();
	} finally {
		process.env.PATH = originalPath;
	}
}

function writeFakeClangd(file: string): void {
	fs.writeFileSync(file, `#!/usr/bin/env node
if (process.argv.includes("--version")) {
  console.log("fake clangd 1.0");
  process.exit(0);
}
let buffer = Buffer.alloc(0);
function write(message) {
  const body = JSON.stringify(message);
  process.stdout.write("Content-Length: " + Buffer.byteLength(body, "utf-8") + "\\r\\n\\r\\n" + body);
}
function parse() {
  while (true) {
    const headerEnd = buffer.indexOf("\\r\\n\\r\\n");
    if (headerEnd < 0) return;
    const header = buffer.subarray(0, headerEnd).toString("utf-8");
    const match = /Content-Length:\\s*(\\d+)/i.exec(header);
    if (!match) { buffer = buffer.subarray(headerEnd + 4); continue; }
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + Number(match[1]);
    if (buffer.length < bodyEnd) return;
    const message = JSON.parse(buffer.subarray(bodyStart, bodyEnd).toString("utf-8"));
    buffer = buffer.subarray(bodyEnd);
    handle(message);
  }
}
function handle(message) {
  if (message.method === "initialize") write({ jsonrpc: "2.0", id: message.id, result: { capabilities: {} } });
  else if (message.method === "textDocument/didOpen") {
    const uri = message.params?.textDocument?.uri;
    write({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri, diagnostics: [{ range: { start: { line: 18, character: 4 }, end: { line: 18, character: 10 } }, severity: 1, source: "clangd", code: "undeclared_var", message: "use of undeclared identifier 'helper'" }] } });
  } else if (message.method === "textDocument/references") {
    const uri = message.params?.textDocument?.uri;
    write({ jsonrpc: "2.0", id: message.id, result: [{ uri, range: { start: { line: 20, character: 12 }, end: { line: 20, character: 20 } } }] });
  } else if (message.method === "shutdown") write({ jsonrpc: "2.0", id: message.id, result: null });
  else if (message.method === "exit") process.exit(0);
}
process.stdin.on("data", (chunk) => { buffer = Buffer.concat([buffer, chunk]); parse(); });
`);
	fs.chmodSync(file, 0o755);
}

test("C++ file outline reports namespace, class members, templates, and macros", async () => {
	const repo = cppRepo();
	const tools = loadTools();
	const outline = parseToolResult(await tools.get("code_intel_file_outline")!.execute("outline", { path: "storage.cpp", maxSymbols: 80, detail: "snippets" }, undefined, undefined, mockContext(repo)));
	assert.equal(outline.ok, true);
	assert.deepEqual(outline.imports, ["vector"]);
	assert.equal(outline.declarations.some((row: any) => row.kind === "namespace_definition" && row.name === "DB"), true);
	assert.equal(outline.declarations.some((row: any) => row.kind === "class_specifier" && row.name === "StorageSystemTables"), true);
	assert.equal(outline.declarations.some((row: any) => row.kind === "field_declaration" && row.name === "count" && row.owner === "StorageSystemTables"), true);
	assert.equal(outline.declarations.some((row: any) => row.kind === "method_declaration" && row.name === "StorageSystemTables" && row.owner === "StorageSystemTables"), true);
	assert.equal(outline.declarations.some((row: any) => row.kind === "method_definition" && row.name === "fillData" && row.owner === "StorageSystemTables"), true);
	assert.equal(outline.declarations.some((row: any) => row.kind === "template_declaration" && row.name === "identity"), true);
	assert.equal(outline.declarations.some((row: any) => row.kind === "macro_definition" && row.name === "STORAGE_LIMIT"), true);
});

test("state reports clangd and impact map supports C++ changed-file routing as syntax evidence", async () => {
	const repo = cppRepo();
	const tools = loadTools();
	const state = parseToolResult(await tools.get("code_intel_state")!.execute("test-state", {}, undefined, undefined, mockContext(repo)));
	assert.equal(state.languageServers.clangd.server, "clangd");
	const impact = parseToolResult(await tools.get("code_intel_impact_map")!.execute("test", { changedFiles: ["storage.cpp"], maxRootSymbols: 3, maxResults: 10, detail: "snippets" }, undefined, undefined, mockContext(repo)));
	assert.equal(impact.ok, true);
	assert.equal(impact.coverage.parsedByLanguage.cpp, 1);
	assert.equal(impact.coverage.supportedImpactLanguages.includes("cpp"), true);
	assert.equal(impact.rootSymbols.includes("fillData"), true);
	assert.equal(impact.related.some((row: any) => row.kind === "syntax_call" && row.text === "storage.fillData()"), true);
	assert.match(impact.limitations.join("\n"), /not type-resolved semantic references/);
});

test("impact map confirms C++ references through fake clangd LSP", async () => {
	const repo = cppRepo();
	try {
		fs.writeFileSync(path.join(repo, "compile_commands.json"), "[]\n");
		const binDir = path.join(repo, "bin");
		fs.mkdirSync(binDir);
		writeFakeClangd(path.join(binDir, "clangd"));
		await withPath(`${binDir}${path.delimiter}${process.env.PATH ?? ""}`, async () => {
			const tools = loadTools();
			const impact = parseToolResult(await tools.get("code_intel_impact_map")!.execute("test", { symbols: ["fillData"], confirmReferences: "clangd", maxReferenceRoots: 1, maxReferenceResults: 5, detail: "locations" }, undefined, undefined, mockContext(repo)));
			assert.equal(impact.referenceConfirmation.backend, "clangd");
			assert.equal(impact.referenceConfirmation.ok, true);
			assert.equal(impact.referenceConfirmation.references.some((row: any) => row.file === "storage.cpp" && row.rootSymbol === "fillData" && row.evidence === "clangd:textDocument/references"), true);
			assert.equal(impact.referenceConfirmation.summary.referenceCount, 1);
		});
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("post-edit diagnostics collect clangd publishDiagnostics rows", async () => {
	const repo = cppRepo();
	try {
		fs.writeFileSync(path.join(repo, "compile_commands.json"), "[]\n");
		const binDir = path.join(repo, "bin");
		fs.mkdirSync(binDir);
		writeFakeClangd(path.join(binDir, "clangd"));
		await withPath(`${binDir}${path.delimiter}${process.env.PATH ?? ""}`, async () => {
			const result = await collectTouchedDiagnostics(repo, ["storage.cpp"], DEFAULT_CONFIG);
			assert.equal(result.diagnostics.some((row) => row.path === "storage.cpp" && row.line === 19 && row.column === 5 && row.severity === "error" && row.source === "clangd" && row.code === "undeclared_var"), true);
			assert.equal(result.providerStatuses.some((row) => row.provider === "clangd" && row.available === "available" && row.fileCount === 1 && row.diagnosticCount === 1), true);
		});
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("post-edit diagnostics report missing clangd prerequisites without failing collection", async () => {
	const repo = cppRepo();
	try {
		const binDir = path.join(repo, "bin");
		fs.mkdirSync(binDir);
		writeFakeClangd(path.join(binDir, "clangd"));
		await withPath(`${binDir}${path.delimiter}${process.env.PATH ?? ""}`, async () => {
			const result = await collectTouchedDiagnostics(repo, ["storage.cpp"], DEFAULT_CONFIG);
			assert.equal(result.diagnostics.length, 0);
			const status = result.providerStatuses.find((row) => row.provider === "clangd");
			assert.equal(status?.available, "missing");
			assert.match(String(status?.diagnostic ?? ""), /compile_commands\.json not found/);
		});
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("post-edit diagnostics report missing clangd without failing collection", async () => {
	const repo = cppRepo();
	try {
		const emptyBin = path.join(repo, "empty-bin");
		fs.mkdirSync(emptyBin);
		await withPath(emptyBin, async () => {
			const result = await collectTouchedDiagnostics(repo, ["storage.cpp"], DEFAULT_CONFIG);
			assert.equal(result.diagnostics.length, 0);
			const status = result.providerStatuses.find((row) => row.provider === "clangd");
			assert.equal(status?.available, "missing");
			assert.match(String(status?.diagnostic ?? ""), /clangd not found/);
		});
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("impact map reports clangd confirmation unavailable without compile commands", async () => {
	const repo = cppRepo();
	const tools = loadTools();
	const impact = parseToolResult(await tools.get("code_intel_impact_map")!.execute("test", { symbols: ["fillData"], confirmReferences: "clangd", maxReferenceRoots: 1, maxReferenceResults: 5, detail: "locations" }, undefined, undefined, mockContext(repo)));
	assert.equal(impact.referenceConfirmation.backend, "clangd");
	assert.equal(impact.referenceConfirmation.ok, false);
	assert.match(impact.referenceConfirmation.diagnostics.join("\n"), /compile_commands\.json|clangd not found/);
	assert.match(impact.referenceConfirmation.limitations.join("\n"), /compile_commands\.json/);
});
