import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import test from "node:test";
import { LANGUAGE_CAPABILITIES } from "../src/language-support/registry.ts";
import { SEMANTIC_PROVIDER_METADATA } from "../src/lsp/provider-metadata.ts";

const extensionRoot = path.resolve("private/code-intelligence");
const requestedLanguages = ["go", "typescript", "tsx", "javascript", "rust", "python", "cpp", "csharp", "bash", "zsh", "markdown"];

function readExtensionFile(relativePath: string): string {
	return fs.readFileSync(path.join(extensionRoot, relativePath), "utf-8");
}

function providerMetadataName(id: string): string {
	return id === "markdownlint" ? "markdownlint-cli2" : id;
}

test("language registry coverage stays aligned with provider metadata", () => {
	const capabilities = new Map<string, (typeof LANGUAGE_CAPABILITIES)[number]>(LANGUAGE_CAPABILITIES.map((capability) => [capability.id, capability]));
	const providers = new Set<string>(SEMANTIC_PROVIDER_METADATA.map((provider) => provider.name));
	for (const language of requestedLanguages) assert.equal(capabilities.has(language), true, `${language} registry row missing`);
	for (const capability of LANGUAGE_CAPABILITIES) {
		for (const provider of [...capability.features.exactReferences, ...capability.features.diagnostics]) {
			assert.equal(providers.has(providerMetadataName(provider)), true, `${capability.id} references unknown provider ${provider}`);
		}
	}
	assert.equal(capabilities.get("go")?.features.diagnostics.includes("gopls"), true);
	assert.equal(capabilities.get("rust")?.features.exactReferences.includes("rust-analyzer"), true);
	assert.equal(capabilities.get("rust")?.features.diagnostics.includes("rust-analyzer"), true);
	assert.equal(capabilities.get("markdown")?.features.impact, "doc");
	assert.equal(capabilities.get("markdown")?.features.mutateSymbol, true);
	assert.equal(capabilities.get("markdown")?.features.syntaxSearch, false);
	const zshParser = capabilities.get("zsh")?.parser;
	assert.equal(zshParser?.kind, "tree-sitter-wasm");
	assert.equal(zshParser?.kind === "tree-sitter-wasm" ? zshParser.wasm : undefined, "tree-sitter-bash.wasm");
	assert.doesNotMatch((capabilities.get("markdown")?.limitations ?? []).join("\n"), /planned/i);
	assert.doesNotMatch((capabilities.get("python")?.limitations ?? []).join("\n"), /generic until/i);
});

test("README language coverage table names requested language behavior", () => {
	const readme = readExtensionFile("README.md");
	for (const row of ["Go", "TypeScript / TSX / JavaScript", "Rust", "Python", "C/C++", "C#", "Bash", "zsh", "Markdown"]) {
		assert.match(readme, new RegExp(`\\| ${row.replace(/[+]/g, "\\+")} \\|`), `${row} coverage row missing`);
	}
	assert.match(readme, /missing optional providers do not break default Tree-sitter\/scanner maps/);
	assert.match(readme, /Markdown changed files are reported as documentation changes instead of code impact/);
	assert.match(readme, /uses the Bash Tree-sitter grammar/i);
	assert.doesNotMatch(readme, /current TypeScript\/JavaScript diagnostics/);
	assert.doesNotMatch(readme, /Markdown support is planned/);
});

test("code-intelligence skill guidance avoids stale diagnostic and Markdown claims", () => {
	const skill = readExtensionFile("skills/code-intelligence/SKILL.md");
	assert.match(skill, /includeDiagnostics:true[\s\S]*gopls check[\s\S]*Rust Analyzer[\s\S]*ShellCheck[\s\S]*zsh -n[\s\S]*markdownlint-cli2/);
	assert.match(skill, /Markdown rows as document-structure routing, not code semantics/);
	assert.match(skill, /zsh[\s\S]*Bash grammar/);
	assert.doesNotMatch(skill, /current TypeScript\/JavaScript touched-file diagnostics/);
});
