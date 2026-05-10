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

function mockContext(cwd: string) {
	return { cwd, sessionManager: { getSessionId: () => `test-${process.pid}` }, ui: { notify() {}, setStatus() {}, theme: { fg: (_style: string, text: string) => text } } };
}

function fixtureRepo(): string {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-code-intel-compact-"));
	execFileSync("git", ["init", "-q"], { cwd: repo });
	fs.writeFileSync(path.join(repo, "main.ts"), `export function authenticate(user: string) { return user.length > 0; }
export function caller() { return authenticate("root"); }
`);
	return repo;
}

test("code-intel tools keep full details while returning compact content", async () => {
	const repo = fixtureRepo();
	try {
		const tools = loadTools();
		const ctx = mockContext(repo);
		const state = await tools.get("code_intel_state")!.execute("state", {}, undefined, undefined, ctx);
		assert.match(state.content[0].text, /^OK state/m);
		assert.doesNotMatch(state.content[0].text, /"backends"/);
		assert.equal(state.details.backends["tree-sitter"].available, "available");

		const impact = await tools.get("code_intel_impact_map")!.execute("impact", { symbols: ["authenticate"], maxResults: 5 }, undefined, undefined, ctx);
		assert.match(impact.content[0].text, /^OK impact_map/m);
		assert.doesNotMatch(impact.content[0].text, /"related"/);
		assert.equal(impact.details.ok, true);
		assert.equal(Array.isArray(impact.details.related), true);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});
