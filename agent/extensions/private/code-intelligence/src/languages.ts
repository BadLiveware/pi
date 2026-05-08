export interface LanguageSpec {
	id: string;
	wasm: string;
	extensions: string[];
}

export const LANGUAGE_SPECS: LanguageSpec[] = [
	{ id: "go", wasm: "tree-sitter-go.wasm", extensions: [".go"] },
	{ id: "typescript", wasm: "tree-sitter-typescript.wasm", extensions: [".ts", ".mts", ".cts"] },
	{ id: "tsx", wasm: "tree-sitter-tsx.wasm", extensions: [".tsx"] },
	{ id: "javascript", wasm: "tree-sitter-javascript.wasm", extensions: [".js", ".mjs", ".cjs", ".jsx"] },
	{ id: "rust", wasm: "tree-sitter-rust.wasm", extensions: [".rs"] },
	{ id: "python", wasm: "tree-sitter-python.wasm", extensions: [".py"] },
	{ id: "java", wasm: "tree-sitter-java.wasm", extensions: [".java"] },
	{ id: "cpp", wasm: "tree-sitter-cpp.wasm", extensions: [".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".hxx"] },
	{ id: "csharp", wasm: "tree-sitter-c-sharp.wasm", extensions: [".cs"] },
	{ id: "ruby", wasm: "tree-sitter-ruby.wasm", extensions: [".rb"] },
	{ id: "php", wasm: "tree-sitter-php.wasm", extensions: [".php"] },
	{ id: "bash", wasm: "tree-sitter-bash.wasm", extensions: [".sh", ".bash", ".zsh"] },
	{ id: "css", wasm: "tree-sitter-css.wasm", extensions: [".css"] },
];

const LANGUAGE_ALIASES = new Map<string, string>([
	["golang", "go"],
	["ts", "typescript"],
	["typescript", "typescript"],
	["tsx", "tsx"],
	["js", "javascript"],
	["jsx", "javascript"],
	["javascript", "javascript"],
	["rust", "rust"],
	["rs", "rust"],
	["python", "python"],
	["py", "python"],
	["java", "java"],
	["c", "cpp"],
	["cpp", "cpp"],
	["c++", "cpp"],
	["csharp", "csharp"],
	["c#", "csharp"],
	["ruby", "ruby"],
	["rb", "ruby"],
	["php", "php"],
	["bash", "bash"],
	["sh", "bash"],
	["css", "css"],
]);

export function languageSpec(language: string): LanguageSpec | undefined {
	const normalized = LANGUAGE_ALIASES.get(language.trim().toLowerCase()) ?? language.trim().toLowerCase();
	return LANGUAGE_SPECS.find((spec) => spec.id === normalized);
}
