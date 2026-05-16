import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { codeIntelStatusSummary } from "./src/slices/state/footer-status.ts";
import type { BackendName, BackendStatus, LanguageServerName, LanguageServerStatus } from "./src/types.ts";

function mockContext(cwd: string) {
	return { cwd, ui: { theme: { fg: (_style: string, text: string) => text } } } as any;
}

function statuses(): Record<BackendName, BackendStatus> {
	return {
		"tree-sitter": { backend: "tree-sitter", available: "available", indexStatus: "not-required", writesToRepo: false, artifacts: [], diagnostics: [] },
		rg: { backend: "rg", available: "available", indexStatus: "not-required", writesToRepo: false, artifacts: [], diagnostics: [] },
	};
}

function languageServers(): Record<LanguageServerName, LanguageServerStatus> {
	return {
		gopls: { server: "gopls", available: "available", diagnostics: [] },
		"rust-analyzer": { server: "rust-analyzer", available: "missing", diagnostics: [] },
		typescript: { server: "typescript", available: "available", diagnostics: [] },
		clangd: { server: "clangd", available: "available", diagnostics: [] },
	};
}

function fixtureRepo(files: Record<string, string>): string {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-code-intel-footer-"));
	for (const [file, source] of Object.entries(files)) {
		const absolute = path.join(repo, file);
		fs.mkdirSync(path.dirname(absolute), { recursive: true });
		fs.writeFileSync(absolute, source);
	}
	return repo;
}

test("footer status ranks TypeScript LSP first in TypeScript-heavy repos", () => {
	const repo = fixtureRepo({ "src/a.ts": "", "src/b.tsx": "", "src/native.cpp": "", "main.go": "" });
	try {
		const summary = codeIntelStatusSummary(mockContext(repo), statuses(), languageServers(), repo);
		assert.match(summary, /^ci\s+syn:ok\s+·\s+rg:ok\s+·\s+lsp:ts,clangd\+1$/);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("footer status shows only LSPs with matching repo files", () => {
	const repo = fixtureRepo({ "src/a.ts": "", "src/b.tsx": "", "README.md": "" });
	try {
		const summary = codeIntelStatusSummary(mockContext(repo), statuses(), languageServers(), repo);
		assert.match(summary, /^ci\s+syn:ok\s+·\s+rg:ok\s+·\s+lsp:ts$/);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("footer status hides available LSPs without matching repo files", () => {
	const repo = fixtureRepo({ "README.md": "", "docs/guide.txt": "" });
	try {
		const summary = codeIntelStatusSummary(mockContext(repo), statuses(), languageServers(), repo);
		assert.match(summary, /^ci\s+syn:ok\s+·\s+rg:ok\s+·\s+lsp:no-files$/);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("footer status shows matching LSP errors instead of no-files", () => {
	const repo = fixtureRepo({ "src/lib.rs": "" });
	try {
		const servers = languageServers();
		servers["rust-analyzer"] = { server: "rust-analyzer", available: "error", diagnostics: ["rust-analyzer failed"] };
		const summary = codeIntelStatusSummary(mockContext(repo), statuses(), servers, repo);
		assert.match(summary, /^ci\s+syn:ok\s+·\s+rg:ok\s+·\s+lsp:ra:err$/);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("footer status ranks clangd first in C++-heavy repos", () => {
	const repo = fixtureRepo({ "src/a.cpp": "", "src/b.h": "", "src/c.cc": "", "tool.ts": "" });
	try {
		const summary = codeIntelStatusSummary(mockContext(repo), statuses(), languageServers(), repo);
		assert.match(summary, /^ci\s+syn:ok\s+·\s+rg:ok\s+·\s+lsp:clangd,ts$/);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});
