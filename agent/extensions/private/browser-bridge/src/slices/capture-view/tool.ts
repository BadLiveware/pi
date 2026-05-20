import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { BrowserBridgeServer } from "../../bridge-server/lifecycle.ts";
import type { BridgeEnvelope } from "../../core/protocol.ts";
import type { BrowserBridgeRuntime } from "../../core/state.ts";
import { chooseSelectionTarget } from "../select-elements/tool.ts";

interface CaptureViewParams {
	target?: { clientId?: string; tabId?: number };
	timeoutMs?: number;
}

export function registerCaptureViewTool(pi: ExtensionAPI, runtime: BrowserBridgeRuntime, server: BrowserBridgeServer): void {
	pi.registerTool({
		name: "browser_bridge_capture_view",
		label: "Capture Browser View",
		description: "Capture the activated browser tab's current visible web viewport as an image artifact for visual verification. Does not mutate the page and does not include browser chrome.",
		promptSnippet: "Capture the activated browser tab's visible web viewport as a screenshot artifact for visual verification.",
		promptGuidelines: [
			"Use browser_bridge_capture_view when you need to verify what the page actually looks like without changing it.",
			"Use browser_bridge_capture_view after browser_bridge_design_preview when the returned preview snapshot is cropped, confusing, or may not match the user's visible viewport.",
			"browser_bridge_capture_view captures web content only, not the browser toolbar, tabs, or DevTools chrome.",
		],
		parameters: Type.Object({
			target: Type.Optional(Type.Object({
				clientId: Type.Optional(Type.String({ description: "Specific connected browser client id. Defaults to the active connected client." })),
				tabId: Type.Optional(Type.Number({ description: "Specific activated tab id. Defaults to the client's active tab." })),
			}, { description: "Optional connected browser client/tab target." })),
			timeoutMs: Type.Optional(Type.Number({ description: "Viewport capture request timeout in milliseconds. Default 10000." })),
		}),
		async execute(_toolCallId: string, params: CaptureViewParams, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: ExtensionContext) {
			const target = chooseSelectionTarget(runtime, params);
			const timeoutMs = clampTimeout(params.timeoutMs);
			const response = await server.sendRequestToClient(target.client.clientId, "capture-view", {}, { timeoutMs, target: { tabId: target.tab.tabId } });
			return formatCaptureViewToolResult(response);
		},
	});
}

export function formatCaptureViewToolResult(response: BridgeEnvelope): { content: Array<{ type: "text"; text: string }>; details: unknown } {
	if (response.type === "error") throw new Error(errorMessage(response.payload));
	const payload = isRecord(response.payload) ? { ...response.payload } : {};
	if (isRecord(payload.snapshot)) payload.snapshot = materializeSnapshot(payload.snapshot);
	const snapshot = isRecord(payload.snapshot) ? payload.snapshot : undefined;
	const lines = [typeof snapshot?.path === "string" ? `Browser viewport captured: ${snapshot.path}` : "Browser viewport capture completed without an image artifact."];
	if (isRecord(snapshot?.viewport) && typeof snapshot.viewport.width === "number" && typeof snapshot.viewport.height === "number") lines.push(`viewport: ${snapshot.viewport.width}x${snapshot.viewport.height}`);
	return { content: [{ type: "text", text: lines.join("\n") }], details: payload };
}

function materializeSnapshot(snapshot: Record<string, unknown>): Record<string, unknown> {
	const mediaType = stringValue(snapshot.mediaType) ?? mediaTypeFromDataUrl(stringValue(snapshot.dataUrl));
	const path = writeSnapshotDataUrl(stringValue(snapshot.dataUrl), mediaType);
	const { dataUrl: _dataUrl, ...rest } = snapshot;
	return { ...rest, ...(mediaType ? { mediaType } : {}), ...(path ? { path } : {}) };
}

function writeSnapshotDataUrl(dataUrl: string | undefined, mediaType: string | undefined): string | undefined {
	const match = dataUrl ? /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl) : undefined;
	if (!match) return undefined;
	const type = mediaType ?? match[1];
	const extension = type === "image/jpeg" ? "jpg" : "png";
	const directory = join(tmpdir(), "pi-browser-bridge-captures");
	mkdirSync(directory, { recursive: true });
	const path = join(directory, `capture-${Date.now()}-${Math.random().toString(16).slice(2)}.${extension}`);
	writeFileSync(path, Buffer.from(match[2]!, "base64"));
	return path;
}

function mediaTypeFromDataUrl(dataUrl: string | undefined): string | undefined {
	return dataUrl ? /^data:([^;,]+)/.exec(dataUrl)?.[1] : undefined;
}

function errorMessage(payload: unknown): string {
	return isRecord(payload) && typeof payload.message === "string" ? payload.message : "Browser viewport capture failed.";
}

function clampTimeout(value: number | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return 10_000;
	return Math.min(60_000, Math.max(1_000, Math.trunc(value)));
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
