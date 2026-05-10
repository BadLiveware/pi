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
	return result.details;
}

function mockContext(cwd: string) {
	return { cwd, sessionManager: { getSessionId: () => `test-${process.pid}` }, ui: { notify() {}, setStatus() {}, theme: { fg: (_style: string, text: string) => text } } };
}

function fixtureRepo(): string {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-code-intel-orientation-"));
	execFileSync("git", ["init", "-q"], { cwd: repo });
	fs.mkdirSync(path.join(repo, "src", "auth"), { recursive: true });
	fs.mkdirSync(path.join(repo, "src", "storage"), { recursive: true });
	fs.mkdirSync(path.join(repo, "tests", "queries"), { recursive: true });
	fs.mkdirSync(path.join(repo, "build_debug"), { recursive: true });
	fs.writeFileSync(path.join(repo, "src", "auth", "jwt.ts"), `import { createSign } from "crypto";
export interface JwtClaims { sub: string }
export function signJwt(claims: JwtClaims) { return createSign("RSA-SHA256"); }
function parseJwt(raw: string) { return raw.split("."); }
`);
	fs.writeFileSync(path.join(repo, "src", "storage", "system_tables.cpp"), `#include <Tables.h>
namespace DB {
class StorageSystemTables { public: void fillData(); };
void StorageSystemTables::fillData() {}
void createVirtuals() {}
}
`);
	fs.writeFileSync(path.join(repo, "tests", "queries", "001_system_tables.sql"), "SELECT * FROM system.tables WHERE name = 'numbers';\n");
	fs.mkdirSync(path.join(repo, "tests", "__pycache__"), { recursive: true });
	fs.writeFileSync(path.join(repo, "tests", "__pycache__", "noise.pyc"), "system.tables\n");
	fs.writeFileSync(path.join(repo, "tests", "query_function_range.log"), "system.tables\n");
	fs.writeFileSync(path.join(repo, "build_debug", "ignored.cpp"), "void ignored() {}\n");
	return repo;
}

test("repo overview shape summarizes directories without parsing declarations", async () => {
	const repo = fixtureRepo();
	try {
		const tools = loadTools();
		const result = await tools.get("code_intel_repo_overview")!.execute("test", { tier: "shape", maxDepth: 2 }, undefined, undefined, mockContext(repo));
		assert.match(result.content[0].text, /^OK repo_overview/m);
		assert.doesNotMatch(result.content[0].text, /"directories"/);
		const overview = parseToolResult(result);
		assert.equal(overview.ok, true);
		assert.equal(overview.tier, "shape");
		assert.equal(overview.summary.sourceFileCount >= 2, true);
		assert.equal(overview.summary.testFileCount >= 1, true);
		assert.equal(overview.coverage.excludedDirs.build_debug, 1);
		assert.equal(overview.summary.parsedFileCount, 0);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("repo overview files tier includes capped declarations for scoped paths", async () => {
	const repo = fixtureRepo();
	try {
		const tools = loadTools();
		const overview = parseToolResult(await tools.get("code_intel_repo_overview")!.execute("test", { tier: "files", paths: ["src/auth"], maxSymbolsPerFile: 10 }, undefined, undefined, mockContext(repo)));
		assert.equal(overview.ok, true);
		assert.equal(overview.tier, "files");
		const file = overview.directories[0].fileEntries.find((entry: any) => entry.path === "src/auth/jwt.ts");
		assert.ok(file);
		assert.equal(file.declarations.some((row: any) => row.name === "signJwt"), true);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("file outline reports imports and declarations for one file", async () => {
	const repo = fixtureRepo();
	try {
		const tools = loadTools();
		const result = await tools.get("code_intel_file_outline")!.execute("test", { path: "src/storage/system_tables.cpp", maxSymbols: 20 }, undefined, undefined, mockContext(repo));
		assert.match(result.content[0].text, /^OK file_outline/m);
		assert.match(result.content[0].text, /class StorageSystemTables/);
		const outline = parseToolResult(result);
		assert.equal(outline.ok, true);
		assert.equal(outline.language, "cpp");
		assert.deepEqual(outline.imports, ["Tables.h"]);
		assert.equal(outline.declarations.some((row: any) => row.name === "StorageSystemTables"), true);
		assert.equal(outline.declarations.some((row: any) => row.name === "createVirtuals"), true);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("repo route ranks files by path and literal evidence", async () => {
	const repo = fixtureRepo();
	try {
		const tools = loadTools();
		const result = await tools.get("code_intel_repo_route")!.execute("test", { terms: ["StorageSystemTables", "system.tables"], paths: ["src", "tests"], maxResults: 5 }, undefined, undefined, mockContext(repo));
		assert.match(result.content[0].text, /^OK repo_route/m);
		const route = parseToolResult(result);
		assert.equal(route.ok, true);
		assert.equal(route.candidates.some((candidate: any) => candidate.file === "src/storage/system_tables.cpp"), true);
		assert.equal(route.candidates.some((candidate: any) => candidate.file === "tests/queries/001_system_tables.sql"), true);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("test map ranks non-code tests by path and literal evidence", async () => {
	const repo = fixtureRepo();
	try {
		const tools = loadTools();
		const result = await tools.get("code_intel_test_map")!.execute("test", { path: "src/storage/system_tables.cpp", names: ["system.tables"], testPaths: ["tests"], maxResults: 5 }, undefined, undefined, mockContext(repo));
		assert.match(result.content[0].text, /^OK test_map/m);
		assert.match(result.content[0].text, /literal: system\.tables@1/);
		const testMap = parseToolResult(result);
		assert.equal(testMap.ok, true);
		assert.equal(testMap.candidates.length >= 1, true);
		assert.equal(testMap.candidates[0].file, "tests/queries/001_system_tables.sql");
		assert.equal(testMap.candidates.some((candidate: any) => candidate.file.includes("__pycache__") || candidate.file.endsWith(".log")), false);
		assert.equal(testMap.candidates[0].evidence.some((row: any) => row.kind === "literal_match" && row.term === "system.tables"), true);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});
