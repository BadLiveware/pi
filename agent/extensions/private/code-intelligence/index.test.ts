import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import codeIntelligence from "./index.ts";

process.env.PI_CODE_INTEL_RUNTIME_LOG = path.join(os.tmpdir(), `pi-code-intel-runtime-test-${process.pid}.jsonl`);
process.env.PI_CODE_INTEL_USAGE_LOG = path.join(os.tmpdir(), `pi-code-intel-usage-test-${process.pid}.jsonl`);
for (const logPath of [process.env.PI_CODE_INTEL_RUNTIME_LOG, process.env.PI_CODE_INTEL_USAGE_LOG]) {
	try {
		fs.rmSync(logPath);
	} catch {
		// Ignore missing prior test diagnostics.
	}
}

function hasCommand(command: string): boolean {
	try {
		execFileSync("bash", ["-lc", `command -v ${command}`], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

function loadExtension(): { tools: Map<string, any>; handlers: Map<string, Array<(...args: any[]) => any>> } {
	const tools = new Map<string, any>();
	const handlers = new Map<string, Array<(...args: any[]) => any>>();
	codeIntelligence({
		on(eventName: string, handler: (...args: any[]) => any) {
			const existing = handlers.get(eventName) ?? [];
			existing.push(handler);
			handlers.set(eventName, existing);
		},
		registerTool(tool: { name: string; execute: (...args: any[]) => Promise<any> }) {
			tools.set(tool.name, tool);
		},
	} as any);
	return { tools, handlers };
}

function loadTools(): Map<string, { execute: (...args: any[]) => Promise<any> }> {
	return loadExtension().tools;
}

function fixtureRepo(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-code-intel-"));
	execFileSync("git", ["init", "-q"], { cwd: dir });
	const emptyGlobalIgnore = path.join(dir, "empty-global-ignore");
	fs.writeFileSync(emptyGlobalIgnore, "");
	execFileSync("git", ["config", "core.excludesfile", emptyGlobalIgnore], { cwd: dir });
	fs.writeFileSync(path.join(dir, "main.ts"), `export function authenticate(token: string): boolean {
  return token.length > 0
}

export function loginHandler(token: string) {
  if (authenticate(token)) {
    return "ok"
  }
  return "no"
}

export function unusedHandler() {
  return authenticate("test")
}
`);
	return dir;
}

function parseToolResult(result: any): any {
	return JSON.parse(result.content[0].text);
}

function mockContext(cwd: string) {
	const statuses: Array<{ key: string; value: string | undefined }> = [];
	return {
		ctx: {
			cwd,
			sessionManager: { getSessionId: () => `test-${process.pid}` },
			ui: {
				notify() {},
				setStatus(key: string, value: string | undefined) {
					statuses.push({ key, value });
				},
				theme: { fg: (_style: string, text: string) => text },
			},
		},
		statuses,
	};
}

const renderTheme = { fg: (_style: string, text: string) => text, bold: (text: string) => text };

function renderText(component: { render: (width: number) => string[] }): string {
	return component.render(120).join("\n");
}

test("syntax search returns bounded ast-grep candidates", { skip: !hasCommand("ast-grep") }, async () => {
	const repo = fixtureRepo();
	const tools = loadTools();
	const { ctx } = mockContext(repo);
	const payload = parseToolResult(await tools.get("code_intel_syntax_search")!.execute("test", { pattern: "authenticate($A)", language: "ts", maxResults: 1 }, undefined, undefined, ctx));
	assert.equal(payload.ok, true);
	assert.equal(payload.matchCount, 2);
	assert.equal(payload.returned, 1);
	assert.equal(payload.truncated, true);
	assert.equal(payload.detail, "snippets");
	assert.equal(payload.summary.fileCount, 1);
	assert.equal(payload.summary.returnedFileCount, 1);
	assert.equal(payload.matches[0].file, "main.ts");
	assert.equal(payload.matches[0].line, 6);
	assert.equal(payload.matches[0].metaVariables.single.A, "token");

	const locationsOnly = parseToolResult(await tools.get("code_intel_syntax_search")!.execute("test", { pattern: "authenticate($A)", language: "ts", maxResults: 1, detail: "locations" }, undefined, undefined, ctx));
	assert.equal(locationsOnly.detail, "locations");
	assert.equal("snippet" in locationsOnly.matches[0], false);
	assert.equal("metaVariables" in locationsOnly.matches[0], false);
});

test("cymbal tools return context, references, and impact maps", { skip: !hasCommand("cymbal") }, async () => {
	const repo = fixtureRepo();
	execFileSync("cymbal", ["index", "."], { cwd: repo, stdio: "ignore" });
	const tools = loadTools();
	const { ctx } = mockContext(repo);

	const context = parseToolResult(await tools.get("code_intel_symbol_context")!.execute("test", { symbol: "authenticate" }, undefined, undefined, ctx));
	assert.equal(context.ok, true);
	assert.equal(context.resolved.name, "authenticate");
	assert.equal(context.callers.length, 2);

	const refs = parseToolResult(await tools.get("code_intel_references")!.execute("test", { query: "authenticate", relation: "refs" }, undefined, undefined, ctx));
	assert.equal(refs.ok, true);
	assert.equal(refs.matchCount, 2);
	assert.equal(refs.detail, "locations");
	assert.equal(refs.summary.fileCount, 1);
	assert.deepEqual(refs.summary.topFiles, [{ file: "main.ts", count: 2 }]);
	assert.equal("context" in refs.results[0], false);
	const refsWithSnippets = parseToolResult(await tools.get("code_intel_references")!.execute("test", { query: "authenticate", relation: "refs", detail: "snippets" }, undefined, undefined, ctx));
	assert.equal(refsWithSnippets.detail, "snippets");
	assert.equal(Array.isArray(refsWithSnippets.results[0].context), true);

	const impact = parseToolResult(await tools.get("code_intel_impact_map")!.execute("test", { symbols: ["authenticate"], maxResults: 5 }, undefined, undefined, ctx));
	assert.equal(impact.ok, true);
	assert.deepEqual(impact.rootSymbols, ["authenticate"]);
	assert.equal(impact.related.length, 2);
});

test("symbol source and guarded replacement edit exactly one symbol", { skip: !hasCommand("cymbal") }, async () => {
	const repo = fixtureRepo();
	execFileSync("cymbal", ["index", "."], { cwd: repo, stdio: "ignore" });
	const tools = loadTools();
	const { ctx } = mockContext(repo);
	const source = parseToolResult(await tools.get("code_intel_symbol_source")!.execute("test", { symbol: "authenticate", file: "main.ts" }, undefined, undefined, ctx));
	assert.equal(source.ok, true);
	assert.equal(source.file, "main.ts");
	assert.equal(source.range.startLine, 1);
	assert.match(source.source, /export function authenticate/);
	assert.match(source.sourceHash, /^sha256:/);
	assert.deepEqual(source.preconditions.expectedRange, source.range);

	const newSource = source.source.replace("return token.length > 0", "return token.trim().length > 0");
	const replaced = parseToolResult(await tools.get("code_intel_replace_symbol")!.execute("test", { symbol: "authenticate", file: source.preconditions.file, expectedRange: source.preconditions.expectedRange, expectedHash: source.preconditions.expectedHash, newSource }, undefined, undefined, ctx));
	assert.equal(replaced.ok, true);
	assert.equal(replaced.file, "main.ts");
	assert.equal(replaced.reverted, false);
	assert.equal(replaced.rangeAfter.startLine, 1);
	assert.match(fs.readFileSync(path.join(repo, "main.ts"), "utf8"), /token\.trim\(\)\.length/);

	const stale = parseToolResult(await tools.get("code_intel_replace_symbol")!.execute("test", { symbol: "authenticate", file: source.preconditions.file, expectedRange: source.preconditions.expectedRange, expectedHash: source.preconditions.expectedHash, newSource: source.source }, undefined, undefined, ctx));
	assert.equal(stale.ok, false);
	assert.equal(stale.phase, "precondition");
	assert.match(stale.reason, /hash/);
});

test("local map combines symbol context and scoped references", { skip: !hasCommand("cymbal") }, async () => {
	const repo = fixtureRepo();
	execFileSync("cymbal", ["index", "."], { cwd: repo, stdio: "ignore" });
	const tools = loadTools();
	const { ctx } = mockContext(repo);
	const localMap = parseToolResult(await tools.get("code_intel_local_map")!.execute("test", { anchors: ["authenticate"], names: ["loginHandler"], paths: ["main.ts"], includeSyntax: false, maxPerName: 3 }, undefined, undefined, ctx));
	assert.equal(localMap.ok, true);
	assert.deepEqual(localMap.anchors, ["authenticate"]);
	assert.deepEqual(localMap.names, ["authenticate", "loginHandler"]);
	assert.equal(localMap.sections.symbolContexts.length, 1);
	assert.equal(localMap.sections.references.length, 2);
	assert.equal(localMap.sections.syntaxMatches.length, 0);
	assert.equal(localMap.sections.literalMatches.length, 2);
	assert.equal(localMap.summary.suggestedFiles.some((file: any) => file.file === "main.ts"), true);
	assert.equal(localMap.detail, "locations");
});

test("impact map caps changed-file roots to queried roots", { skip: !hasCommand("cymbal") }, async () => {
	const repo = fixtureRepo();
	execFileSync("cymbal", ["index", "."], { cwd: repo, stdio: "ignore" });
	const tools = loadTools();
	const { ctx } = mockContext(repo);
	const impact = parseToolResult(await tools.get("code_intel_impact_map")!.execute("test", { changedFiles: ["main.ts"], maxRootSymbols: 1, maxResults: 5 }, undefined, undefined, ctx));
	assert.equal(impact.roots.length, 1);
	assert.equal(impact.rootSymbols.length, 1);
	assert.equal(impact.coverage.rootSymbolsDiscovered, 3);
	assert.equal(impact.coverage.rootSymbolsUsed, 1);
	assert.equal(impact.coverage.truncated, true);
	assert.equal("absoluteFile" in impact.roots[0], false);
	assert.equal(typeof impact.summary.relatedFileCount, "number");
	assert.equal(impact.detail, "locations");
	if (impact.related.length > 0) assert.equal("context" in impact.related[0], false);
});

test("sqry artifact policy is visible in state", async () => {
	const repo = fixtureRepo();
	const tools = loadTools();
	const { ctx, statuses } = mockContext(repo);
	const state = parseToolResult(await tools.get("code_intel_state")!.execute("test", { includeDiagnostics: true }, undefined, undefined, ctx));
	assert.equal(state.sqryArtifactPolicy.allowed, false);
	assert.match(state.sqryArtifactPolicy.reason, /not confirmed ignored|disabled/);
	assert.equal(statuses.at(-1)?.key, "code-intel");
	assert.match(statuses.at(-1)?.value ?? "", /^ci\s/);
	assert.doesNotMatch(statuses.at(-1)?.value ?? "", /○/);
});

test("sqry artifact policy allows directory ignore patterns", async () => {
	const repo = fixtureRepo();
	fs.appendFileSync(path.join(repo, ".git", "info", "exclude"), "\n.sqry/\n.sqry-index/\n");
	const tools = loadTools();
	const { ctx } = mockContext(repo);
	const state = parseToolResult(await tools.get("code_intel_state")!.execute("test", { includeDiagnostics: true }, undefined, undefined, ctx));
	assert.equal(state.sqryArtifactPolicy.allowed, true);
});

test("auto update indexes configured role backends", { skip: !hasCommand("sqry") || !hasCommand("cymbal") }, async () => {
	const repo = fixtureRepo();
	fs.appendFileSync(path.join(repo, ".git", "info", "exclude"), "\n.sqry/\n.sqry-index/\n");
	const tools = loadTools();
	const { ctx } = mockContext(repo);
	const update = parseToolResult(await tools.get("code_intel_update")!.execute("test", { backend: "auto" }, undefined, undefined, ctx));
	assert.equal(update.ok, true);
	assert.deepEqual(update.backends, ["sqry", "cymbal"]);
	assert.equal(update.state.backends.sqry.indexStatus, "fresh");
	assert.equal(update.state.backends.cymbal.indexStatus, "present");

	const state = parseToolResult(await tools.get("code_intel_state")!.execute("test", { includeDiagnostics: true }, undefined, undefined, ctx));
	assert.match(state.runtimeDiagnostics.logPath, /pi-code-intel-runtime-test-/);
	assert.equal(state.runtimeDiagnostics.recentOperations.at(-1).operation, "update");
	assert.deepEqual(state.runtimeDiagnostics.recentOperations.at(-1).backends, ["sqry", "cymbal"]);
});

test("usage tracking records sanitized symbol replacement followups", { skip: !hasCommand("cymbal") }, async () => {
	const repo = fixtureRepo();
	execFileSync("cymbal", ["index", "."], { cwd: repo, stdio: "ignore" });
	fs.rmSync(process.env.PI_CODE_INTEL_USAGE_LOG as string, { force: true });
	const { tools, handlers } = loadExtension();
	const { ctx } = mockContext(repo);
	const source = parseToolResult(await tools.get("code_intel_symbol_source")!.execute("source", { symbol: "authenticate", file: "main.ts" }, undefined, undefined, ctx));
	const newSource = source.source.replace("return token.length > 0", "return token.trim().length > 0");
	const input = { symbol: "authenticate", file: source.preconditions.file, expectedRange: source.preconditions.expectedRange, expectedHash: source.preconditions.expectedHash, newSource };
	for (const handler of handlers.get("tool_call") ?? []) await handler({ toolName: "code_intel_replace_symbol", toolCallId: "replace-test", input }, ctx);
	const result = await tools.get("code_intel_replace_symbol")!.execute("replace-test", input, undefined, undefined, ctx);
	for (const handler of handlers.get("tool_result") ?? []) await handler({ toolName: "code_intel_replace_symbol", toolCallId: "replace-test", input, details: result.details, content: result.content, isError: false }, ctx);
	for (const handler of handlers.get("tool_call") ?? []) await handler({ toolName: "read", toolCallId: "read-after-replace", input: { path: "main.ts" } }, ctx);

	const usageLog = fs.readFileSync(process.env.PI_CODE_INTEL_USAGE_LOG as string, "utf-8");
	assert.match(usageLog, /symbol_replace_followup/);
	assert.match(usageLog, /code_intel_replace_symbol/);
	assert.doesNotMatch(usageLog, /token\.trim\(\)\.length/);
});

test("usage tracking records sanitized code-intel metadata", { skip: !hasCommand("ast-grep") }, async () => {
	const repo = fixtureRepo();
	const { tools, handlers } = loadExtension();
	const { ctx } = mockContext(repo);
	const input = { pattern: "authenticate($A)", language: "ts", maxResults: 1 };
	const callEvent = { toolName: "code_intel_syntax_search", toolCallId: "usage-test", input };
	for (const handler of handlers.get("tool_call") ?? []) await handler(callEvent, ctx);
	const result = await tools.get("code_intel_syntax_search")!.execute("usage-test", input, undefined, undefined, ctx);
	const resultEvent = { toolName: "code_intel_syntax_search", toolCallId: "usage-test", input, details: result.details, content: result.content, isError: false };
	for (const handler of handlers.get("tool_result") ?? []) await handler(resultEvent, ctx);

	const usageLog = fs.readFileSync(process.env.PI_CODE_INTEL_USAGE_LOG as string, "utf-8");
	assert.match(usageLog, /code_intel_syntax_search/);
	assert.match(usageLog, /patternLength/);
	assert.doesNotMatch(usageLog, /authenticate\(\$A\)/);
});

test("custom render cards keep code-intel results compact", async () => {
	const { tools } = loadExtension();
	const references = tools.get("code_intel_references")!;
	const details = {
		ok: true,
		query: "veryImportantSymbol",
		relation: "refs",
		matchCount: 2,
		returned: 2,
		truncated: false,
		results: [
			{ file: "src/very/long/path/that/should/still/be/compact/file-one.ts", line: 10, name: "veryImportantSymbol", context: ["a", "b", "c"] },
			{ file: "src/file-two.ts", line: 20, name: "veryImportantSymbol", context: ["d", "e", "f"] },
		],
		command: { stdout: "x".repeat(10_000), stderr: "" },
	};
	const collapsed = renderText(references.renderResult({ details }, { expanded: false, isPartial: false }, renderTheme, {}));
	assert.match(collapsed, /references/);
	assert.match(collapsed, /2\/2/);
	assert.doesNotMatch(collapsed, /10_000|xxxxxxxxxx/);
	assert.ok(collapsed.split("\n").length <= 2);

	const expanded = renderText(references.renderResult({ details }, { expanded: true, isPartial: false }, renderTheme, {}));
	assert.match(expanded, /file-one\.ts:10/);
	assert.match(expanded, /file-two\.ts:20/);
	assert.ok(expanded.length < 500);
});
