import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import toolFeedback, { feedbackLogPath } from "./index.ts";

function loadExtension() {
	const tools = new Map<string, any>();
	const entries: Array<{ customType: string; data: unknown }> = [];
	const pi = {
		on() {},
		registerTool(tool: any) { tools.set(tool.name, tool); },
		registerCommand() {},
		registerMessageRenderer() {},
		appendEntry(customType: string, data: unknown) { entries.push({ customType, data }); },
	} as any;
	toolFeedback(pi);
	const ctx = { cwd: fs.mkdtempSync(path.join(os.tmpdir(), "pi-tool-feedback-per-tool-")), sessionManager: { getSessionId: () => `per-tool-${process.pid}` }, ui: { notify() {}, setStatus() {} }, hasPendingMessages: () => false };
	return { tools, entries, ctx };
}

async function withConfig(config: unknown, run: () => Promise<void>): Promise<void> {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-tool-feedback-per-tool-config-"));
	const configPath = path.join(dir, "tool-feedback.json");
	const logPath = path.join(dir, "feedback.jsonl");
	fs.writeFileSync(configPath, JSON.stringify(config));
	const oldConfig = process.env.PI_TOOL_FEEDBACK_CONFIG;
	const oldLog = process.env.PI_TOOL_FEEDBACK_LOG;
	process.env.PI_TOOL_FEEDBACK_CONFIG = configPath;
	process.env.PI_TOOL_FEEDBACK_LOG = logPath;
	try {
		await run();
	} finally {
		if (oldConfig === undefined) delete process.env.PI_TOOL_FEEDBACK_CONFIG;
		else process.env.PI_TOOL_FEEDBACK_CONFIG = oldConfig;
		if (oldLog === undefined) delete process.env.PI_TOOL_FEEDBACK_LOG;
		else process.env.PI_TOOL_FEEDBACK_LOG = oldLog;
	}
}

describe("tool-feedback per-tool responses", () => {
	it("records primary tool and sanitized per-tool feedback", async () => {
		await withConfig({ mode: "both", watch: [{ prefix: "code_intel_" }], feedbackFields: [{ name: "rankingQuality", type: "enum", values: ["good", "mixed"], required: true }] }, async () => {
			const { tools, entries, ctx } = loadExtension();
			await tools.get("tool_feedback")!.execute("feedback", {
				watchedTools: ["code_intel_impact_map", "code_intel_local_map"],
				primaryWatchedTool: "code_intel_impact_map",
				perceivedUsefulness: "medium",
				wouldUseAgainSameSituation: "yes",
				confidence: "high",
				fieldResponses: { rankingQuality: "mixed" },
				perToolResponses: {
					code_intel_impact_map: { outputSeemedTooNoisy: "yes", fieldResponses: { rankingQuality: "mixed" }, ignoredObject: { secret: true } },
					code_intel_local_map: { outputSeemedTooNoisy: "no", fieldResponses: { rankingQuality: "good" } },
				},
			}, undefined, undefined, ctx);
			const feedbackEntry = entries.find((entry) => entry.customType === "tool-feedback:agent-feedback");
			assert.ok(feedbackEntry);
			assert.equal((feedbackEntry.data as any).primaryWatchedTool, "code_intel_impact_map");
			assert.deepEqual((feedbackEntry.data as any).perToolResponses.code_intel_impact_map, { outputSeemedTooNoisy: "yes", fieldResponses: { rankingQuality: "mixed" } });
			assert.deepEqual((feedbackEntry.data as any).perToolResponses.code_intel_local_map, { outputSeemedTooNoisy: "no", fieldResponses: { rankingQuality: "good" } });
			const log = fs.readFileSync(feedbackLogPath(`per-tool-${process.pid}`), "utf-8");
			assert.match(log, /primaryWatchedTool/);
			assert.doesNotMatch(log, /ignoredObject/);
		});
	});
});
