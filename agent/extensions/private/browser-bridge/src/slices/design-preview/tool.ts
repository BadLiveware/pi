import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { BrowserBridgeServer } from "../../bridge-server/lifecycle.ts";
import type { BridgeEnvelope } from "../../core/protocol.ts";
import type { BrowserBridgeRuntime, BrowserDesignPreviewSummary } from "../../core/state.ts";
import { chooseSelectionTarget } from "../select-elements/tool.ts";
import { resolveElementDescriptorFromSharedSelection } from "../shared-selection-target.ts";

interface DesignPreviewParams {
	target?: { clientId?: string; tabId?: number };
	commands: unknown[];
	captureAfter?: boolean | { mode?: "affected" | "viewport"; padding?: number };
	timeoutMs?: number;
}

export function registerDesignPreviewTool(pi: ExtensionAPI, runtime: BrowserBridgeRuntime, server: BrowserBridgeServer): void {
	pi.registerTool({
		name: "browser_bridge_design_preview",
		label: "Browser Design Preview",
		description: "Apply, copy, list, or clear reversible temporary HTML/CSS design preview patches in an activated browser tab through the companion extension. Does not edit source files or evaluate arbitrary JavaScript.",
		promptSnippet: "Apply reversible live design preview patches such as temporary styles, copied computed styles, text, or sanitized HTML to selected elements or selectors.",
		promptGuidelines: [
			"Use browser_bridge_design_preview when the user wants a live visual preview of design changes before source edits.",
			"Prefer selectionId plus selectionIndex from browser_bridge_state or shared selection context; this lets browser_bridge_design_preview validate the target against stored descriptor context and avoid stale element-id collisions.",
			"If browser_bridge_design_preview reports that a shared selection is stale, ask the user to share/select the element again instead of calling browser_bridge_select_elements yourself.",
			"Selector and elementId targets are also supported for explicit current-page targets; keep changes temporary until the user approves source edits.",
			"Use browser_bridge_inspect_styles before browser_bridge_design_preview when matching an existing page style, or browser_bridge_copy_styles when directly copying computed properties from one element to another.",
			"For layout, spacing, sizing, or other vague visual changes, inspect the snapshot path returned by browser_bridge_design_preview instead of relying only on computed CSS.",
			"Pass captureAfter:false only when a screenshot would be unnecessary or disruptive; mutating preview commands capture a full viewport snapshot by default so layout context is visible.",
			"Use clear after an experiment or before applying conflicting preview patches.",
		],
		parameters: Type.Object({
			target: Type.Optional(Type.Object({
				clientId: Type.Optional(Type.String({ description: "Specific connected browser client id. Defaults to the active connected client." })),
				tabId: Type.Optional(Type.Number({ description: "Specific activated tab id. Defaults to the client's active tab." })),
			})),
			commands: Type.Array(Type.Record(Type.String(), Type.Unknown()), { description: "Ordered design preview commands: style, copy-styles, text, html, clear, or list. Mutating commands may target selector/elementId or selectionId plus selectionIndex from shared selection state." }),
			captureAfter: Type.Optional(Type.Union([
				Type.Boolean(),
				Type.Object({
					mode: Type.Optional(Type.Union([Type.Literal("affected"), Type.Literal("viewport")], { description: "Capture affected element region (default) or full viewport." })),
					padding: Type.Optional(Type.Number({ description: "Extra viewport pixels around affected elements for cropped captures. Default 96." })),
				}),
			], { description: "Capture a post-preview screenshot artifact. Mutating commands default to a full viewport capture; pass false to disable." })),
			timeoutMs: Type.Optional(Type.Number({ description: "Design preview request timeout in milliseconds. Default 10000." })),
		}),
		async execute(_toolCallId: string, params: DesignPreviewParams, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: ExtensionContext) {
			const target = chooseSelectionTarget(runtime, params);
			const timeoutMs = clampTimeout(params.timeoutMs);
			const commands = normalizeDesignPreviewCommands(params.commands, runtime, target);
			const response = await server.sendRequestToClient(target.client.clientId, "design-preview", { commands, captureAfter: normalizeCaptureAfter(params.captureAfter, commands) }, { timeoutMs, target: { tabId: target.tab.tabId } });
			const result = formatDesignPreviewToolResult(response);
			updateDesignPreviewState(runtime, target.client.clientId, target.tab.tabId, result.details);
			return result;
		},
	});
}

export function normalizeDesignPreviewCommands(commands: unknown[], runtime?: BrowserBridgeRuntime, target?: { client: { clientId: string }; tab: { tabId?: number } }): unknown[] {
	return commands.map((command) => normalizeDesignPreviewCommand(command, runtime, target));
}

function normalizeDesignPreviewCommand(command: unknown, runtime: BrowserBridgeRuntime | undefined, target: { client: { clientId: string }; tab: { tabId?: number } } | undefined): unknown {
	if (!isRecord(command)) return { action: "list" };
	const selectionId = stringValue(command.selectionId);
	const selectionIndex = numberValue(command.selectionIndex);
	if (!runtime || !target || (!selectionId && selectionIndex === undefined)) return command;
	const resolved = resolveElementDescriptorFromSharedSelection(runtime, target, selectionId, selectionIndex);
	if (!resolved) return command;
	const expected = resolved.element;
	const selector = expected.selectorCandidates?.[0];
	return {
		...command,
		selectionId: resolved.selection.selectionId,
		selectionIndex: resolved.index,
		...(expected.elementId ? { elementId: expected.elementId } : selector ? { selector } : {}),
		expected,
	};
}

export function normalizeCaptureAfter(value: DesignPreviewParams["captureAfter"], commands: unknown[]): DesignPreviewParams["captureAfter"] | undefined {
	if (value !== undefined) return value;
	return commands.some((command) => isRecord(command) && command.action !== "list") ? { mode: "viewport" } : undefined;
}

export function formatDesignPreviewToolResult(response: BridgeEnvelope): { content: Array<{ type: "text"; text: string }>; details: unknown } {
	if (response.type === "error") throw new Error(errorMessage(response.payload));
	const payload = materializeDesignPreviewPayload(response.payload);
	const applied = numberValue(payload.applied) ?? 0;
	const cleared = numberValue(payload.cleared) ?? 0;
	const active = Array.isArray(payload.active) ? payload.active.length : 0;
	const lines = [`Design preview updated: ${applied} applied, ${cleared} cleared, ${active} active patch(es).`];
	if (Array.isArray(payload.results)) {
		for (const result of payload.results.slice(0, 10)) {
			if (!isRecord(result)) continue;
			const ok = result.ok === false ? "✗" : "✓";
			const action = typeof result.action === "string" ? result.action : "command";
			const summary = typeof result.summary === "string" ? result.summary : "No summary.";
			lines.push(`${ok} ${action}: ${summary}`);
			lines.push(...formatComputedAfterLines(result));
		}
	}
	const snapshot = isRecord(payload.snapshot) ? payload.snapshot : undefined;
	if (typeof snapshot?.path === "string") lines.push(`snapshot: ${snapshot.path}`);
	const userFeedback = isRecord(payload.userFeedback) ? payload.userFeedback : undefined;
	if (userFeedback) {
		const status = typeof userFeedback.status === "string" ? userFeedback.status : "unknown";
		const text = typeof userFeedback.text === "string" && userFeedback.text.length > 0 ? ` — ${clipText(userFeedback.text, 300)}` : "";
		lines.push(`user feedback: ${status}${text}`);
	}
	return { content: [{ type: "text", text: lines.join("\n") }], details: payload };
}

export function updateDesignPreviewState(runtime: BrowserBridgeRuntime, clientId: string | undefined, tabId: number | undefined, payload: unknown): void {
	const active = isRecord(payload) && Array.isArray(payload.active) ? payload.active : [];
	runtime.state.designPreviews = active.map((item) => parseDesignPreviewSummary(item, clientId, tabId)).filter((item): item is BrowserDesignPreviewSummary => Boolean(item)).slice(-50);
}

function parseDesignPreviewSummary(value: unknown, clientId: string | undefined, tabId: number | undefined): BrowserDesignPreviewSummary | undefined {
	if (!isRecord(value)) return undefined;
	const patchId = stringValue(value.patchId);
	const action = stringValue(value.action);
	const summary = stringValue(value.summary);
	const elementCount = numberValue(value.elementCount);
	const createdAt = numberValue(value.createdAt);
	if (!patchId || !action || !summary || elementCount === undefined || createdAt === undefined) return undefined;
	return {
		patchId,
		...(clientId ? { clientId } : {}),
		...(tabId === undefined ? {} : { tabId }),
		action,
		...(stringValue(value.selector) ? { selector: stringValue(value.selector) } : {}),
		...(stringValue(value.elementId) ? { elementId: stringValue(value.elementId) } : {}),
		elementCount,
		summary,
		createdAt,
	};
}

function materializeDesignPreviewPayload(payload: unknown): Record<string, unknown> {
	const record = isRecord(payload) ? { ...payload } : {};
	if (isRecord(record.snapshot)) record.snapshot = materializeSnapshot(record.snapshot);
	return record;
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
	const directory = join(tmpdir(), "pi-browser-bridge-previews");
	mkdirSync(directory, { recursive: true });
	const path = join(directory, `preview-${Date.now()}-${Math.random().toString(16).slice(2)}.${extension}`);
	writeFileSync(path, Buffer.from(match[2]!, "base64"));
	return path;
}

function mediaTypeFromDataUrl(dataUrl: string | undefined): string | undefined {
	return dataUrl ? /^data:([^;,]+)/.exec(dataUrl)?.[1] : undefined;
}

function formatComputedAfterLines(result: Record<string, unknown>): string[] {
	const computedAfter = Array.isArray(result.computedAfter) ? result.computedAfter : [];
	return computedAfter.slice(0, 3).map((entry, index) => {
		if (!isRecord(entry)) return undefined;
		const label = formatComputedElementLabel(entry);
		const styles = isRecord(entry.styles) ? entry.styles : {};
		const preferred = ["background-color", "background-image", "color", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color", "display", "padding-left", "padding-right", "width", "height"];
		const pairs = preferred
			.map((property) => [property, typeof styles[property] === "string" ? styles[property] : undefined] as const)
			.filter((pair): pair is readonly [string, string] => Boolean(pair[1]))
			.slice(0, 8)
			.map(([property, value]) => `${property}=${clipText(value, 80)}`)
			.join("; ");
		return `  after ${index + 1}${label ? ` ${label}` : ""}: ${pairs || "computed styles captured"}`;
	}).filter((line): line is string => Boolean(line));
}

function formatComputedElementLabel(entry: Record<string, unknown>): string {
	const descriptor = isRecord(entry.descriptor) ? entry.descriptor : {};
	const selectors = Array.isArray(descriptor.selectorCandidates) ? descriptor.selectorCandidates.filter((selector): selector is string => typeof selector === "string") : [];
	const elementId = typeof descriptor.elementId === "string" ? descriptor.elementId : undefined;
	const selector = selectors[0] ?? (typeof descriptor.tagName === "string" ? descriptor.tagName : undefined) ?? elementId;
	if (!selector && !elementId) return "";
	const idSuffix = elementId && elementId !== selector ? ` [${elementId}]` : "";
	return `${selector ?? "element"}${idSuffix}`;
}

function clipText(value: string, maxChars: number): string {
	return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function errorMessage(payload: unknown): string {
	return isRecord(payload) && typeof payload.message === "string" ? payload.message : "Browser design preview failed.";
}

function clampTimeout(value: number | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return 10_000;
	return Math.min(60_000, Math.max(1_000, Math.trunc(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
