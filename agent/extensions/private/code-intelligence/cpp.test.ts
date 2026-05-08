import { execFileSync } from "node:child_process";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import codeIntelligence from "./index.ts";

function loadTools(): Map<string, { execute: (...args: any[]) => Promise<any> }> {
	const tools = new Map<string, any>();
	codeIntelligence({ on() {}, registerTool(tool: { name: string; execute: (...args: any[]) => Promise<any> }) { tools.set(tool.name, tool); } } as any);
	return tools;
}

function parseToolResult(result: any): any {
	return JSON.parse(result.content[0].text);
}

function mockContext(cwd: string) {
	return { cwd, sessionManager: { getSessionId: () => `test-${process.pid}` }, ui: { notify() {}, setStatus() {}, theme: { fg: (_style: string, text: string) => text } } };
}

function cppRepo(): string {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-code-intel-cpp-"));
	execFileSync("git", ["init", "-q"], { cwd: repo });
	fs.writeFileSync(path.join(repo, "storage.cpp"), `namespace DB {
class StorageSystemTables {
public:
    void fillData();
};

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

test("impact map reports clangd confirmation unavailable without compile commands", async () => {
	const repo = cppRepo();
	const tools = loadTools();
	const impact = parseToolResult(await tools.get("code_intel_impact_map")!.execute("test", { symbols: ["fillData"], confirmReferences: "clangd", maxReferenceRoots: 1, maxReferenceResults: 5, detail: "locations" }, undefined, undefined, mockContext(repo)));
	assert.equal(impact.referenceConfirmation.backend, "clangd");
	assert.equal(impact.referenceConfirmation.ok, false);
	assert.match(impact.referenceConfirmation.diagnostics.join("\n"), /compile_commands\.json|clangd not found/);
	assert.match(impact.referenceConfirmation.limitations.join("\n"), /compile_commands\.json/);
});
