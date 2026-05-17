import { execFileSync } from "node:child_process";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { loadTools, mockContext, parseToolResult } from "./test-harness.ts";

function fixtureRepo(): string {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-code-intel-test-map-languages-"));
	execFileSync("git", ["init", "-q"], { cwd: repo });
	fs.mkdirSync(path.join(repo, "src"), { recursive: true });
	fs.mkdirSync(path.join(repo, "scripts"), { recursive: true });
	fs.mkdirSync(path.join(repo, "docs"), { recursive: true });
	fs.mkdirSync(path.join(repo, "tests"), { recursive: true });

	fs.writeFileSync(path.join(repo, "src", "AuthService.cs"), `public class AuthService
{
    public bool Authenticate(string token) => token.Length > 0;
}
`);
	fs.writeFileSync(path.join(repo, "tests", "AuthServiceTests.cs"), `using Xunit;

public class AuthServiceTests
{
    [Fact]
    public void Authenticate_accepts_token()
    {
        Assert.True(new AuthService().Authenticate("token"));
    }
}
`);

	fs.writeFileSync(path.join(repo, "scripts", "deploy.sh"), `deploy() {
  echo deploy
}
`);
	fs.writeFileSync(path.join(repo, "tests", "deploy.bats"), `#!/usr/bin/env bats
@test "deploy succeeds" {
  run scripts/deploy.sh
  assert_success
}
`);

	fs.writeFileSync(path.join(repo, "src", "workflow.py"), `def run_poll_cycle(config):
    return config
`);
	fs.writeFileSync(path.join(repo, "tests", "test_workflow.py"), `import pytest
from src.workflow import run_poll_cycle

def test_run_poll_cycle():
    assert run_poll_cycle({}) == {}
`);

	fs.writeFileSync(path.join(repo, "src", "lib.rs"), `pub fn run_poll_cycle() -> bool { true }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_poll_cycle_returns_true() {
        assert!(run_poll_cycle());
    }
}
`);
	fs.writeFileSync(path.join(repo, "tests", "integration.rs"), `use app::run_poll_cycle;

#[test]
fn integration_run_poll_cycle() {
    assert!(run_poll_cycle());
}
`);

	fs.writeFileSync(path.join(repo, "src", "engine.cpp"), `bool BuildRoutingPolicy() { return true; }
`);
	fs.writeFileSync(path.join(repo, "tests", "engine_test.cpp"), `#include <gtest/gtest.h>

TEST(EngineTest, BuildRoutingPolicy) {
    EXPECT_TRUE(BuildRoutingPolicy());
}
`);

	fs.writeFileSync(path.join(repo, "docs", "guide.md"), `# Guide

See [API](api.md#authenticate).
`);
	fs.writeFileSync(path.join(repo, "tests", "docs-link-check.test.ts"), `import { describe, it } from "vitest";

describe("docs link check", () => {
  it("checks guide api.md#authenticate links with markdown-link-check", () => true);
});
`);
	fs.writeFileSync(path.join(repo, ".markdown-link-check.json"), JSON.stringify({ replacementPatterns: [{ pattern: "api.md#authenticate", replacement: "api.md#authenticate" }] }, null, 2));
	return repo;
}

async function testMap(repo: string, params: Record<string, unknown>): Promise<any> {
	const tools = loadTools();
	return parseToolResult(await tools.get("code_intel_test_map")!.execute("test-map", { maxResults: 10, ...params }, undefined, undefined, mockContext(repo).ctx));
}

test("test map routes C# source to xUnit-style tests", async () => {
	const repo = fixtureRepo();
	try {
		const result = await testMap(repo, { path: "src/AuthService.cs", symbols: ["Authenticate"] });
		assert.equal(result.ok, true);
		const candidate = result.candidates.find((row: any) => row.file === "tests/AuthServiceTests.cs");
		assert.ok(candidate);
		assert.equal(candidate.evidence.some((row: any) => row.kind === "language_test_pattern" && row.term === "csharp"), true);
		assert.equal(candidate.evidence.some((row: any) => row.kind === "literal_match" && row.term === "Authenticate"), true);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("test map routes shell scripts to Bats/ShellSpec-style tests", async () => {
	const repo = fixtureRepo();
	try {
		const result = await testMap(repo, { path: "scripts/deploy.sh", symbols: ["deploy"] });
		const candidate = result.candidates.find((row: any) => row.file === "tests/deploy.bats");
		assert.ok(candidate);
		assert.equal(candidate.evidence.some((row: any) => row.kind === "language_test_pattern" && row.term === "bash"), true);
		assert.equal(candidate.evidence.some((row: any) => row.kind === "literal_match" && row.term === "deploy"), true);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("test map routes Python modules to pytest/unittest-style tests", async () => {
	const repo = fixtureRepo();
	try {
		const result = await testMap(repo, { path: "src/workflow.py", symbols: ["run_poll_cycle"] });
		const candidate = result.candidates.find((row: any) => row.file === "tests/test_workflow.py");
		assert.ok(candidate);
		assert.equal(candidate.evidence.some((row: any) => row.kind === "language_test_pattern" && row.term === "python"), true);
		assert.equal(candidate.evidence.some((row: any) => row.kind === "literal_match" && row.term === "run_poll_cycle"), true);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("test map routes Rust modules to integration and inline test evidence", async () => {
	const repo = fixtureRepo();
	try {
		const result = await testMap(repo, { path: "src/lib.rs", symbols: ["run_poll_cycle"] });
		assert.equal(result.candidates.some((row: any) => row.file === "tests/integration.rs" && row.evidence.some((evidence: any) => evidence.kind === "literal_match" && evidence.term === "run_poll_cycle")), true);
		assert.equal(result.candidates.some((row: any) => row.file === "src/lib.rs" && row.evidence.some((evidence: any) => evidence.kind === "literal_match" && evidence.term === "run_poll_cycle")), true);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("test map routes C++ source to gtest/Catch2/doctest-style tests", async () => {
	const repo = fixtureRepo();
	try {
		const result = await testMap(repo, { path: "src/engine.cpp", symbols: ["BuildRoutingPolicy"] });
		const candidate = result.candidates.find((row: any) => row.file === "tests/engine_test.cpp");
		assert.ok(candidate);
		assert.equal(candidate.evidence.some((row: any) => row.kind === "language_test_pattern" && row.term === "cpp"), true);
		assert.equal(candidate.evidence.some((row: any) => row.kind === "literal_match" && row.term === "BuildRoutingPolicy"), true);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("test map routes Markdown docs to docs/link-check tests and config", async () => {
	const repo = fixtureRepo();
	try {
		const result = await testMap(repo, { path: "docs/guide.md", names: ["api.md#authenticate", "markdown-link-check"] });
		assert.equal(result.candidates.some((row: any) => row.file === "tests/docs-link-check.test.ts"), true);
		assert.equal(result.candidates.some((row: any) => row.file === ".markdown-link-check.json"), true);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});
