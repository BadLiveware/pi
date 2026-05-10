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

test("impact map skips whole-repo parsing for unsupported changed-file languages", async () => {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-code-intel-unsupported-impact-"));
	execFileSync("git", ["init", "-q"], { cwd: repo });
	fs.mkdirSync(path.join(repo, "src"), { recursive: true });
	fs.writeFileSync(path.join(repo, "src", "query.rs"), "fn apply_function_over_range() {}\n");
	fs.writeFileSync(path.join(repo, "src", "quantile.rs"), "struct AggregateFunctionTimeseriesQuantile {}\n");
	fs.writeFileSync(path.join(repo, "supported.ts"), "export function shouldNotNeedParsing() { return true }\n");

	const impact = parseToolResult(await loadTools().get("code_intel_impact_map")!.execute("test", { changedFiles: ["src/query.rs", "src/quantile.rs"], maxResults: 10 }, undefined, undefined, mockContext(repo)));

	assert.equal(impact.ok, false);
	assert.match(impact.reason, /do not include languages supported/);
	assert.equal(impact.coverage.filesParsed, 0);
	assert.equal(impact.coverage.unsupportedImpactFiles.length, 2);
	assert.deepEqual(impact.coverage.supportedImpactFiles, []);
});
