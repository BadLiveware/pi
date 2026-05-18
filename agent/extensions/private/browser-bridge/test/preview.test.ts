import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { PreviewServer, resolveWorkspacePath } from "../src/preview/server.ts";
import { createBrowserBridgeRuntime } from "../src/core/state.ts";
import { resolvePreviewUrl } from "../src/slices/open-preview/tool.ts";

test("resolveWorkspacePath accepts @ paths inside cwd and rejects traversal", () => {
	const cwd = path.join(tmpdir(), "bridge-preview-cwd");
	assert.equal(resolveWorkspacePath(cwd, "@index.html"), path.join(cwd, "index.html"));
	assert.throws(() => resolveWorkspacePath(cwd, "../secret.html"), /inside the current workspace/);
});

test("PreviewServer writes and serves inline HTML", async () => {
	const runtime = createBrowserBridgeRuntime(1000);
	const server = new PreviewServer(runtime.state);
	try {
		const artifact = await server.writeHtml("Demo", "<h1>Hello</h1>");
		assert.match(artifact.url, /^http:\/\/127\.0\.0\.1:/);
		assert.equal(await readFile(artifact.path, "utf8"), "<h1>Hello</h1>");
		const response = await fetch(artifact.url);
		assert.equal(response.status, 200);
		assert.equal(await response.text(), "<h1>Hello</h1>");
		assert.equal(runtime.state.previewServer?.enabled, true);
	} finally {
		await server.stop();
	}
});

test("resolvePreviewUrl copies workspace HTML files and validates URL inputs", async () => {
	const workspace = path.join(tmpdir(), `bridge-preview-${Date.now()}`);
	await mkdir(workspace, { recursive: true });
	await writeFile(path.join(workspace, "page.html"), "<p>Workspace</p>", "utf8");
	const runtime = createBrowserBridgeRuntime(1000);
	const server = new PreviewServer(runtime.state);
	try {
		const copied = await resolvePreviewUrl({ path: "page.html" }, { cwd: workspace }, server);
		assert.equal(copied.source, "path");
		assert.match(copied.url, /^http:\/\/127\.0\.0\.1:/);
		const existing = await resolvePreviewUrl({ url: "https://example.test/demo" }, { cwd: workspace }, server);
		assert.equal(existing.url, "https://example.test/demo");
		await assert.rejects(resolvePreviewUrl({ html: "x", url: "https://example.test" }, { cwd: workspace }, server), /exactly one/);
		await assert.rejects(resolvePreviewUrl({ url: "file:///tmp/demo.html" }, { cwd: workspace }, server), /http or https/);
	} finally {
		await server.stop();
	}
});
