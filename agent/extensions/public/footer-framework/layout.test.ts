import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	composeFooterLine,
	createFooterCells,
	footerCellsFromText,
	overlayFooterColumnItems,
	plainFooterText,
	renderFooterCells,
	writeFooterText,
} from "./index.ts";

const compose = (left: string, right?: string, width = 64) =>
	composeFooterLine({
		width,
		left,
		right,
		anchor: "right",
		minGap: 2,
		maxGap: 24,
		ellipsis: "...",
	});

describe("footer line cell rendering", () => {
	it("right-aligns the right group without changing visible width", () => {
		const { line, layout } = compose("left", "right", 20);
		assert.equal(plainFooterText(line), "left           right");
		assert.equal(visibleWidth(line), 20);
		assert.deepEqual(layout, {
			anchor: "right",
			leftWidth: 4,
			rightWidthOriginal: 5,
			rightWidthFinal: 5,
			padCount: 11,
			rightStartCol: 15,
			rightEndCol: 19,
			truncated: false,
		});
	});

	it("keeps right-zone text visible when centered overlays are written", () => {
		const right = "mcp:0/3 servers · watchdog:on";
		const base = compose("↑3.8M ↓107k $43.736", right, 80).line;
		const line = overlayFooterColumnItems(80, base, [
			{ id: "context", text: "ctx 70% 190K/272K", placement: { column: "center", order: 20 } },
		]);
		const plain = plainFooterText(line);

		assert.equal(visibleWidth(line), 80);
		assert.match(plain, /↑3\.8M/);
		assert.match(plain, /ctx 70% 190K\/272K/);
		assert.match(plain, /mcp:0\/3 servers/);
		assert.match(plain, /watchdog:on/);
	});

	it("clears an entire wide-character run when overwritten", () => {
		const cells = createFooterCells(5);
		writeFooterText(cells, 0, "A好B");
		writeFooterText(cells, 1, "x");

		assert.equal(plainFooterText(renderFooterCells(cells)), "Ax B");
	});

	it("treats grapheme clusters as terminal cells", () => {
		const cells = footerCellsFromText("👩‍💻X");
		assert.equal(cells.filter((cell) => !cell.continuation).length, 2);
		assert.equal(plainFooterText(renderFooterCells(cells)), "👩‍💻X");
	});

	it("handles ANSI SGR variants without dropping text", () => {
		assert.equal(plainFooterText("\u001b[38:2::255:0:0mred\u001b[0m"), "red");

		const rendered = renderFooterCells(footerCellsFromText("\u001b[1;31mA\u001b[39mB"));
		assert.equal(plainFooterText(rendered), "AB");
		assert.match(rendered, /\u001b\[1;31m\u001b\[39mB/);
	});

	it("preserves OSC8 hyperlinks with params", () => {
		const link = "\u001b]8;id=pr-123;https://example.test\u0007PR\u001b]8;;\u0007";
		const rendered = renderFooterCells(footerCellsFromText(link));

		assert.equal(plainFooterText(rendered), "PR");
		assert.match(rendered, /\u001b\]8;id=pr-123;https:\/\/example\.test\u0007P/);
	});

	it("trims filler padding but preserves real trailing spaces", () => {
		const realSpace = renderFooterCells(footerCellsFromText("abc "));
		assert.equal(plainFooterText(realSpace), "abc ");

		const cells = createFooterCells(10);
		writeFooterText(cells, 0, "abc");
		assert.equal(plainFooterText(renderFooterCells(cells)), "abc");
	});
});
