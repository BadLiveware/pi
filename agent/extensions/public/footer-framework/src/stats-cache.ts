export interface FooterStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost: number;
	cacheReadCost: number;
	cacheWriteCost: number;
	inputText: string;
	outputText: string;
	cacheReadText: string;
	cacheWriteText: string;
	totalText: string;
	costText: string;
	cacheReadCostText: string;
	cacheWriteCostText: string;
	value: string;
}

type SessionEntry = {
	type?: string;
	message?: {
		role?: string;
		usage?: {
			input?: number;
			output?: number;
			cacheRead?: number;
			cacheWrite?: number;
			totalTokens?: number;
			cost?: { total?: number; cacheRead?: number; cacheWrite?: number };
		};
	};
};

function numberValue(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function lastAssistantSignature(entries: readonly SessionEntry[]): string {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry?.type !== "message" || entry.message?.role !== "assistant") continue;
		const usage = entry.message.usage;
		return `${index}:${numberValue(usage?.input)}:${numberValue(usage?.output)}:${numberValue(usage?.cacheRead)}:${numberValue(usage?.cacheWrite)}:${numberValue(usage?.cost?.total)}`;
	}
	return "none";
}

export function createFooterStatsCache(formatTokens: (value: number) => string): (entries: readonly SessionEntry[]) => FooterStats {
	let cachedLength = -1;
	let cachedLastEntry: SessionEntry | undefined;
	let cachedAssistantSignature = "";
	let cachedStats: FooterStats | undefined;

	return (entries) => {
		const lastEntry = entries.at(-1);
		const assistantSignature = lastAssistantSignature(entries);
		if (cachedStats && entries.length === cachedLength && lastEntry === cachedLastEntry && assistantSignature === cachedAssistantSignature) return cachedStats;

		let input = 0;
		let output = 0;
		let cacheRead = 0;
		let cacheWrite = 0;
		let totalTokens = 0;
		let cost = 0;
		let cacheReadCost = 0;
		let cacheWriteCost = 0;
		for (const entry of entries) {
			if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
			const usage = entry.message.usage;
			const entryInput = numberValue(usage?.input);
			const entryOutput = numberValue(usage?.output);
			const entryCacheRead = numberValue(usage?.cacheRead);
			const entryCacheWrite = numberValue(usage?.cacheWrite);
			input += entryInput;
			output += entryOutput;
			cacheRead += entryCacheRead;
			cacheWrite += entryCacheWrite;
			totalTokens += numberValue(usage?.totalTokens) || entryInput + entryOutput + entryCacheRead + entryCacheWrite;
			cost += numberValue(usage?.cost?.total);
			cacheReadCost += numberValue(usage?.cost?.cacheRead);
			cacheWriteCost += numberValue(usage?.cost?.cacheWrite);
		}

		const inputText = formatTokens(input);
		const outputText = formatTokens(output);
		const cacheReadText = formatTokens(cacheRead);
		const cacheWriteText = formatTokens(cacheWrite);
		const totalText = formatTokens(totalTokens);
		const costText = cost.toFixed(3);
		const cacheReadCostText = cacheReadCost.toFixed(3);
		const cacheWriteCostText = cacheWriteCost.toFixed(3);
		const hasCacheActivity = cacheRead > 0 || cacheWrite > 0;
		const cacheReadValue = hasCacheActivity ? ` ↺${cacheReadText}` : "";
		const cacheWriteValue = hasCacheActivity ? ` ↻${cacheWriteText}` : "";

		cachedLength = entries.length;
		cachedLastEntry = lastEntry;
		cachedAssistantSignature = assistantSignature;
		cachedStats = {
			input,
			output,
			cacheRead,
			cacheWrite,
			totalTokens,
			cost,
			cacheReadCost,
			cacheWriteCost,
			inputText,
			outputText,
			cacheReadText,
			cacheWriteText,
			totalText,
			costText,
			cacheReadCostText,
			cacheWriteCostText,
			value: `↑${inputText}${cacheReadValue} ↓${outputText}${cacheWriteValue} $${costText}`,
		};
		return cachedStats;
	};
}
