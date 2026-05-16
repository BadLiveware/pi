export interface FooterTextMetrics {
	plainText: string;
	width: number;
}

export function createFooterTextMetricsCache(
	plainText: (text: string) => string,
	visibleWidth: (text: string) => number,
	maxEntries = 256,
): (text: string) => FooterTextMetrics {
	const cache = new Map<string, FooterTextMetrics>();
	return (text) => {
		const cached = cache.get(text);
		if (cached) return cached;
		const metrics = { plainText: plainText(text), width: visibleWidth(text) };
		if (cache.size >= maxEntries) cache.clear();
		cache.set(text, metrics);
		return metrics;
	};
}
