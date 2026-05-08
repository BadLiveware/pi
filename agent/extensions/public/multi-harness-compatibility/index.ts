import { Type } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { loadCompatConfig } from "./src/config.ts";
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

function statePayload(state: ResolvedCompatState, includeResources = false): Record<string, unknown> {
	return {
		cwd: state.cwd,
		repoRoot: state.repoRoot,
		profile: state.activeProfile.name,
		profileReason: state.activeProfile.reason,
		summary: summarizeState(state),
		skillPaths: state.skillPaths,
		diagnostics: state.diagnostics,
		loadedCounts: state.loaded.reduce<Record<string, number>>((counts, resource) => {
			counts[resource.type] = (counts[resource.type] ?? 0) + 1;
			return counts;
		}, {}),
		suppressed: state.suppressed.map(compactResource),
		loaded: includeResources ? state.loaded.map(compactResource) : undefined,
	};
}

function renderStatus(state: ResolvedCompatState): string {
	const suppressed = state.suppressed.length ? `\nSuppressed:\n${state.suppressed.map((item) => `  - ${item.realPath ?? item.path}: ${item.reason ?? "suppressed"}${item.aliasTarget ? ` -> ${item.aliasTarget}` : ""}`).join("\n")}` : "";
	const diagnostics = state.diagnostics.length ? `\nDiagnostics:\n${state.diagnostics.map((item) => `  - ${item}`).join("\n")}` : "";
	return `${summarizeState(state)}\n\nLoaded skill paths:\n${state.skillPaths.map((item) => `  - ${item}`).join("\n") || "  (none)"}${suppressed}${diagnostics}`;
}

export default function compatWorkflows(pi: ExtensionAPI): void {
	let lastState: ResolvedCompatState | undefined;
	let runtimeProfile: string | undefined;

	function resolve(ctx: ExtensionContext): ResolvedCompatState {
		const loaded = loadCompatConfig(ctx.cwd);
		if (runtimeProfile) loaded.config.defaultProfile = runtimeProfile;
		lastState = resolveCompatState(ctx.cwd, loaded);
		return lastState;
	}

	pi.on("resources_discover", async (event) => {
		const loaded = loadCompatConfig(event.cwd);
		if (runtimeProfile) loaded.config.defaultProfile = runtimeProfile;
		lastState = resolveCompatState(event.cwd, loaded);
		return { skillPaths: lastState.skillPaths };
	});

	pi.on("session_start", async (_event, ctx) => {
		const state = resolve(ctx);
		ctx.ui.setStatus("compat", state.activeProfile.name === "private" && state.skillPaths.length === 0 && !state.contextText ? undefined : `compat:${state.activeProfile.name}`);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const state = resolve(ctx);
		const builtInContextFiles = Array.isArray((event.systemPromptOptions as any)?.contextFiles) ? (event.systemPromptOptions as any).contextFiles.length : 0;
		const noContextWarning = builtInContextFiles > 0 ? "\n\nNote: Pi default context files also appear to be loaded. For normalized context loading, start pi with --no-context-files so this extension owns context injection." : "";
		if (!state.contextText && !noContextWarning) return;
		return {
			systemPrompt: `${event.systemPrompt}\n\n# Loaded Context\n\nActive context profile: ${state.activeProfile.name} (${state.activeProfile.reason}).${noContextWarning}${state.contextText}`,
		};
	});

	pi.registerCommand("harness-compat", {
		description: "Inspect or switch multi-harness compatibility profile: status | profile <name> | off",
		handler: async (args, ctx) => {
			const words = args.trim().split(/\s+/).filter(Boolean);
			if (words[0] === "profile" && words[1]) runtimeProfile = words[1];
			if (words[0] === "off") runtimeProfile = "private";
			const state = resolve(ctx);
			ctx.ui.notify(renderStatus(state), state.diagnostics.length ? "warning" : "info");
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
			const payload = statePayload(state, Boolean((params as { includeResources?: boolean }).includeResources));
			return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], details: payload };
		},
	});
}
