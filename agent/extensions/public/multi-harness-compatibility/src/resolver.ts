import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { ancestorDirs, existingRealPath, findUp, globLikeMatch, resolvePath, uniqueExistingDirectories } from "./path-utils.ts";
import type { ActiveProfile, CompatConfig, CompatProfileConfig, CompatResource, LoadedCompatConfig, ResolvedCompatState, SourceKind } from "./types.ts";

const contextNames = ["AGENTS.md", "CLAUDE.md"];

function sha256(text: string): string {
	return crypto.createHash("sha256").update(text).digest("hex");
}

function readFile(filePath: string): string | undefined {
	try {
		return fs.readFileSync(filePath, "utf-8");
	} catch {
		return undefined;
	}
}

function gitRemotes(cwd: string): string[] {
	try {
		const output = execFileSync("git", ["remote", "-v"], { cwd, encoding: "utf-8", timeout: 1000, stdio: ["ignore", "pipe", "ignore"] });
		return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
	} catch {
		return [];
	}
}

function profileMatches(name: string, profile: CompatProfileConfig, cwd: string, remotes: string[]): string | undefined {
	const match = profile.match;
	if (!match) return undefined;
	for (const pattern of match.paths ?? []) {
		if (globLikeMatch(resolvePath(pattern, cwd), cwd)) return `cwd matches ${pattern}`;
	}
	for (const marker of match.markerFiles ?? []) {
		const markerPath = resolvePath(marker, cwd);
		if (fs.existsSync(markerPath)) return `marker exists ${marker}`;
	}
	for (const pattern of match.gitRemotes ?? []) {
		if (remotes.some((remote) => globLikeMatch(pattern, remote))) return `git remote matches ${pattern}`;
	}
	return name === "" ? "" : undefined;
}

function mergeStringArrays(...arrays: Array<string[] | undefined>): string[] | undefined {
	const merged = arrays.flatMap((array) => array ?? []);
	return merged.length ? [...new Set(merged)] : undefined;
}

function mergeMatch(parent: CompatProfileConfig["match"], child: CompatProfileConfig["match"]): CompatProfileConfig["match"] {
	if (!parent && !child) return undefined;
	return {
		paths: mergeStringArrays(parent?.paths, child?.paths),
		gitRemotes: mergeStringArrays(parent?.gitRemotes, child?.gitRemotes),
		markerFiles: mergeStringArrays(parent?.markerFiles, child?.markerFiles),
	};
}

function mergeProfiles(parent: CompatProfileConfig, child: CompatProfileConfig): CompatProfileConfig {
	return {
		inherit: child.inherit,
		match: mergeMatch(parent.match, child.match),
		roots: mergeStringArrays(parent.roots, child.roots),
		pi: child.pi ?? parent.pi,
		claude: child.claude ?? parent.claude,
		cursor: child.cursor ?? parent.cursor,
		agents: child.agents ?? parent.agents,
		includeGlobalPiContext: child.includeGlobalPiContext ?? parent.includeGlobalPiContext,
		contextFiles: mergeStringArrays(parent.contextFiles, child.contextFiles),
		skillDirs: mergeStringArrays(parent.skillDirs, child.skillDirs),
		cursorRuleDirs: mergeStringArrays(parent.cursorRuleDirs, child.cursorRuleDirs),
	};
}

function resolveProfileConfig(name: string, profiles: Record<string, CompatProfileConfig>, diagnostics: string[], stack: string[] = []): CompatProfileConfig {
	const profile = profiles[name];
	if (!profile) {
		diagnostics.push(`Profile '${name}' inherits missing profile '${name}'.`);
		return {};
	}
	if (stack.includes(name)) {
		diagnostics.push(`Profile inheritance cycle: ${[...stack, name].join(" -> ")}`);
		return profile;
	}
	let resolved: CompatProfileConfig = {};
	for (const parentName of profile.inherit ?? []) resolved = mergeProfiles(resolved, resolveProfileConfig(parentName, profiles, diagnostics, [...stack, name]));
	return mergeProfiles(resolved, profile);
}

export function activeProfile(config: CompatConfig, cwd: string, diagnostics: string[] = []): ActiveProfile {
	const profiles = config.profiles ?? {};
	const remotes = gitRemotes(cwd);
	for (const [name, profile] of Object.entries(profiles)) {
		const resolved = resolveProfileConfig(name, profiles, diagnostics);
		const reason = profileMatches(name, resolved, cwd, remotes);
		if (reason) return { name, profile: resolved, reason };
	}
	const defaultName = config.defaultProfile ?? "private";
	return { name: defaultName, profile: profiles[defaultName] ? resolveProfileConfig(defaultName, profiles, diagnostics) : { pi: true, claude: true, cursor: true, agents: true }, reason: "defaultProfile" };
}

function enabled(profile: CompatProfileConfig, kind: SourceKind): boolean {
	if (kind === "pi") return profile.pi !== false;
	if (kind === "claude") return profile.claude !== false;
	if (kind === "agents") return profile.agents !== false;
	return profile.cursor !== false;
}

function discoveryRoots(profile: CompatProfileConfig, cwd: string, repoRoot: string | undefined): string[] {
	const localRoots = repoRoot ? ancestorDirs(cwd, repoRoot) : [cwd];
	return uniqueExistingDirectories([...localRoots, ...(profile.roots ?? []).map((root) => resolvePath(root, repoRoot ?? cwd))]);
}

function contextCandidates(profile: CompatProfileConfig, cwd: string, repoRoot: string | undefined): Array<{ kind: SourceKind; path: string }> {
	const candidates: Array<{ kind: SourceKind; path: string }> = [];
	const roots = discoveryRoots(profile, cwd, repoRoot);
	if (enabled(profile, "pi")) {
		for (const filePath of findUp(cwd, repoRoot, ["AGENTS.md"])) candidates.push({ kind: "pi", path: filePath });
		if (profile.includeGlobalPiContext) candidates.push({ kind: "pi", path: resolvePath("~/.pi/agent/AGENTS.md", cwd) });
	}
	if (enabled(profile, "claude")) {
		for (const filePath of findUp(cwd, repoRoot, ["CLAUDE.md"])) candidates.push({ kind: "claude", path: filePath });
	}
	for (const root of roots) {
		if (enabled(profile, "claude")) candidates.push({ kind: "claude", path: path.join(root, "CLAUDE.md") });
		if (enabled(profile, "pi")) candidates.push({ kind: "pi", path: path.join(root, "AGENTS.md") });
		for (const file of profile.contextFiles ?? []) candidates.push({ kind: "pi", path: resolvePath(file, root) });
	}
	return candidates.filter((candidate, index, all) => contextNames.includes(path.basename(candidate.path)) || index === all.findIndex((other) => other.path === candidate.path));
}

function aliasTarget(content: string, filePath: string): string | undefined {
	const trimmed = content.trim();
	const match = trimmed.match(/^@(.+)$/);
	if (!match) return undefined;
	const target = match[1].trim();
	if (!target || /\s/.test(target)) return undefined;
	return resolvePath(target, path.dirname(filePath));
}

function addContext(state: ResolvedCompatState, kind: SourceKind, filePath: string, seenReal: Set<string>, seenHash: Set<string>): void {
	const realPath = existingRealPath(filePath);
	if (!realPath) return;
	const content = readFile(realPath);
	if (content === undefined) return;
	const base: CompatResource = { kind, type: "context", path: filePath, realPath, status: "loaded" };
	if (seenReal.has(realPath)) {
		state.suppressed.push({ ...base, status: "suppressed", reason: "duplicate real path" });
		return;
	}
	const target = aliasTarget(content, realPath);
	if (target) {
		const targetReal = existingRealPath(target);
		if (targetReal) {
			state.suppressed.push({ ...base, status: "suppressed", reason: "alias include", aliasTarget: targetReal });
			addContext(state, kind, targetReal, seenReal, seenHash);
			return;
		}
		state.diagnostics.push(`${realPath} references missing ${target}`);
	}
	const hash = sha256(content.trim().replace(/\r\n/g, "\n"));
	if (seenHash.has(hash)) {
		state.suppressed.push({ ...base, status: "suppressed", reason: "duplicate normalized content", contentHash: hash });
		return;
	}
	seenReal.add(realPath);
	seenHash.add(hash);
	state.loaded.push({ ...base, contentHash: hash });
	state.contextText += `\n\n## ${path.basename(realPath)} (${realPath})\n\n${content.trim()}\n`;
}

function skillName(skillPath: string): string | undefined {
	const stat = fs.existsSync(skillPath) ? fs.statSync(skillPath) : undefined;
	const filePath = stat?.isDirectory() ? path.join(skillPath, "SKILL.md") : skillPath;
	const content = readFile(filePath);
	if (!content) return undefined;
	const frontmatter = content.match(/^---\s*\n([\s\S]*?)\n---/);
	const name = frontmatter?.[1].match(/^name:\s*['"]?([^'"\n]+)['"]?\s*$/m)?.[1]?.trim();
	return name || path.basename(stat?.isDirectory() ? skillPath : filePath, path.extname(filePath));
}

function findSkills(dir: string): string[] {
	if (!fs.existsSync(dir)) return [];
	const stat = fs.statSync(dir);
	if (stat.isFile()) return dir.endsWith(".md") ? [dir] : [];
	if (!stat.isDirectory()) return [];
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	const result: string[] = [];
	for (const entry of entries) {
		const child = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (fs.existsSync(path.join(child, "SKILL.md"))) result.push(child);
			else result.push(...findSkills(child));
		} else if (entry.isFile() && entry.name.endsWith(".md")) {
			result.push(child);
		}
	}
	return result;
}

function skillDirs(profile: CompatProfileConfig, cwd: string, repoRoot: string | undefined): Array<{ kind: SourceKind; dir: string }> {
	const dirs: Array<{ kind: SourceKind; dir: string }> = [];
	const roots = discoveryRoots(profile, cwd, repoRoot);
	for (const root of roots) {
		if (enabled(profile, "agents")) dirs.push({ kind: "agents", dir: path.join(root, ".agents", "skills") });
		if (enabled(profile, "claude")) dirs.push({ kind: "claude", dir: path.join(root, ".claude", "skills") });
		if (enabled(profile, "cursor")) dirs.push({ kind: "cursor", dir: path.join(root, ".cursor", "skills") });
	}
	for (const dir of profile.skillDirs ?? []) dirs.push({ kind: "pi", dir: resolvePath(dir, repoRoot ?? cwd) });
	return dirs;
}

function addSkills(state: ResolvedCompatState, profile: CompatProfileConfig, cwd: string, repoRoot: string | undefined): void {
	const seenReal = new Set<string>();
	const seenName = new Set<string>();
	for (const { kind, dir } of skillDirs(profile, cwd, repoRoot)) {
		for (const skillPath of findSkills(dir)) {
			const realPath = existingRealPath(skillPath);
			if (!realPath) continue;
			const name = skillName(realPath);
			const base: CompatResource = { kind, type: "skill", path: skillPath, realPath, name, status: "loaded" };
			if (seenReal.has(realPath)) {
				state.suppressed.push({ ...base, status: "suppressed", reason: "duplicate real path" });
				continue;
			}
			if (name && seenName.has(name)) {
				state.suppressed.push({ ...base, status: "suppressed", reason: `duplicate skill name ${name}` });
				continue;
			}
			seenReal.add(realPath);
			if (name) seenName.add(name);
			state.loaded.push(base);
			state.skillPaths.push(realPath);
		}
	}
}

function cursorRuleDirs(profile: CompatProfileConfig, cwd: string, repoRoot: string | undefined): string[] {
	if (!enabled(profile, "cursor")) return [];
	return uniqueExistingDirectories([
		...discoveryRoots(profile, cwd, repoRoot).map((root) => path.join(root, ".cursor", "rules")),
		...(profile.cursorRuleDirs ?? []).map((dir) => resolvePath(dir, repoRoot ?? cwd)),
	]);
}

function findRuleFiles(dir: string): string[] {
	const result: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const child = path.join(dir, entry.name);
		if (entry.isDirectory()) result.push(...findRuleFiles(child));
		else if (entry.isFile() && /\.(md|mdc)$/i.test(entry.name)) result.push(child);
	}
	return result;
}

function addCursorRules(state: ResolvedCompatState, profile: CompatProfileConfig, cwd: string, repoRoot: string | undefined): void {
	const seenReal = new Set<string>();
	for (const dir of cursorRuleDirs(profile, cwd, repoRoot)) {
		for (const rulePath of findRuleFiles(dir)) {
			const realPath = existingRealPath(rulePath);
			if (!realPath || seenReal.has(realPath)) continue;
			seenReal.add(realPath);
			const content = readFile(realPath)?.trim();
			if (!content) continue;
			state.loaded.push({ kind: "cursor", type: "cursor-rule", path: rulePath, realPath, status: "loaded", contentHash: sha256(content) });
			state.contextText += `\n\n## Cursor rule (${realPath})\n\n${content}\n`;
		}
	}
}

export function resolveCompatState(cwd: string, loadedConfig: LoadedCompatConfig): ResolvedCompatState {
	const selected = activeProfile(loadedConfig.config, cwd, loadedConfig.diagnostics);
	const state: ResolvedCompatState = {
		cwd,
		repoRoot: loadedConfig.repoRoot,
		activeProfile: selected,
		contextText: "",
		skillPaths: [],
		loaded: [],
		suppressed: [],
		diagnostics: [...loadedConfig.diagnostics],
	};
	const seenReal = new Set<string>();
	const seenHash = new Set<string>();
	for (const candidate of contextCandidates(selected.profile, cwd, loadedConfig.repoRoot)) addContext(state, candidate.kind, candidate.path, seenReal, seenHash);
	addSkills(state, selected.profile, cwd, loadedConfig.repoRoot);
	addCursorRules(state, selected.profile, cwd, loadedConfig.repoRoot);
	return state;
}

export function summarizeState(state: ResolvedCompatState): string {
	const loaded = state.loaded.reduce<Record<string, number>>((counts, resource) => {
		const key = resource.type;
		counts[key] = (counts[key] ?? 0) + 1;
		return counts;
	}, {});
	return `compat profile ${state.activeProfile.name}; loaded ${loaded.context ?? 0} context, ${loaded.skill ?? 0} skills, ${loaded["cursor-rule"] ?? 0} cursor rules; suppressed ${state.suppressed.length}`;
}
