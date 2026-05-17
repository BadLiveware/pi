import { execFileSync } from "node:child_process";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { loadTools, mockContext, parseToolResult } from "./test-harness.ts";

function goRepo(): string {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-code-intel-go-"));
	execFileSync("git", ["init", "-q"], { cwd: repo });
	fs.writeFileSync(path.join(repo, "widget.go"), `package main

import (
  alias "fmt"
  . "strings"
)

type Widget struct { Name string \`json:"name"\`; Count int }
type Runner interface { Run(input string) error }
type Alias = string
const (
  Max = 3
  Min int = 1
)
var Default = Max

func NewWidget(name string) Widget { return Widget{Name: name} }
func (w *Widget) Run(input string) error { alias.Println(input); return nil }
func caller(w Widget) { w.Run("x"); _ = Widget{Name: "x"} }
`);
	return repo;
}

test("Go extractor reports receiver owners, interface methods, fields, and grouped specs", async () => {
	const repo = goRepo();
	try {
		const tools = loadTools();
		const outline = parseToolResult(await tools.get("code_intel_file_outline")!.execute("outline", { path: "widget.go", maxSymbols: 80, detail: "snippets" }, undefined, undefined, mockContext(repo).ctx));
		assert.equal(outline.ok, true);
		assert.deepEqual(outline.imports, ["fmt", "strings"]);
		assert.equal(outline.declarations.some((row: any) => row.kind === "type" && row.name === "Widget"), true);
		assert.equal(outline.declarations.some((row: any) => row.kind === "type_alias" && row.name === "Alias"), true);
		assert.equal(outline.declarations.some((row: any) => row.kind === "field_declaration" && row.name === "Name" && row.owner === "Widget" && /string/.test(row.type)), true);
		assert.equal(outline.declarations.some((row: any) => row.kind === "method_signature" && row.name === "Run" && row.owner === "Runner"), true);
		assert.equal(outline.declarations.some((row: any) => row.kind === "method_declaration" && row.name === "Run" && row.owner === "Widget"), true);
		assert.equal(outline.declarations.some((row: any) => row.kind === "constant_declaration" && row.name === "Max"), true);
		assert.equal(outline.declarations.some((row: any) => row.kind === "variable_declaration" && row.name === "Default"), true);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("Go extractor keeps call candidates and suppresses selector duplicates for method calls", async () => {
	const repo = goRepo();
	try {
		const tools = loadTools();
		const impact = parseToolResult(await tools.get("code_intel_impact_map")!.execute("impact", { symbols: ["Run", "Name"], maxResults: 20, detail: "snippets" }, undefined, undefined, mockContext(repo).ctx));
		assert.equal(impact.ok, true);
		assert.equal(impact.related.some((row: any) => row.kind === "syntax_call" && row.text === "w.Run(\"x\")"), true);
		assert.equal(impact.related.some((row: any) => row.kind === "syntax_selector" && row.text === "w.Run"), false);
		assert.equal(impact.related.some((row: any) => row.kind === "syntax_keyed_field" && row.text === "Name: name"), true);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});
