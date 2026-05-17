import { execFileSync } from "node:child_process";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { loadTools, mockContext, parseToolResult } from "./test-harness.ts";

function csharpRepo(): string {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-code-intel-csharp-"));
	execFileSync("git", ["init", "-q"], { cwd: repo });
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
