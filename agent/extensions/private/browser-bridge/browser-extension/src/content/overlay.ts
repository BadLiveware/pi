namespace PiBrowserBridgeContent {
	export type OverlayCommand =
		| { action: "show" | "hide" | "clear"; layer?: string }
		| { action: "highlight"; elementId?: string; selector?: string; label?: string; color?: string; layer?: string }
		| { action: "draw"; layer?: string; strokes: OverlayStroke[] };

	export type OverlayStroke =
		| { type: "freehand"; points: Point[]; color?: string; size?: number; coordinateSpace?: "viewport" }
		| { type: "rect"; start: Point; end: Point; color?: string; size?: number; coordinateSpace?: "viewport" }
		| { type: "arrow"; start: Point; end: Point; color?: string; size?: number; coordinateSpace?: "viewport" };

	interface Point {
		x: number;
		y: number;
	}

	interface OverlayState {
		root: HTMLDivElement;
		drawingLayer: SVGSVGElement;
		highlightLayer: HTMLDivElement;
		visible: boolean;
	}

	type OverlayGlobal = typeof globalThis & {
		__piBrowserBridgeOverlayState?: OverlayState;
		__piBrowserBridgeOverlayResizeInstalled?: boolean;
	};

	const overlayGlobal = globalThis as OverlayGlobal;
	const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

	export function applyOverlayCommands(commands: OverlayCommand[]): { ok: true; applied: number } {
		const state = ensureOverlay();
		let applied = 0;
		for (const command of commands) {
			if (command.action === "show") show(state);
			else if (command.action === "hide") hide(state);
			else if (command.action === "clear") clear(state);
			else if (command.action === "highlight") highlight(state, command);
			else if (command.action === "draw") draw(state, command.strokes);
			applied++;
		}
		return { ok: true, applied };
	}

	function ensureOverlay(): OverlayState {
		const existingState = overlayGlobal.__piBrowserBridgeOverlayState;
		if (existingState && document.documentElement.contains(existingState.root)) return existingState;
		document.getElementById("pi-browser-bridge-overlay")?.remove();
		const root = document.createElement("div");
		root.id = "pi-browser-bridge-overlay";
		Object.assign(root.style, {
			position: "fixed",
			inset: "0",
			zIndex: "2147483645",
			pointerEvents: "none",
			display: "block",
		});
		const drawingLayer = document.createElementNS(SVG_NAMESPACE, "svg");
		setSvgAttributes(drawingLayer, { id: "pi-browser-bridge-drawing-layer", role: "presentation" });
		Object.assign(drawingLayer.style, { position: "fixed", inset: "0", width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" });
		const highlightLayer = document.createElement("div");
		Object.assign(highlightLayer.style, { position: "fixed", inset: "0", pointerEvents: "none" });
		root.append(drawingLayer, highlightLayer);
		document.documentElement.appendChild(root);
		const state = { root, drawingLayer, highlightLayer, visible: true };
		overlayGlobal.__piBrowserBridgeOverlayState = state;
		resizeDrawingLayer(state);
		if (!overlayGlobal.__piBrowserBridgeOverlayResizeInstalled) {
			window.addEventListener("resize", () => {
				const currentState = overlayGlobal.__piBrowserBridgeOverlayState;
				if (currentState && document.documentElement.contains(currentState.root)) resizeDrawingLayer(currentState);
			});
			overlayGlobal.__piBrowserBridgeOverlayResizeInstalled = true;
		}
		return state;
	}

	function show(state: OverlayState): void {
		state.visible = true;
		state.root.style.display = "block";
		resizeDrawingLayer(state);
	}

	function hide(state: OverlayState): void {
		state.visible = false;
		state.root.style.display = "none";
	}

	function clear(state: OverlayState): void {
		state.drawingLayer.replaceChildren();
		state.highlightLayer.replaceChildren();
	}

	function highlight(state: OverlayState, command: Extract<OverlayCommand, { action: "highlight" }>): void {
		show(state);
		const element = command.elementId ? PiBrowserBridgeContent.resolveSelectedElement(command.elementId) : command.selector ? document.querySelector(command.selector) ?? undefined : undefined;
		if (!element) throw new Error("Could not resolve element to highlight.");
		const rect = element.getBoundingClientRect();
		const box = document.createElement("div");
		Object.assign(box.style, {
			position: "fixed",
			left: `${rect.left}px`,
			top: `${rect.top}px`,
			width: `${rect.width}px`,
			height: `${rect.height}px`,
			border: `3px solid ${command.color ?? "#fa1e0e"}`,
			background: "rgba(250, 30, 14, 0.08)",
			boxSizing: "border-box",
			pointerEvents: "none",
		});
		state.highlightLayer.appendChild(box);
		if (command.label) {
			const label = document.createElement("div");
			label.textContent = command.label;
			Object.assign(label.style, {
				position: "fixed",
				left: `${rect.left}px`,
				top: `${Math.max(0, rect.top - 28)}px`,
				padding: "4px 7px",
				borderRadius: "6px",
				background: command.color ?? "#fa1e0e",
				color: "white",
				font: "12px system-ui, sans-serif",
				pointerEvents: "none",
			});
			state.highlightLayer.appendChild(label);
		}
	}

	function draw(state: OverlayState, strokes: OverlayStroke[]): void {
		show(state);
		for (const stroke of strokes) renderStroke(state.drawingLayer, stroke);
	}

	function renderStroke(layer: SVGSVGElement, stroke: OverlayStroke): void {
		if (stroke.type === "freehand") {
			if (stroke.points.length < 1) return;
			const polyline = document.createElementNS(SVG_NAMESPACE, "polyline");
			setSvgAttributes(polyline, {
				points: stroke.points.map((point) => `${point.x},${point.y}`).join(" "),
				fill: "none",
				stroke: stroke.color ?? "#fa1e0e",
				"stroke-width": stroke.size ?? 4,
				"stroke-linecap": "round",
				"stroke-linejoin": "round",
			});
			layer.appendChild(polyline);
		} else if (stroke.type === "rect") {
			const x = Math.min(stroke.start.x, stroke.end.x);
			const y = Math.min(stroke.start.y, stroke.end.y);
			const rect = document.createElementNS(SVG_NAMESPACE, "rect");
			setSvgAttributes(rect, {
				x,
				y,
				width: Math.abs(stroke.end.x - stroke.start.x),
				height: Math.abs(stroke.end.y - stroke.start.y),
				fill: "rgba(26, 115, 232, 0.06)",
				stroke: stroke.color ?? "#fa1e0e",
				"stroke-width": stroke.size ?? 4,
				"stroke-linejoin": "round",
			});
			layer.appendChild(rect);
		} else if (stroke.type === "arrow") {
			const color = stroke.color ?? "#fa1e0e";
			const size = stroke.size ?? 4;
			const line = document.createElementNS(SVG_NAMESPACE, "line");
			setSvgAttributes(line, {
				x1: stroke.start.x,
				y1: stroke.start.y,
				x2: stroke.end.x,
				y2: stroke.end.y,
				stroke: color,
				"stroke-width": size,
				"stroke-linecap": "round",
			});
			layer.appendChild(line);
			const arrowHead = document.createElementNS(SVG_NAMESPACE, "polygon");
			setSvgAttributes(arrowHead, { points: arrowHeadPoints(stroke.start, stroke.end, size), fill: color });
			layer.appendChild(arrowHead);
		}
	}

	function arrowHeadPoints(start: Point, end: Point, size: number): string {
		const angle = Math.atan2(end.y - start.y, end.x - start.x);
		const headLen = Math.max(18, size * 6);
		const left = { x: end.x - headLen * Math.cos(angle - 0.45), y: end.y - headLen * Math.sin(angle - 0.45) };
		const right = { x: end.x - headLen * Math.cos(angle + 0.45), y: end.y - headLen * Math.sin(angle + 0.45) };
		return `${end.x},${end.y} ${left.x},${left.y} ${right.x},${right.y}`;
	}

	function resizeDrawingLayer(state: OverlayState): void {
		const width = Math.max(1, window.innerWidth);
		const height = Math.max(1, window.innerHeight);
		setSvgAttributes(state.drawingLayer, { width, height, viewBox: `0 0 ${width} ${height}` });
	}

	function setSvgAttributes(element: SVGElement, attributes: Record<string, string | number>): void {
		for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
	}
}
