import { execFileSync } from "node:child_process";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { loadTools, mockContext, parseToolResult } from "./test-harness.ts";

function markdownRepo(): string {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-code-intel-markdown-"));
	execFileSync("git", ["init", "-q"], { cwd: repo });
	fs.writeFileSync(path.join(repo, "README.md"), `---
title: Demo
---

# Demo Guide

See [setup](docs/setup.md) and [API][api-ref].

## Install

\`\`\`bash
npm install
\`\`\`

## Usage

Call the tool.

[api-ref]: docs/api.md
`);
	return repo;
}

test("Markdown outline reports frontmatter, sections, links, and code fences", async () => {
	const repo = markdownRepo();
	try {
		const tools = loadTools();
		const ctx = mockContext(repo).ctx;
		const outline = parseToolResult(await tools.get("code_intel_file_outline")!.execute("outline", { path: "README.md", maxSymbols: 50, detail: "snippets" }, undefined, undefined, ctx));
		assert.equal(outline.ok, true);
		assert.equal(outline.language, "markdown");
		assert.deepEqual(outline.imports, ["docs/setup.md", "bash", "docs/api.md"]);
		assert.equal(outline.declarations.some((row: any) => row.kind === "frontmatter" && row.name === "frontmatter"), true);
		assert.equal(outline.declarations.some((row: any) => row.kind === "markdown_section" && row.name === "Demo Guide" && row.type === "h1#demo-guide"), true);
		assert.equal(outline.declarations.some((row: any) => row.kind === "markdown_section" && row.name === "Install" && row.type === "h2#install"), true);
		assert.equal(outline.declarations.some((row: any) => row.kind === "code_fence" && row.name === "bash"), true);

		const install = outline.declarations.find((row: any) => row.kind === "markdown_section" && row.name === "Install").symbolTarget;
		const read = parseToolResult(await tools.get("code_intel_read_symbol")!.execute("read", { target: install }, undefined, undefined, ctx));
		assert.equal(read.ok, true);
		assert.match(read.targetSegment.source, /## Install/);
		assert.match(read.targetSegment.source, /npm install/);
		assert.doesNotMatch(read.targetSegment.source, /## Usage/);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});
