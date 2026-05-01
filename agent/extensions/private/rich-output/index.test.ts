import assert from "node:assert/strict";
import { describe, it } from "node:test";
import richOutput from "./index.ts";

function loadExtension() {
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const renderers = new Map<string, any>();
	const messages: unknown[] = [];
	const entries: Array<{ customType: string; data: unknown }> = [];
	const pi = {
		registerTool(tool: any) {
			tools.set(tool.name, tool);
		},
		registerCommand(name: string, command: any) {
			commands.set(name, command);
		},
		registerMessageRenderer(type: string, renderer: any) {
			renderers.set(type, renderer);
		},
		sendMessage(message: unknown) {
			messages.push(message);
		},
		appendEntry(customType: string, data: unknown) {
			entries.push({ customType, data });
		},
	} as any;
	richOutput(pi);
	return { tools, commands, renderers, messages, entries };
}

const theme = {
	fg: (_style: string, text: string) => text,
	bg: (_style: string, text: string) => text,
	bold: (text: string) => text,
};

describe("rich-output", () => {
	it("registers a presentation tool that sends a custom timeline card", async () => {
		const { tools, renderers, messages, entries } = loadExtension();
		assert.ok(tools.has("rich_output_present"));
		assert.ok(renderers.has("rich-output:card"));

		const result = await tools.get("rich_output_present").execute("call", {
			kind: "findings",
			title: "Review findings",
			summary: "Two supported findings.",
			payload: {
				findings: [
					{ severity: "high", location: "src/auth.ts:42", title: "Expired token accepted", evidence: "targeted test failed", impact: "stale sessions stay valid", suggestedFix: "reject before refresh fallback" },
				],
				gaps: ["SSO browser smoke not run"],
			},
		}, undefined, undefined, {});

		assert.equal(result.details.kind, "findings");
		assert.equal(messages.length, 1);
		assert.deepEqual((messages[0] as any).customType, "rich-output:card");
		assert.equal((messages[0] as any).display, true);
		assert.equal(entries.length, 1);
		assert.equal(entries[0].customType, "rich-output:card");
	});

	it("renders structured payloads through the custom message renderer", async () => {
		const { renderers } = loadExtension();
		const renderer = renderers.get("rich-output:card");
		const component = renderer({
			details: {
				kind: "validation",
				title: "Validation",
				summary: "Focused checks passed.",
				payload: {
					commands: [
						{ command: "npm test", result: "passed", duration: "1.2s", summary: "all good" },
					],
				},
				createdAt: "2026-05-01T00:00:00.000Z",
			},
		}, { expanded: true }, theme);

		assert.ok(component);
		const rendered = component.render(100).join("\n");
		assert.match(rendered, /Validation/);
		assert.match(rendered, /npm test/);
		assert.match(rendered, /PASSED/);
	});

	it("provides a demo command", async () => {
		const { commands, messages, entries } = loadExtension();
		assert.ok(commands.has("rich-output-demo"));
		await commands.get("rich-output-demo").handler("", {});
		assert.equal(messages.length, 1);
		assert.equal(entries.length, 1);
		assert.equal((messages[0] as any).customType, "rich-output:card");
	});
});
