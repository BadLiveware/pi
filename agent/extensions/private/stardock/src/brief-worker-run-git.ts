import { execFileSync } from "node:child_process";
import { compactText, type ChangedFileReport } from "./state/core.ts";

export interface GitStatusSnapshot {
	ok: boolean;
	dirty: boolean;
	files: ChangedFileReport[];
	error?: string;
}

function parsePorcelainPath(line: string): string | undefined {
	const raw = line.slice(3).trim();
	if (!raw) return undefined;
	const pathText = raw.includes(" -> ") ? raw.split(" -> ").pop() ?? raw : raw;
	return pathText.replace(/^"|"$/g, "");
}

export function gitStatusSnapshot(cwd: string): GitStatusSnapshot {
	try {
		const output = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
		const files = output
			.split(/\r?\n/)
			.filter(Boolean)
			.map((line): ChangedFileReport | null => {
				const filePath = parsePorcelainPath(line);
				if (!filePath || filePath.startsWith(".stardock/")) return null;
				const code = line.slice(0, 2).trim() || "modified";
				return { path: filePath, summary: `Git status ${code} after worker run.`, reviewReason: "Mutable worker touched this path; parent review required before accepting." };
			})
			.filter((file): file is ChangedFileReport => file !== null);
		return { ok: true, dirty: files.length > 0, files };
	} catch (error) {
		return { ok: false, dirty: true, files: [], error: error instanceof Error ? error.message : String(error) };
	}
}

export function formatChangedFiles(files: ChangedFileReport[], maxItems = 8): string[] {
	if (!files.length) return ["- none"];
	const lines = files.slice(0, maxItems).map((file) => `- ${file.path}: ${compactText(file.summary, 120)}`);
	if (files.length > maxItems) lines.push(`- ... ${files.length - maxItems} more`);
	return lines;
}
