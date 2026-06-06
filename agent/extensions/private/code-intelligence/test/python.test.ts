import { execFileSync } from "node:child_process";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { extractFileRecords, parseFiles } from "code-intel/pi-integration";
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
	fs.mkdirSync(path.join(repo, "tests"));
	fs.writeFileSync(path.join(repo, "tests", "test_jobs.py"), `from jobs import run_task

async def test_run_task():
    await run_task("nightly")
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

function writeFakePyrefly(file: string): void {
	fs.writeFileSync(file, `#!/usr/bin/env node
if (process.argv.includes("--version")) {
  console.log("pyrefly fake 1.0");
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
  else if (message.method === "textDocument/references") {
    const uri = message.params?.textDocument?.uri;
    const testUri = uri.replace(/jobs\\.py$/, "tests/test_jobs.py");
    write({ jsonrpc: "2.0", id: message.id, result: [
      { uri, range: { start: { line: 15, character: 10 }, end: { line: 15, character: 18 } } },
      { uri: testUri, range: { start: { line: 3, character: 10 }, end: { line: 3, character: 18 } } },
    ] });
  } else if (message.method === "shutdown") write({ jsonrpc: "2.0", id: message.id, result: null });
  else if (message.method === "exit") process.exit(0);
}
process.stdin.on("data", (chunk) => { buffer = Buffer.concat([buffer, chunk]); parse(); });
`);
	fs.chmodSync(file, 0o755);
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

test("Python impact map optionally confirms references with Pyrefly", async () => {
	const repo = pythonRepo();
	try {
		const binDir = path.join(repo, "bin");
		fs.mkdirSync(binDir);
		writeFakePyrefly(path.join(binDir, "pyrefly"));
		await withPath(`${binDir}${path.delimiter}${process.env.PATH ?? ""}`, async () => {
			const tools = loadTools();
			const ctx = mockContext(repo).ctx;
			const impact = parseToolResult(await tools.get("code_intel_impact_map")!.execute("impact", { symbols: ["run_task"], confirmReferences: "pyrefly", maxReferenceRoots: 1, maxReferenceResults: 5, detail: "locations" }, undefined, undefined, ctx));
			assert.equal(impact.referenceConfirmation.backend, "pyrefly");
			assert.equal(impact.referenceConfirmation.ok, true);
			assert.equal(impact.referenceConfirmation.roots[0].position, "jobs.py:16:11");
			assert.equal(impact.referenceConfirmation.references.some((row: any) => row.file === "tests/test_jobs.py" && row.rootSymbol === "run_task" && row.evidence === "pyrefly:textDocument/references"), true);
		});
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("Python reference confirmation reports missing Pyrefly without failing impact routing", async () => {
	const repo = pythonRepo();
	try {
		const emptyBin = path.join(repo, "empty-bin");
		fs.mkdirSync(emptyBin);
		await withPath(emptyBin, async () => {
			const tools = loadTools();
			const ctx = mockContext(repo).ctx;
			const impact = parseToolResult(await tools.get("code_intel_impact_map")!.execute("impact", { symbols: ["run_task"], confirmReferences: "pyrefly", maxReferenceRoots: 1, maxReferenceResults: 5, detail: "locations" }, undefined, undefined, ctx));
			assert.equal(impact.ok, true);
			assert.equal(impact.referenceConfirmation.backend, "pyrefly");
			assert.equal(impact.referenceConfirmation.ok, false);
			assert.deepEqual(impact.referenceConfirmation.references, []);
			assert.match(impact.referenceConfirmation.diagnostics.join("\n"), /pyrefly not found/);
		});
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
