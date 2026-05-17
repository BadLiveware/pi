import { execFileSync } from "node:child_process";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { collectTouchedDiagnostics } from "../src/slices/post-edit-map/diagnostics.ts";
import { DEFAULT_CONFIG } from "../src/types.ts";

function pythonRepo(): string {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-code-intel-python-diagnostics-"));
	execFileSync("git", ["init", "-q"], { cwd: repo });
	fs.writeFileSync(path.join(repo, "bad.py"), `def greet(name: str) -> str:
    return "hi " + name

greet(42)
`);
	fs.writeFileSync(path.join(repo, "other.py"), `value: int = 1
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

test("Python diagnostics prefer pyrefly JSON output for touched files", async () => {
	const repo = pythonRepo();
	try {
		const binDir = path.join(repo, "bin");
		fs.mkdirSync(binDir);
		writeExecutable(path.join(binDir, "pyrefly"), `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "pyrefly 1.0.0"
  exit 0
fi
printf '%s\n' '{"errors":[{"line":4,"column":1,"stop_line":4,"stop_column":10,"path":"bad.py","code":-1,"name":"bad-argument-type","description":"Argument is not assignable to parameter"},{"line":1,"column":1,"stop_line":1,"stop_column":6,"path":"other.py","code":-2,"name":"unused-ignore","description":"not touched"}]}'
exit 1
`);
		await withPath(binDir, async () => {
			const result = await collectTouchedDiagnostics(repo, ["bad.py"], DEFAULT_CONFIG);
			assert.equal(result.diagnostics.length, 1);
			assert.equal(result.diagnostics.some((row) => row.path === "bad.py" && row.line === 4 && row.column === 1 && row.severity === "error" && row.source === "pyrefly" && row.code === "bad-argument-type"), true);
			assert.equal(result.providerStatuses.some((row) => row.provider === "pyrefly" && row.available === "available" && row.fileCount === 1 && row.diagnosticCount === 1), true);
		});
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("Python diagnostics fall back to ty GitLab JSON output", async () => {
	const repo = pythonRepo();
	try {
		const binDir = path.join(repo, "bin");
		fs.mkdirSync(binDir);
		writeExecutable(path.join(binDir, "ty"), `#!/bin/sh
if [ "$1" = "version" ]; then
  echo "ty 1.0.0-beta"
  exit 0
fi
printf '%s\n' '[{"description":"Argument type mismatch","check_name":"bad-argument-type","severity":"major","location":{"path":"bad.py","positions":{"begin":{"line":4,"column":1},"end":{"line":4,"column":10}}}}]'
exit 1
`);
		await withPath(binDir, async () => {
			const result = await collectTouchedDiagnostics(repo, ["bad.py"], DEFAULT_CONFIG);
			assert.equal(result.diagnostics.length, 1);
			assert.equal(result.diagnostics.some((row) => row.path === "bad.py" && row.line === 4 && row.column === 1 && row.severity === "error" && row.source === "ty" && row.code === "bad-argument-type"), true);
			assert.equal(result.providerStatuses.some((row) => row.provider === "pyrefly" && row.available === "missing"), true);
			assert.equal(result.providerStatuses.some((row) => row.provider === "ty" && row.available === "available" && row.diagnosticCount === 1), true);
		});
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("Python diagnostics keep basedpyright and pyright JSON as fallback providers", async () => {
	const repo = pythonRepo();
	try {
		const binDir = path.join(repo, "bin");
		fs.mkdirSync(binDir);
		writeExecutable(path.join(binDir, "basedpyright"), `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "basedpyright 1.39.0"
  exit 0
fi
printf '%s\n' '{"generalDiagnostics":[{"file":"bad.py","severity":"warning","message":"Unknown argument type","rule":"reportUnknownArgumentType","range":{"start":{"line":3,"character":0},"end":{"line":3,"character":9}}}]}'
exit 1
`);
		await withPath(binDir, async () => {
			const result = await collectTouchedDiagnostics(repo, ["bad.py"], DEFAULT_CONFIG);
			assert.equal(result.diagnostics.length, 1);
			assert.equal(result.diagnostics.some((row) => row.path === "bad.py" && row.line === 4 && row.column === 1 && row.severity === "warning" && row.source === "basedpyright" && row.code === "reportUnknownArgumentType"), true);
			assert.equal(result.providerStatuses.some((row) => row.provider === "ty" && row.available === "missing"), true);
			assert.equal(result.providerStatuses.some((row) => row.provider === "basedpyright" && row.available === "available" && row.diagnosticCount === 1), true);
		});
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("Python diagnostics report missing providers without failing collection", async () => {
	const repo = pythonRepo();
	try {
		const emptyBin = path.join(repo, "empty-bin");
		fs.mkdirSync(emptyBin);
		await withPath(emptyBin, async () => {
			const result = await collectTouchedDiagnostics(repo, ["bad.py"], DEFAULT_CONFIG);
			assert.equal(result.diagnostics.length, 0);
			for (const provider of ["pyrefly", "ty", "basedpyright", "pyright"]) {
				const status = result.providerStatuses.find((row) => row.provider === provider);
				assert.equal(status?.available, "missing");
				assert.match(String(status?.diagnostic ?? ""), /not found/);
			}
		});
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});
