/// <reference path="./selection.ts" />
/// <reference path="./style-inspection.ts" />

namespace PiBrowserBridgeContent {
	export type DesignPreviewCommand =
		| ({ action: "style"; styles?: Record<string, string | number | null>; patchId?: string } & StyleElementTarget)
		| ({ action: "copy-styles"; source?: StyleElementTarget; properties?: string[]; presets?: StyleInspectPreset[]; patchId?: string } & StyleElementTarget)
		| ({ action: "text"; text?: string; patchId?: string } & StyleElementTarget)
		| ({ action: "html"; html?: string; patchId?: string } & StyleElementTarget)
		| ({ action: "clear"; patchIds?: string[] } & StyleElementTarget)
		| { action: "list" };

	export interface DesignPreviewRequest {
		commands: DesignPreviewCommand[];
		captureAfter?: boolean | { mode?: "affected" | "viewport"; padding?: number };
	}

	export interface DesignPreviewPatchSummary {
		patchId: string;
		action: "style" | "text" | "html";
		selector?: string;
		elementId?: string;
		elementCount: number;
		summary: string;
		createdAt: number;
		computedAfter?: StyleInspectionElement[];
	}

	interface DesignPreviewCommandResult {
		ok: boolean;
		action: string;
		summary: string;
		patchId?: string;
		computedAfter?: StyleInspectionElement[];
	}

	interface PatchRecord extends DesignPreviewPatchSummary {
		restores: Array<() => void>;
		elements: Element[];
		computedAfter?: StyleInspectionElement[];
	}

	type DesignPreviewGlobal = typeof globalThis & {
		__piBrowserBridgeDesignPreviewState?: { patches: Map<string, PatchRecord>; nextPatchId: number };
		__piBrowserBridgeSelectionState?: { elementsById: Map<string, Element> };
	};

	const designPreviewGlobal = globalThis as DesignPreviewGlobal;
	const designPreviewState = designPreviewGlobal.__piBrowserBridgeDesignPreviewState ??= { patches: new Map<string, PatchRecord>(), nextPatchId: 1 };

	export function runDesignPreview(request: DesignPreviewRequest): { ok: true; applied: number; cleared: number; active: DesignPreviewPatchSummary[]; results: DesignPreviewCommandResult[]; context: ElementSelectionContext } {
		const results: DesignPreviewCommandResult[] = [];
		let applied = 0;
		let cleared = 0;
		for (const command of request.commands) {
			try {
				if (command.action === "style") {
					const patch = applyStylePreview(command);
					results.push({ ok: true, action: command.action, patchId: patch.patchId, summary: patch.summary, computedAfter: patch.computedAfter });
					applied++;
				} else if (command.action === "copy-styles") {
					const patch = applyCopyStylesPreview(command);
					results.push({ ok: true, action: command.action, patchId: patch.patchId, summary: patch.summary, computedAfter: patch.computedAfter });
					applied++;
				} else if (command.action === "text") {
					const patch = applyTextPreview(command);
					results.push({ ok: true, action: command.action, patchId: patch.patchId, summary: patch.summary });
					applied++;
				} else if (command.action === "html") {
					const patch = applyHtmlPreview(command);
					results.push({ ok: true, action: command.action, patchId: patch.patchId, summary: patch.summary });
					applied++;
				} else if (command.action === "clear") {
					const count = clearDesignPreviews(command);
					cleared += count;
					results.push({ ok: true, action: command.action, summary: `Cleared ${count} preview patch(es).` });
				} else if (command.action === "list") {
					results.push({ ok: true, action: command.action, summary: `${activeDesignPreviews().length} active preview patch(es).` });
				}
			} catch (error) {
				results.push({ ok: false, action: command.action, summary: error instanceof Error ? error.message : String(error) });
			}
		}
		return { ok: true, applied, cleared, active: activeDesignPreviews(), results, context: currentSelectionContext("tool") };
	}

	function applyStylePreview(command: Extract<DesignPreviewCommand, { action: "style" }>): PatchRecord {
		const styles = command.styles && typeof command.styles === "object" ? command.styles : {};
		const entries = Object.entries(styles).filter(([name, value]) => name.length > 0 && (typeof value === "string" || typeof value === "number" || value === null));
		if (entries.length === 0) throw new Error("Style preview requires at least one style property.");
		const elements = resolvePreviewElements(command);
		const patchId = resolvePatchId(command.patchId);
		clearPatch(patchId);
		const restores = elements.map((element) => {
			const before = element.getAttribute("style");
			const htmlElement = element as HTMLElement;
			for (const [name, value] of entries) {
				const property = cssPropertyName(name);
				if (value === null) htmlElement.style.removeProperty(property);
				else htmlElement.style.setProperty(property, String(value));
			}
			return () => restoreAttribute(element, "style", before);
		});
		const properties = entries.map(([name]) => cssPropertyName(name));
		const computedAfter = inspectElementsForStyles(elements, normalizeStyleInspectionOptions({ properties }), { elementId: command.elementId, selector: command.selector });
		return recordPatch(command, patchId, "style", elements, restores, `Styled ${elements.length} element(s): ${properties.join(", ")}.`, computedAfter);
	}

	function applyCopyStylesPreview(command: Extract<DesignPreviewCommand, { action: "copy-styles" }>): PatchRecord {
		const source = resolveStyleInspectionElements(command.source, 1)[0];
		if (!source) throw new Error("Copy-styles preview requires a source element.");
		const properties = stylePropertyNamesForPresets(command.presets, command.properties);
		if (properties.length === 0) throw new Error("Copy-styles preview requires at least one style property.");
		const sourceStyle = getComputedStyle(source);
		const copied: Record<string, string> = Object.fromEntries(properties.map((property) => [property, sourceStyle.getPropertyValue(property).trim()]).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0));
		if (Object.keys(copied).length === 0) throw new Error("Source element did not expose any requested computed styles.");
		const elements = resolvePreviewElements(command);
		const patchId = resolvePatchId(command.patchId);
		clearPatch(patchId);
		const restores = elements.map((element) => {
			const before = element.getAttribute("style");
			const htmlElement = element as HTMLElement;
			for (const [property, value] of Object.entries(copied)) htmlElement.style.setProperty(property, value);
			return () => restoreAttribute(element, "style", before);
		});
		const computedAfter = inspectElementsForStyles(elements, normalizeStyleInspectionOptions({ properties }), { elementId: command.elementId, selector: command.selector });
		return recordPatch(command, patchId, "style", elements, restores, `Copied ${Object.keys(copied).length} computed style(s) from ${describeElement(source, { mode: "single", includeText: false, maxHtmlChars: 0 }).elementId} to ${elements.length} element(s).`, computedAfter);
	}

	function applyTextPreview(command: Extract<DesignPreviewCommand, { action: "text" }>): PatchRecord {
		if (typeof command.text !== "string") throw new Error("Text preview requires text.");
		const elements = resolvePreviewElements(command);
		const patchId = resolvePatchId(command.patchId);
		clearPatch(patchId);
		const restores = elements.map((element) => {
			const before = element.textContent;
			element.textContent = command.text!;
			return () => { element.textContent = before; };
		});
		return recordPatch(command, patchId, "text", elements, restores, `Set text on ${elements.length} element(s).`);
	}

	function applyHtmlPreview(command: Extract<DesignPreviewCommand, { action: "html" }>): PatchRecord {
		if (typeof command.html !== "string") throw new Error("HTML preview requires html.");
		const html = sanitizePreviewHtml(command.html);
		const elements = resolvePreviewElements(command);
		const patchId = resolvePatchId(command.patchId);
		clearPatch(patchId);
		const restores = elements.map((element) => {
			const before = element.innerHTML;
			element.innerHTML = html;
			return () => { element.innerHTML = before; };
		});
		return recordPatch(command, patchId, "html", elements, restores, `Set sanitized HTML on ${elements.length} element(s).`);
	}

	function resolvePatchId(patchId: string | undefined): string {
		return patchId && patchId.length > 0 ? patchId : `preview-${designPreviewState.nextPatchId++}`;
	}

	function recordPatch(command: { selector?: string; elementId?: string }, patchId: string, action: "style" | "text" | "html", elements: Element[], restores: Array<() => void>, summary: string, computedAfter?: StyleInspectionElement[]): PatchRecord {
		const patch: PatchRecord = { patchId, action, selector: command.selector, elementId: command.elementId, elementCount: elements.length, summary, createdAt: Date.now(), restores, elements, computedAfter };
		designPreviewState.patches.set(patchId, patch);
		return patch;
	}

	function clearDesignPreviews(command: Extract<DesignPreviewCommand, { action: "clear" }>): number {
		if (Array.isArray(command.patchIds) && command.patchIds.length > 0) return command.patchIds.reduce((count, patchId) => count + (clearPatch(patchId) ? 1 : 0), 0);
		const targets = command.selector || command.elementId ? resolvePreviewElements({ ...command, limit: 100 }) : undefined;
		let count = 0;
		for (const patch of [...designPreviewState.patches.values()]) {
			const matchesTarget = !targets || patch.elements.some((element) => targets.includes(element)) || (command.selector && patch.selector === command.selector) || (command.elementId && patch.elementId === command.elementId);
			if (matchesTarget && clearPatch(patch.patchId)) count++;
		}
		return count;
	}

	function clearPatch(patchId: string): boolean {
		const patch = designPreviewState.patches.get(patchId);
		if (!patch) return false;
		for (const restore of [...patch.restores].reverse()) restore();
		designPreviewState.patches.delete(patchId);
		return true;
	}

	function activeDesignPreviews(): DesignPreviewPatchSummary[] {
		return [...designPreviewState.patches.values()].map(({ patchId, action, selector, elementId, elementCount, summary, createdAt, computedAfter }) => ({ patchId, action, selector, elementId, elementCount, summary, createdAt, computedAfter }));
	}

	function resolvePreviewElements(command: StyleElementTarget): Element[] {
		if (!command.elementId && !command.selector && !command.expected) throw new Error("Design preview command requires selector or elementId.");
		return resolveStyleInspectionElements(command, command.limit);
	}

	function restoreAttribute(element: Element, name: string, value: string | null): void {
		if (value === null) element.removeAttribute(name);
		else element.setAttribute(name, value);
	}

	function cssPropertyName(name: string): string {
		return name.startsWith("--") ? name : name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
	}

	function sanitizePreviewHtml(html: string): string {
		const template = document.createElement("template");
		template.innerHTML = html;
		for (const element of Array.from(template.content.querySelectorAll("script, iframe, object, embed, link, meta"))) element.remove();
		for (const element of Array.from(template.content.querySelectorAll("*"))) {
			for (const attribute of Array.from(element.attributes)) {
				const name = attribute.name.toLowerCase();
				const value = attribute.value.trim().toLowerCase();
				if (name.startsWith("on") || ((name === "href" || name === "src" || name === "xlink:href") && value.startsWith("javascript:"))) element.removeAttribute(attribute.name);
			}
		}
		return template.innerHTML;
	}
}
