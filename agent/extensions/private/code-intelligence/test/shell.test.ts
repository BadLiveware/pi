import { execFileSync } from "node:child_process";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { extractFileRecords, parseFiles } from "../src/tree-sitter.ts";
import { loadTools, mockContext, parseToolResult } from "./test-harness.ts";

function shellRepo(): string {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-code-intel-shell-"));
	execFileSync("git", ["init", "-q"], { cwd: repo });
	fs.writeFileSync(path.join(repo, "deploy.sh"), `#!/usr/bin/env bash
set -euo pipefail
source ./lib.sh
. ./env.sh
alias ll='ls -la'
GLOBAL=value

cleanup() { echo cleanup; }
function deploy() {
  local target="$1"
  prepare "$target" | tee /tmp/out
  cleanup
}
trap cleanup EXIT
`);
	return repo;
}

test("Shell outline reports functions, aliases, variables, traps, and sources", async () => {
	const repo = shellRepo();
	try {
		const tools = loadTools();
		const ctx = mockContext(repo).ctx;
		const outline = parseToolResult(await tools.get("code_intel_file_outline")!.execute("outline", { path: "deploy.sh", maxSymbols: 50, detail: "snippets" }, undefined, undefined, ctx));
		assert.equal(outline.ok, true);
		assert.equal(outline.language, "bash");
		assert.deepEqual(outline.imports, ["./lib.sh", "./env.sh"]);
		assert.equal(outline.declarations.some((row: any) => row.kind === "function_definition" && row.name === "cleanup"), true);
		assert.equal(outline.declarations.some((row: any) => row.kind === "function_definition" && row.name === "deploy"), true);
		assert.equal(outline.declarations.some((row: any) => row.kind === "alias_declaration" && row.name === "ll"), true);
		assert.equal(outline.declarations.some((row: any) => row.kind === "variable_declaration" && row.name === "GLOBAL"), true);
		assert.equal(outline.declarations.some((row: any) => row.kind === "trap_declaration" && row.name === "EXIT"), true);

		const deployTarget = outline.declarations.find((row: any) => row.name === "deploy").symbolTarget;
		const read = parseToolResult(await tools.get("code_intel_read_symbol")!.execute("read", { target: deployTarget }, undefined, undefined, ctx));
		assert.equal(read.ok, true);
		assert.match(read.targetSegment.source, /function deploy/);
		assert.match(read.targetSegment.source, /prepare "\$target"/);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("Shell extractor emits command and source candidates", async () => {
	const repo = shellRepo();
	try {
		const parsed = await parseFiles(repo, ["bash"], ["deploy.sh"]);
		const records = extractFileRecords(parsed.parsedFiles[0], "snippets");
		assert.equal(records.candidates.some((row: any) => row.kind === "syntax_call" && row.name === "prepare" && row.text === 'prepare "$target"'), true);
		assert.equal(records.candidates.some((row: any) => row.kind === "syntax_call" && row.name === "cleanup" && row.inFunction === "deploy"), true);
		assert.equal(records.candidates.some((row: any) => row.kind === "syntax_keyed_field" && row.name === "./lib.sh"), true);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});
