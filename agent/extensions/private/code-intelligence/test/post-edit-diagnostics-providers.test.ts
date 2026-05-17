import { execFileSync } from "node:child_process";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { DEFAULT_CONFIG } from "../src/types.ts";
import { collectTouchedDiagnostics } from "../src/slices/post-edit-map/diagnostics.ts";

function fixtureRepo(): string {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-code-intel-diagnostics-providers-"));
	execFileSync("git", ["init", "-q"], { cwd: repo });
	fs.writeFileSync(path.join(repo, "bad.go"), `package main

func main() {
	Missing()
	shadow := 1
	_ = shadow
}
`);
	fs.writeFileSync(path.join(repo, "clean.go"), `package main

func clean() {}
`);
	fs.writeFileSync(path.join(repo, "bad.sh"), `#!/usr/bin/env bash
echo $name
`);
	fs.writeFileSync(path.join(repo, "bad.zsh"), `if true; then
  echo ok
fi)
`);
	fs.writeFileSync(path.join(repo, "README.md"), `not a heading
`);
	return repo;
}

function writeExecutable(file: string, content: string): void {
	fs.writeFileSync(file, content);
	fs.chmodSync(file, 0o755);
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

test("post-edit diagnostics collect gopls check rows for touched Go files", async () => {
	const repo = fixtureRepo();
	try {
		const binDir = path.join(repo, "bin");
		fs.mkdirSync(binDir);
		writeExecutable(path.join(binDir, "gopls"), `#!/usr/bin/env sh
if [ "$1" = "check" ] && [ "$(basename "$2")" = "bad.go" ]; then
  echo "$PWD/bad.go:4:2: undefined: Missing"
  echo "$PWD/bad.go:5:2: warning: shadow declaration"
fi
exit 0
`);
		await withPath(`${binDir}${path.delimiter}${process.env.PATH ?? ""}`, async () => {
			const result = await collectTouchedDiagnostics(repo, ["bad.go", "clean.go"], DEFAULT_CONFIG);
			assert.equal(result.diagnostics.length, 2);
			assert.equal(result.diagnostics.some((row) => row.path === "bad.go" && row.line === 4 && row.column === 2 && row.severity === "error" && row.source === "gopls" && /Missing/.test(row.message ?? "")), true);
			assert.equal(result.diagnostics.some((row) => row.path === "bad.go" && row.line === 5 && row.column === 2 && row.severity === "warning" && /shadow/.test(row.message ?? "")), true);
			assert.equal(result.diagnostics.every((row) => row.baselineStatus === "not-compared" && row.provenance === "collected"), true);
			assert.equal(result.providerStatuses.some((row) => row.provider === "gopls" && row.available === "available" && row.fileCount === 2 && row.diagnosticCount === 2), true);
		});
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("post-edit diagnostics collect shellcheck, zsh, and markdownlint rows", async () => {
	const repo = fixtureRepo();
	try {
		const binDir = path.join(repo, "bin");
		fs.mkdirSync(binDir);
		writeExecutable(path.join(binDir, "shellcheck"), `#!/usr/bin/env sh
cat <<'JSON'
{"comments":[{"file":"bad.sh","line":2,"endLine":2,"column":6,"endColumn":11,"level":"warning","code":2086,"message":"Double quote to prevent globbing and word splitting."}]}
JSON
exit 1
`);
		writeExecutable(path.join(binDir, "zsh"), `#!/usr/bin/env sh
if [ "$1" = "-n" ]; then
  echo "$2:3: parse error near 'fi'" >&2
  exit 1
fi
echo "zsh 5.9"
exit 0
`);
		writeExecutable(path.join(binDir, "markdownlint-cli2"), `#!/usr/bin/env sh
cat <<'JSON'
{"README.md":[{"lineNumber":1,"ruleNames":["MD041","first-line-heading"],"ruleDescription":"First line in a file should be a top-level heading","errorDetail":"Expected: # Title","errorRange":[1,6]}]}
JSON
exit 1
`);
		await withPath(`${binDir}${path.delimiter}${process.env.PATH ?? ""}`, async () => {
			const result = await collectTouchedDiagnostics(repo, ["bad.sh", "bad.zsh", "README.md"], DEFAULT_CONFIG);
			assert.equal(result.diagnostics.length, 3);
			assert.equal(result.diagnostics.some((row) => row.path === "bad.sh" && row.line === 2 && row.column === 6 && row.severity === "warning" && row.source === "shellcheck" && row.code === "SC2086"), true);
			assert.equal(result.diagnostics.some((row) => row.path === "bad.zsh" && row.line === 3 && row.severity === "error" && row.source === "zsh -n" && /parse error/.test(row.message ?? "")), true);
			assert.equal(result.diagnostics.some((row) => row.path === "README.md" && row.line === 1 && row.severity === "warning" && row.source === "markdownlint-cli2" && row.code === "MD041"), true);
			assert.equal(result.providerStatuses.some((row) => row.provider === "shellcheck" && row.available === "available" && row.fileCount === 1 && row.diagnosticCount === 1), true);
			assert.equal(result.providerStatuses.some((row) => row.provider === "zsh" && row.available === "available" && row.fileCount === 1 && row.diagnosticCount === 1), true);
			assert.equal(result.providerStatuses.some((row) => row.provider === "markdownlint-cli2" && row.available === "available" && row.fileCount === 1 && row.diagnosticCount === 1), true);
			assert.equal(result.diagnostics.every((row) => row.baselineStatus === "not-compared" && row.provenance === "collected"), true);
		});
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("post-edit diagnostics report missing shell and markdown tools without failing collection", async () => {
	const repo = fixtureRepo();
	try {
		const emptyBin = path.join(repo, "empty-bin");
		fs.mkdirSync(emptyBin);
		await withPath(emptyBin, async () => {
			const result = await collectTouchedDiagnostics(repo, ["bad.sh", "bad.zsh", "README.md"], DEFAULT_CONFIG);
			assert.equal(result.diagnostics.length, 0);
			for (const provider of ["shellcheck", "zsh", "markdownlint-cli2"]) {
				const status = result.providerStatuses.find((row) => row.provider === provider);
				assert.equal(status?.available, "missing");
				assert.match(String(status?.diagnostic ?? ""), /not found/);
			}
		});
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("post-edit diagnostics report missing gopls without failing collection", async () => {
	const repo = fixtureRepo();
	try {
		const emptyBin = path.join(repo, "empty-bin");
		fs.mkdirSync(emptyBin);
		await withPath(emptyBin, async () => {
			const result = await collectTouchedDiagnostics(repo, ["bad.go"], DEFAULT_CONFIG);
			assert.equal(result.diagnostics.length, 0);
			const status = result.providerStatuses.find((row) => row.provider === "gopls");
			assert.equal(status?.available, "missing");
			assert.match(String(status?.diagnostic ?? ""), /gopls not found/);
		});
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});
