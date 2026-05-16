interface FooterCellRun {
	raw: string;
	continuation?: boolean;
	filler?: boolean;
	prefix?: string;
	suffix?: string;
}

export function renderFooterCellRuns(cells: FooterCellRun[]): string {
	let end = cells.length;
	while (end > 0) {
		const cell = cells[end - 1];
		if (cell.continuation || !cell.filler) break;
		end -= 1;
	}
	let output = "";
	let activePrefix = "";
	let activeSuffix = "";
	for (const cell of cells.slice(0, end)) {
		if (cell.continuation) continue;
		const prefix = cell.prefix ?? "";
		const suffix = cell.suffix ?? "";
		if (prefix !== activePrefix || suffix !== activeSuffix) {
			if (activeSuffix) output += activeSuffix;
			if (prefix) output += prefix;
			activePrefix = prefix;
			activeSuffix = suffix;
		}
		output += cell.raw;
	}
	if (activeSuffix) output += activeSuffix;
	return output;
}
