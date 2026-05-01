import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	existsSync,
	loadExtension,
	resetCapabilitiesCache,
	setCapabilities,
	theme,
} from "./shared.ts";

describe("rich-output chart rendering", () => {
	it("falls back when persisted chart artifact files are missing", async () => {
		setCapabilities({ images: "kitty", hyperlinks: false, trueColor: true });
		try {
			const { renderers } = loadExtension();
			const renderer = renderers.get("rich-output:card");
			const component = renderer({
				details: {
					kind: "benchmark",
					title: "Stale chart block",
					blocks: [{
						type: "chart",
						format: "vega-lite",
						label: "Missing chart",
						pngPath: "/tmp/pi-rich-output-charts/missing.png",
						svgPath: "/tmp/pi-rich-output-charts/missing.svg",
						jsonPath: "/tmp/pi-rich-output-charts/missing.vl.json",
					}],
					createdAt: "2026-05-01T00:00:00.000Z",
				},
			}, { expanded: false }, theme);

			const rendered = component.render(100).join("\n");
			assert.match(rendered, /Chart image unavailable: \/tmp\/pi-rich-output-charts\/missing\.png/);
			assert.match(rendered, /svg \/tmp\/pi-rich-output-charts\/missing\.svg/);
			assert.match(rendered, /spec \/tmp\/pi-rich-output-charts\/missing\.vl\.json/);
		} finally {
			resetCapabilitiesCache();
		}
	});

	it("returns chart render errors for unserializable tool input", async () => {
		const { tools } = loadExtension();
		const cyclicSpec: any = { mark: "bar" };
		cyclicSpec.self = cyclicSpec;

		const result = await tools.get("rich_output_present").execute("call", {
			kind: "benchmark",
			title: "Cyclic chart",
			blocks: [{ type: "chart", format: "vega-lite", label: "cyclic", spec: cyclicSpec }],
		}, undefined, undefined, {});

		assert.match(result.details.blocks[0].renderError, /could not be serialized/);
	});

	it("caps Vega-Lite chart rendering per card", async () => {
		const { tools } = loadExtension();
		const spec = { width: 16, height: 16, data: { values: [{ x: "a", y: 1 }] }, mark: "bar", encoding: { x: { field: "x", type: "nominal" }, y: { field: "y", type: "quantitative" } } };
		const result = await tools.get("rich_output_present").execute("call", {
			kind: "benchmark",
			title: "Many charts",
			blocks: Array.from({ length: 5 }, (_, index) => ({ type: "chart", format: "vega-lite", label: `chart ${index}`, spec })),
		}, undefined, undefined, {});

		assert.match(result.details.blocks[4].renderError, /chart cap reached/);
	});

	it("renders Vega-Lite chart blocks to artifacts and inline previews", async () => {
		setCapabilities({ images: "kitty", hyperlinks: false, trueColor: true });
		try {
			const { tools, renderers, messages } = loadExtension();
			await tools.get("rich_output_present").execute("call", {
				kind: "benchmark",
				title: "Benchmark chart",
				blocks: [{
					type: "chart",
					format: "vega-lite",
					label: "Shim p50 by mode",
					spec: {
						width: 320,
						height: 180,
						data: { values: [
							{ mode: "off", p50: 12.3 },
							{ mode: "prefer", p50: 8.4 },
							{ mode: "force", p50: 29.7 },
						] },
						mark: "bar",
						encoding: {
							x: { field: "mode", type: "nominal" },
							y: { field: "p50", type: "quantitative" },
						},
					},
				}],
			}, undefined, undefined, {});
			const block = (messages[0] as any).details.blocks[0];
			assert.ok(block.pngPath);
			assert.ok(block.svgPath);
			assert.ok(block.jsonPath);
			assert.equal(existsSync(block.pngPath), true);
			assert.equal(existsSync(block.svgPath), true);
			assert.equal(existsSync(block.jsonPath), true);
			const renderer = renderers.get("rich-output:card");
			const component = renderer(messages[0], { expanded: false }, theme);
			const renderedLines = component.render(100);
			assert.ok(renderedLines.some((line: string) => line.includes("\x1b_G")));
			const rendered = renderedLines.join("\n");
			assert.match(rendered, /Shim p50 by mode/);
			assert.match(rendered, /spec .*rich-output\/charts\/.*\.vl\.json/);
		} finally {
			resetCapabilitiesCache();
		}
	});
});
