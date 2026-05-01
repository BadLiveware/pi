import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadExtension, theme } from "./shared.ts";

describe("rich-output core tool surface", () => {
	it("registers a presentation tool that sends a custom timeline card", async () => {
		const { tools, renderers, messages, entries } = loadExtension();
		assert.ok(tools.has("rich_output_present"));
		assert.equal(tools.get("rich_output_present").renderShell, "self");
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
		assert.match(rendered, /Focused checks passed/);
		assert.match(rendered, /npm test/);
		assert.match(rendered, /PASSED/);
	});

	it("renders structured payload content even when collapsed", async () => {
		const { renderers } = loadExtension();
		const renderer = renderers.get("rich-output:card");
		const component = renderer({
			details: {
				kind: "table",
				title: "Routing matrix",
				summary: "Choose the lightest workflow.",
				payload: {
					columns: ["Situation", "Path"],
					rows: [["small edit", "task list"], ["recursive search", "Stardock"]],
				},
				createdAt: "2026-05-01T00:00:00.000Z",
			},
		}, { expanded: false }, theme);

		const rendered = component.render(100).join("\n");
		assert.match(rendered, /Choose the lightest workflow/);
		assert.match(rendered, /small edit/);
		assert.match(rendered, /Stardock/);
	});

	it("tool call renderers tolerate malformed persisted state", async () => {
		const { tools } = loadExtension();
		const tool = tools.get("rich_output_present");
		assert.doesNotThrow(() => tool.renderCall(undefined, theme).render(80));
		assert.doesNotThrow(() => tool.renderResult(undefined, {}, theme).render(80));
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
