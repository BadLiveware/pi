import { execFileSync } from "node:child_process";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { loadTools, mockContext, parseToolResult } from "./test-harness.ts";

function tsRepo(): string {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-code-intel-ts-extractor-"));
	execFileSync("git", ["init", "-q"], { cwd: repo });
	fs.writeFileSync(path.join(repo, "view.tsx"), `import React from 'react'

export class Client {
  value = 1
  constructor(public url: string) {}
  get status() { return this.url }
  set status(value: string) { this.url = value }
  request() { return import('./worker').then(m => m.run()) }
}

export const Wrapped = class WrappedClient {
  run() { return new Client('x').request() }
}

export function View() { return <Widget value="x" /> }
`);
	return repo;
}

test("TypeScript extractor keeps class members and adds new/JSX candidates", async () => {
	const repo = tsRepo();
	try {
		const tools = loadTools();
		const ctx = mockContext(repo).ctx;
		const outline = parseToolResult(await tools.get("code_intel_file_outline")!.execute("outline", { path: "view.tsx", maxSymbols: 80, detail: "snippets" }, undefined, undefined, ctx));
		assert.equal(outline.ok, true);
		assert.deepEqual(outline.imports, ["react", "./worker"]);
		assert.equal(outline.declarations.some((row: any) => row.kind === "class_declaration" && row.name === "Client"), true);
		assert.equal(outline.declarations.some((row: any) => row.kind === "method_definition" && row.name === "constructor" && row.owner === "Client"), true);
		assert.equal(outline.declarations.some((row: any) => row.kind === "method_definition" && row.name === "status" && row.owner === "Client"), true);
		assert.equal(outline.declarations.some((row: any) => row.name === "Wrapped"), true);

		const impact = parseToolResult(await tools.get("code_intel_impact_map")!.execute("impact", { symbols: ["Client", "Widget"], maxResults: 20, detail: "snippets" }, undefined, undefined, ctx));
		assert.equal(impact.related.some((row: any) => row.kind === "syntax_call" && row.evidence === "tree-sitter:new_expression" && row.text === "new Client('x')"), true);
		assert.equal(impact.related.some((row: any) => row.kind === "syntax_call" && /jsx_self_closing_element/.test(row.evidence) && row.text === '<Widget value="x" />'), true);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});
