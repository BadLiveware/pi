import { resolveSelectedElement } from "./selection.js";

export type InteractionAction =
	| { type: "click"; elementId?: string; selector?: string; x?: number; y?: number }
	| { type: "type"; elementId?: string; selector?: string; x?: number; y?: number; text: string; clearFirst?: boolean }
	| { type: "scroll"; x?: number; y?: number; behavior?: "instant" | "smooth" }
	| { type: "key"; key: string };

export interface InteractionRequest {
	actions: InteractionAction[];
	requireUserConfirmation?: boolean;
	continueOnError?: boolean;
}

export interface InteractionActionResult {
	index: number;
	type: string;
	ok: boolean;
	summary: string;
}

export async function runInteractions(request: InteractionRequest): Promise<{ ok: boolean; cancelled?: boolean; results: InteractionActionResult[] }> {
	if (request.requireUserConfirmation && !window.confirm(`Allow Pi to run ${request.actions.length} browser action(s) on this page?`)) {
		return { ok: false, cancelled: true, results: [] };
	}
	const results: InteractionActionResult[] = [];
	for (let index = 0; index < request.actions.length; index++) {
		const action = request.actions[index]!;
		try {
			results.push({ index, type: action.type, ok: true, summary: runAction(action) });
		} catch (error) {
			results.push({ index, type: action.type, ok: false, summary: error instanceof Error ? error.message : String(error) });
			if (!request.continueOnError) break;
		}
	}
	return { ok: results.every((result) => result.ok), results };
}

function runAction(action: InteractionAction): string {
	if (action.type === "click") {
		const target = resolveTarget(action);
		target.click();
		return "clicked target";
	}
	if (action.type === "type") {
		const target = resolveTarget(action);
		if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) throw new Error("Type target is not a text input or textarea.");
		target.focus();
		if (action.clearFirst) target.value = "";
		target.value += action.text;
		target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: action.text }));
		target.dispatchEvent(new Event("change", { bubbles: true }));
		return "typed text";
	}
	if (action.type === "scroll") {
		window.scrollBy({ left: action.x ?? 0, top: action.y ?? 0, behavior: action.behavior ?? "instant" });
		return "scrolled viewport";
	}
	if (action.type === "key") {
		const target = document.activeElement ?? document.body;
		target.dispatchEvent(new KeyboardEvent("keydown", { key: action.key, bubbles: true }));
		target.dispatchEvent(new KeyboardEvent("keyup", { key: action.key, bubbles: true }));
		return `sent key ${action.key}`;
	}
	throw new Error("Unknown interaction action.");
}

function resolveTarget(action: Extract<InteractionAction, { type: "click" | "type" }>): HTMLElement {
	if (action.elementId) {
		const element = resolveSelectedElement(action.elementId);
		if (element instanceof HTMLElement) return element;
	}
	if (action.selector) {
		const element = document.querySelector(action.selector);
		if (element instanceof HTMLElement) return element;
	}
	if (typeof action.x === "number" && typeof action.y === "number") {
		const element = document.elementFromPoint(action.x, action.y);
		if (element instanceof HTMLElement) return element;
	}
	throw new Error("Could not resolve interaction target.");
}
