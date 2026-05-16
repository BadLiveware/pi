export interface FooterStats {
	input: number;
	output: number;
	cost: number;
	inputText: string;
	outputText: string;
	costText: string;
	value: string;
}

type SessionEntry = {
	type?: string;
	message?: {
		role?: string;
		usage?: {
			input?: number;
			output?: number;
			cost?: { total?: number };
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
		return `${index}:${numberValue(usage?.input)}:${numberValue(usage?.output)}:${numberValue(usage?.cost?.total)}`;
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
		let cost = 0;
		for (const entry of entries) {
			if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
			input += numberValue(entry.message.usage?.input);
			output += numberValue(entry.message.usage?.output);
			cost += numberValue(entry.message.usage?.cost?.total);
		}

		cachedLength = entries.length;
		cachedLastEntry = lastEntry;
		cachedAssistantSignature = assistantSignature;
		cachedStats = {
			input,
			output,
			cost,
			inputText: formatTokens(input),
			outputText: formatTokens(output),
			costText: cost.toFixed(3),
			value: `↑${formatTokens(input)} ↓${formatTokens(output)} $${cost.toFixed(3)}`,
		};
		return cachedStats;
	};
}
