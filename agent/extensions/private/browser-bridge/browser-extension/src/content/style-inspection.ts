/// <reference path="./selection.ts" />

namespace PiBrowserBridgeContent {
	export type StyleInspectPreset = "colors" | "box" | "typography" | "layout" | "images" | "all";

	export interface StyleElementTarget {
		elementId?: string;
		selector?: string;
		selectionId?: string;
		selectionIndex?: number;
		expected?: Partial<ElementDescriptor>;
		limit?: number;
	}

	export interface StyleInspectionRequest {
		element?: StyleElementTarget;
		properties?: string[];
		presets?: StyleInspectPreset[];
		includeAncestors?: boolean;
		maxAncestors?: number;
		includeCssVariables?: boolean;
		maxCssVariables?: number;
		maxElements?: number;
	}

	export interface StyleInspectionElement {
		descriptor: ElementDescriptor;
		matchedBy: StyleElementTarget;
		groups: Record<string, Record<string, string>>;
		styles: Record<string, string>;
		cssVariables?: Record<string, string>;
		imageSources?: string[];
		ancestors?: StyleAncestorSummary[];
	}

	export interface StyleAncestorSummary {
		descriptor: ElementDescriptor;
		styles: Record<string, string>;
	}

	export interface StyleInspectionResponse {
		ok: true;
		elements: StyleInspectionElement[];
		context: ElementSelectionContext;
		warnings?: string[];
	}

	const STYLE_PRESET_PROPERTIES: Record<Exclude<StyleInspectPreset, "all">, string[]> = {
		colors: [
			"background-color",
			"background-image",
			"color",
			"border-top-color",
			"border-right-color",
			"border-bottom-color",
			"border-left-color",
			"outline-color",
			"caret-color",
			"accent-color",
			"fill",
			"stroke",
			"opacity",
			"box-shadow",
			"text-shadow",
		],
		box: [
			"display",
			"box-sizing",
			"width",
			"height",
			"min-width",
			"min-height",
			"max-width",
			"max-height",
			"margin-top",
			"margin-right",
			"margin-bottom",
			"margin-left",
			"padding-top",
			"padding-right",
			"padding-bottom",
			"padding-left",
			"border-top-width",
			"border-right-width",
			"border-bottom-width",
			"border-left-width",
			"border-top-style",
			"border-right-style",
			"border-bottom-style",
			"border-left-style",
			"border-top-left-radius",
			"border-top-right-radius",
			"border-bottom-right-radius",
			"border-bottom-left-radius",
			"overflow-x",
			"overflow-y",
		],
		typography: [
			"font-family",
			"font-size",
			"font-weight",
			"font-style",
			"line-height",
			"letter-spacing",
			"text-align",
			"text-decoration-line",
			"text-transform",
			"white-space",
			"word-break",
		],
		layout: [
			"position",
			"top",
			"right",
			"bottom",
			"left",
			"z-index",
			"inset",
			"visibility",
			"pointer-events",
			"transform",
			"transform-origin",
			"aspect-ratio",
			"object-fit",
			"object-position",
			"flex-direction",
			"justify-content",
			"align-items",
			"align-self",
			"grid-template-columns",
			"grid-template-rows",
		],
		images: [
			"background-image",
			"background-size",
			"background-position",
			"background-repeat",
			"background-clip",
			"object-fit",
			"object-position",
			"filter",
			"mix-blend-mode",
		],
	};

	const ANCESTOR_STYLE_PROPERTIES = ["display", "position", "background-color", "color", "opacity", "overflow-x", "overflow-y", "z-index", "pointer-events"];

	export function runStyleInspection(request: StyleInspectionRequest): StyleInspectionResponse {
		const elements = resolveStyleInspectionElements(request.element, request.maxElements);
		const options = normalizeStyleInspectionOptions(request);
		return {
			ok: true,
			elements: inspectElementsForStyles(elements, options, request.element ?? {}),
			context: currentSelectionContext("tool"),
		};
	}

	export function inspectElementsForStyles(elements: Element[], options: NormalizedStyleInspectionOptions, matchedBy: StyleElementTarget = {}): StyleInspectionElement[] {
		return elements.map((element) => inspectElementStyles(element, options, matchedBy));
	}

	export function inspectElementStyles(element: Element, options: NormalizedStyleInspectionOptions, matchedBy: StyleElementTarget = {}): StyleInspectionElement {
		const computed = getComputedStyle(element);
		const groups: Record<string, Record<string, string>> = {};
		const styles: Record<string, string> = {};
		for (const [group, properties] of Object.entries(options.groupedProperties)) {
			const groupValues = readStyleValues(computed, properties);
			if (Object.keys(groupValues).length > 0) groups[group] = groupValues;
			Object.assign(styles, groupValues);
		}
		const customValues = readStyleValues(computed, options.customProperties);
		if (Object.keys(customValues).length > 0) {
			groups.custom = customValues;
			Object.assign(styles, customValues);
		}
		const descriptor = describeElement(element, { mode: "single", includeText: true, maxHtmlChars: 0 });
		return {
			descriptor,
			matchedBy,
			groups,
			styles,
			...(options.includeCssVariables ? { cssVariables: readCssVariables(computed, options.maxCssVariables) } : {}),
			...(options.includeImages ? { imageSources: imageSources(element, computed) } : {}),
			...(options.includeAncestors ? { ancestors: ancestorSummaries(element, options.maxAncestors) } : {}),
		};
	}

	export interface NormalizedStyleInspectionOptions {
		groupedProperties: Record<string, string[]>;
		customProperties: string[];
		includeAncestors: boolean;
		maxAncestors: number;
		includeCssVariables: boolean;
		maxCssVariables: number;
		includeImages: boolean;
	}

	export function normalizeStyleInspectionOptions(request: Pick<StyleInspectionRequest, "properties" | "presets" | "includeAncestors" | "maxAncestors" | "includeCssVariables" | "maxCssVariables">): NormalizedStyleInspectionOptions {
		const presets = normalizePresets(request.presets);
		const groupedProperties: Record<string, string[]> = {};
		for (const preset of presets) groupedProperties[preset] = STYLE_PRESET_PROPERTIES[preset];
		return {
			groupedProperties,
			customProperties: normalizePropertyNames(request.properties),
			includeAncestors: request.includeAncestors === true,
			maxAncestors: clampCount(request.maxAncestors, 0, 12, 3),
			includeCssVariables: request.includeCssVariables === true,
			maxCssVariables: clampCount(request.maxCssVariables, 0, 80, 24),
			includeImages: presets.includes("images") || presets.includes("layout"),
		};
	}

	export function stylePropertyNamesForPresets(presets: StyleInspectPreset[] | undefined, properties: string[] | undefined, fallback: StyleInspectPreset[] = ["colors"]): string[] {
		const normalizedPresets = normalizePresets(presets, fallback);
		const result: string[] = [];
		for (const preset of normalizedPresets) result.push(...STYLE_PRESET_PROPERTIES[preset]);
		result.push(...normalizePropertyNames(properties));
		return unique(result);
	}

	export function resolveStyleInspectionElements(target: StyleElementTarget | undefined, maxElements: number | undefined): Element[] {
		const limit = clampCount(target?.limit ?? maxElements, 1, 100, 20);
		let elements: Element[] = [];
		let staleElementId = false;
		if (target?.elementId) {
			const element = resolveSelectedElement(target.elementId);
			if (element && (!target.expected || elementMatchesExpectedDescriptor(element, target.expected))) elements.push(element);
			else if (element && target.expected) staleElementId = true;
		}
		if (elements.length === 0 && target?.expected) elements = resolveElementsFromDescriptor(target.expected, limit);
		if (elements.length === 0 && !target?.elementId && target?.selector) elements = safeQuerySelectorAll(target.selector).slice(0, limit);
		if (elements.length === 0) {
			if (staleElementId || target?.selectionId) throw new Error("Shared selection appears stale or now resolves to a different element. Ask the user to share/select the element again.");
			throw new Error("No elements matched the style inspection target.");
		}
		return elements.slice(0, limit);
	}

	function resolveElementsFromDescriptor(expected: Partial<ElementDescriptor>, limit: number): Element[] {
		const candidates = candidateElementsForDescriptor(expected, limit * 8);
		const ranked = candidates
			.map((element) => ({ element, score: descriptorMatchScore(element, expected) }))
			.filter((entry) => entry.score >= 3)
			.sort((a, b) => b.score - a.score);
		return ranked.slice(0, limit).map((entry) => entry.element);
	}

	function candidateElementsForDescriptor(expected: Partial<ElementDescriptor>, maxCandidates: number): Element[] {
		const candidates: Element[] = [];
		for (const selector of expected.selectorCandidates ?? []) {
			for (const element of safeQuerySelectorAll(selector)) candidates.push(element);
			if (candidates.length >= maxCandidates) break;
		}
		if (candidates.length < maxCandidates && expected.tagName) {
			for (const element of safeQuerySelectorAll(expected.tagName)) candidates.push(element);
		}
		return uniqueElements(candidates).slice(0, maxCandidates);
	}

	function elementMatchesExpectedDescriptor(element: Element, expected: Partial<ElementDescriptor>): boolean {
		return descriptorMatchScore(element, expected) >= 3;
	}

	function descriptorMatchScore(element: Element, expected: Partial<ElementDescriptor>): number {
		let score = 0;
		if (expected.tagName && element.tagName.toLowerCase() === expected.tagName.toLowerCase()) score += 2;
		const attributes = expected.attributes ?? {};
		for (const [name, value] of Object.entries(attributes).slice(0, 4)) if (element.getAttribute(name) === value) score += 1;
		const expectedText = normalizeDescriptorText(expected.textPreview);
		if (expectedText) {
			const text = normalizeDescriptorText(element.textContent ?? "");
			if (text === expectedText) score += 3;
			else if (text.includes(expectedText) || expectedText.includes(text)) score += 1;
		}
		if (expected.boundingBox && boxApproximatelyMatches(element.getBoundingClientRect(), expected.boundingBox)) score += 2;
		return score;
	}

	function boxApproximatelyMatches(rect: DOMRect, expected: ElementDescriptor["boundingBox"]): boolean {
		if (!expected || expected.width <= 0 || expected.height <= 0) return false;
		const widthDelta = Math.abs(rect.width - expected.width) / Math.max(1, expected.width);
		const heightDelta = Math.abs(rect.height - expected.height) / Math.max(1, expected.height);
		const xDelta = Math.abs(rect.x - expected.x);
		const yDelta = Math.abs(rect.y - expected.y);
		return widthDelta <= 0.25 && heightDelta <= 0.25 && xDelta <= 80 && yDelta <= 80;
	}

	function safeQuerySelectorAll(selector: string): Element[] {
		try {
			return Array.from(document.querySelectorAll(selector));
		} catch {
			return [];
		}
	}

	function uniqueElements(elements: Element[]): Element[] {
		return [...new Set(elements)];
	}

	function normalizeDescriptorText(value: string | undefined): string {
		return (value ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
	}

	function normalizePresets(presets: StyleInspectPreset[] | undefined, fallback: StyleInspectPreset[] = ["colors", "box", "typography", "layout", "images"]): Array<Exclude<StyleInspectPreset, "all">> {
		const requested = Array.isArray(presets) && presets.length > 0 ? presets : fallback;
		const expanded = requested.includes("all") ? Object.keys(STYLE_PRESET_PROPERTIES) : requested;
		const filtered = expanded.filter((preset): preset is Exclude<StyleInspectPreset, "all"> => preset === "colors" || preset === "box" || preset === "typography" || preset === "layout" || preset === "images");
		return [...new Set(filtered)];
	}

	function normalizePropertyNames(properties: string[] | undefined): string[] {
		if (!Array.isArray(properties)) return [];
		return unique(properties.map(cssPropertyName).filter((property) => property.length > 0));
	}

	function readStyleValues(computed: CSSStyleDeclaration, properties: string[]): Record<string, string> {
		const values: Record<string, string> = {};
		for (const property of unique(properties)) {
			const value = computed.getPropertyValue(property).trim();
			if (value.length > 0) values[property] = value;
		}
		return values;
	}

	function readCssVariables(computed: CSSStyleDeclaration, maxVariables: number): Record<string, string> {
		const values: Record<string, string> = {};
		for (let index = 0; index < computed.length && Object.keys(values).length < maxVariables; index++) {
			const property = computed.item(index);
			if (!property.startsWith("--")) continue;
			const value = computed.getPropertyValue(property).trim();
			if (value.length > 0) values[property] = value;
		}
		return values;
	}

	function imageSources(element: Element, computed: CSSStyleDeclaration): string[] {
		const sources: string[] = [];
		const backgroundImage = computed.getPropertyValue("background-image").trim();
		if (backgroundImage && backgroundImage !== "none") sources.push(backgroundImage);
		if (element instanceof HTMLImageElement) pushImageSource(sources, element.currentSrc || element.src);
		if (element instanceof SVGImageElement) pushImageSource(sources, element.href.baseVal);
		for (const child of Array.from(element.querySelectorAll("img, source, image")).slice(0, 8)) {
			if (child instanceof HTMLImageElement) pushImageSource(sources, child.currentSrc || child.src);
			else if (child instanceof HTMLSourceElement) pushImageSource(sources, child.srcset || child.src);
			else if (child instanceof SVGImageElement) pushImageSource(sources, child.href.baseVal);
		}
		return unique(sources).slice(0, 12);
	}

	function pushImageSource(sources: string[], value: string): void {
		const trimmed = value.trim();
		if (trimmed) sources.push(trimmed);
	}

	function ancestorSummaries(element: Element, maxAncestors: number): StyleAncestorSummary[] {
		const ancestors: StyleAncestorSummary[] = [];
		let current = element.parentElement;
		while (current && ancestors.length < maxAncestors) {
			const computed = getComputedStyle(current);
			ancestors.push({
				descriptor: describeElement(current, { mode: "single", includeText: false, maxHtmlChars: 0 }),
				styles: readStyleValues(computed, ANCESTOR_STYLE_PROPERTIES),
			});
			current = current.parentElement;
		}
		return ancestors;
	}

	function cssPropertyName(name: string): string {
		return name.trim().startsWith("--") ? name.trim() : name.trim().replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
	}

	function unique(values: string[]): string[] {
		return [...new Set(values)];
	}

	function clampCount(value: number | undefined, min: number, max: number, fallback: number): number {
		if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
		return Math.min(max, Math.max(min, Math.trunc(value)));
	}
}
