import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { BrowserBridgeServer } from "../../bridge-server/lifecycle.ts";
import type { PreviewServer } from "../../preview/server.ts";
import type { BrowserBridgeRuntime } from "../../core/state.ts";

interface OpenPreviewParams {
	title?: string;
	html?: string;
	path?: string;
	url?: string;
	mode?: "new-tab" | "reuse-preview-tab";
}

export function registerOpenPreviewTool(pi: ExtensionAPI, runtime: BrowserBridgeRuntime, bridgeServer: BrowserBridgeServer, previewServer: PreviewServer): void {
	pi.registerTool({
		name: "browser_bridge_open_preview",
		label: "Open Browser Preview",
		description: "Open a local preview page or existing URL in the connected browser extension, returning the URL when no browser client is connected.",
		promptSnippet: "Create/open local preview pages or existing URLs for browser viewing through the browser bridge.",
		promptGuidelines: [
			"Use browser_bridge_open_preview when you create a local HTML preview or want to show the user a browser page automatically.",
			"browser_bridge_open_preview returns a URL even when no browser client is connected; give that URL to the user as a fallback.",
		],
		parameters: Type.Object({
			title: Type.Optional(Type.String({ description: "Preview title used for generated artifact naming." })),
			html: Type.Optional(Type.String({ description: "Inline HTML to write to a temporary localhost-served preview artifact." })),
			path: Type.Optional(Type.String({ description: "Workspace-relative HTML file path to copy and serve through localhost. A leading @ is accepted." })),
			url: Type.Optional(Type.String({ description: "Existing URL to open without creating a preview artifact." })),
			mode: Type.Optional(Type.Union([Type.Literal("new-tab"), Type.Literal("reuse-preview-tab")], { description: "Open behavior for connected browser extension. Default new-tab." })),
		}),
		async execute(_toolCallId: string, params: OpenPreviewParams, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			const preview = await resolvePreviewUrl(params, ctx, previewServer);
			const opened = await tryOpenInBrowser(runtime, bridgeServer, preview.url, params.mode ?? "new-tab");
			return {
				content: [{ type: "text", text: opened ? `Opened preview: ${preview.url}` : `Preview ready: ${preview.url}` }],
				details: { ...preview, opened },
			};
		},
	});
}

export async function resolvePreviewUrl(params: OpenPreviewParams, ctx: Pick<ExtensionContext, "cwd">, previewServer: PreviewServer): Promise<{ url: string; path?: string; source: "html" | "path" | "url" }> {
	const sources = [params.html !== undefined, params.path !== undefined, params.url !== undefined].filter(Boolean).length;
	if (sources !== 1) throw new Error("Provide exactly one of html, path, or url.");
	if (params.url !== undefined) return { url: validatePreviewUrl(params.url), source: "url" };
	if (params.html !== undefined) {
		const artifact = await previewServer.writeHtml(params.title, params.html);
		return { ...artifact, source: "html" };
	}
	const artifact = await previewServer.copyWorkspaceFile(ctx.cwd, params.path!);
	return { ...artifact, source: "path" };
}

async function tryOpenInBrowser(runtime: BrowserBridgeRuntime, server: BrowserBridgeServer, url: string, mode: "new-tab" | "reuse-preview-tab"): Promise<boolean> {
	const client = runtime.state.clients[0];
	if (!client) return false;
	const response = await server.sendRequestToClient(client.clientId, "open-preview", { url, mode }, { timeoutMs: 10_000 });
	if (response.type === "error") throw new Error(typeof response.payload === "object" && response.payload !== null && typeof (response.payload as { message?: unknown }).message === "string" ? (response.payload as { message: string }).message : "Browser preview open failed.");
	return true;
}

function validatePreviewUrl(raw: string): string {
	const url = new URL(raw);
	if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Preview URL must be http or https.");
	return url.toString();
}
