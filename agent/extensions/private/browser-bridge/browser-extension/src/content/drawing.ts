/// <reference path="./share-context.ts" />
/// <reference path="./selection.ts" />

namespace PiBrowserBridgeContent {
	export interface DrawingOptions {
		source?: "drawing";
		askForContext?: boolean;
		color?: string;
		width?: number;
		maxPoints?: number;
	}

	export interface DrawingPoint {
		x: number;
		y: number;
		t: number;
		pressure?: number;
	}

	export interface DrawingStroke {
		color: string;
		width: number;
		points: DrawingPoint[];
		boundingBox?: DrawingBox;
		pageBoundingBox?: DrawingBox;
	}

	export interface DrawingGesture {
		type: "arrow" | "mark" | "region";
		confidence: "low" | "medium";
		start: { x: number; y: number };
		end: { x: number; y: number };
		fromElement?: ElementDescriptor;
		toElement?: ElementDescriptor;
	}

	export interface DrawingBox {
		x: number;
		y: number;
		width: number;
		height: number;
		coordinateSpace: "viewport" | "page";
	}

	export interface DrawingViewportGeometry {
		width: number;
		height: number;
		scrollX: number;
		scrollY: number;
		devicePixelRatio: number;
	}

	export interface DrawingPayload {
		coordinateSpace: "viewport";
		boundingBox: DrawingBox;
		pageBoundingBox: DrawingBox;
		viewport: DrawingViewportGeometry;
		pointCount: number;
		strokes: DrawingStroke[];
		gesture?: DrawingGesture;
	}

	export type DrawingResponse =
		| { status: "drawn"; drawing: DrawingPayload; nearbyElements: ElementDescriptor[]; context: ElementSelectionContext; userNote?: string }
		| { status: "cancelled"; reason: string; nearbyElements: ElementDescriptor[]; context: ElementSelectionContext; userNote?: string };

	const DRAWING_LAYER_ID = "pi-browser-bridge-drawing-layer";

	export function startDrawing(options: DrawingOptions = {}): Promise<DrawingResponse> {
		document.getElementById(DRAWING_LAYER_ID)?.remove();
		return new Promise((resolve) => {
			const color = options.color ?? "#e53935";
			const width = clampNumber(options.width, 2, 16, 4);
			const maxPoints = clampNumber(options.maxPoints, 50, 2500, 1200);
			const strokes: DrawingStroke[] = [];
			const layer = makeDrawingLayer();
			const svg = makeDrawingSvg();
			const toolbar = makeDrawingToolbar();
			const done = toolbar.querySelector<HTMLButtonElement>("[data-action='done']")!;
			const clear = toolbar.querySelector<HTMLButtonElement>("[data-action='clear']")!;
			const cancel = toolbar.querySelector<HTMLButtonElement>("[data-action='cancel']")!;
			layer.append(svg, toolbar);
			document.documentElement.appendChild(layer);

			let activeStroke: DrawingStroke | undefined;
			let activePath: SVGPathElement | undefined;
			let finished = false;

			function cleanup(removeLayer = true): void {
				svg.removeEventListener("pointerdown", onPointerDown, true);
				svg.removeEventListener("pointermove", onPointerMove, true);
				svg.removeEventListener("pointerup", onPointerUp, true);
				svg.removeEventListener("pointercancel", onPointerUp, true);
				document.removeEventListener("keydown", onKeyDown, true);
				if (removeLayer) layer.remove();
			}

			async function finish(status: "drawn" | "cancelled", reason = "cancelled"): Promise<void> {
				if (finished) return;
				finished = true;
				const drawn = status === "drawn" && totalPointCount(strokes) > 0;
				cleanup(!drawn);
				const context = currentSelectionContext("drawing");
				if (!drawn) {
					resolve({ status: "cancelled", reason: status === "drawn" ? "empty-drawing" : reason, nearbyElements: [], context });
					return;
				}
				const drawing = drawingPayload(strokes, layer, options);
				const nearbyElements = withLayerHidden(layer, () => nearbyDrawingElements(drawing, strokes, options));
				if (options.askForContext) {
					const shareContext = promptShareContext("drawing");
					if (shareContext.cancelled) {
						layer.remove();
						resolve({ status: "cancelled", reason: "context-cancelled", nearbyElements, context });
						return;
					}
					resolve({ status, drawing, nearbyElements, context, userNote: shareContext.userNote });
					return;
				}
				resolve({ status, drawing, nearbyElements, context });
			}

			function onPointerDown(event: PointerEvent): void {
				event.preventDefault();
				event.stopPropagation();
				activeStroke = { color, width, points: [pointFromEvent(event)] };
				activePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
				activePath.setAttribute("fill", "none");
				activePath.setAttribute("stroke", color);
				activePath.setAttribute("stroke-width", String(width));
				activePath.setAttribute("stroke-linecap", "round");
				activePath.setAttribute("stroke-linejoin", "round");
				svg.appendChild(activePath);
				svg.setPointerCapture?.(event.pointerId);
				renderPath(activePath, activeStroke.points);
			}

			function onPointerMove(event: PointerEvent): void {
				if (!activeStroke || !activePath) return;
				event.preventDefault();
				event.stopPropagation();
				if (totalPointCount(strokes) + activeStroke.points.length >= maxPoints) return;
				const point = pointFromEvent(event);
				const previous = activeStroke.points.at(-1)!;
				if (Math.hypot(point.x - previous.x, point.y - previous.y) < 2) return;
				activeStroke.points.push(point);
				renderPath(activePath, activeStroke.points);
			}

			function onPointerUp(event: PointerEvent): void {
				if (!activeStroke) return;
				event.preventDefault();
				event.stopPropagation();
				if (activeStroke.points.length > 0) strokes.push(activeStroke);
				activeStroke = undefined;
				activePath = undefined;
				svg.releasePointerCapture?.(event.pointerId);
			}

			function onKeyDown(event: KeyboardEvent): void {
				if (event.key === "Escape") {
					event.preventDefault();
					void finish("cancelled", "escape");
				}
				if (event.key === "Enter") {
					event.preventDefault();
					void finish("drawn");
				}
			}

			svg.addEventListener("pointerdown", onPointerDown, true);
			svg.addEventListener("pointermove", onPointerMove, true);
			svg.addEventListener("pointerup", onPointerUp, true);
			svg.addEventListener("pointercancel", onPointerUp, true);
			document.addEventListener("keydown", onKeyDown, true);
			done.addEventListener("click", () => void finish("drawn"));
			cancel.addEventListener("click", () => void finish("cancelled", "cancelled"));
			clear.addEventListener("click", () => {
				strokes.length = 0;
				svg.replaceChildren();
			});
		});
	}

	function makeDrawingLayer(): HTMLDivElement {
		const layer = document.createElement("div");
		layer.id = DRAWING_LAYER_ID;
		Object.assign(layer.style, { position: "fixed", inset: "0", zIndex: "2147483646" });
		return layer;
	}

	function makeDrawingSvg(): SVGSVGElement {
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("width", "100%");
		svg.setAttribute("height", "100%");
		Object.assign(svg.style, { position: "absolute", inset: "0", cursor: "crosshair", background: "rgba(26, 115, 232, 0.04)", touchAction: "none" });
		return svg;
	}

	function makeDrawingToolbar(): HTMLDivElement {
		const toolbar = document.createElement("div");
		toolbar.innerHTML = `<span>Draw for Pi</span><button data-action="done">Share</button><button data-action="clear">Clear</button><button data-action="cancel">Cancel</button>`;
		Object.assign(toolbar.style, {
			position: "fixed",
			left: "50%",
			top: "12px",
			transform: "translateX(-50%)",
			zIndex: "2147483647",
			display: "flex",
			alignItems: "center",
			gap: "8px",
			padding: "8px 10px",
			borderRadius: "999px",
			background: "rgba(32, 33, 36, 0.94)",
			color: "white",
			font: "13px system-ui, sans-serif",
			boxShadow: "0 2px 12px rgba(0,0,0,0.25)",
		});
		Array.from(toolbar.querySelectorAll("button")).forEach((button) => Object.assign((button as HTMLButtonElement).style, { border: "0", borderRadius: "999px", padding: "4px 9px", cursor: "pointer" }));
		return toolbar;
	}

	function pointFromEvent(event: PointerEvent): DrawingPoint {
		return { x: Math.round(event.clientX * 10) / 10, y: Math.round(event.clientY * 10) / 10, t: Date.now(), pressure: event.pressure || undefined };
	}

	function renderPath(path: SVGPathElement, points: DrawingPoint[]): void {
		path.setAttribute("d", points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`).join(" "));
	}

	function drawingPayload(strokes: DrawingStroke[], layer: HTMLElement, options: DrawingOptions): DrawingPayload {
		const boundingBox = boundingBoxForPoints(strokes.flatMap((stroke) => stroke.points));
		const viewport = currentViewportGeometry();
		const strokesWithGeometry = strokes.map((stroke) => strokeWithGeometry(stroke, viewport));
		return {
			coordinateSpace: "viewport",
			boundingBox,
			pageBoundingBox: viewportToPageBox(boundingBox, viewport),
			viewport,
			pointCount: totalPointCount(strokes),
			strokes: strokesWithGeometry,
			gesture: withLayerHidden(layer, () => inferDrawingGesture(strokes, options)),
		};
	}

	function strokeWithGeometry(stroke: DrawingStroke, viewport: DrawingViewportGeometry): DrawingStroke {
		const boundingBox = boundingBoxForPoints(stroke.points);
		return { ...stroke, boundingBox, pageBoundingBox: viewportToPageBox(boundingBox, viewport) };
	}

	function boundingBoxForPoints(points: DrawingPoint[]): DrawingBox {
		const xs = points.map((point) => point.x);
		const ys = points.map((point) => point.y);
		const minX = Math.min(...xs);
		const minY = Math.min(...ys);
		return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY, coordinateSpace: "viewport" };
	}

	function currentViewportGeometry(): DrawingViewportGeometry {
		return {
			width: window.innerWidth,
			height: window.innerHeight,
			scrollX: window.scrollX,
			scrollY: window.scrollY,
			devicePixelRatio: window.devicePixelRatio || 1,
		};
	}

	function viewportToPageBox(box: DrawingBox, viewport: DrawingViewportGeometry): DrawingBox {
		return { x: box.x + viewport.scrollX, y: box.y + viewport.scrollY, width: box.width, height: box.height, coordinateSpace: "page" };
	}

	function nearbyDrawingElements(drawing: DrawingPayload, strokes: DrawingStroke[], options: DrawingOptions): ElementDescriptor[] {
		const samples = samplePoints(drawing, strokes);
		const elements: Element[] = [];
		for (const point of samples) {
			const element = selectableElement(document.elementFromPoint(point.x, point.y));
			if (element && !elements.includes(element)) elements.push(element);
		}
		return elements.slice(0, 8).map((element) => describeElement(element, { mode: "single", includeText: true, includeHtml: false, maxHtmlChars: 0, source: "drawing" }));
	}

	function inferDrawingGesture(strokes: DrawingStroke[], options: DrawingOptions): DrawingGesture | undefined {
		const main = strokes.reduce<DrawingStroke | undefined>((best, stroke) => !best || pathLength(stroke.points) > pathLength(best.points) ? stroke : best, undefined);
		if (!main || main.points.length < 2) return undefined;
		const first = main.points[0]!;
		const last = main.points.at(-1)!;
		const distance = Math.hypot(last.x - first.x, last.y - first.y);
		const length = pathLength(main.points);
		const box = boundingBoxForPoints(main.points);
		const closedRegion = box.width >= 32 && box.height >= 32 && distance <= Math.max(48, Math.max(box.width, box.height) * 0.3) && length >= (box.width + box.height) * 1.2;
		const arrow = distance > 40 && length / Math.max(distance, 1) < 2.7;
		const type = closedRegion ? "region" : arrow ? "arrow" : "mark";
		return {
			type,
			confidence: type === "mark" ? "low" : "medium",
			start: { x: first.x, y: first.y },
			end: { x: last.x, y: last.y },
			fromElement: elementDescriptorAt(first, options),
			toElement: elementDescriptorAt(last, options),
		};
	}

	function elementDescriptorAt(point: { x: number; y: number }, options: DrawingOptions): ElementDescriptor | undefined {
		const element = selectableElement(document.elementFromPoint(point.x, point.y));
		return element ? describeElement(element, { mode: "single", includeText: true, includeHtml: false, maxHtmlChars: 0, source: "drawing" }) : undefined;
	}

	function pathLength(points: DrawingPoint[]): number {
		return points.reduce((total, point, index) => index === 0 ? 0 : total + Math.hypot(point.x - points[index - 1]!.x, point.y - points[index - 1]!.y), 0);
	}

	function withLayerHidden<T>(layer: HTMLElement, callback: () => T): T {
		const previous = layer.style.display;
		layer.style.display = "none";
		try {
			return callback();
		} finally {
			layer.style.display = previous;
		}
	}

	function samplePoints(drawing: DrawingPayload, strokes: DrawingStroke[]): Array<{ x: number; y: number }> {
		const samples: Array<{ x: number; y: number }> = [];
		for (const stroke of strokes) {
			const first = stroke.points[0];
			const last = stroke.points.at(-1);
			if (first) samples.push(first);
			if (last) samples.push(last);
		}
		const box = drawing.boundingBox;
		const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
		samples.push(center, { x: box.x, y: box.y }, { x: box.x + box.width, y: box.y }, { x: box.x, y: box.y + box.height }, { x: box.x + box.width, y: box.y + box.height });
		return samples.filter((point) => point.x >= 0 && point.y >= 0 && point.x <= window.innerWidth && point.y <= window.innerHeight);
	}

	function totalPointCount(strokes: DrawingStroke[]): number {
		return strokes.reduce((total, stroke) => total + stroke.points.length, 0);
	}

	function clampNumber(value: number | undefined, min: number, max: number, fallback: number): number {
		if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
		return Math.min(max, Math.max(min, Math.trunc(value)));
	}
}
