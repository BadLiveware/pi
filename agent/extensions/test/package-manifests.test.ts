import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const workspaceRoot = new URL("../", import.meta.url);
const manifestAt = (path: string) => JSON.parse(readFileSync(new URL(path, workspaceRoot), "utf8"));
const hostPackages = new Set([
	"@earendil-works/pi-ai",
	"@earendil-works/pi-agent-core",
	"@earendil-works/pi-coding-agent",
	"@earendil-works/pi-tui",
	"typebox",
]);

function packagePaths(): string[] {
	return ["public", "private"].flatMap((scope) =>
		readdirSync(new URL(`${scope}/`, workspaceRoot), { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => `${scope}/${entry.name}`),
	);
}

function sourceFiles(directory: URL): URL[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry): URL[] => {
		if (entry.isDirectory()) {
			if (["node_modules", "dist", "test", "tests", "examples", "fixtures", "browser-extension"].includes(entry.name)) return [];
			return sourceFiles(new URL(`${entry.name}/`, directory));
		}
		return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
			? [new URL(entry.name, directory)] : [];
	});
}

test("workspace development packages exercise the Pi 1.0.2 host", () => {
	const manifest = manifestAt("package.json");
	for (const name of hostPackages) {
		assert.equal(manifest.devDependencies[name], name === "typebox" ? "1.3.27" : "1.0.2", name);
	}
});

test("classic browser builds retain a compatible compiler while workspace checks use TypeScript 7", () => {
	const browser = manifestAt("private/browser-bridge/package.json");
	const content = manifestAt("private/browser-bridge/browser-extension/tsconfig.content.json");
	assert.equal(manifestAt("package.json").devDependencies.typescript, "^7.0.2");
	// TypeScript 7 removed the classic-script emitter used by this build.
	assert.equal(browser.devDependencies.typescript, "^5.9.3");
	assert.equal(content.compilerOptions.module, "None");
	assert.equal(content.compilerOptions.outFile, "dist/content.js");
});

test("workspace packages keep host modules as wildcard peers, never runtime copies", () => {
	for (const path of [".", ...packagePaths()]) {
		const manifest = manifestAt(join(path, "package.json"));
		for (const name of Object.keys(manifest.dependencies ?? {})) {
			assert.equal(hostPackages.has(name) || name.startsWith("@mariozechner/pi-") || name === "@sinclair/typebox", false, `${path}: ${name}`);
		}
		for (const [name, range] of Object.entries(manifest.peerDependencies ?? {})) {
			if (hostPackages.has(name)) assert.equal(range, "*", `${path}: ${name}`);
		}
	}
});

test("every directly imported host module is declared by its extension package", () => {
	for (const path of packagePaths()) {
		const manifest = manifestAt(`${path}/package.json`);
		for (const file of sourceFiles(new URL(`${path}/`, workspaceRoot))) {
			const source = readFileSync(file, "utf8");
			assert.doesNotMatch(source, /(?:from\s+|import\s*\()\s*["']@mariozechner\/pi-/, file.pathname);
			for (const match of source.matchAll(/(?:from\s+|import\s*\()\s*["'](@earendil-works\/pi-[^"']+|typebox(?:\/[^"']+)?)["']/g)) {
				const name = match[1].startsWith("@") ? match[1].split("/").slice(0, 2).join("/") : "typebox";
				assert.equal(manifest.peerDependencies?.[name], "*", `${file.pathname}: ${name}`);
			}
		}
	}
});
