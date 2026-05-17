import { execFileSync } from "node:child_process";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { extractFileRecords, parseFiles } from "../src/tree-sitter.ts";
import { loadTools, mockContext, parseToolResult } from "./test-harness.ts";

function pythonRepo(): string {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-code-intel-python-"));
	execFileSync("git", ["init", "-q"], { cwd: repo });
	fs.writeFileSync(path.join(repo, "jobs.py"), `from dataclasses import dataclass
import client as client_lib

MAX_RETRIES: int = 3
DEFAULT = MAX_RETRIES

@dataclass
class Job:
    name: str
    count: int = 0

    def run(self):
        return client.fetch(name=self.name)

@decorator
async def run_task(name: str):
    payload = {"NeedTags": True, "name": name}
    return await client_lib.fetch(payload)
`);
	return repo;
}

test("Python outline reports decorated definitions, class fields, methods, and module constants", async () => {
	const repo = pythonRepo();
	try {
		const tools = loadTools();
		const ctx = mockContext(repo).ctx;
		const outline = parseToolResult(await tools.get("code_intel_file_outline")!.execute("outline", { path: "jobs.py", maxSymbols: 80, detail: "snippets" }, undefined, undefined, ctx));
		assert.equal(outline.ok, true);
		assert.deepEqual(outline.imports, ["dataclasses", "client"]);
		assert.equal(outline.declarations.some((row: any) => row.kind === "variable_declaration" && row.name === "MAX_RETRIES" && row.type === "int"), true);
		assert.equal(outline.declarations.some((row: any) => row.kind === "class_definition" && row.name === "Job" && /^@dataclass/.test(row.text)), true);
		assert.equal(outline.declarations.some((row: any) => row.kind === "field_declaration" && row.name === "name" && row.owner === "Job"), true);
		assert.equal(outline.declarations.some((row: any) => row.kind === "function_definition" && row.name === "run" && row.owner === "Job"), true);
		assert.equal(outline.declarations.some((row: any) => row.kind === "function_definition" && row.name === "run_task" && /^@decorator/.test(row.text)), true);

		const runTask = outline.declarations.find((row: any) => row.name === "run_task").symbolTarget;
		const read = parseToolResult(await tools.get("code_intel_read_symbol")!.execute("read", { target: runTask }, undefined, undefined, ctx));
		assert.equal(read.ok, true);
		assert.match(read.targetSegment.source, /@decorator/);
		assert.match(read.targetSegment.source, /async def run_task/);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("Python extractor emits call, attribute, keyword, and dict-key candidates", async () => {
	const repo = pythonRepo();
	try {
		const parsed = await parseFiles(repo, ["python"], ["jobs.py"]);
		const records = extractFileRecords(parsed.parsedFiles[0], "snippets");
		assert.equal(records.candidates.some((row: any) => row.kind === "syntax_call" && row.text === "client.fetch(name=self.name)"), true);
		assert.equal(records.candidates.some((row: any) => row.kind === "syntax_keyed_field" && row.name === "name" && row.text === "name=self.name"), true);
		assert.equal(records.candidates.some((row: any) => row.kind === "syntax_keyed_field" && row.name === "NeedTags" && row.text === '"NeedTags": True'), true);
		assert.equal(records.candidates.some((row: any) => row.kind === "syntax_selector" && row.name === "name" && row.text === "self.name"), true);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});
