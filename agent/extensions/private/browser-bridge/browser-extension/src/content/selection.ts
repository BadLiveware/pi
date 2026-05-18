export interface SelectElementsOptions {
	mode: "single" | "multiple";
	includeHtml?: boolean;
	includeText?: boolean;
	maxHtmlChars?: number;
	timeoutMs?: number;
}

export interface ElementDescriptor {
	elementId: string;
	selectorCandidates: string[];
	tagName: string;
	role?: string;
	accessibleName?: string;
	textPreview?: string;
	attributes: Record<string, string>;
	boundingBox: { x: number; y: number; width: number; height: number; coordinateSpace: "viewport" };
	htmlPreview?: string;
}

export type SelectElementsResponse =
	| { status: "selected"; elements: ElementDescriptor[] }
	| { status: "cancelled"; elements: ElementDescriptor[]; reason: "escape" | "timeout" | "replaced" };

const elementIds = new WeakMap<Element, string>();
let nextElementId = 1;
let activeCleanup: (() => void) | undefined;

export function startElementSelection(options: SelectElementsOptions): Promise<SelectElementsResponse> {
	activeCleanup?.();
	return new Promise((resolve) => {
		const selected: Element[] = [];
		const hoverBox = makeBox("pi-browser-bridge-hover-box", "rgba(26, 115, 232, 0.95)");
		const selectedLayer = document.createElement("div");
		selectedLayer.id = "pi-browser-bridge-selected-layer";
		Object.assign(selectedLayer.style, fixedLayerStyle());
		const banner = makeBanner(options.mode);
		document.documentElement.append(hoverBox, selectedLayer, banner);

		let finished = false;
		const timeout = window.setTimeout(() => finish("cancelled", "timeout"), options.timeoutMs ?? 60_000);

		function cleanup(): void {
			window.clearTimeout(timeout);
			document.removeEventListener("mousemove", onMouseMove, true);
			document.removeEventListener("click", onClick, true);
			document.removeEventListener("keydown", onKeyDown, true);
			hoverBox.remove();
			selectedLayer.remove();
			banner.remove();
			if (activeCleanup === cleanup) activeCleanup = undefined;
		}

		function finish(status: "selected" | "cancelled", reason?: "escape" | "timeout" | "replaced"): void {
			if (finished) return;
			finished = true;
			cleanup();
			const elements = selected.map((element) => describeElement(element, options));
			resolve(status === "selected" ? { status, elements } : { status, elements, reason: reason ?? "escape" });
		}

		activeCleanup = () => finish("cancelled", "replaced");
		document.addEventListener("mousemove", onMouseMove, true);
		document.addEventListener("click", onClick, true);
		document.addEventListener("keydown", onKeyDown, true);

		function onMouseMove(event: MouseEvent): void {
			const target = selectableElement(event.target);
			if (!target) return hideBox(hoverBox);
			positionBox(hoverBox, target.getBoundingClientRect());
		}

		function onClick(event: MouseEvent): void {
			const target = selectableElement(event.target);
			if (!target) return;
			event.preventDefault();
			event.stopPropagation();
			if (!selected.includes(target)) selected.push(target);
			renderSelected(selectedLayer, selected);
			if (options.mode === "single") finish("selected");
		}

		function onKeyDown(event: KeyboardEvent): void {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				finish("cancelled", "escape");
				return;
			}
			if (event.key === "Enter" && options.mode === "multiple") {
				event.preventDefault();
				event.stopPropagation();
				finish("selected");
			}
		}
	});
}

export function describeElement(element: Element, options: SelectElementsOptions = { mode: "single" }): ElementDescriptor {
	const rect = element.getBoundingClientRect();
	const attributes = selectedAttributes(element);
	const text = normalizePreview(element.textContent ?? "", 500);
	const maxHtmlChars = Math.max(0, options.maxHtmlChars ?? 1200);
	return {
		elementId: getElementId(element),
		selectorCandidates: selectorCandidates(element),
		tagName: element.tagName.toLowerCase(),
		role: element.getAttribute("role") ?? undefined,
		accessibleName: element.getAttribute("aria-label") ?? element.getAttribute("title") ?? undefined,
		textPreview: options.includeText === false ? undefined : text,
		attributes,
		boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, coordinateSpace: "viewport" },
		htmlPreview: options.includeHtml ? normalizePreview(element.outerHTML, maxHtmlChars) : undefined,
	};
}

function selectableElement(target: EventTarget | null): Element | undefined {
	if (!(target instanceof Element)) return undefined;
	const blocked = target.closest("#pi-browser-bridge-banner, #pi-browser-bridge-hover-box, #pi-browser-bridge-selected-layer");
	if (blocked) return undefined;
	return target;
}

function getElementId(element: Element): string {
	const existing = elementIds.get(element);
	if (existing) return existing;
	const id = `el-${nextElementId++}`;
	elementIds.set(element, id);
	return id;
}

function selectorCandidates(element: Element): string[] {
	const candidates: string[] = [];
	const id = element.getAttribute("id");
	if (id) candidates.push(`#${escapeCss(id)}`);
	for (const attr of ["data-testid", "data-test", "data-cy", "name", "aria-label"] as const) {
		const value = element.getAttribute(attr);
		if (value) candidates.push(`${element.tagName.toLowerCase()}[${attr}="${escapeAttribute(value)}"]`);
	}
	const classList = Array.from(element.classList).slice(0, 3).map(escapeCss);
	if (classList.length > 0) candidates.push(`${element.tagName.toLowerCase()}.${classList.join(".")}`);
	candidates.push(element.tagName.toLowerCase());
	return [...new Set(candidates)];
}

function selectedAttributes(element: Element): Record<string, string> {
	const attrs: Record<string, string> = {};
	for (const name of ["id", "class", "name", "type", "href", "role", "aria-label", "title", "data-testid", "data-test", "data-cy"]) {
		const value = element.getAttribute(name);
		if (value) attrs[name] = normalizePreview(value, 240);
	}
	return attrs;
}

function normalizePreview(value: string, maxChars: number): string {
	const normalized = value.replace(/\s+/g, " ").trim();
	return normalized.length <= maxChars ? normalized : `${normalized.slice(0, Math.max(0, maxChars - 1))}…`;
}

function renderSelected(layer: HTMLElement, selected: Element[]): void {
	layer.replaceChildren();
	for (const element of selected) {
		const box = makeBox("", "rgba(52, 168, 83, 0.95)");
		positionBox(box, element.getBoundingClientRect());
		layer.appendChild(box);
	}
}

function makeBox(id: string, color: string): HTMLDivElement {
	const box = document.createElement("div");
	if (id) box.id = id;
	Object.assign(box.style, {
		position: "fixed",
		zIndex: "2147483646",
		border: `2px solid ${color}`,
		background: "rgba(26, 115, 232, 0.08)",
		pointerEvents: "none",
		boxSizing: "border-box",
		display: "none",
	});
	return box;
}

function positionBox(box: HTMLElement, rect: DOMRect): void {
	Object.assign(box.style, {
		display: "block",
		left: `${rect.left}px`,
		top: `${rect.top}px`,
		width: `${rect.width}px`,
		height: `${rect.height}px`,
	});
}

function hideBox(box: HTMLElement): void {
	box.style.display = "none";
}

function makeBanner(mode: "single" | "multiple"): HTMLDivElement {
	const banner = document.createElement("div");
	banner.id = "pi-browser-bridge-banner";
	banner.textContent = mode === "single" ? "Pi: click one element, Esc cancels" : "Pi: click elements, Enter finishes, Esc cancels";
	Object.assign(banner.style, {
		...fixedLayerStyle(),
		zIndex: "2147483647",
		left: "50%",
		top: "12px",
		right: "auto",
		bottom: "auto",
		width: "auto",
		height: "auto",
		transform: "translateX(-50%)",
		padding: "8px 12px",
		borderRadius: "999px",
		background: "rgba(32, 33, 36, 0.92)",
		color: "white",
		font: "13px system-ui, sans-serif",
		pointerEvents: "none",
	});
	return banner;
}

function fixedLayerStyle(): Partial<CSSStyleDeclaration> {
	return { position: "fixed", inset: "0", pointerEvents: "none" };
}

function escapeCss(value: string): string {
	return globalThis.CSS?.escape ? globalThis.CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function escapeAttribute(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}
