import { execFileSync } from "node:child_process";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { hasCommand, loadTools, mockContext, parseToolResult } from "./test-harness.ts";

function fixtureRepo(): string {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-code-intel-local-languages-"));
	execFileSync("git", ["init", "-q"], { cwd: repo });
	fs.mkdirSync(path.join(repo, "docs"), { recursive: true });
	fs.writeFileSync(path.join(repo, "Service.cs"), `public class Service
{
    public bool NeedTags { get; init; }
    public bool Authenticate(string token)
    {
        return token.Length > 0;
    }
}

public class Consumer
{
    public bool Run(Service service)
    {
        return service.NeedTags && service.Authenticate("ok");
    }
}
`);
	fs.writeFileSync(path.join(repo, "workflow.py"), `class Worker:
    def __init__(self):
        self.state_path = "state.json"

    def run_poll_cycle(self):
        return self.state_path
`);
	fs.writeFileSync(path.join(repo, "helper.zsh"), `function prompt_main {
  compinit
}
`);
	fs.writeFileSync(path.join(repo, "engine.cpp"), `class Engine {
public:
  bool Ready;
  bool run();
};

bool call(Engine& engine) {
  return engine.Ready && engine.run();
}
`);
	fs.writeFileSync(path.join(repo, "docs", "guide.md"), `# Guide

## Install Steps

See [Usage](#usage) and the [API](api.md#authenticate).

\`\`\`ts
authenticate("token")
\`\`\`

## Usage

NeedTags controls routing.
`);
	return repo;
}

async function localMap(repo: string, params: Record<string, unknown>): Promise<any> {
	const tools = loadTools();
	return parseToolResult(await tools.get("code_intel_local_map")!.execute("local", params, undefined, undefined, mockContext(repo).ctx));
}

test("local map resolves C#, Python, zsh, and C++ language aliases", { skip: !hasCommand("rg") }, async () => {
	const repo = fixtureRepo();
	try {
		const csharp = await localMap(repo, { anchors: ["Authenticate"], names: ["NeedTags"], language: "c#", paths: ["Service.cs"], maxPerName: 5, detail: "snippets" });
		assert.equal(csharp.ok, true);
		assert.equal(csharp.language, "csharp");
		assert.equal(csharp.coverage.languageResolvedFrom, "c#");
		assert.equal(csharp.coverage.syntaxParsePasses, 1);
		assert.equal(csharp.summary.suggestedFiles.some((file: any) => file.file === "Service.cs" && file.primaryCount > 0), true);

		const python = await localMap(repo, { anchors: ["run_poll_cycle"], names: ["state_path"], language: "py", paths: ["workflow.py"], maxPerName: 5, detail: "snippets" });
		assert.equal(python.ok, true);
		assert.equal(python.language, "python");
		assert.equal(python.coverage.languageResolvedFrom, "py");
		assert.equal(python.summary.suggestedFiles.some((file: any) => file.file === "workflow.py" && file.primaryCount > 0), true);

		const zsh = await localMap(repo, { anchors: ["prompt_main"], names: ["compinit"], language: "zsh", paths: ["helper.zsh"], maxPerName: 5, detail: "snippets" });
		assert.equal(zsh.ok, true);
		assert.equal(zsh.language, "zsh");
		assert.equal(zsh.coverage.syntaxParsePasses, 1);
		assert.equal(zsh.summary.suggestedFiles.some((file: any) => file.file === "helper.zsh" && file.primaryCount > 0), true);

		const cpp = await localMap(repo, { anchors: ["run"], names: ["Ready"], language: "c++", paths: ["engine.cpp"], maxPerName: 5, detail: "snippets" });
		assert.equal(cpp.ok, true);
		assert.equal(cpp.language, "cpp");
		assert.equal(cpp.coverage.languageResolvedFrom, "c++");
		assert.equal(cpp.summary.suggestedFiles.some((file: any) => file.file === "engine.cpp" && file.primaryCount > 0), true);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("local map uses Markdown headings, slugs, links, and code fence metadata", { skip: !hasCommand("rg") }, async () => {
	const repo = fixtureRepo();
	try {
		const markdown = await localMap(repo, { anchors: ["Install Steps"], names: ["api.md#authenticate", "ts", "NeedTags"], language: "markdown", paths: ["docs"], maxPerName: 5, detail: "snippets" });
		assert.equal(markdown.ok, true);
		assert.equal(markdown.language, "markdown");
		assert.equal(markdown.coverage.includeSyntax, false);
		assert.equal(markdown.coverage.markdownSearches, 4);
		assert.equal(markdown.sections.markdownMatches.some((section: any) => section.matchCount > 0), true);
		assert.equal(markdown.summary.suggestedFiles.some((file: any) => file.file === "docs/guide.md" && file.primaryCount > 0), true);
		const docMatches = markdown.sections.markdownMatches.flatMap((section: any) => section.matches);
		assert.equal(docMatches.some((row: any) => row.kind === "markdown_section" && row.name === "Install Steps"), true);
		assert.equal(docMatches.some((row: any) => row.kind === "syntax_selector" && row.name === "api.md#authenticate"), true);
		assert.equal(docMatches.some((row: any) => row.kind === "code_fence" && row.name === "ts"), true);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});
