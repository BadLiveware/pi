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

function loadTools(): Map<string, { execute: (...args: any[]) => Promise<any>; renderResult?: (...args: any[]) => any }> {
	return loadExtension().tools;
}

function fixtureRepo(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-code-intel-"));
	execFileSync("git", ["init", "-q"], { cwd: dir });
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

export interface SelectorSource {
  NeedTags: boolean
}

export function needsTags(selector: SelectorSource): boolean {
  if (selector.NeedTags) return true
  return false
}

export const selector: SelectorSource = { NeedTags: true }
`);
	fs.writeFileSync(path.join(dir, "main.test.ts"), `import { authenticate } from "./main"

function testHelper() {
  return authenticate("helper")
}

const mock = {
  on() {
    return authenticate("hook")
  },
}
`);
	fs.writeFileSync(path.join(dir, "selector.go"), `package main

type SelectorSourceGo struct { NeedTags bool }

func buildMatchedSeriesSQL() {}
func (s SelectorSourceGo) load() bool { return true }

func caller(selector SelectorSourceGo) {
	buildMatchedSeriesSQL()
	if selector.NeedTags {}
	selector.load()
	_ = SelectorSourceGo{NeedTags: true}
}
`);
	fs.writeFileSync(path.join(dir, "flags.go"), `package main

type csvList []string

func (c *csvList) String() string { return "" }
func (c *csvList) Set(value string) error { return nil }

func BuildRoutingPolicy() {}
func buildRoutingPolicyFallback() {}
func applyRoutingPolicy() {}
`);
	fs.writeFileSync(path.join(dir, "watcher.py"), `def load_state(path):
    return {}


def save_state(path, state):
    return None


def run_poll_cycle(config):
    state = load_state(config["state"])
    save_state(config["state"], state)
`);
	return dir;
}

function parseToolResult(result: any): any {
	return result.details;
}

async function withFakeGopls(repo: string, run: () => Promise<void>): Promise<void> {
	const binDir = path.join(repo, "bin");
	fs.mkdirSync(binDir);
	fs.writeFileSync(path.join(binDir, "gopls"), `#!/usr/bin/env sh
if [ "$1" = "references" ]; then
  echo "$PWD/selector.go:11:2-16"
  echo "$PWD/selector.go:6:32-36"
  exit 0
fi
echo "golang.org/x/tools/gopls v0.0.0-test"
`);
	fs.chmodSync(path.join(binDir, "gopls"), 0o755);
	const originalPath = process.env.PATH;
	process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ""}`;
	try {
		await run();
	} finally {
		process.env.PATH = originalPath;
	}
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

test("registered tool surface is Tree-sitter routing and orientation only", async () => {
	const tools = loadTools();
	assert.deepEqual([...tools.keys()].sort(), ["code_intel_file_outline", "code_intel_impact_map", "code_intel_local_map", "code_intel_repo_overview", "code_intel_state", "code_intel_syntax_search", "code_intel_test_map"]);
});

test("state reports Tree-sitter and rg without legacy artifact policy", async () => {
	const repo = fixtureRepo();
	const tools = loadTools();
	const { ctx, statuses } = mockContext(repo);
	const state = parseToolResult(await tools.get("code_intel_state")!.execute("test", { includeDiagnostics: true }, undefined, undefined, ctx));
	assert.equal(state.backends["tree-sitter"].available, "available");
	assert.equal(state.backends["tree-sitter"].indexStatus, "not-required");
	assert.equal(state.backends.rg.indexStatus, "not-required");
	assert.equal("sqryArtifactPolicy" in state, false);
	assert.equal("cymbal" in state.backends, false);
	assert.equal("sqry" in state.backends, false);
	assert.equal(state.languageServers.gopls.server, "gopls");
	assert.equal(state.languageServers["rust-analyzer"].server, "rust-analyzer");
	assert.equal(state.languageServers.typescript.server, "typescript");
	assert.equal(state.languageServers.typescript.available, "available");
	assert.equal(["tsserver", "typescript-language-server", "typescript-language-service"].includes(state.languageServers.typescript.details.command), true);
	assert.match(state.limitations.join("\n"), /availability-only/);
	assert.deepEqual(state.config, { maxResults: 125, queryTimeoutMs: 30000, maxOutputBytes: 5000000 });
	assert.equal(statuses.at(-1)?.key, "code-intel");
	assert.match(statuses.at(-1)?.value ?? "", /^ci\s+syn:ok/);
});

test("syntax search returns bounded Tree-sitter candidates", async () => {
	const repo = fixtureRepo();
	const tools = loadTools();
	const { ctx } = mockContext(repo);
	const payload = parseToolResult(await tools.get("code_intel_syntax_search")!.execute("test", { pattern: "authenticate($A)", language: "ts", paths: ["main.ts"], maxResults: 1 }, undefined, undefined, ctx));
	assert.equal(payload.ok, true);
	assert.equal(payload.backend, "tree-sitter");
	assert.equal("command" in payload, false);
	assert.equal(payload.matchCount, 2);
	assert.equal(payload.returned, 1);
	assert.equal(payload.truncated, true);
	assert.equal(payload.detail, "snippets");
	assert.equal(payload.summary.fileCount, 1);
	assert.equal(payload.summary.returnedFileCount, 1);
	assert.equal(payload.matches[0].file, "main.ts");
	assert.equal(payload.matches[0].line, 6);
	assert.equal(payload.matches[0].metaVariables.single.A, "token");

	const selected = parseToolResult(await tools.get("code_intel_syntax_search")!.execute("test", { pattern: "func _() { if $OBJ.NeedTags {} }", language: "go", selector: "selector_expression", paths: ["selector.go"], detail: "snippets" }, undefined, undefined, ctx));
	assert.equal(selected.ok, true);
	assert.equal(selected.selector, "selector_expression");
	assert.equal(selected.matchCount, 1);
	assert.equal(selected.matches[0].text, "selector.NeedTags");
	assert.equal(selected.matches[0].metaVariables.single.OBJ, "selector");

	const keyed = parseToolResult(await tools.get("code_intel_syntax_search")!.execute("test", { pattern: "SelectorSourceGo{NeedTags: $VALUE}", language: "go", selector: "keyed_element", paths: ["selector.go"], detail: "snippets" }, undefined, undefined, ctx));
	assert.equal(keyed.ok, true);
	assert.equal(keyed.matchCount, 1);
	assert.equal(keyed.matches[0].text, "NeedTags: true");
	assert.equal(keyed.matches[0].metaVariables.single.VALUE, "true");

	const rawQuery = parseToolResult(await tools.get("code_intel_syntax_search")!.execute("test", { pattern: "(call_expression (identifier) @fn)", language: "ts", selector: "fn", paths: ["main.ts"], maxResults: 3, detail: "snippets" }, undefined, undefined, ctx));
	assert.equal(rawQuery.ok, true);
	assert.equal(rawQuery.summary.basis, "treeSitterQueryCaptures");
	assert.equal(rawQuery.matches.some((match: any) => match.text === "authenticate"), true);

	const broadRawQuery = parseToolResult(await tools.get("code_intel_syntax_search")!.execute("test", { pattern: "(identifier) @id", language: "ts", paths: ["main.ts"], maxResults: 2, detail: "locations" }, undefined, undefined, ctx));
	assert.equal(broadRawQuery.ok, true);
	assert.equal(broadRawQuery.summary.basis, "treeSitterQueryCaptures");
	assert.equal(broadRawQuery.returned, 2);
	assert.equal(broadRawQuery.truncated, true);
	assert.equal(broadRawQuery.matchCount > broadRawQuery.returned, true);
	assert.equal(broadRawQuery.summary.fileCount, 1);
	assert.equal(broadRawQuery.summary.returnedFileCount, 1);
	assert.equal("text" in broadRawQuery.matches[0], false);
	assert.equal("metaVariables" in broadRawQuery.matches[0], false);
});

test("impact map includes current-source syntax candidates", async () => {
	const repo = fixtureRepo();
	const tools = loadTools();
	const { ctx } = mockContext(repo);
	const impact = parseToolResult(await tools.get("code_intel_impact_map")!.execute("test", { symbols: ["buildMatchedSeriesSQL", "NeedTags"], maxResults: 20, detail: "snippets" }, undefined, undefined, ctx));
	assert.equal(impact.ok, true);
	assert.equal(impact.backend, "tree-sitter");
	assert.deepEqual(impact.backends, ["tree-sitter"]);
	assert.equal(impact.summary.basis, "currentSourceSyntax");
	assert.equal(impact.roots.some((row: any) => row.name === "buildMatchedSeriesSQL" && typeof row.text === "string"), true);
	assert.equal(impact.related.some((row: any) => row.kind === "syntax_call" && row.text === "buildMatchedSeriesSQL()" && row.snippet === "\tbuildMatchedSeriesSQL()" && row.line === 9), true);
	assert.equal(impact.related.some((row: any) => row.kind === "syntax_selector" && row.text === "selector.NeedTags" && row.line === 10), true);
	assert.equal(impact.related.some((row: any) => row.kind === "syntax_keyed_field" && row.text === "NeedTags: true" && row.line === 12), true);
	assert.match(impact.coverage.limitations.join("\n"), /current-source syntax/);
});

test("impact map default location cap is closer to normal bounded search output", async () => {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-code-intel-wide-impact-"));
	execFileSync("git", ["init", "-q"], { cwd: repo });
	const callers = Array.from({ length: 40 }, (_, index) => `export function caller${index}() { return target() }`).join("\n");
	fs.writeFileSync(path.join(repo, "wide.ts"), `export function target() { return true }\n${callers}\n`);
	const tools = loadTools();
	const { ctx } = mockContext(repo);
	const impact = parseToolResult(await tools.get("code_intel_impact_map")!.execute("test", { symbols: ["target"] }, undefined, undefined, ctx));
	assert.equal(impact.detail, "locations");
	assert.equal(impact.related.length, 40);
	assert.equal(impact.coverage.truncated, false);
	assert.equal(impact.coverage.maxResults, 125);
});

test("impact map suppresses selector duplicates for method calls", async () => {
	const repo = fixtureRepo();
	const tools = loadTools();
	const { ctx } = mockContext(repo);
	const impact = parseToolResult(await tools.get("code_intel_impact_map")!.execute("test", { symbols: ["load"], maxResults: 20, detail: "snippets" }, undefined, undefined, ctx));
	assert.equal(impact.related.some((row: any) => row.kind === "syntax_call" && row.text === "selector.load()"), true);
	assert.equal(impact.related.some((row: any) => row.kind === "syntax_selector" && row.text === "selector.load"), false);
});

test("impact map supports Python changed-file routing", async () => {
	const repo = fixtureRepo();
	const tools = loadTools();
	const { ctx } = mockContext(repo);
	const impact = parseToolResult(await tools.get("code_intel_impact_map")!.execute("test", { changedFiles: ["watcher.py", "README.md"], maxRootSymbols: 3, maxResults: 10, detail: "snippets" }, undefined, undefined, ctx));
	assert.equal(impact.ok, true);
	assert.equal(impact.coverage.parsedByLanguage.python, 1);
	assert.equal(impact.coverage.nonSourceFiles.includes("README.md"), true);
	assert.deepEqual(impact.rootSymbols, ["load_state", "save_state", "run_poll_cycle"]);
	assert.equal(impact.related.some((row: any) => row.kind === "syntax_call" && row.text === "load_state(config[\"state\"])") , true);
});

test("impact map explains non-source changed files when no impact language files parse", async () => {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-code-intel-nonsource-"));
	execFileSync("git", ["init", "-q"], { cwd: repo });
	fs.writeFileSync(path.join(repo, "README.md"), "# docs\n");
	fs.writeFileSync(path.join(repo, "config.json"), "{}\n");
	const tools = loadTools();
	const { ctx } = mockContext(repo);
	const impact = parseToolResult(await tools.get("code_intel_impact_map")!.execute("test", { changedFiles: ["README.md", "config.json"], maxResults: 10 }, undefined, undefined, ctx));
	assert.equal(impact.ok, false);
	assert.match(impact.reason, /Supported impact languages/);
	assert.deepEqual(impact.coverage.nonSourceFiles, ["README.md", "config.json"]);
	assert.deepEqual(impact.coverage.supportedImpactLanguages, ["go", "typescript", "tsx", "javascript", "python", "cpp"]);
});

test("impact map optionally confirms Go references with gopls", async () => {
	const repo = fixtureRepo();
	await withFakeGopls(repo, async () => {
		const tools = loadTools();
		const { ctx } = mockContext(repo);
		const impact = parseToolResult(await tools.get("code_intel_impact_map")!.execute("test", { symbols: ["load"], confirmReferences: "gopls", maxReferenceRoots: 1, maxReferenceResults: 1, detail: "locations" }, undefined, undefined, ctx));
		assert.equal(impact.referenceConfirmation.backend, "gopls");
		assert.equal(impact.referenceConfirmation.basis, "lspExactReferences");
		assert.equal(impact.referenceConfirmation.ok, true);
		assert.equal(impact.referenceConfirmation.roots[0].position.startsWith("selector.go:6:"), true);
		assert.deepEqual(impact.referenceConfirmation.references, [{ file: "selector.go", line: 11, column: 2, endColumn: 16, rootSymbol: "load", evidence: "gopls:references" }]);
		assert.equal(impact.referenceConfirmation.coverage.truncated, true);
	});
});

test("impact map optionally confirms TypeScript references", async () => {
	const repo = fixtureRepo();
	const tools = loadTools();
	const { ctx } = mockContext(repo);
	const impact = parseToolResult(await tools.get("code_intel_impact_map")!.execute("test", { symbols: ["authenticate"], confirmReferences: "typescript", maxReferenceRoots: 1, maxReferenceResults: 4, detail: "locations" }, undefined, undefined, ctx));
	assert.equal(impact.referenceConfirmation.backend, "typescript");
	assert.equal(impact.referenceConfirmation.basis, "lspExactReferences");
	assert.equal(impact.referenceConfirmation.evidence, "typescript:references");
	assert.equal(impact.referenceConfirmation.ok, true);
	assert.equal(impact.referenceConfirmation.roots[0].position.startsWith("main.ts:1:"), true);
	assert.equal(impact.referenceConfirmation.references.some((row: any) => row.file === "main.ts" && row.line === 6 && row.evidence === "typescript:references"), true);
	assert.equal(impact.referenceConfirmation.references.some((row: any) => row.file === "main.test.ts"), true);
	assert.equal(impact.referenceConfirmation.references.some((row: any) => row.file === "main.ts" && row.line === 1 && row.isDefinition === true), false);
});

test("TypeScript confirmation uses the root file's nearest tsconfig", async () => {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-code-intel-tsconfig-"));
	execFileSync("git", ["init", "-q"], { cwd: repo });
	fs.mkdirSync(path.join(repo, "packages/app/lib"), { recursive: true });
	fs.writeFileSync(path.join(repo, "packages/app/tsconfig.json"), JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@lib/*": ["lib/*"] } }, include: ["**/*.ts"] }));
	fs.writeFileSync(path.join(repo, "packages/app/lib/auth.ts"), "export function authenticate(token: string): boolean { return token.length > 0 }\n");
	fs.writeFileSync(path.join(repo, "packages/app/main.ts"), "import { authenticate } from '@lib/auth'\nexport const ok = authenticate('token')\n");
	const tools = loadTools();
	const { ctx } = mockContext(repo);
	const impact = parseToolResult(await tools.get("code_intel_impact_map")!.execute("test", { symbols: ["authenticate"], confirmReferences: "typescript", maxReferenceRoots: 1, maxReferenceResults: 5, detail: "locations" }, undefined, undefined, ctx));
	assert.equal(impact.referenceConfirmation.ok, true);
	assert.equal(impact.referenceConfirmation.references.some((row: any) => row.file === "packages/app/main.ts" && row.line === 2 && row.evidence === "typescript:references"), true);
});

test("local map combines Tree-sitter and bounded rg evidence", { skip: !hasCommand("rg") }, async () => {
	const repo = fixtureRepo();
	const tools = loadTools();
	const { ctx } = mockContext(repo);
	const localMap = parseToolResult(await tools.get("code_intel_local_map")!.execute("test", { anchors: ["authenticate"], names: ["NeedTags"], paths: ["main.ts"], language: "ts", maxPerName: 3 }, undefined, undefined, ctx));
	assert.equal(localMap.ok, true);
	assert.deepEqual(localMap.backends, ["tree-sitter", "rg"]);
	assert.deepEqual(localMap.anchors, ["authenticate"]);
	assert.deepEqual(localMap.names, ["authenticate", "NeedTags"]);
	assert.equal(localMap.sections.treeSitterMaps.length, 1);
	assert.equal(localMap.sections.syntaxMatches.length, 2);
	assert.equal(localMap.coverage.syntaxSearches, 2);
	assert.equal(localMap.coverage.syntaxParsePasses, 1);
	assert.equal(localMap.sections.syntaxMatches.every((section: any) => section.coverage.batched === true), true);
	assert.equal(localMap.sections.syntaxMatches.every((section: any) => section.coverage.filesParsed === 1), true);
	assert.equal(localMap.sections.literalMatches.length, 2);
	assert.equal(localMap.sections.literalMatches.every((section: any) => section.command.command.endsWith("rg")), true);
	assert.equal(localMap.summary.suggestedFiles.some((file: any) => file.file === "main.ts"), true);
	assert.equal(localMap.detail, "locations");
});

test("local map ranks syntax-backed files above broad literal fallback", { skip: !hasCommand("rg") }, async () => {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-code-intel-local-ranking-"));
	execFileSync("git", ["init", "-q"], { cwd: repo });
	fs.mkdirSync(path.join(repo, "app"), { recursive: true });
	fs.mkdirSync(path.join(repo, "docs"), { recursive: true });
	fs.writeFileSync(path.join(repo, "app/workflow.ts"), `export function importantWorkflow(settings: { config: string }) {
  return settings.config
}
`);
	fs.writeFileSync(path.join(repo, "docs/noisy.txt"), Array.from({ length: 20 }, (_, index) => `config literal fallback ${index}`).join("\n"));
	const tools = loadTools();
	const { ctx } = mockContext(repo);
	const localMap = parseToolResult(await tools.get("code_intel_local_map")!.execute("test", { anchors: ["importantWorkflow"], names: ["config"], language: "ts", maxPerName: 20, maxResults: 5 }, undefined, undefined, ctx));
	assert.equal(localMap.ok, true);
	assert.equal(localMap.summary.basis, "weightedTreeSitterSyntaxThenLiteralFallback");
	assert.equal(localMap.summary.suggestedFiles[0].file, "app/workflow.ts");
	assert.equal(localMap.summary.suggestedFiles[0].primaryCount > 0, true);
	assert.equal(localMap.summary.literalFallbackFiles.some((file: any) => file.file === "docs/noisy.txt"), true);
	assert.equal(localMap.summary.suggestedFiles.findIndex((file: any) => file.file === "app/workflow.ts") < localMap.summary.suggestedFiles.findIndex((file: any) => file.file === "docs/noisy.txt"), true);
});

test("impact map ranks common interface method roots after domain functions", async () => {
	const repo = fixtureRepo();
	const tools = loadTools();
	const { ctx } = mockContext(repo);
	const impact = parseToolResult(await tools.get("code_intel_impact_map")!.execute("test", { changedFiles: ["flags.go"], maxRootSymbols: 3, maxResults: 5 }, undefined, undefined, ctx));
	assert.deepEqual(impact.rootSymbols, ["BuildRoutingPolicy", "buildRoutingPolicyFallback", "applyRoutingPolicy"]);
	assert.equal(impact.coverage.rootSymbolsDiscovered > impact.coverage.rootSymbolsUsed, true);
	assert.equal(impact.coverage.truncated, true);
});

test("impact map spreads changed-file root budget across files", async () => {
	const repo = fixtureRepo();
	const tools = loadTools();
	const { ctx } = mockContext(repo);
	const impact = parseToolResult(await tools.get("code_intel_impact_map")!.execute("test", { changedFiles: ["main.ts", "flags.go", "selector.go"], maxRootSymbols: 3, maxResults: 5 }, undefined, undefined, ctx));
	assert.deepEqual(impact.rootSymbols, ["authenticate", "BuildRoutingPolicy", "buildMatchedSeriesSQL"]);
	assert.deepEqual(impact.roots.map((root: any) => root.file), ["main.ts", "flags.go", "selector.go"]);
	assert.equal(impact.coverage.rootSymbolsDiscovered > impact.coverage.rootSymbolsUsed, true);
	assert.equal(impact.coverage.truncated, true);
});

test("impact map caps changed-file roots to higher-signal roots first", async () => {
	const repo = fixtureRepo();
	const tools = loadTools();
	const { ctx } = mockContext(repo);
	const capped = parseToolResult(await tools.get("code_intel_impact_map")!.execute("test", { changedFiles: ["main.ts"], maxRootSymbols: 2, maxResults: 5 }, undefined, undefined, ctx));
	assert.equal(capped.roots.length, 2);
	assert.deepEqual(capped.rootSymbols, ["authenticate", "loginHandler"]);
	assert.equal(capped.coverage.rootSymbolsDiscovered > capped.coverage.rootSymbolsUsed, true);
	assert.equal(capped.coverage.truncated, true);
	assert.equal("file" in capped.roots[0], true);
	assert.equal("text" in capped.roots[0], false);
	assert.equal("snippet" in capped.roots[0], false);
	assert.equal(typeof capped.summary.relatedFileCount, "number");
	assert.equal(capped.detail, "locations");
	if (capped.related.length > 0) {
		assert.equal("context" in capped.related[0], false);
		assert.equal("text" in capped.related[0], false);
		assert.equal("snippet" in capped.related[0], false);
	}

	const broad = parseToolResult(await tools.get("code_intel_impact_map")!.execute("test", { changedFiles: ["main.test.ts", "main.ts"], maxRootSymbols: 10, maxResults: 5 }, undefined, undefined, ctx));
	assert.deepEqual(broad.rootSymbols.slice(0, 2), ["authenticate", "loginHandler"]);
	assert.equal(broad.rootSymbols.indexOf("testHelper") > broad.rootSymbols.indexOf("needsTags"), true);
	assert.equal(broad.rootSymbols.includes("on"), false);
});

test("usage tracking records sanitized code-intel metadata", async () => {
	const repo = fixtureRepo();
	const { tools, handlers } = loadExtension();
	const { ctx } = mockContext(repo);
	fs.rmSync(process.env.PI_CODE_INTEL_USAGE_LOG as string, { force: true });
	const input = { pattern: "authenticate($A)", language: "ts", maxResults: 1 };
	const callEvent = { toolName: "code_intel_syntax_search", toolCallId: "usage-test", input };
	for (const handler of handlers.get("tool_call") ?? []) await handler(callEvent, ctx);
	const result = await tools.get("code_intel_syntax_search")!.execute("usage-test", input, undefined, undefined, ctx);
	const resultEvent = { toolName: "code_intel_syntax_search", toolCallId: "usage-test", input, details: result.details, content: result.content, isError: false };
	for (const handler of handlers.get("tool_result") ?? []) await handler(resultEvent, ctx);

	const impactInput = { symbols: ["sensitiveSymbolName"], confirmReferences: "typescript", maxReferenceRoots: 2, maxReferenceResults: 5, includeReferenceDeclarations: true };
	const impactCallEvent = { toolName: "code_intel_impact_map", toolCallId: "usage-impact-test", input: impactInput };
	for (const handler of handlers.get("tool_call") ?? []) await handler(impactCallEvent, ctx);
	const impactResultEvent = { toolName: "code_intel_impact_map", toolCallId: "usage-impact-test", input: impactInput, details: { ok: true, rootSymbols: ["sensitiveSymbolName"], related: [], coverage: { truncated: false } }, isError: false };
	for (const handler of handlers.get("tool_result") ?? []) await handler(impactResultEvent, ctx);

	const usageLog = fs.readFileSync(process.env.PI_CODE_INTEL_USAGE_LOG as string, "utf-8");
	assert.match(usageLog, /code_intel_syntax_search/);
	assert.match(usageLog, /patternLength/);
	assert.match(usageLog, /confirmReferences/);
	assert.match(usageLog, /typescript/);
	assert.match(usageLog, /maxReferenceRoots/);
	assert.doesNotMatch(usageLog, /authenticate\(\$A\)/);
	assert.doesNotMatch(usageLog, /sensitiveSymbolName/);
});

test("custom render cards keep code-intel results compact", async () => {
	const { tools } = loadExtension();
	const impact = tools.get("code_intel_impact_map")!;
	const details = {
		ok: true,
		rootSymbols: ["veryImportantSymbol"],
		related: [
			{ file: "src/very/long/path/that/should/still/be/compact/file-one.ts", line: 10, reason: "call expression with callee name veryImportantSymbol", context: ["a", "b", "c"] },
			{ file: "src/file-two.ts", line: 20, reason: "selector/member expression with field/property name veryImportantSymbol", context: ["d", "e", "f"] },
		],
		coverage: { truncated: false },
		summary: { relatedFileCount: 2, topRelatedFiles: [{ file: "src/very/long/path/that/should/still/be/compact/file-one.ts", count: 1 }, { file: "src/file-two.ts", count: 1 }] },
	};
	const collapsed = renderText(impact.renderResult({ details }, { expanded: false, isPartial: false }, renderTheme, {}));
	assert.match(collapsed, /impact map/);
	assert.match(collapsed, /related 2/);
	assert.doesNotMatch(collapsed, /call expression/);
	assert.ok(collapsed.split("\n").length <= 2);

	const expanded = renderText(impact.renderResult({ details }, { expanded: true, isPartial: false }, renderTheme, {}));
	assert.match(expanded, /file-one\.ts:10/);
	assert.match(expanded, /file-two\.ts:20/);
	assert.ok(expanded.length < 800);

	const failed = renderText(impact.renderResult({ details: { ok: false, roots: [], related: [], reason: "No supported current-source files were parsed for Tree-sitter impact mapping.", coverage: { nonSourceFiles: ["README.md"] }, summary: {} } }, { expanded: false, isPartial: false }, renderTheme, {}));
	assert.match(failed, /No supported current-source files/);
});
