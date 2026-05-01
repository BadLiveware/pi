#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const repoRoot = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "");
const extensionsRoot = join(repoRoot, "agent/extensions");
const defaultMaxLines = 500;

// Existing large files are technical debt. They are allowed only up to their
// current size so routine work cannot make them larger by accident.
const grandfatheredMaxLines = new Map(Object.entries({
	"agent/extensions/private/code-intelligence/index.test.ts": 505,
	"agent/extensions/private/code-intelligence/src/tree-sitter.ts": 1050,
	"agent/extensions/private/rich-output/index.ts": 1026,
	"agent/extensions/private/stardock/src/policy.ts": 536,
	"agent/extensions/private/stardock/src/state/migration.ts": 501,
	"agent/extensions/private/stardock/test/lifecycle.test.ts": 523,
	"agent/extensions/public/compaction-continue/index.ts": 596,
	"agent/extensions/public/footer-framework/index.ts": 2418,
	"agent/extensions/public/pr-upstream-status/index.ts": 1448,
	"agent/extensions/public/tool-feedback/src/core.ts": 511,
}));

function walk(dir, output = []) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === "node_modules" || entry.name === ".git") continue;
		const path = join(dir, entry.name);
		if (entry.isDirectory()) walk(path, output);
		else if (entry.isFile() && path.endsWith(".ts")) output.push(path);
	}
	return output;
}

function lineCount(path) {
	const text = readFileSync(path, "utf8");
	if (text.length === 0) return 0;
	return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
}

const failures = [];
const checked = [];
for (const file of walk(extensionsRoot)) {
	const rel = relative(repoRoot, file).split("\\").join("/");
	const lines = lineCount(file);
	const max = grandfatheredMaxLines.get(rel) ?? defaultMaxLines;
	checked.push({ rel, lines, max, grandfathered: grandfatheredMaxLines.has(rel) });
	if (lines > max) failures.push({ rel, lines, max, grandfathered: grandfatheredMaxLines.has(rel) });
}

const staleGrandfathered = [];
for (const rel of grandfatheredMaxLines.keys()) {
	try {
		const full = join(repoRoot, rel);
		if (!statSync(full).isFile()) staleGrandfathered.push(rel);
	} catch {
		staleGrandfathered.push(rel);
	}
}

if (failures.length > 0 || staleGrandfathered.length > 0) {
	console.error("Extension structure check failed.");
	console.error(`Default max TypeScript file size: ${defaultMaxLines} lines.`);
	if (failures.length > 0) {
		console.error("\nFiles over their allowed size:");
		for (const failure of failures) {
			const label = failure.grandfathered ? "grandfathered file grew" : "new oversized file";
			console.error(`- ${failure.rel}: ${failure.lines}/${failure.max} lines (${label})`);
		}
	}
	if (staleGrandfathered.length > 0) {
		console.error("\nStale grandfathered entries:");
		for (const rel of staleGrandfathered) console.error(`- ${rel}`);
	}
	console.error("\nSplit behavior into vertical slice modules instead of growing large files. Only update the grandfathered list when intentionally recording a smaller cap after refactoring, or with explicit reviewer/user approval for an exceptional large file.");
	process.exit(1);
}

const largeCount = checked.filter((item) => item.grandfathered).length;
console.log(`Extension structure check passed (${checked.length} TypeScript files, ${largeCount} grandfathered large files).`);
