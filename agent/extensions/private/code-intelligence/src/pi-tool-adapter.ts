import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.ts";
import type { CodeIntelEnv, CodeIntelMutationPolicy } from "./standalone/env.ts";
import type { CodeIntelToolResult, CodeIntelToolSpec, JsonObjectSchema } from "./tool-registry.ts";

export function codeIntelEnvForPiContext(ctx: ExtensionContext, mutationPolicy: CodeIntelMutationPolicy = "enabled"): CodeIntelEnv {
	const loadedConfig = loadConfig(ctx);
	return {
		cwd: ctx.cwd,
		config: loadedConfig.config,
		configPaths: { ...loadedConfig.paths, standaloneUser: "" },
		loadedConfig: loadedConfig.loaded,
		configDiagnostics: loadedConfig.diagnostics,
		mutationPolicy,
		pathBase: "repo",
	};
}

export interface RegisterCodeIntelSpecToolOptions<P> {
	renderCall?: any;
	renderResult?: any;
	mutationPolicy?: CodeIntelMutationPolicy;
	prepareParams?: (params: P, ctx: ExtensionContext, env: CodeIntelEnv, signal: AbortSignal | undefined) => P | Promise<P>;
	afterResult?: (result: CodeIntelToolResult, params: P, ctx: ExtensionContext, env: CodeIntelEnv) => void | Promise<void>;
}

export function parametersFromJsonSchema(schema: JsonObjectSchema): any {
	return Type.Unsafe(schema as any) as any;
}

export function registerCodeIntelSpecTool<P>(pi: ExtensionAPI, spec: CodeIntelToolSpec<P>, options: RegisterCodeIntelSpecToolOptions<P> = {}): void {
	pi.registerTool({
		name: spec.name,
		label: spec.title,
		description: spec.description,
		promptSnippet: spec.promptSnippet,
		promptGuidelines: spec.promptGuidelines,
		renderCall: options.renderCall,
		renderResult: options.renderResult,
		parameters: parametersFromJsonSchema(spec.inputSchema),
		async execute(_toolCallId: string, params: P, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			const env = codeIntelEnvForPiContext(ctx, options.mutationPolicy ?? "enabled");
			const effectiveParams = options.prepareParams ? await options.prepareParams(params, ctx, env, signal) : params;
			const result = await spec.run(effectiveParams, env, signal);
			await options.afterResult?.(result, effectiveParams, ctx, env);
			return { content: [{ type: "text", text: result.contentText }], details: result.details };
		},
	});
}
