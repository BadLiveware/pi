import { execFileSync } from "node:child_process";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { collectTouchedDiagnostics } from "../src/slices/post-edit-map/diagnostics.ts";
import { DEFAULT_CONFIG } from "../src/types.ts";
import { loadTools, mockContext, parseToolResult } from "./test-harness.ts";

function csharpRepo(): string {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-code-intel-csharp-"));
	execFileSync("git", ["init", "-q"], { cwd: repo });
	fs.writeFileSync(path.join(repo, "Demo.csproj"), `<Project Sdk="Microsoft.NET.Sdk">
</Project>
`);
	fs.writeFileSync(path.join(repo, "AuthService.cs"), `using System;
global using System.Collections.Generic;

namespace Demo.App;

public interface IService { bool Authenticate(string token); }
public record UserRecord(string Name);
public enum Mode { Ready, Done }

public class AuthService : IService
{
    private readonly string secret = "x";
    public bool NeedTags { get; init; }
    public event EventHandler? Changed;

    public AuthService(string secret) { this.secret = secret; }

    public bool Authenticate(string token)
    {
        return token == secret;
    }
}

public static class Runner
{
    public static bool Run(IService service)
    {
        var ok = service.Authenticate("x");
        var model = new AuthService("x") { NeedTags = true };
        return ok && model.NeedTags;
    }
}
`);
	return repo;
}

async function withPath(pathValue: string, run: () => Promise<void>): Promise<void> {
	const originalPath = process.env.PATH;
	process.env.PATH = pathValue;
	try {
		await run();
	} finally {
		process.env.PATH = originalPath;
	}
}

function writeFakeCSharpLs(file: string): void {
	fs.writeFileSync(file, `#!/usr/bin/env node
if (process.argv.includes("--version")) {
  console.log("fake csharp-ls 1.0");
  process.exit(0);
}
let buffer = Buffer.alloc(0);
function write(message) {
  const body = JSON.stringify(message);
  process.stdout.write("Content-Length: " + Buffer.byteLength(body, "utf-8") + "\\r\\n\\r\\n" + body);
}
function parse() {
  while (true) {
    const headerEnd = buffer.indexOf("\\r\\n\\r\\n");
    if (headerEnd < 0) return;
    const header = buffer.subarray(0, headerEnd).toString("utf-8");
    const match = /Content-Length:\\s*(\\d+)/i.exec(header);
    if (!match) { buffer = buffer.subarray(headerEnd + 4); continue; }
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + Number(match[1]);
    if (buffer.length < bodyEnd) return;
    const message = JSON.parse(buffer.subarray(bodyStart, bodyEnd).toString("utf-8"));
    buffer = buffer.subarray(bodyEnd);
    handle(message);
  }
}
function handle(message) {
  if (message.method === "initialize") write({ jsonrpc: "2.0", id: message.id, result: { capabilities: {} } });
  else if (message.method === "textDocument/didOpen") {
    const uri = message.params?.textDocument?.uri;
    write({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri, diagnostics: [{ range: { start: { line: 17, character: 15 }, end: { line: 17, character: 21 } }, severity: 1, source: "csharp-ls", code: "CS0103", message: "The name 'secret' does not exist in the current context" }] } });
  } else if (message.method === "textDocument/references") {
    const uri = message.params?.textDocument?.uri;
    write({ jsonrpc: "2.0", id: message.id, result: [{ uri, range: { start: { line: 25, character: 25 }, end: { line: 25, character: 37 } } }] });
  } else if (message.method === "shutdown") write({ jsonrpc: "2.0", id: message.id, result: null });
  else if (message.method === "exit") process.exit(0);
}
process.stdin.on("data", (chunk) => { buffer = Buffer.concat([buffer, chunk]); parse(); });
`);
	fs.chmodSync(file, 0o755);
}

test("C# file outline reports using directives, declarations, members, and enum values", async () => {
	const repo = csharpRepo();
	try {
		const tools = loadTools();
		const outline = parseToolResult(await tools.get("code_intel_file_outline")!.execute("outline", { path: "AuthService.cs", maxSymbols: 80, detail: "snippets" }, undefined, undefined, mockContext(repo).ctx));
		assert.equal(outline.ok, true);
		assert.equal(outline.language, "csharp");
		assert.deepEqual(outline.imports, ["System", "System.Collections.Generic"]);
		assert.equal(outline.declarations.some((row: any) => row.kind === "file_scoped_namespace_declaration" && row.name === "Demo.App"), true);
		assert.equal(outline.declarations.some((row: any) => row.kind === "interface_declaration" && row.name === "IService"), true);
		assert.equal(outline.declarations.some((row: any) => row.kind === "record_declaration" && row.name === "UserRecord"), true);
		assert.equal(outline.declarations.some((row: any) => row.kind === "class_declaration" && row.name === "AuthService" && row.exported === true), true);
		assert.equal(outline.declarations.some((row: any) => row.kind === "constructor_declaration" && row.name === "AuthService" && row.owner === "AuthService"), true);
		assert.equal(outline.declarations.some((row: any) => row.kind === "method_declaration" && row.name === "Authenticate" && row.owner === "AuthService"), true);
		assert.equal(outline.declarations.some((row: any) => row.kind === "property_declaration" && row.name === "NeedTags" && row.owner === "AuthService"), true);
		assert.equal(outline.declarations.some((row: any) => row.kind === "field_declaration" && row.name === "secret" && row.owner === "AuthService"), true);
		assert.equal(outline.declarations.some((row: any) => row.kind === "event_declaration" && row.name === "Changed" && row.owner === "AuthService"), true);
		assert.equal(outline.declarations.some((row: any) => row.kind === "enum_member_declaration" && row.name === "Ready" && row.owner === "Mode"), true);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("C# read_symbol returns complete methods and properties", async () => {
	const repo = csharpRepo();
	try {
		const tools = loadTools();
		const ctx = mockContext(repo).ctx;
		const outline = parseToolResult(await tools.get("code_intel_file_outline")!.execute("outline", { path: "AuthService.cs", maxSymbols: 80 }, undefined, undefined, ctx));
		const authenticate = outline.declarations.find((row: any) => row.name === "Authenticate" && row.owner === "AuthService").symbolTarget;
		const method = parseToolResult(await tools.get("code_intel_read_symbol")!.execute("read", { target: authenticate }, undefined, undefined, ctx));
		assert.equal(method.ok, true);
		assert.match(method.targetSegment.source, /public bool Authenticate/);
		assert.match(method.targetSegment.source, /return token == secret/);

		const needTags = outline.declarations.find((row: any) => row.name === "NeedTags").symbolTarget;
		const property = parseToolResult(await tools.get("code_intel_read_symbol")!.execute("read", { target: needTags }, undefined, undefined, ctx));
		assert.equal(property.ok, true);
		assert.match(property.targetSegment.source, /public bool NeedTags \{ get; init; \}/);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("C# impact map optionally confirms references with csharp-ls", async () => {
	const repo = csharpRepo();
	try {
		const binDir = path.join(repo, "bin");
		fs.mkdirSync(binDir);
		writeFakeCSharpLs(path.join(binDir, "csharp-ls"));
		await withPath(`${binDir}${path.delimiter}${process.env.PATH ?? ""}`, async () => {
			const tools = loadTools();
			const impact = parseToolResult(await tools.get("code_intel_impact_map")!.execute("impact", { symbols: ["Authenticate"], confirmReferences: "csharp-ls", maxReferenceRoots: 1, maxReferenceResults: 5, detail: "locations" }, undefined, undefined, mockContext(repo).ctx));
			assert.equal(impact.referenceConfirmation.backend, "csharp-ls");
			assert.equal(impact.referenceConfirmation.ok, true);
			assert.equal(impact.referenceConfirmation.references.some((row: any) => row.file === "AuthService.cs" && row.rootSymbol === "Authenticate" && row.evidence === "csharp-ls:textDocument/references"), true);
		});
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("C# post-edit diagnostics collect csharp-ls publishDiagnostics rows", async () => {
	const repo = csharpRepo();
	try {
		const binDir = path.join(repo, "bin");
		fs.mkdirSync(binDir);
		writeFakeCSharpLs(path.join(binDir, "csharp-ls"));
		await withPath(`${binDir}${path.delimiter}${process.env.PATH ?? ""}`, async () => {
			const result = await collectTouchedDiagnostics(repo, ["AuthService.cs"], DEFAULT_CONFIG);
			assert.equal(result.diagnostics.some((row) => row.path === "AuthService.cs" && row.line === 18 && row.column === 16 && row.severity === "error" && row.source === "csharp-ls" && row.code === "CS0103"), true);
			assert.equal(result.providerStatuses.some((row) => row.provider === "csharp-ls" && row.available === "available" && row.fileCount === 1 && row.diagnosticCount === 1), true);
		});
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("C# post-edit diagnostics report missing csharp-ls without failing collection", async () => {
	const repo = csharpRepo();
	try {
		const emptyBin = path.join(repo, "empty-bin");
		fs.mkdirSync(emptyBin);
		await withPath(emptyBin, async () => {
			const result = await collectTouchedDiagnostics(repo, ["AuthService.cs"], DEFAULT_CONFIG);
			assert.equal(result.diagnostics.length, 0);
			const status = result.providerStatuses.find((row) => row.provider === "csharp-ls");
			assert.equal(status?.available, "missing");
			assert.match(String(status?.diagnostic ?? ""), /csharp-ls not found/);
		});
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("C# impact routes changed-file roots, invocations, member access, and initializers", async () => {
	const repo = csharpRepo();
	try {
		const tools = loadTools();
		const ctx = mockContext(repo).ctx;
		const changed = parseToolResult(await tools.get("code_intel_impact_map")!.execute("impact", { changedFiles: ["AuthService.cs"], maxRootSymbols: 8, maxResults: 20, detail: "snippets" }, undefined, undefined, ctx));
		assert.equal(changed.ok, true);
		assert.equal(changed.coverage.supportedImpactFiles.some((row: any) => row.file === "AuthService.cs" && row.languages.includes("csharp")), true);
		assert.equal(changed.rootSymbols.includes("AuthService"), true);

		const method = parseToolResult(await tools.get("code_intel_impact_map")!.execute("impact", { symbols: ["Authenticate"], maxResults: 20, detail: "snippets" }, undefined, undefined, ctx));
		assert.equal(method.related.some((row: any) => row.kind === "syntax_call" && row.text === "service.Authenticate(\"x\")"), true);
		assert.equal(method.related.some((row: any) => row.kind === "syntax_selector" && row.text === "service.Authenticate"), false);

		const property = parseToolResult(await tools.get("code_intel_impact_map")!.execute("impact", { symbols: ["NeedTags"], maxResults: 20, detail: "snippets" }, undefined, undefined, ctx));
		assert.equal(property.related.some((row: any) => row.kind === "syntax_keyed_field" && row.text === "NeedTags = true"), true);
		assert.equal(property.related.some((row: any) => row.kind === "syntax_selector" && row.text === "model.NeedTags"), true);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});
