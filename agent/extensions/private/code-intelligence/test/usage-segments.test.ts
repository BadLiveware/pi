import * as assert from "node:assert/strict";
import test from "node:test";
import { returnedFilesForResult, returnedSegmentsForResult } from "../src/slices/usage/followup.ts";

const target = { path: "main.ts", range: { startLine: 5, endLine: 8 }, rangeHash: "declaration-hash" };

function details() {
	return {
		target,
		targetSegment: {
			range: { startLine: 3, endLine: 10 },
			sourceCompleteness: "complete-segment",
			source: "export function target() {}",
		},
		contextSegments: [{
			target: { path: "constants.ts", range: { startLine: 1, endLine: 2 }, rangeHash: "context-hash" },
			range: { startLine: 1, endLine: 1 },
			sourceCompleteness: "partial",
			source: "const LIMIT =",
		}],
	};
}

test("usage resolves the primary segment through the response target and preserves segment ranges", () => {
	assert.deepEqual(returnedSegmentsForResult("code_intel_read_symbol", details()), [
		{ file: "main.ts", startLine: 3, endLine: 10, rank: 1, source: "read_symbol:target", completeness: "complete-segment", rangeHash: "declaration-hash" },
		{ file: "constants.ts", startLine: 1, endLine: 1, rank: 2, source: "read_symbol:context", completeness: "partial", rangeHash: "context-hash" },
	]);
	assert.deepEqual(returnedFilesForResult("code_intel_read_symbol", details()), [
		{ file: "main.ts", rank: 1, source: "read_symbol:target" },
		{ file: "constants.ts", rank: 2, source: "read_symbol:context" },
	]);
});

test("usage does not invent source segments for failed or locator-only results", () => {
	for (const result of [{ ok: false, alternatives: [{ target }] }, { target, sourceCompleteness: "locations-only" }]) {
		assert.deepEqual(returnedSegmentsForResult("code_intel_read_symbol", result), []);
		assert.deepEqual(returnedFilesForResult("code_intel_read_symbol", result), []);
	}
});
