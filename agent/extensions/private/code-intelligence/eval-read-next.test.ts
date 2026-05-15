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

function fixtureRepo(): string {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-code-intel-eval-"));
	execFileSync("git", ["init", "-q"], { cwd: repo });
	fs.mkdirSync(path.join(repo, "src"), { recursive: true });
	fs.mkdirSync(path.join(repo, "tests"), { recursive: true });
	fs.writeFileSync(path.join(repo, "src", "auth.ts"), `export interface AuthToken { raw: string }
export function authenticate(token: AuthToken): boolean { return token.raw.length > 0 }
export function authorize(token: AuthToken): string { return authenticate(token) ? "ok" : "no" }
`);
	fs.writeFileSync(path.join(repo, "src", "app.ts"), `import { authenticate, type AuthToken } from "./auth"
export function login(token: AuthToken) { return authenticate(token) }
`);
	fs.writeFileSync(path.join(repo, "tests", "auth.test.ts"), `import { authenticate } from "../src/auth"
test("authenticate accepts non-empty token", () => authenticate({ raw: "abc" }))
`);
	fs.writeFileSync(path.join(repo, "README.md"), "Authentication docs mention authenticate only as prose.\n");
	return repo;
}

function files(rows: Array<Record<string, unknown>>): string[] {
	return [...new Set(rows.map((row) => String(row.file ?? "")).filter(Boolean))];
}

test("code-intel eval: top-N read-next files for a TypeScript auth symbol", async () => {
	const repo = fixtureRepo();
	try {
		const tools = loadTools();
		const ctx = mockContext(repo);
		const impact = parseToolResult(await tools.get("code_intel_impact_map")!.execute("impact", { symbols: ["authenticate"], maxResults: 10, detail: "locations" }, undefined, undefined, ctx));
		assert.equal(impact.ok, true);
		const impactFiles = files(impact.related).slice(0, 3);
		assert.deepEqual([...impactFiles.slice(0, 2)].sort(), ["src/app.ts", "src/auth.ts"]);
		assert.equal(impactFiles[2], "tests/auth.test.ts");

		const testMap = parseToolResult(await tools.get("code_intel_test_map")!.execute("tests", { path: "src/auth.ts", symbols: ["authenticate"], maxResults: 3 }, undefined, undefined, ctx));
		assert.equal(testMap.ok, true);
		assert.equal(testMap.candidates[0].file, "tests/auth.test.ts");
		assert.equal(testMap.candidates[0].evidence.some((row: any) => row.kind === "literal_match" && row.term === "authenticate"), true);

		const route = parseToolResult(await tools.get("code_intel_repo_route")!.execute("route", { terms: ["authenticate"], paths: ["src", "tests"], maxResults: 3 }, undefined, undefined, ctx));
		assert.equal(route.ok, true);
		assert.equal(route.candidates.some((candidate: any) => candidate.file === "src/auth.ts"), true);
		assert.equal(route.candidates.some((candidate: any) => candidate.file === "tests/auth.test.ts"), true);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});
