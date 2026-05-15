import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import modelCatalog from "./index.ts";

function fakeModel(overrides: Partial<Model<Api>> & Pick<Model<Api>, "id" | "provider">): Model<Api> {
	return {
		id: overrides.id,
		name: overrides.name ?? overrides.id,
		api: overrides.api ?? "openai-completions",
		provider: overrides.provider,
		baseUrl: overrides.baseUrl ?? "https://example.invalid/v1",
		reasoning: overrides.reasoning ?? false,
		thinkingLevelMap: overrides.thinkingLevelMap,
		input: overrides.input ?? ["text"],
		cost: overrides.cost ?? { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
		contextWindow: overrides.contextWindow ?? 128000,
		maxTokens: overrides.maxTokens ?? 32000,
	};
}

function registeredTool() {
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	modelCatalog({
		registerTool(tool: any) {
			tools.set(tool.name, tool);
		},
		registerCommand(name: string, command: any) {
			commands.set(name, command);
		},
	} as any);
	const tool = tools.get("list_pi_models");
	assert.ok(tool);
	return tool;
}

test("list_pi_models exposes supported thinking levels and mappings", async () => {
	const tempAgentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-model-catalog-test-"));
	const previousAgentDir = process.env.PI_AGENT_DIR;
	try {
		process.env.PI_AGENT_DIR = tempAgentDir;
		fs.writeFileSync(path.join(tempAgentDir, "settings.json"), JSON.stringify({ enabledModels: ["test/reasoner"] }), "utf-8");
		const reasoner = fakeModel({
			provider: "test",
			id: "reasoner",
			reasoning: true,
			input: ["text", "image"],
			thinkingLevelMap: { off: null, minimal: null, low: "LOW", medium: null, high: "HIGH", xhigh: "MAX" },
		});
		const plain = fakeModel({ provider: "test", id: "plain" });
		const ctx = {
			model: reasoner,
			modelRegistry: {
				getAll: () => [reasoner, plain],
				getAvailable: () => [reasoner, plain],
			},
		} as any;

		const result = await registeredTool().execute("tool-call", { includeUnavailable: true }, undefined, undefined, ctx);
		const text = result.content[0].text;
		assert.match(text, /think-levels/);
		assert.match(text, /test\/reasoner/);
		assert.match(text, /low,high,xhi/);
		assert.match(text, /test\/plain/);
		assert.match(text, /\boff\b/);

		const reasonerDetails = result.details.models.find((row: any) => row.fullId === "test/reasoner");
		assert.deepEqual(reasonerDetails.thinkingLevels, ["low", "high", "xhigh"]);
		assert.deepEqual(reasonerDetails.thinkingLevelMap, { off: null, minimal: null, low: "LOW", medium: null, high: "HIGH", xhigh: "MAX" });
		const plainDetails = result.details.models.find((row: any) => row.fullId === "test/plain");
		assert.deepEqual(plainDetails.thinkingLevels, ["off"]);
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_AGENT_DIR;
		else process.env.PI_AGENT_DIR = previousAgentDir;
		fs.rmSync(tempAgentDir, { recursive: true, force: true });
	}
});
