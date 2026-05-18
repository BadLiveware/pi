import { resolveSelectedElement } from "./selection.js";

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
	canvas: HTMLCanvasElement;
	ctx: CanvasRenderingContext2D;
	highlightLayer: HTMLDivElement;
	visible: boolean;
}

let overlay: OverlayState | undefined;

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
	if (overlay && document.documentElement.contains(overlay.root)) return overlay;
	const root = document.createElement("div");
	root.id = "pi-browser-bridge-overlay";
	Object.assign(root.style, {
		position: "fixed",
		inset: "0",
		zIndex: "2147483645",
		pointerEvents: "none",
		display: "block",
	});
	const canvas = document.createElement("canvas");
	Object.assign(canvas.style, { width: "100%", height: "100%" });
	const highlightLayer = document.createElement("div");
	Object.assign(highlightLayer.style, { position: "fixed", inset: "0", pointerEvents: "none" });
	root.append(canvas, highlightLayer);
	document.documentElement.appendChild(root);
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Could not create overlay canvas context.");
	overlay = { root, canvas, ctx, highlightLayer, visible: true };
	resizeCanvas(overlay);
	window.addEventListener("resize", () => overlay && resizeCanvas(overlay));
	return overlay;
}

function show(state: OverlayState): void {
	state.visible = true;
	state.root.style.display = "block";
	resizeCanvas(state);
}

function hide(state: OverlayState): void {
	state.visible = false;
	state.root.style.display = "none";
}

function clear(state: OverlayState): void {
	resizeCanvas(state);
	state.ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
	state.highlightLayer.replaceChildren();
}

function highlight(state: OverlayState, command: Extract<OverlayCommand, { action: "highlight" }>): void {
	show(state);
	const element = command.elementId ? resolveSelectedElement(command.elementId) : command.selector ? document.querySelector(command.selector) ?? undefined : undefined;
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
	for (const stroke of strokes) renderStroke(state.ctx, stroke);
}

function renderStroke(ctx: CanvasRenderingContext2D, stroke: OverlayStroke): void {
	ctx.save();
	ctx.strokeStyle = stroke.color ?? "#fa1e0e";
	ctx.fillStyle = stroke.color ?? "#fa1e0e";
	ctx.lineWidth = stroke.size ?? 4;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	if (stroke.type === "freehand") {
		if (stroke.points.length < 1) {
			ctx.restore();
			return;
		}
		ctx.beginPath();
		ctx.moveTo(stroke.points[0]!.x, stroke.points[0]!.y);
		for (const point of stroke.points.slice(1)) ctx.lineTo(point.x, point.y);
		ctx.stroke();
	} else if (stroke.type === "rect") {
		ctx.strokeRect(stroke.start.x, stroke.start.y, stroke.end.x - stroke.start.x, stroke.end.y - stroke.start.y);
	} else if (stroke.type === "arrow") {
		const angle = Math.atan2(stroke.end.y - stroke.start.y, stroke.end.x - stroke.start.x);
		const headLen = Math.max(18, (stroke.size ?? 4) * 6);
		ctx.beginPath();
		ctx.moveTo(stroke.start.x, stroke.start.y);
		ctx.lineTo(stroke.end.x, stroke.end.y);
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(stroke.end.x, stroke.end.y);
		ctx.lineTo(stroke.end.x - headLen * Math.cos(angle - 0.45), stroke.end.y - headLen * Math.sin(angle - 0.45));
		ctx.lineTo(stroke.end.x - headLen * Math.cos(angle + 0.45), stroke.end.y - headLen * Math.sin(angle + 0.45));
		ctx.closePath();
		ctx.fill();
	}
	ctx.restore();
}

function resizeCanvas(state: OverlayState): void {
	const ratio = window.devicePixelRatio || 1;
	state.canvas.width = Math.floor(window.innerWidth * ratio);
	state.canvas.height = Math.floor(window.innerHeight * ratio);
	state.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}
