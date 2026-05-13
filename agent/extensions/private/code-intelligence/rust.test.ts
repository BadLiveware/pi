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

function rustRepo(): string {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-code-intel-rust-"));
	execFileSync("git", ["init", "-q"], { cwd: repo });
	fs.mkdirSync(path.join(repo, "src"), { recursive: true });
	fs.mkdirSync(path.join(repo, "tests"), { recursive: true });
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
