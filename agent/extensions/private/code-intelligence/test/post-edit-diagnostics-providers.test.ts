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

test("post-edit diagnostics collect gopls check rows for touched Go files", async () => {
	const repo = fixtureRepo();
	try {
		const binDir = path.join(repo, "bin");
		fs.mkdirSync(binDir);
		fs.writeFileSync(path.join(binDir, "gopls"), `#!/usr/bin/env sh
if [ "$1" = "check" ] && [ "$(basename "$2")" = "bad.go" ]; then
  echo "$PWD/bad.go:4:2: undefined: Missing"
  echo "$PWD/bad.go:5:2: warning: shadow declaration"
fi
exit 0
`);
		fs.chmodSync(path.join(binDir, "gopls"), 0o755);
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
