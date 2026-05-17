import { execFileSync } from "node:child_process";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import codeIntelligence from "../index.ts";
import { collectTouchedDiagnostics } from "../src/slices/post-edit-map/diagnostics.ts";
import { DEFAULT_CONFIG } from "../src/types.ts";

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

function rustRepo(): string {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-code-intel-rust-"));
	execFileSync("git", ["init", "-q"], { cwd: repo });
	fs.mkdirSync(path.join(repo, "src"), { recursive: true });
	fs.mkdirSync(path.join(repo, "tests"), { recursive: true });
	fs.writeFileSync(path.join(repo, "Cargo.toml"), `[package]
name = "sample"
version = "0.1.0"
edition = "2021"
`);
	fs.writeFileSync(path.join(repo, "src", "lib.rs"), `use std::sync::Arc;
mod parser;

pub struct ParserConfig { pub enabled: bool }
pub enum ParseState { Ready, Done }
pub trait Runner { fn run(&self); }

impl ParserConfig {
    pub fn new() -> Self { Self { enabled: true } }
    pub fn parse_inner(&self, input: &str) -> usize {
        if self.enabled { helper(input) } else { 0 }
    }
    fn private_helper(&self) -> bool { self.enabled }
}

pub fn build_model(input: &str) -> usize {
    let cfg = ParserConfig::new();
    if cfg.private_helper() { cfg.parse_inner(input) } else { 0 }
}

fn helper(input: &str) -> usize { input.len() }
`);
	fs.writeFileSync(path.join(repo, "src", "parser.rs"), "pub fn parse_token(raw: &str) -> &str { raw }\n");
	fs.writeFileSync(path.join(repo, "tests", "parser_integration.rs"), `use sample::build_model;

#[test]
fn build_model_smoke() {
    let size = build_model("a");
    assert_eq!(size, 1);
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

function writeFakeRustAnalyzer(file: string): void {
	fs.writeFileSync(file, `#!/usr/bin/env node
if (process.argv.includes("--version")) {
  console.log("rust-analyzer fake 1.0");
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
    write({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri, diagnostics: [{ range: { start: { line: 3, character: 26 }, end: { line: 3, character: 30 } }, severity: 1, source: "rust-analyzer", code: "E0308", message: "mismatched types" }] } });
  } else if (message.method === "textDocument/references") {
    const uri = message.params?.textDocument?.uri;
    write({ jsonrpc: "2.0", id: message.id, result: [{ uri, range: { start: { line: 16, character: 7 }, end: { line: 16, character: 18 } } }] });
  } else if (message.method === "shutdown") write({ jsonrpc: "2.0", id: message.id, result: null });
  else if (message.method === "exit") process.exit(0);
}
process.stdin.on("data", (chunk) => { buffer = Buffer.concat([buffer, chunk]); parse(); });
`);
	fs.chmodSync(file, 0o755);
}

test("Rust file outline reports imports, declarations, methods, and fields", async () => {
	const repo = rustRepo();
	try {
		const tools = loadTools();
		const outline = parseToolResult(await tools.get("code_intel_file_outline")!.execute("test", { path: "src/lib.rs", maxSymbols: 50, detail: "snippets" }, undefined, undefined, mockContext(repo)));
		assert.equal(outline.ok, true);
		assert.equal(outline.language, "rust");
		assert.deepEqual(outline.imports, ["std::sync::Arc", "parser"]);
		assert.equal(outline.declarations.some((row: any) => row.kind === "struct_item" && row.name === "ParserConfig" && row.exported === true), true);
		assert.equal(outline.declarations.some((row: any) => row.kind === "enum_item" && row.name === "ParseState"), true);
		assert.equal(outline.declarations.some((row: any) => row.kind === "trait_item" && row.name === "Runner"), true);
		assert.equal(outline.declarations.some((row: any) => row.kind === "function_item" && row.name === "parse_inner" && row.owner === "ParserConfig"), true);
		assert.equal(outline.declarations.some((row: any) => row.kind === "function_item" && row.name === "build_model" && row.exported === true), true);
		assert.equal(outline.declarations.some((row: any) => row.kind === "field_declaration" && row.name === "enabled" && row.type === "bool"), true);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("Rust impact map routes current-source definitions and callers", async () => {
	const repo = rustRepo();
	try {
		const tools = loadTools();
		const impact = parseToolResult(await tools.get("code_intel_impact_map")!.execute("test", { symbols: ["build_model"], maxResults: 20, detail: "snippets" }, undefined, undefined, mockContext(repo)));
		assert.equal(impact.ok, true);
		assert.equal(impact.coverage.supportedImpactLanguages.includes("rust"), true);
		assert.equal(impact.coverage.parsedByLanguage.rust, 3);
		assert.equal(impact.rootSymbols.includes("build_model"), true);
		assert.equal(impact.related.some((row: any) => row.kind === "syntax_call" && row.file === "tests/parser_integration.rs" && row.text === "build_model(\"a\")"), true);
		assert.match(impact.limitations.join("\n"), /not type-resolved semantic references/);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("Rust impact map optionally confirms references with rust-analyzer", async () => {
	const repo = rustRepo();
	try {
		const binDir = path.join(repo, "bin");
		fs.mkdirSync(binDir);
		writeFakeRustAnalyzer(path.join(binDir, "rust-analyzer"));
		await withPath(`${binDir}${path.delimiter}${process.env.PATH ?? ""}`, async () => {
			const tools = loadTools();
			const impact = parseToolResult(await tools.get("code_intel_impact_map")!.execute("test", { symbols: ["build_model"], confirmReferences: "rust-analyzer", maxReferenceRoots: 1, maxReferenceResults: 5, detail: "locations" }, undefined, undefined, mockContext(repo)));
			assert.equal(impact.referenceConfirmation.backend, "rust-analyzer");
			assert.equal(impact.referenceConfirmation.ok, true);
			assert.equal(impact.referenceConfirmation.references.some((row: any) => row.file === "src/lib.rs" && row.rootSymbol === "build_model" && row.evidence === "rust-analyzer:textDocument/references"), true);
		});
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("Rust post-edit diagnostics collect rust-analyzer publishDiagnostics rows", async () => {
	const repo = rustRepo();
	try {
		const binDir = path.join(repo, "bin");
		fs.mkdirSync(binDir);
		writeFakeRustAnalyzer(path.join(binDir, "rust-analyzer"));
		await withPath(`${binDir}${path.delimiter}${process.env.PATH ?? ""}`, async () => {
			const result = await collectTouchedDiagnostics(repo, ["src/lib.rs"], DEFAULT_CONFIG);
			assert.equal(result.diagnostics.some((row) => row.path === "src/lib.rs" && row.line === 4 && row.column === 27 && row.severity === "error" && row.source === "rust-analyzer" && row.code === "E0308" && /mismatched/.test(row.message ?? "")), true);
			assert.equal(result.providerStatuses.some((row) => row.provider === "rust-analyzer" && row.available === "available" && row.fileCount === 1 && row.diagnosticCount === 1), true);
		});
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("Rust post-edit diagnostics report missing rust-analyzer without failing collection", async () => {
	const repo = rustRepo();
	try {
		const emptyBin = path.join(repo, "empty-bin");
		fs.mkdirSync(emptyBin);
		await withPath(emptyBin, async () => {
			const result = await collectTouchedDiagnostics(repo, ["src/lib.rs"], DEFAULT_CONFIG);
			assert.equal(result.diagnostics.length, 0);
			const status = result.providerStatuses.find((row) => row.provider === "rust-analyzer");
			assert.equal(status?.available, "missing");
			assert.match(String(status?.diagnostic ?? ""), /rust-analyzer not found/);
		});
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("Rust changed-file impact extracts roots without treating .rs as unsupported", async () => {
	const repo = rustRepo();
	try {
		const tools = loadTools();
		const impact = parseToolResult(await tools.get("code_intel_impact_map")!.execute("test", { changedFiles: ["src/lib.rs"], maxRootSymbols: 6, maxResults: 20, detail: "locations" }, undefined, undefined, mockContext(repo)));
		assert.equal(impact.ok, true);
		assert.deepEqual(impact.coverage.unsupportedImpactFiles, []);
		assert.equal(impact.coverage.supportedImpactFiles.some((file: any) => file.file === "src/lib.rs" && file.languages.includes("rust")), true);
		assert.equal(impact.rootSymbols.includes("build_model"), true);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("Rust syntax search supports scoped calls, fields, and struct initializers", async () => {
	const repo = rustRepo();
	try {
		const tools = loadTools();
		const ctx = mockContext(repo);
		const call = parseToolResult(await tools.get("code_intel_syntax_search")!.execute("test", { pattern: "ParserConfig::new()", language: "rust", paths: ["src/lib.rs"], detail: "snippets" }, undefined, undefined, ctx));
		assert.equal(call.ok, true);
		assert.equal(call.matches.some((row: any) => row.text === "ParserConfig::new()"), true);

		const selector = parseToolResult(await tools.get("code_intel_syntax_search")!.execute("test", { pattern: "$X.enabled", language: "rust", paths: ["src/lib.rs"], detail: "snippets" }, undefined, undefined, ctx));
		assert.equal(selector.ok, true);
		assert.equal(selector.matches.some((row: any) => row.text === "self.enabled" && row.metaVariables.single.X === "self"), true);

		const keyed = parseToolResult(await tools.get("code_intel_syntax_search")!.execute("test", { pattern: "enabled: $VALUE", language: "rust", selector: "field_initializer", paths: ["src/lib.rs"], detail: "snippets" }, undefined, undefined, ctx));
		assert.equal(keyed.ok, true);
		assert.equal(keyed.matches.some((row: any) => row.text === "enabled: true" && row.metaVariables.single.VALUE === "true"), true);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("Rust extractor records trait impl owners and inline test functions", async () => {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-code-intel-rust-impl-"));
	try {
		execFileSync("git", ["init", "-q"], { cwd: repo });
		fs.writeFileSync(path.join(repo, "lib.rs"), `use std::fmt::{self, Display};

pub struct Widget { pub name: String }

impl Display for Widget {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result { write!(f, "{}", self.name) }
}

#[cfg(test)]
mod tests {
    #[test]
    fn widget_display_smoke() { assert_eq!(format!("{}", Widget { name: "x".into() }), "x"); }
}
`);
		const tools = loadTools();
		const outline = parseToolResult(await tools.get("code_intel_file_outline")!.execute("test", { path: "lib.rs", maxSymbols: 50, detail: "snippets" }, undefined, undefined, mockContext(repo)));
		assert.equal(outline.ok, true);
		assert.equal(outline.declarations.some((row: any) => row.kind === "function_item" && row.name === "fmt" && row.owner === "Widget"), true);
		assert.equal(outline.declarations.some((row: any) => row.kind === "function_item" && row.name === "widget_display_smoke"), true);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("Rust test map finds integration tests by literal evidence", async () => {
	const repo = rustRepo();
	try {
		const tools = loadTools();
		const testMap = parseToolResult(await tools.get("code_intel_test_map")!.execute("test", { path: "src/lib.rs", symbols: ["build_model"], maxResults: 5 }, undefined, undefined, mockContext(repo)));
		assert.equal(testMap.ok, true);
		assert.equal(testMap.candidates.some((candidate: any) => candidate.file === "tests/parser_integration.rs"), true);
		assert.equal(testMap.candidates.find((candidate: any) => candidate.file === "tests/parser_integration.rs").evidence.some((row: any) => row.kind === "literal_match" && row.term === "build_model"), true);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});
