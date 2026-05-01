import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";
import { resetCapabilitiesCache, setCapabilities } from "@mariozechner/pi-tui";
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

	it("renders generic terminal-native blocks", async () => {
		const { tools, renderers, messages } = loadExtension();
		await tools.get("rich_output_present").execute("call", {
			kind: "note",
			style: "inline",
			title: "Generic blocks",
			summary: "Formula, diagram, progress, and tree blocks.",
			blocks: [
				{ type: "formula", latex: "\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}" },
				{ type: "diagram", edges: [["Agent", "Tool"], ["Tool", "Timeline"]] },
				{ type: "progress", label: "Criteria", value: 5, total: 7 },
				{ type: "tree", items: [{ label: "root", children: [{ label: "leaf" }] }] },
			],
		}, undefined, undefined, {});

		const renderer = renderers.get("rich-output:card");
		const component = renderer(messages[0], { expanded: false }, theme);
		const rendered = component.render(100).join("\n");
		assert.match(rendered, /∫/);
		assert.match(rendered, /∞/);
		assert.match(rendered, /Agent ─▶ Tool/);
		assert.match(rendered, /Criteria/);
		assert.match(rendered, /root/);
		assert.match(rendered, /leaf/);
	});

	it("renders Ghostty-oriented demo blocks with text fallbacks", async () => {
		setCapabilities({ images: null, hyperlinks: false, trueColor: true });
		try {
			const { renderers } = loadExtension();
			const renderer = renderers.get("rich-output:card");
			const component = renderer({
				details: {
					kind: "note",
					title: "Ghostty blocks",
					blocks: [
						{ type: "capabilities" },
						{ type: "badge", tone: "success", text: "ready" },
						{ type: "sparkline", label: "latency", values: [5, 3, 8, 4] },
						{ type: "link", label: "source", path: "/tmp/example.ts" },
						{ type: "image", label: "demo chart", values: [1, 4, 2], maxWidthCells: 12 },
					],
					createdAt: "2026-05-01T00:00:00.000Z",
				},
			}, { expanded: false }, theme);

			const rendered = component.render(100).join("\n");
			assert.match(rendered, /images=no/);
			assert.match(rendered, /truecolor=yes/);
			assert.match(rendered, /● ready/);
			assert.match(rendered, /latency/);
			assert.match(rendered, /file:\/\/\/tmp\/example\.ts/);
			assert.match(rendered, /demo chart/);
			assert.match(rendered, /\[image\/png\] 320x120/);
		} finally {
			resetCapabilitiesCache();
		}
	});

	it("renders Mermaid diagram blocks to SVG artifacts", async () => {
		setCapabilities({ images: null, hyperlinks: false, trueColor: true });
		try {
			const { renderers } = loadExtension();
			const renderer = renderers.get("rich-output:card");
			const component = renderer({
				details: {
					kind: "note",
					title: "Mermaid block",
					blocks: [{ type: "diagram", format: "mermaid", render: "svg", label: "Flow", text: "flowchart LR\n  A --> B" }],
					createdAt: "2026-05-01T00:00:00.000Z",
				},
			}, { expanded: false }, theme);

			const rendered = component.render(100).join("\n");
			assert.match(rendered, /Flow/);
			assert.match(rendered, /svg file:\/\//);
			assert.match(rendered, /flowchart LR/);
			const svgPath = rendered.match(/file:\/\/([^\s]+\.svg)/)?.[1];
			assert.ok(svgPath);
			assert.equal(existsSync(svgPath), true);
		} finally {
			resetCapabilitiesCache();
		}
	});

	it("preserves Kitty image escape sequences instead of truncating them", async () => {
		setCapabilities({ images: "kitty", hyperlinks: true, trueColor: true });
		try {
			const { renderers } = loadExtension();
			const renderer = renderers.get("rich-output:card");
			const component = renderer({
				details: {
					kind: "note",
					title: "Image block",
					blocks: [{ type: "image", label: "demo chart", values: [1, 2, 3], maxWidthCells: 10 }],
					createdAt: "2026-05-01T00:00:00.000Z",
				},
			}, { expanded: false }, theme);

			const renderedLines = component.render(80);
			const imageLine = renderedLines.find((line: string) => line.includes("\x1b_G"));
			assert.ok(imageLine);
			assert.doesNotMatch(imageLine, /\.\.\./);
		} finally {
			resetCapabilitiesCache();
		}
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
