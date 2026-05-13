import * as path from "node:path";

export const IMPACT_LANGUAGES = ["go", "typescript", "tsx", "javascript", "rust", "python", "cpp"];
const IMPACT_LANGUAGE_SET = new Set(IMPACT_LANGUAGES);

const LANGUAGE_EXTENSIONS: Array<{ id: string; extensions: string[] }> = [
	{ id: "go", extensions: [".go"] },
	{ id: "typescript", extensions: [".ts", ".mts", ".cts"] },
	{ id: "tsx", extensions: [".tsx"] },
	{ id: "javascript", extensions: [".js", ".mjs", ".cjs", ".jsx"] },
	{ id: "rust", extensions: [".rs"] },
	{ id: "python", extensions: [".py"] },
	{ id: "java", extensions: [".java"] },
	{ id: "cpp", extensions: [".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".hxx"] },
	{ id: "csharp", extensions: [".cs"] },
	{ id: "ruby", extensions: [".rb"] },
	{ id: "php", extensions: [".php"] },
	{ id: "bash", extensions: [".sh", ".bash", ".zsh"] },
	{ id: "css", extensions: [".css"] },
];

function languageIdsForFile(file: string): string[] {
	const extension = path.extname(file);
	return LANGUAGE_EXTENSIONS.filter((spec) => spec.extensions.includes(extension)).map((spec) => spec.id);
}

export function changedFileSupportSummary(changedFiles: string[]): Record<string, unknown> {
	const unsupportedImpactFiles: Array<Record<string, unknown>> = [];
	const nonSourceFiles: string[] = [];
	const supportedImpactFiles: Array<Record<string, unknown>> = [];
	for (const file of changedFiles) {
		const languages = languageIdsForFile(file);
		if (languages.length === 0) {
			nonSourceFiles.push(file);
			continue;
		}
		if (languages.some((language) => IMPACT_LANGUAGE_SET.has(language))) supportedImpactFiles.push({ file, languages: languages.filter((language) => IMPACT_LANGUAGE_SET.has(language)) });
		else unsupportedImpactFiles.push({ file, languages });
	}
	return { supportedImpactLanguages: IMPACT_LANGUAGES, supportedImpactFiles, unsupportedImpactFiles, nonSourceFiles };
}
