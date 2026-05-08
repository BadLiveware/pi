import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Type } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { loadCompatConfig } from "./src/config.ts";
import { existingRealPath, resolvePath } from "./src/path-utils.ts";
import { resolveCompatState, summarizeState } from "./src/resolver.ts";
import type { ResolvedCompatState } from "./src/types.ts";

function compactResource(resource: ResolvedCompatState["loaded"][number]): Record<string, unknown> {
	return {
		type: resource.type,
		kind: resource.kind,
		path: resource.realPath ?? resource.path,
		name: resource.name,
		status: resource.status,
		reason: resource.reason,
		aliasTarget: resource.aliasTarget,
	};
}

const manualRootsEntryType = "multi-harness-compat:manual-roots";

function statePayload(state: ResolvedCompatState, manualRoots: string[], includeResources = false): Record<string, unknown> {
	return {
		cwd: state.cwd,
		repoRoot: state.repoRoot,
		profile: state.activeProfile.name,
		profileReason: state.activeProfile.reason,
		summary: summarizeState(state),
		manualRoots,
		skillPaths: state.skillPaths,
		diagnostics: state.diagnostics,
		loadedCounts: loadedCounts(state),
		suppressed: state.suppressed.map(compactResource),
		loaded: includeResources ? state.loaded.map(compactResource) : undefined,
	};
}

function loadedCounts(state: ResolvedCompatState): Record<string, number> {
	return state.loaded.reduce<Record<string, number>>((counts, resource) => {
		counts[resource.type] = (counts[resource.type] ?? 0) + 1;
		return counts;
	}, {});
}

function conciseSummary(state: ResolvedCompatState): string {
	const counts = loadedCounts(state);
	const diagnostics = state.diagnostics.length ? `, ${state.diagnostics.length} diagnostic${state.diagnostics.length === 1 ? "" : "s"}` : "";
	return `multi-harness ${state.activeProfile.name}: ${counts.context ?? 0} context, ${counts.skill ?? 0} skills, ${counts["cursor-rule"] ?? 0} cursor rules, ${state.suppressed.length} suppressed${diagnostics}`;
}

function manualSkillReferenceText(state: ResolvedCompatState, manualRoots: string[]): string {
	if (manualRoots.length === 0) return "";
	const skillLines = state.loaded
		.filter((resource) => resource.type === "skill" && resource.realPath && manualRoots.some((root) => resource.realPath?.startsWith(`${root}${path.sep}`) || resource.realPath === root))
		.map((resource) => {
			const manualRoot = manualRoots.find((root) => resource.realPath?.startsWith(`${root}${path.sep}`) || resource.realPath === root);
			const wrapperName = manualRoot ? `${slug(path.basename(manualRoot))}-${slug(resource.name ?? path.basename(resource.realPath ?? resource.path))}` : undefined;
			return `- ${wrapperName ? `/skill:${wrapperName}` : resource.name}: ${skillFileFor(resource) ?? resource.realPath}`;
		});
	if (skillLines.length === 0) return "";
	return `\n\n## Additional Skill References\n\nThese skills come from manually loaded project roots. When relevant, use the read tool to load the referenced SKILL.md before following it.\n\n${skillLines.join("\n")}\n`;
}

function readManualRootsFromSession(ctx: ExtensionContext): string[] {
	const entries = ctx.sessionManager.getEntries() as Array<{ type?: string; customType?: string; data?: unknown }>;
	const latest = [...entries].reverse().find((entry) => entry.type === "custom" && entry.customType === manualRootsEntryType);
	const data = latest?.data as { roots?: unknown } | undefined;
	return Array.isArray(data?.roots) ? data.roots.filter((root): root is string => typeof root === "string") : [];
}

function slug(value: string): string {
	const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/--+/g, "-");
	return normalized || "project";
}

function shortHash(value: string): string {
	return crypto.createHash("sha256").update(value).digest("hex").slice(0, 10);
}

function skillFileFor(resource: ResolvedCompatState["loaded"][number]): string | undefined {
	if (!resource.realPath) return undefined;
	try {
		const stat = fs.statSync(resource.realPath);
		return stat.isDirectory() ? path.join(resource.realPath, "SKILL.md") : resource.realPath;
	} catch {
		return undefined;
	}
}

function wrapperRoot(): string {
	return path.join(os.tmpdir(), "pi-multi-harness-compat", "skill-wrappers");
}

function writeSkillWrapper(wrapperDir: string, wrapperName: string, originalName: string, originalSkillFile: string | undefined, reason: string): string {
	fs.mkdirSync(wrapperDir, { recursive: true });
	fs.writeFileSync(path.join(wrapperDir, "SKILL.md"), `---\nname: ${wrapperName}\ndescription: Loads the ${originalName} skill from ${reason}. Use when work needs that guidance.\n---\n\n# ${originalName}\n\nThis is a generated wrapper for a skill discovered by multi-harness compatibility.\n\nBefore proceeding, use the read tool to load the original skill file, then follow its instructions.\n\nOriginal skill: ${originalSkillFile ?? "unknown"}\n`);
	return wrapperDir;
}

function effectiveSkillPaths(state: ResolvedCompatState, manualRoots: string[]): string[] {
	const paths: string[] = [];
	for (const skillPath of state.skillPaths) {
		const realPath = existingRealPath(skillPath) ?? skillPath;
		const resource = state.loaded.find((item) => item.type === "skill" && item.realPath === realPath);
		const originalName = resource?.name ?? slug(path.basename(realPath));
		const manualRoot = manualRoots.find((root) => realPath === root || realPath.startsWith(`${root}${path.sep}`));
		if (manualRoot) {
			const wrapperName = `${slug(path.basename(manualRoot))}-${slug(originalName)}`;
			paths.push(writeSkillWrapper(path.join(wrapperRoot(), shortHash(manualRoot), wrapperName), wrapperName, originalName, skillFileFor(resource ?? { realPath, path: realPath, type: "skill", kind: "pi", status: "loaded" }), `manual project ${manualRoot}`));
			continue;
		}
		if (path.basename(realPath) === "SKILL.md" && slug(path.basename(path.dirname(realPath))) !== slug(originalName)) {
			paths.push(writeSkillWrapper(path.join(wrapperRoot(), "standalone", shortHash(realPath), slug(originalName)), slug(originalName), originalName, skillFileFor(resource ?? { realPath, path: realPath, type: "skill", kind: "pi", status: "loaded" }), realPath));
			continue;
		}
		paths.push(skillPath);
	}
	return paths;
}

function renderStatus(state: ResolvedCompatState, manualRoots: string[]): string {
	const suppressed = state.suppressed.length ? `\nSuppressed:\n${state.suppressed.map((item) => `  - ${item.realPath ?? item.path}: ${item.reason ?? "suppressed"}${item.aliasTarget ? ` -> ${item.aliasTarget}` : ""}`).join("\n")}` : "";
	const diagnostics = state.diagnostics.length ? `\nDiagnostics:\n${state.diagnostics.map((item) => `  - ${item}`).join("\n")}` : "";
	const manual = manualRoots.length ? `\n\nManual project roots:\n${manualRoots.map((root) => `  - ${root}`).join("\n")}` : "";
	return `${conciseSummary(state)}${manual}\n\nLoaded skill paths:\n${state.skillPaths.map((item) => `  - ${item}`).join("\n") || "  (none)"}${suppressed}${diagnostics}`;
}

export default function compatWorkflows(pi: ExtensionAPI): void {
	let lastState: ResolvedCompatState | undefined;
	let runtimeProfile: string | undefined;
	let manualRoots: string[] = [];

	function addManualRootsToConfig(loaded: ReturnType<typeof loadCompatConfig>): void {
		if (manualRoots.length === 0) return;
		const profiles = loaded.config.profiles ?? {};
		loaded.config.profiles = profiles;
		for (const [name, profile] of Object.entries(profiles)) {
			profiles[name] = { ...profile, roots: [...(profile.roots ?? []), ...manualRoots] };
		}
		const defaultName = loaded.config.defaultProfile ?? "private";
		if (!profiles[defaultName]) profiles[defaultName] = { roots: manualRoots };
	}

	function resolve(ctx: ExtensionContext): ResolvedCompatState {
		const loaded = loadCompatConfig(ctx.cwd);
		if (runtimeProfile) loaded.config.defaultProfile = runtimeProfile;
		addManualRootsToConfig(loaded);
		lastState = resolveCompatState(ctx.cwd, loaded);
		return lastState;
	}

	pi.on("resources_discover", async (event) => {
		const loaded = loadCompatConfig(event.cwd);
		if (runtimeProfile) loaded.config.defaultProfile = runtimeProfile;
		addManualRootsToConfig(loaded);
		lastState = resolveCompatState(event.cwd, loaded);
		return { skillPaths: effectiveSkillPaths(lastState, manualRoots) };
	});

	pi.on("session_start", async (_event, ctx) => {
		manualRoots = readManualRootsFromSession(ctx);
		const state = resolve(ctx);
		ctx.ui.setStatus("compat", state.activeProfile.name === "private" && state.skillPaths.length === 0 && !state.contextText ? undefined : `compat:${state.activeProfile.name}`);
		ctx.ui.notify(conciseSummary(state), state.diagnostics.length ? "warning" : "info");
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const state = resolve(ctx);
		const builtInContextFiles = Array.isArray((event.systemPromptOptions as any)?.contextFiles) ? (event.systemPromptOptions as any).contextFiles.length : 0;
		const noContextWarning = builtInContextFiles > 0 ? "\n\nNote: Pi default context files also appear to be loaded. For normalized context loading, start pi with --no-context-files so this extension owns context injection." : "";
		const manualSkills = manualSkillReferenceText(state, manualRoots);
		if (!state.contextText && !manualSkills && !noContextWarning) return;
		return {
			systemPrompt: `${event.systemPrompt}\n\n# Loaded Context\n\nActive context profile: ${state.activeProfile.name} (${state.activeProfile.reason}).${noContextWarning}${state.contextText}${manualSkills}`,
		};
	});

	pi.registerCommand("harness-compat", {
		description: "Inspect or switch multi-harness compatibility profile: status | profile <name> | off | load-project <path> | unload-project <path|all>",
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			const words = trimmed.split(/\s+/).filter(Boolean);
			if (words[0] === "profile" && words[1]) runtimeProfile = words[1];
			if (words[0] === "off") runtimeProfile = "private";
			if (words[0] === "load-project") {
				const rawProjectPath = trimmed.slice("load-project".length).trim();
				if (!rawProjectPath) {
					ctx.ui.notify("Usage: /harness-compat load-project <repo path>", "warning");
					return;
				}
				const resolved = existingRealPath(resolvePath(rawProjectPath, ctx.cwd));
				if (!resolved) {
					ctx.ui.notify(`Project path not found: ${rawProjectPath}`, "error");
					return;
				}
				manualRoots = [...manualRoots.filter((root) => root !== resolved), resolved];
				pi.appendEntry(manualRootsEntryType, { roots: manualRoots });
				ctx.ui.notify(`Loaded project for this session: ${resolved}. Reloading resources so native /skill commands are available.`, "info");
				await ctx.reload();
				return;
			}
			if (words[0] === "unload-project") {
				const rawProjectPath = trimmed.slice("unload-project".length).trim();
				if (!rawProjectPath || rawProjectPath === "all") manualRoots = [];
				else {
					const resolved = existingRealPath(resolvePath(rawProjectPath, ctx.cwd));
					manualRoots = manualRoots.filter((root) => root !== (resolved ?? rawProjectPath));
				}
				pi.appendEntry(manualRootsEntryType, { roots: manualRoots });
				ctx.ui.notify("Updated session project roots. Reloading resources.", "info");
				await ctx.reload();
				return;
			}
			const state = resolve(ctx);
			ctx.ui.notify(renderStatus(state, manualRoots), state.diagnostics.length ? "warning" : "info");
		},
	});

	pi.registerTool({
		name: "multi_harness_compat_state",
		label: "Multi-Harness Compatibility State",
		description: "Inspect the active multi-harness compatibility profile, loaded resources, suppressed duplicates, and diagnostics. Read-only.",
		parameters: Type.Object({
			includeResources: Type.Optional(Type.Boolean({ description: "Include loaded resource rows in addition to counts and suppressed diagnostics. Default false." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const state = resolve(ctx);
			const payload = statePayload(state, manualRoots, Boolean((params as { includeResources?: boolean }).includeResources));
			return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], details: payload };
		},
	});
}
