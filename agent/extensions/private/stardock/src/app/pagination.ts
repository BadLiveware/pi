export const DEFAULT_LIST_PAGE_SIZE = 20;
export const MAX_LIST_PAGE_SIZE = 100;

export interface ListPageParams {
	limit?: unknown;
	offset?: unknown;
}

export interface ListPageMetadata {
	total: number;
	offset: number;
	limit: number;
	returned: number;
	truncated: boolean;
	nextOffset?: number;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

export function paginateItems<T>(items: T[], params: ListPageParams = {}): { items: T[]; page: ListPageMetadata } {
	const offset = nonNegativeInteger(params.offset, 0);
	const requestedLimit = nonNegativeInteger(params.limit, DEFAULT_LIST_PAGE_SIZE);
	const limit = Math.max(1, Math.min(MAX_LIST_PAGE_SIZE, requestedLimit || DEFAULT_LIST_PAGE_SIZE));
	const pageItems = items.slice(offset, offset + limit);
	const nextOffset = offset + pageItems.length < items.length ? offset + pageItems.length : undefined;
	return {
		items: pageItems,
		page: {
			total: items.length,
			offset,
			limit,
			returned: pageItems.length,
			truncated: nextOffset !== undefined,
			nextOffset,
		},
	};
}

export function formatPageNote(page: ListPageMetadata): string {
	const range = page.returned > 0 ? `${page.offset + 1}-${page.offset + page.returned}` : "none";
	const next = page.nextOffset === undefined ? "" : ` Next offset: ${page.nextOffset}.`;
	return `Page: ${range} of ${page.total}.${next}`;
}
