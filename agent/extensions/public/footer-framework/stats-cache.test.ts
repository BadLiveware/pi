import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFooterStatsCache } from "./src/stats-cache.ts";

const formatTokens = (value: number) => {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
	return `${value}`;
};

describe("footer stats cache", () => {
	it("sums assistant cache token and cost buckets", () => {
		const statsFor = createFooterStatsCache(formatTokens);
		const stats = statsFor([
			{ type: "message", message: { role: "user" } },
			{
				type: "message",
				message: {
					role: "assistant",
					usage: {
						input: 1_600_000,
						output: 117_000,
						cacheRead: 51_100_000,
						cacheWrite: 0,
						totalTokens: 52_817_000,
						cost: { total: 37.2, cacheRead: 25.55, cacheWrite: 0 },
					},
				},
			},
		]);

		assert.equal(stats.input, 1_600_000);
		assert.equal(stats.output, 117_000);
		assert.equal(stats.cacheRead, 51_100_000);
		assert.equal(stats.cacheWrite, 0);
		assert.equal(stats.totalTokens, 52_817_000);
		assert.equal(stats.cacheReadCost, 25.55);
		assert.equal(stats.cacheWriteCost, 0);
		assert.equal(stats.cacheReadText, "51.1M");
		assert.equal(stats.cacheWriteText, "0");
		assert.equal(stats.value, "↑1.6M ↺51.1M ↓117.0k ↻0 $37.200");
	});

	it("falls back to summing bucket totals when totalTokens is absent", () => {
		const statsFor = createFooterStatsCache(formatTokens);
		const stats = statsFor([
			{
				type: "message",
				message: {
					role: "assistant",
					usage: { input: 100, output: 20, cacheRead: 300, cacheWrite: 40, cost: { total: 0.123 } },
				},
			},
		]);

		assert.equal(stats.totalTokens, 460);
		assert.equal(stats.value, "↑100 ↺300 ↓20 ↻40 $0.123");
	});
});
