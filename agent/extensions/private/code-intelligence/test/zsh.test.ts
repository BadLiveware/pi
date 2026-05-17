import { execFileSync } from "node:child_process";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { loadTools, mockContext, parseToolResult } from "./test-harness.ts";

function zshRepo(): string {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-code-intel-zsh-"));
	execFileSync("git", ["init", "-q"], { cwd: repo });
	fs.writeFileSync(path.join(repo, "prompt.zsh"), `autoload -Uz compinit
source ./theme.zsh
function prompt_main {
  compinit
  print -r -- ready
}
`);
	return repo;
}

test("zsh files parse as logical zsh with bash-grammar shell extraction", async () => {
	const repo = zshRepo();
	try {
		const tools = loadTools();
		const outline = parseToolResult(await tools.get("code_intel_file_outline")!.execute("outline", { path: "prompt.zsh", maxSymbols: 30, detail: "snippets" }, undefined, undefined, mockContext(repo).ctx));
		assert.equal(outline.ok, true);
		assert.equal(outline.language, "zsh");
		assert.deepEqual(outline.imports, ["compinit", "./theme.zsh"]);
		assert.equal(outline.declarations.some((row: any) => row.kind === "function_definition" && row.name === "prompt_main"), true);

		const impact = parseToolResult(await tools.get("code_intel_impact_map")!.execute("impact", { changedFiles: ["prompt.zsh"], symbols: ["compinit"], maxRootSymbols: 5, maxResults: 20, detail: "snippets" }, undefined, undefined, mockContext(repo).ctx));
		assert.equal(impact.ok, true);
		assert.equal(impact.coverage.supportedImpactFiles.some((row: any) => row.file === "prompt.zsh" && row.languages.includes("zsh")), true);
		assert.equal(impact.rootSymbols.includes("prompt_main"), true);
		assert.equal(impact.related.some((row: any) => row.kind === "syntax_keyed_field" && row.name === "compinit" && /autoload/.test(row.evidence)), true);
		assert.equal(impact.related.some((row: any) => row.kind === "syntax_call" && row.name === "compinit" && row.inFunction === "prompt_main"), true);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});
