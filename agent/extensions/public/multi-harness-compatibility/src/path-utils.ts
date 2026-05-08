import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export function expandHome(input: string): string {
	if (input === "~") return os.homedir();
	if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
	return input;
}

export function resolvePath(input: string, base: string): string {
	const expanded = expandHome(input);
	return path.resolve(path.isAbsolute(expanded) ? expanded : path.join(base, expanded));
}

export function existingRealPath(filePath: string): string | undefined {
	try {
		return fs.realpathSync(filePath);
	} catch {
		return undefined;
	}
}

export function findRepoRoot(start: string): string | undefined {
	let current = path.resolve(start);
	while (true) {
		if (fs.existsSync(path.join(current, ".git"))) return current;
		if (current === path.parse(current).root) return undefined;
		current = path.dirname(current);
	}
}

export function ancestorDirs(start: string, stopAt: string | undefined): string[] {
	const result: string[] = [];
	let current = path.resolve(start);
	const stop = stopAt ? path.resolve(stopAt) : path.parse(current).root;
	while (true) {
		result.push(current);
		if (current === stop || current === path.parse(current).root) break;
		current = path.dirname(current);
	}
	return result.reverse();
}

export function findUp(start: string, stopAt: string | undefined, names: string[]): string[] {
	const result: string[] = [];
	for (const current of ancestorDirs(start, stopAt)) {
		for (const name of names) {
			const candidate = path.join(current, name);
			if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) result.push(candidate);
		}
	}
	return result;
}

export function globLikeMatch(pattern: string, value: string): boolean {
	const normalizedPattern = expandHome(pattern).replace(/\\/g, "/");
	const normalizedValue = value.replace(/\\/g, "/");
	if (normalizedPattern.endsWith("/**") && normalizedValue === normalizedPattern.slice(0, -3)) return true;
	const escaped = normalizedPattern
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*\*/g, "\u0000")
		.replace(/\*/g, "[^/]*")
		.replace(/\u0000/g, ".*");
	return new RegExp(`^${escaped}$`).test(normalizedValue);
}

export function uniqueExistingDirectories(paths: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const dir of paths) {
		const real = existingRealPath(dir);
		if (!real) continue;
		try {
			if (!fs.statSync(real).isDirectory() || seen.has(real)) continue;
		} catch {
			continue;
		}
		seen.add(real);
		result.push(real);
	}
	return result;
}
