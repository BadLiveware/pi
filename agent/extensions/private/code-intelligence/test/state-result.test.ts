import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import test from "node:test";
import { fixtureRepo, loadTools, mockContext, renderText, renderTheme } from "./test-harness.ts";

test("state rendering and footer use canonical semantic provider status", async () => {
	const repo = fixtureRepo();
	try {
		const tool = loadTools().get("code_intel_state")!;
		const { ctx, statuses } = mockContext(repo);
		const result = await tool.execute("state", {}, undefined, undefined, ctx);
		const providers = result.details.semanticProviders;
		assert.equal(providers.typescript.available, "available");
		assert.equal("languageServers" in result.details, false);
		const available = ["gopls", "rust-analyzer", "typescript", "clangd"].filter((name) => providers[name].available === "available").length;
		const collapsed = renderText(tool.renderResult!(result, { expanded: false }, renderTheme));
		assert.ok(collapsed.includes(`lsp:${available}/4`));
		const expanded = renderText(tool.renderResult!(result, { expanded: true }, renderTheme));
		for (const name of ["gopls", "rust-analyzer", "typescript", "clangd"]) {
			assert.ok(expanded.includes(`${name}:${providers[name].available}`));
		}
		assert.match(statuses.at(-1)?.value ?? "", /lsp:[^\n]*ts/);
		assert.doesNotMatch(statuses.at(-1)?.value ?? "", /lsp:none/);
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});
