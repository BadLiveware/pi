import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	existsSync,
	loadExtension,
	pngDimensions,
	theme,
	resetCapabilitiesCache,
	setCapabilities,
} from "./shared.ts";

describe("rich-output mermaid rendering", () => {
	it("renders Mermaid diagram blocks to SVG artifacts", async () => {
		setCapabilities({ images: null, hyperlinks: false, trueColor: true });
		try {
			const { tools, renderers, messages } = loadExtension();
			await tools.get("rich_output_present").execute("call", {
				kind: "note",
				title: "Mermaid block",
				blocks: [{ type: "diagram", format: "mermaid", render: "svg", label: "Flow", text: "flowchart LR\n  A --> B" }],
			}, undefined, undefined, {});
			const renderer = renderers.get("rich-output:card");
			const component = renderer(messages[0], { expanded: false }, theme);

			const rendered = component.render(100).join("\n");
			assert.match(rendered, /Flow/);
			assert.match(rendered, /svg .*rich-output\/mermaid\/.*\.svg/);
			assert.doesNotMatch(rendered, /flowchart LR/);
			const svgPath = rendered.match(/((?:\/[^^\s]+)?\.pi\/rich-output\/mermaid\/[^^\s]+\.svg|\/tmp\/pi-rich-output-mermaid\/[^^\s]+\.svg)/)?.[1];
			assert.ok(svgPath);
			assert.equal(existsSync(svgPath), true);
			const pngPath = (messages[0] as any).details.blocks[0].pngPath as string;
			const dimensions = pngDimensions(pngPath);
			assert.ok(dimensions.width >= 300);
		} finally {
			resetCapabilitiesCache();
		}
	});

	it("renders Mermaid PNG previews inline when Kitty images are available", async () => {
		setCapabilities({ images: "kitty", hyperlinks: true, trueColor: true });
		try {
			const { tools, renderers, messages } = loadExtension();
			await tools.get("rich_output_present").execute("call", {
				kind: "note",
				title: "Mermaid image block",
				blocks: [{ type: "diagram", format: "mermaid", render: "svg", label: "Flow", text: "flowchart LR\n  A --> B" }],
			}, undefined, undefined, {});
			const renderer = renderers.get("rich-output:card");
			const component = renderer(messages[0], { expanded: false }, theme);

			const renderedLines = component.render(100);
			assert.ok(renderedLines.some((line: string) => line.includes("\x1b_G")));
			assert.match(renderedLines.join("\n"), /svg .*rich-output\/mermaid\/.*\.svg/);
		} finally {
			resetCapabilitiesCache();
		}
	});

	it("can show Mermaid source when explicitly requested", async () => {
		setCapabilities({ images: null, hyperlinks: false, trueColor: true });
		try {
			const { tools, renderers, messages } = loadExtension();
			await tools.get("rich_output_present").execute("call", {
				kind: "note",
				title: "Mermaid source block",
				blocks: [{ type: "diagram", format: "mermaid", render: "svg", showSource: true, label: "Flow", text: "flowchart LR\n  A --> B" }],
			}, undefined, undefined, {});
			const renderer = renderers.get("rich-output:card");
			const component = renderer(messages[0], { expanded: false }, theme);

			assert.match(component.render(100).join("\n"), /flowchart LR/);
		} finally {
			resetCapabilitiesCache();
		}
	});

	it("does not render Mermaid artifacts from the component render path", async () => {
		setCapabilities({ images: null, hyperlinks: false, trueColor: true });
		try {
			const { renderers } = loadExtension();
			const renderer = renderers.get("rich-output:card");
			const component = renderer({
				details: {
					kind: "note",
					title: "Unprepared Mermaid block",
					blocks: [{ type: "diagram", format: "mermaid", render: "svg", label: "Flow", text: "flowchart LR\n  A --> B" }],
					createdAt: "2026-05-01T00:00:00.000Z",
				},
			}, { expanded: false }, theme);

			const rendered = component.render(100).join("\n");
			assert.match(rendered, /flowchart LR/);
			assert.doesNotMatch(rendered, /svg .*rich-output\/mermaid/);
		} finally {
			resetCapabilitiesCache();
		}
	});

	it("falls back when persisted Mermaid artifact files are missing", async () => {
		setCapabilities({ images: "kitty", hyperlinks: false, trueColor: true });
		try {
			const { renderers } = loadExtension();
			const renderer = renderers.get("rich-output:card");
			const component = renderer({
				details: {
					kind: "note",
					title: "Stale Mermaid block",
					blocks: [{
						type: "diagram",
						format: "mermaid",
						render: "svg",
						label: "Flow",
						text: "flowchart LR\n  A --> B",
						pngPath: "/tmp/pi-rich-output-mermaid/missing.png",
						svgPath: "/tmp/pi-rich-output-mermaid/missing.svg",
					}],
					createdAt: "2026-05-01T00:00:00.000Z",
				},
			}, { expanded: false }, theme);

			const rendered = component.render(100).join("\n");
			assert.match(rendered, /Mermaid image unavailable: \/tmp\/pi-rich-output-mermaid\/missing\.png/);
			assert.match(rendered, /svg \/tmp\/pi-rich-output-mermaid\/missing\.svg/);
			assert.match(rendered, /flowchart LR/);
		} finally {
			resetCapabilitiesCache();
		}
	});
});
