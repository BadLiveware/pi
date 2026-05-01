import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	loadExtension,
	mkdtempSync,
	resetCapabilitiesCache,
	setCapabilities,
	theme,
	tmpdir,
	writeFileSync,
	join,
} from "./shared.ts";

describe("rich-output block rendering", () => {
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

	it("renders malformed persisted cards without throwing", async () => {
		setCapabilities({ images: "kitty", hyperlinks: false, trueColor: true });
		try {
			const { renderers } = loadExtension();
			const cyclicSpec: any = { mark: "bar" };
			cyclicSpec.self = cyclicSpec;
			const tempDir = mkdtempSync(join(tmpdir(), "rich-output-test-"));
			const hugePng = join(tempDir, "huge.png");
			writeFileSync(hugePng, Buffer.alloc(5_000_001));
			const component = renderers.get("rich-output:card")({
				details: {
					kind: "note",
					title: { stale: true },
					summary: 42,
					blocks: [
						{ type: "image", label: "bad image", data: "not base64", mimeType: "image/png" },
						{ type: "chart", format: "vega-lite", label: "cyclic chart", showSource: true, spec: cyclicSpec },
						{ type: "chart", format: "vega-lite", label: "huge chart", pngPath: hugePng },
						{ type: "rule" },
					],
					createdAt: "2026-05-01T00:00:00.000Z",
				},
			}, { expanded: false }, theme);

			assert.ok(component);
			let rendered = "";
			assert.doesNotThrow(() => {
				rendered = component.render(80).join("\n");
			});
			assert.match(rendered, /Rich output/);
			assert.match(rendered, /Image data unavailable/);
			assert.match(rendered, /Chart source unavailable/);
			assert.match(rendered, /Chart image unavailable:/);
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
});
