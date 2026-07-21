import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_LIST_PAGE_SIZE, paginateItems } from "../src/app/pagination.ts";

test("Stardock list pagination is bounded and exposes continuation metadata", () => {
	const items = Array.from({ length: 235 }, (_, index) => index);
	const first = paginateItems(items);
	assert.deepEqual(first.items, items.slice(0, 20));
	assert.deepEqual(first.page, { total: 235, offset: 0, limit: 20, returned: 20, truncated: true, nextOffset: 20 });

	const middle = paginateItems(items, { limit: 7, offset: 21 });
	assert.deepEqual(middle.items, items.slice(21, 28));
	assert.equal(middle.page.nextOffset, 28);

	const final = paginateItems(items, { limit: 20, offset: 230 });
	assert.deepEqual(final.items, items.slice(230));
	assert.equal(final.page.truncated, false);
	assert.equal(final.page.nextOffset, undefined);

	const capped = paginateItems(items, { limit: 10_000, offset: -5 });
	assert.equal(capped.items.length, MAX_LIST_PAGE_SIZE);
	assert.equal(capped.page.offset, 0);
	assert.equal(capped.page.limit, MAX_LIST_PAGE_SIZE);
});
