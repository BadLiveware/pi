import type { ResultDetail } from "../../core/types.ts";
import type { ParsedFile, SymbolRecord } from "../../tree-sitter/nodes.ts";

export function extractMarkdownFileRecords(_parsed: ParsedFile, _detail: ResultDetail): { definitions: SymbolRecord[]; candidates: SymbolRecord[] } {
	return { definitions: [], candidates: [] };
}
