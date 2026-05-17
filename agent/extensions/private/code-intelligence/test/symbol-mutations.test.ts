import { execFileSync } from "node:child_process";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import codeIntelligence from "../index.ts";

function loadTools(): Map<string, { execute: (...args: any[]) => Promise<any> }> {
	const tools = new Map<string, any>();
	codeIntelligence({ on() {}, registerTool(tool: { name: string; execute: (...args: any[]) => Promise<any> }) { tools.set(tool.name, tool); } } as any);
	return tools;
}

function parseToolResult(result: any): any {
	return result.details;
}

function mockContext(cwd: string) {
	return { cwd, sessionManager: { getSessionId: () => `symbol-mutations-${process.pid}` }, ui: { notify() {}, setStatus() {}, theme: { fg: (_style: string, text: string) => text } } };
}

function fixtureRepo(): string {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-code-intel-symbol-mutations-"));
	execFileSync("git", ["init", "-q"], { cwd: repo });
	fs.mkdirSync(path.join(repo, "src"), { recursive: true });
	fs.writeFileSync(path.join(repo, "src", "api.ts"), `export function before() { return "before"; }
export function target() {
  return "old";
}
export function after() { return "after"; }
`);
	return repo;
}

test("replace symbol verifies oldHash from read_symbol", async () => {
	const repo = fixtureRepo();
	try {
		const tools = loadTools();
		const ctx = mockContext(repo);
		const readResult = await tools.get("code_intel_read_symbol")!.execute("read", { path: "src/api.ts", symbol: "target" }, undefined, undefined, ctx);
		const read = parseToolResult(readResult);
		assert.match(readResult.content[0].text, /hash=[a-f0-9]{16}/);
		const replace = parseToolResult(await tools.get("code_intel_replace_symbol")!.execute("replace", { target: read.target, oldHash: read.targetSegment.oldHash, newText: `export function target() {\n  return "new";\n}` }, undefined, undefined, ctx));
		assert.equal(replace.ok, true);
		assert.equal(replace.oldHash, read.targetSegment.oldHash);
		assert.match(fs.readFileSync(path.join(repo, "src", "api.ts"), "utf-8"), /return "new"/);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("replace symbol rejects mismatched oldText without writing", async () => {
	const repo = fixtureRepo();
	try {
		const tools = loadTools();
		const ctx = mockContext(repo);
		const outline = parseToolResult(await tools.get("code_intel_file_outline")!.execute("outline", { path: "src/api.ts", maxSymbols: 20 }, undefined, undefined, ctx));
		const target = outline.declarations.find((row: any) => row.name === "target").symbolTarget;
		const result = parseToolResult(await tools.get("code_intel_replace_symbol")!.execute("replace", { target, oldText: "not the current function", newText: "export function target() { return false; }" }, undefined, undefined, ctx));
		assert.equal(result.ok, false);
		assert.equal(result.reason, "oldText mismatch");
		assert.match(fs.readFileSync(path.join(repo, "src", "api.ts"), "utf-8"), /return "old"/);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("insert relative uses outline anchors without reading source", async () => {
	const repo = fixtureRepo();
	try {
		const tools = loadTools();
		const ctx = mockContext(repo);
		const outlineResult = await tools.get("code_intel_file_outline")!.execute("outline", { path: "src/api.ts", maxSymbols: 20 }, undefined, undefined, ctx);
		const outline = parseToolResult(outlineResult);
		const beforeTarget = outline.declarations.find((row: any) => row.name === "before").symbolTarget;
		const result = parseToolResult(await tools.get("code_intel_insert_relative")!.execute("insert", { anchor: beforeTarget, position: "after", text: `export function inserted() { return "inserted"; }` }, undefined, undefined, ctx));
		assert.equal(result.ok, true);
		assert.doesNotMatch(outlineResult.content[0].text, /relocation/);
		assert.match(fs.readFileSync(path.join(repo, "src", "api.ts"), "utf-8"), /before[\s\S]*inserted[\s\S]*target/);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("insert relative resolves stale duplicate anchors after nearby insertions", async () => {
	const repo = fixtureRepo();
	try {
		const file = path.join(repo, "src", "dupes.ts");
		fs.writeFileSync(file, `export function anchorBefore() { return "before"; }
export function target() { return "first"; }
export function middle() { return "middle"; }
export function target() { return "second"; }
export function anchorAfter() { return "after"; }
`);
		const tools = loadTools();
		const ctx = mockContext(repo);
		const outline = parseToolResult(await tools.get("code_intel_file_outline")!.execute("outline", { path: "src/dupes.ts", maxSymbols: 20 }, undefined, undefined, ctx));
		const secondTarget = outline.declarations.filter((row: any) => row.name === "target")[1].symbolTarget;
		fs.writeFileSync(file, `export function anchorBefore() { return "before"; }
export function target() { return "first"; }
export function middle() { return "middle"; }
export function insertedBefore() { return "inserted-before"; }
export function target() { return "second"; }
export function anchorAfter() { return "after"; }
`);
		const result = parseToolResult(await tools.get("code_intel_insert_relative")!.execute("insert", { anchor: secondTarget, position: "after", text: `export function insertedAfter() { return "inserted-after"; }` }, undefined, undefined, ctx));
		assert.equal(result.ok, true);
		const content = fs.readFileSync(file, "utf-8");
		assert.match(content, /return "second"; }\nexport function insertedAfter/);
		assert.doesNotMatch(content, /return "first"; }\nexport function insertedAfter/);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("insert relative normalizes inserted text to CRLF files", async () => {
	const repo = fixtureRepo();
	try {
		const file = path.join(repo, "src", "api.ts");
		fs.writeFileSync(file, "export function before() { return \"before\"; }\r\nexport function after() { return \"after\"; }\r\n");
		const tools = loadTools();
		const ctx = mockContext(repo);
		const outline = parseToolResult(await tools.get("code_intel_file_outline")!.execute("outline", { path: "src/api.ts", maxSymbols: 20 }, undefined, undefined, ctx));
		const beforeTarget = outline.declarations.find((row: any) => row.name === "before").symbolTarget;
		const result = parseToolResult(await tools.get("code_intel_insert_relative")!.execute("insert", { anchor: beforeTarget, position: "after", text: "export function crlf() {\n  return true;\n}" }, undefined, undefined, ctx));
		assert.equal(result.ok, true);
		const content = fs.readFileSync(file, "utf-8");
		assert.match(content, /crlf\(\) \{\r\n  return true;\r\n\}\r\nexport function after/);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("replace and insert support C#, Python, shell, and Markdown targets", async () => {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-code-intel-new-targets-"));
	try {
		execFileSync("git", ["init", "-q"], { cwd: repo });
		fs.writeFileSync(path.join(repo, "Service.cs"), `public class Service
{
    public bool Enabled { get; init; }
    public bool Authenticate(string token)
    {
        return token.Length > 0;
    }
}
`);
		fs.writeFileSync(path.join(repo, "jobs.py"), `@decorator
async def run_task(name: str):
    return name
`);
		fs.writeFileSync(path.join(repo, "deploy.sh"), `deploy() {
  echo old
}
`);
		fs.writeFileSync(path.join(repo, "README.md"), `# Guide

## Install

old install

## Usage

old usage
`);
		const tools = loadTools();
		const ctx = mockContext(repo);

		const readCs = parseToolResult(await tools.get("code_intel_read_symbol")!.execute("read-cs", { path: "Service.cs", symbol: "Authenticate" }, undefined, undefined, ctx));
		assert.equal(parseToolResult(await tools.get("code_intel_replace_symbol")!.execute("replace-cs", { target: readCs.target, oldHash: readCs.targetSegment.oldHash, newText: `    public bool Authenticate(string token)
    {
        return token == "ok";
    }` }, undefined, undefined, ctx)).ok, true);
		const outlineCs = parseToolResult(await tools.get("code_intel_file_outline")!.execute("outline-cs", { path: "Service.cs", maxSymbols: 20 }, undefined, undefined, ctx));
		const property = outlineCs.declarations.find((row: any) => row.name === "Enabled").symbolTarget;
		assert.equal(parseToolResult(await tools.get("code_intel_insert_relative")!.execute("insert-cs", { anchor: property, position: "after", text: "    public int Count { get; init; }" }, undefined, undefined, ctx)).ok, true);

		const readPy = parseToolResult(await tools.get("code_intel_read_symbol")!.execute("read-py", { path: "jobs.py", symbol: "run_task" }, undefined, undefined, ctx));
		assert.match(readPy.targetSegment.source, /@decorator/);
		assert.equal(parseToolResult(await tools.get("code_intel_replace_symbol")!.execute("replace-py", { target: readPy.target, oldHash: readPy.targetSegment.oldHash, newText: `@decorator
async def run_task(name: str):
    return name.upper()` }, undefined, undefined, ctx)).ok, true);

		const readShell = parseToolResult(await tools.get("code_intel_read_symbol")!.execute("read-sh", { path: "deploy.sh", symbol: "deploy" }, undefined, undefined, ctx));
		assert.equal(parseToolResult(await tools.get("code_intel_replace_symbol")!.execute("replace-sh", { target: readShell.target, oldHash: readShell.targetSegment.oldHash, newText: `deploy() {
  echo new
}` }, undefined, undefined, ctx)).ok, true);

		const outlineMd = parseToolResult(await tools.get("code_intel_file_outline")!.execute("outline-md", { path: "README.md", maxSymbols: 20 }, undefined, undefined, ctx));
		const install = outlineMd.declarations.find((row: any) => row.kind === "markdown_section" && row.name === "Install").symbolTarget;
		const readMd = parseToolResult(await tools.get("code_intel_read_symbol")!.execute("read-md", { target: install }, undefined, undefined, ctx));
		assert.equal(parseToolResult(await tools.get("code_intel_replace_symbol")!.execute("replace-md", { target: install, oldHash: readMd.targetSegment.oldHash, newText: `## Install

new install` }, undefined, undefined, ctx)).ok, true);
		const usage = parseToolResult(await tools.get("code_intel_file_outline")!.execute("outline-md2", { path: "README.md", maxSymbols: 20 }, undefined, undefined, ctx)).declarations.find((row: any) => row.kind === "markdown_section" && row.name === "Usage").symbolTarget;
		assert.equal(parseToolResult(await tools.get("code_intel_insert_relative")!.execute("insert-md", { anchor: usage, position: "before", text: "## Examples\n\nnew example" }, undefined, undefined, ctx)).ok, true);

		assert.match(fs.readFileSync(path.join(repo, "Service.cs"), "utf-8"), /return token == "ok"/);
		assert.match(fs.readFileSync(path.join(repo, "Service.cs"), "utf-8"), /public int Count/);
		assert.match(fs.readFileSync(path.join(repo, "jobs.py"), "utf-8"), /name\.upper/);
		assert.match(fs.readFileSync(path.join(repo, "deploy.sh"), "utf-8"), /echo new/);
		const markdown = fs.readFileSync(path.join(repo, "README.md"), "utf-8");
		assert.match(markdown, /new install/);
		assert.match(markdown, /## Examples[\s\S]*## Usage/);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});
