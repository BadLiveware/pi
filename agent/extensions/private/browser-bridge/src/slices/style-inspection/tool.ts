import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { BrowserBridgeServer } from "../../bridge-server/lifecycle.ts";
import type { BridgeEnvelope } from "../../core/protocol.ts";
import type { BrowserBridgeRuntime } from "../../core/state.ts";
import { formatDesignPreviewToolResult, updateDesignPreviewState } from "../design-preview/tool.ts";
import { chooseSelectionTarget } from "../select-elements/tool.ts";
import { resolveSharedElementTarget, type BrowserTarget, type SharedStyleElementInput } from "../shared-selection-target.ts";

export type StyleInspectPreset = "colors" | "box" | "typography" | "layout" | "images" | "all";

type StyleElementInput = SharedStyleElementInput;

interface InspectStylesParams {
	target?: { clientId?: string; tabId?: number };
	element?: StyleElementInput;
	properties?: string[];
	presets?: StyleInspectPreset[];
	includeAncestors?: boolean;
	maxAncestors?: number;
	includeCssVariables?: boolean;
	maxCssVariables?: number;
	maxElements?: number;
	timeoutMs?: number;
}

interface CopyStylesParams {
	target?: { clientId?: string; tabId?: number };
	sourceElement?: StyleElementInput;
	targetElement?: StyleElementInput;
	properties?: string[];
	presets?: StyleInspectPreset[];
	patchId?: string;
	limit?: number;
	timeoutMs?: number;
}

const STYLE_ELEMENT_SCHEMA = Type.Object({
	elementId: Type.Optional(Type.String({ description: "Stable element id from browser_bridge_select_elements, shared selection details, style inspection, or design-preview computedAfter." })),
	selector: Type.Optional(Type.String({ description: "CSS selector to resolve in the activated tab." })),
	selectionId: Type.Optional(Type.String({ description: "Shared selection id from browser_bridge_state details. Defaults to the latest matching shared selection when omitted." })),
	selectionIndex: Type.Optional(Type.Number({ description: "Element index within the chosen shared selection. Default 0." })),
});

const PRESET_SCHEMA = Type.Array(Type.Union([
	Type.Literal("colors"),
	Type.Literal("box"),
	Type.Literal("typography"),
	Type.Literal("layout"),
	Type.Literal("images"),
	Type.Literal("all"),
]), { description: "Computed style presets to include. Default for inspection: colors, box, typography, layout, images. Default for copy: colors." });

export function registerStyleInspectionTools(pi: ExtensionAPI, runtime: BrowserBridgeRuntime, server: BrowserBridgeServer): void {
	pi.registerTool({
		name: "browser_bridge_inspect_styles",
		label: "Inspect Browser Styles",
		description: "Inspect computed styles, CSS variables, image/layout hints, dimensions, and ancestor context for selected elements or selectors in an activated browser tab.",
		promptSnippet: "Inspect computed styles for selected browser elements, including colors, box model, typography, layout, images, CSS variables, and ancestors.",
		promptGuidelines: [
			"Use browser_bridge_inspect_styles when the user asks what color, font, spacing, dimensions, image, or computed CSS a visible browser element has.",
			"Prefer a selectionId from browser_bridge_state or shared selection context. If no element is supplied, browser_bridge_inspect_styles defaults to the latest matching shared selection element and validates it against stored descriptor context.",
			"Use browser_bridge_inspect_styles before browser_bridge_design_preview or browser_bridge_copy_styles when matching an existing page style.",
			"If browser_bridge_inspect_styles reports that a shared selection is stale, ask the user to share/select the element again instead of calling browser_bridge_select_elements yourself.", 
		],
		parameters: Type.Object({
			target: Type.Optional(Type.Object({
				clientId: Type.Optional(Type.String({ description: "Specific connected browser client id. Defaults to the active connected client." })),
				tabId: Type.Optional(Type.Number({ description: "Specific activated tab id. Defaults to the client's active tab." })),
			}, { description: "Optional connected browser client/tab target." })),
			element: Type.Optional(STYLE_ELEMENT_SCHEMA),
			properties: Type.Optional(Type.Array(Type.String(), { description: "Exact computed CSS properties to include, e.g. background-color, color, padding-left." })),
			presets: Type.Optional(PRESET_SCHEMA),
			includeAncestors: Type.Optional(Type.Boolean({ description: "Include parent/ancestor descriptors with layout-relevant styles. Default true." })),
			maxAncestors: Type.Optional(Type.Number({ description: "Maximum ancestors to include. Default 3." })),
			includeCssVariables: Type.Optional(Type.Boolean({ description: "Include capped CSS custom properties from computed style. Default true." })),
			maxCssVariables: Type.Optional(Type.Number({ description: "Maximum CSS custom properties to include. Default 24." })),
			maxElements: Type.Optional(Type.Number({ description: "Maximum selector matches to inspect. Default 20." })),
			timeoutMs: Type.Optional(Type.Number({ description: "Style inspection request timeout in milliseconds. Default 10000." })),
		}),
		async execute(_toolCallId: string, params: InspectStylesParams, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: ExtensionContext) {
			const target = chooseSelectionTarget(runtime, params);
			const element = resolveStyleElementTarget(runtime, target, params.element, { fallbackSelectionOffset: 0, role: "style inspection target" });
			const timeoutMs = clampTimeout(params.timeoutMs);
			const response = await server.sendRequestToClient(target.client.clientId, "style-inspection", {
				element,
				properties: normalizeStringArray(params.properties),
				presets: normalizePresetArray(params.presets),
				includeAncestors: params.includeAncestors !== false,
				maxAncestors: params.maxAncestors,
				includeCssVariables: params.includeCssVariables !== false,
				maxCssVariables: params.maxCssVariables,
				maxElements: params.maxElements,
			}, { timeoutMs, target: { tabId: target.tab.tabId } });
			return formatStyleInspectionToolResult(response);
		},
	});

	pi.registerTool({
		name: "browser_bridge_copy_styles",
		label: "Copy Browser Styles",
		description: "Copy computed CSS properties from one selected browser element to another as a reversible design-preview patch. Does not edit source files.",
		promptSnippet: "Copy computed CSS properties from one selected browser element to another as a reversible live design preview patch.",
		promptGuidelines: [
			"Use browser_bridge_copy_styles when the user asks to make one visible element match another element's colors, typography, spacing, layout, or image styling.",
			"Prefer explicit sourceElement and targetElement ids from shared selections or browser_bridge_select_elements. If omitted after two shared selections, browser_bridge_copy_styles treats the previous selection as source and the latest selection as target.",
			"Use browser_bridge_inspect_styles first when you need to know which exact properties should be copied, then pass properties or presets explicitly.",
		],
		parameters: Type.Object({
			target: Type.Optional(Type.Object({
				clientId: Type.Optional(Type.String({ description: "Specific connected browser client id. Defaults to the active connected client." })),
				tabId: Type.Optional(Type.Number({ description: "Specific activated tab id. Defaults to the client's active tab." })),
			}, { description: "Optional connected browser client/tab target." })),
			sourceElement: Type.Optional(STYLE_ELEMENT_SCHEMA),
			targetElement: Type.Optional(STYLE_ELEMENT_SCHEMA),
			properties: Type.Optional(Type.Array(Type.String(), { description: "Exact computed CSS properties to copy. Default comes from presets, or colors when presets is omitted." })),
			presets: Type.Optional(PRESET_SCHEMA),
			patchId: Type.Optional(Type.String({ description: "Stable preview patch id to create or replace. Generated when omitted." })),
			limit: Type.Optional(Type.Number({ description: "Maximum target elements for selector targets. Default 20, max 100." })),
			timeoutMs: Type.Optional(Type.Number({ description: "Copy-style preview request timeout in milliseconds. Default 10000." })),
		}),
		async execute(_toolCallId: string, params: CopyStylesParams, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: ExtensionContext) {
			const target = chooseSelectionTarget(runtime, params);
			const targetElement = resolveStyleElementTarget(runtime, target, params.targetElement, { fallbackSelectionOffset: 0, role: "copy target element" });
			const sourceElement = resolveStyleElementTarget(runtime, target, params.sourceElement, { fallbackSelectionOffset: params.targetElement ? 0 : 1, role: "copy source element" });
			if (sourceElement.elementId && sourceElement.elementId === targetElement.elementId && !params.sourceElement && !params.targetElement) {
				throw new Error("Copy styles needs two different selections, or explicit sourceElement and targetElement targets.");
			}
			const command = {
				action: "copy-styles",
				source: sourceElement,
				...targetElement,
				properties: normalizeStringArray(params.properties),
				presets: normalizePresetArray(params.presets),
				...(params.patchId ? { patchId: params.patchId } : {}),
				...(typeof params.limit === "number" ? { limit: params.limit } : {}),
			};
			const timeoutMs = clampTimeout(params.timeoutMs);
			const response = await server.sendRequestToClient(target.client.clientId, "design-preview", { commands: [command] }, { timeoutMs, target: { tabId: target.tab.tabId } });
			const result = formatDesignPreviewToolResult(response);
			updateDesignPreviewState(runtime, target.client.clientId, target.tab.tabId, response.payload);
			return result;
		},
	});
}

export function resolveStyleElementTarget(runtime: BrowserBridgeRuntime, target: BrowserTarget, input: StyleElementInput | undefined, options: { fallbackSelectionOffset: number; role: string }): { elementId?: string; selector?: string; selectionId?: string; selectionIndex?: number; expected?: unknown; limit?: number } {
	return resolveSharedElementTarget(runtime, target, input, options);
}

export function formatStyleInspectionToolResult(response: BridgeEnvelope): { content: Array<{ type: "text"; text: string }>; details: unknown } {
	if (response.type === "error") throw new Error(errorMessage(response.payload));
	const payload = isRecord(response.payload) ? response.payload : {};
	if (payload.ok === false) throw new Error(typeof payload.error === "string" ? payload.error : "Browser style inspection failed.");
	const elements = Array.isArray(payload.elements) ? payload.elements : [];
	const lines = [`Style inspection: ${elements.length} element(s).`];
	elements.slice(0, 5).forEach((element, index) => {
		if (!isRecord(element)) return;
		lines.push(`${index + 1}. ${formatStyleElementLabel(element)}`);
		const summary = styleSummary(element);
		if (summary) lines.push(`   ${summary}`);
		const images = imageSummary(element);
		if (images) lines.push(`   images: ${images}`);
		const variables = cssVariableCount(element);
		if (variables > 0) lines.push(`   css variables: ${variables}`);
		const ancestors = Array.isArray(element.ancestors) ? element.ancestors.length : 0;
		if (ancestors > 0) lines.push(`   ancestors: ${ancestors}`);
	});
	if (elements.length > 5) lines.push(`… ${elements.length - 5} more element(s).`);
	return { content: [{ type: "text", text: lines.join("\n") }], details: response.payload };
}

function formatStyleElementLabel(element: Record<string, unknown>): string {
	const descriptor = isRecord(element.descriptor) ? element.descriptor : {};
	const selectorCandidates = Array.isArray(descriptor.selectorCandidates) ? descriptor.selectorCandidates.filter((selector): selector is string => typeof selector === "string") : [];
	const elementId = typeof descriptor.elementId === "string" ? descriptor.elementId : undefined;
	const selector = selectorCandidates[0] ?? (typeof descriptor.tagName === "string" ? descriptor.tagName : undefined) ?? elementId ?? "element";
	const idSuffix = elementId && elementId !== selector ? ` [${elementId}]` : "";
	const text = typeof descriptor.textPreview === "string" && descriptor.textPreview.length > 0 ? ` — ${clipText(descriptor.textPreview, 100)}` : "";
	return `${selector}${idSuffix}${text}`;
}

function styleSummary(element: Record<string, unknown>): string {
	const styles = isRecord(element.styles) ? element.styles : {};
	const preferred = ["background-color", "background-image", "color", "border-top-color", "display", "width", "height", "padding-left", "padding-right", "font-size", "font-weight", "position", "aspect-ratio", "object-fit"];
	const pairs = preferred
		.map((property) => [property, typeof styles[property] === "string" ? styles[property] : undefined] as const)
		.filter((entry): entry is readonly [string, string] => Boolean(entry[1]))
		.slice(0, 10)
		.map(([property, value]) => `${property}=${clipText(value, 80)}`);
	return pairs.join("; ");
}

function imageSummary(element: Record<string, unknown>): string | undefined {
	const sources = Array.isArray(element.imageSources) ? element.imageSources.filter((source): source is string => typeof source === "string") : [];
	return sources.length > 0 ? sources.slice(0, 3).map((source) => clipText(source, 90)).join("; ") : undefined;
}

function cssVariableCount(element: Record<string, unknown>): number {
	return isRecord(element.cssVariables) ? Object.keys(element.cssVariables).length : 0;
}

function normalizeStringArray(values: string[] | undefined): string[] | undefined {
	if (!Array.isArray(values)) return undefined;
	const normalized = values.map((value) => typeof value === "string" ? value.trim() : "").filter((value) => value.length > 0);
	return normalized.length > 0 ? [...new Set(normalized)] : undefined;
}

function normalizePresetArray(values: StyleInspectPreset[] | undefined): StyleInspectPreset[] | undefined {
	if (!Array.isArray(values)) return undefined;
	const allowed = new Set(["colors", "box", "typography", "layout", "images", "all"]);
	const normalized = values.filter((value): value is StyleInspectPreset => allowed.has(value));
	return normalized.length > 0 ? [...new Set(normalized)] : undefined;
}

function clampTimeout(value: number | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return 10_000;
	return Math.min(60_000, Math.max(1_000, Math.trunc(value)));
}

function errorMessage(payload: unknown): string {
	return isRecord(payload) && typeof payload.message === "string" ? payload.message : "Browser style inspection failed.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clipText(value: string, maxChars: number): string {
	return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}
