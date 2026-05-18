import { applyOverlayCommands, type OverlayCommand } from "./content/overlay.js";
import { startElementSelection, type SelectElementsOptions } from "./content/selection.js";

interface ActivateMessage {
	type: "pi-bridge:activate";
}

interface SelectElementsMessage {
	type: "pi-bridge:select-elements";
	options: SelectElementsOptions;
}

interface OverlayMessage {
	type: "pi-bridge:overlay";
	commands: OverlayCommand[];
}

interface ActivationResponse {
	ok: true;
	title: string;
	origin: string;
	viewport: { width: number; height: number; devicePixelRatio: number };
	capabilities: string[];
}

const ACTIVATION_MARKER_ID = "pi-browser-bridge-activation-marker";

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
	if (isActivateMessage(message)) {
		showActivationMarker();
		const response: ActivationResponse = {
			ok: true,
			title: document.title,
			origin: location.origin,
			viewport: {
				width: window.innerWidth,
				height: window.innerHeight,
				devicePixelRatio: window.devicePixelRatio || 1,
			},
			capabilities: ["activation", "element-selection"],
		};
		sendResponse(response);
		return;
	}

	if (isSelectElementsMessage(message)) {
		void startElementSelection(message.options).then(sendResponse, (error) => sendResponse({ status: "cancelled", elements: [], reason: error instanceof Error ? error.message : "error" }));
		return true;
	}

	if (isOverlayMessage(message)) {
		try {
			sendResponse(applyOverlayCommands(message.commands));
		} catch (error) {
			sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
		}
	}
});

function isActivateMessage(value: unknown): value is ActivateMessage {
	return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "pi-bridge:activate";
}

function isSelectElementsMessage(value: unknown): value is SelectElementsMessage {
	return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "pi-bridge:select-elements" && typeof (value as { options?: unknown }).options === "object";
}

function isOverlayMessage(value: unknown): value is OverlayMessage {
	return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "pi-bridge:overlay" && Array.isArray((value as { commands?: unknown }).commands);
}

function showActivationMarker(): void {
	document.getElementById(ACTIVATION_MARKER_ID)?.remove();
	const marker = document.createElement("div");
	marker.id = ACTIVATION_MARKER_ID;
	marker.textContent = "Pi bridge active";
	Object.assign(marker.style, {
		position: "fixed",
		top: "12px",
		right: "12px",
		zIndex: "2147483647",
		padding: "8px 10px",
		borderRadius: "8px",
		background: "rgba(26, 115, 232, 0.95)",
		color: "white",
		font: "13px system-ui, sans-serif",
		boxShadow: "0 2px 12px rgba(0,0,0,0.25)",
		pointerEvents: "none",
	});
	document.documentElement.appendChild(marker);
	setTimeout(() => marker.remove(), 1600);
}
