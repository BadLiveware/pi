/// <reference path="./chrome.d.ts" />
/// <reference path="./content/selection.ts" />
/// <reference path="./content/overlay.ts" />
/// <reference path="./content/interact.ts" />
/// <reference path="./content/clipboard.ts" />

namespace PiBrowserBridgeContent {
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

	interface InteractMessage {
		type: "pi-bridge:interact";
		request: InteractionRequest;
	}

	interface ClipboardMessage {
		type: "pi-bridge:clipboard";
		request: ClipboardRequest;
	}

	interface ActivationResponse {
		ok: true;
		title: string;
		origin: string;
		viewport: { width: number; height: number; devicePixelRatio: number };
		capabilities: string[];
	}

	type ContentGlobal = typeof globalThis & {
		__piBrowserBridgeContentInstalled?: boolean;
	};

	const ACTIVATION_MARKER_ID = "pi-browser-bridge-activation-marker";
	const contentGlobal = globalThis as ContentGlobal;

	if (!contentGlobal.__piBrowserBridgeContentInstalled) {
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
					capabilities: ["activation", "element-selection", "overlay", "interaction", "clipboard"],
				};
				sendResponse(response);
				return;
			}

			if (isSelectElementsMessage(message)) {
				void PiBrowserBridgeContent.startElementSelection(message.options).then(sendResponse, (error) => sendResponse({ status: "cancelled", elements: [], reason: error instanceof Error ? error.message : "error" }));
				return true;
			}

			if (isOverlayMessage(message)) {
				try {
					sendResponse(PiBrowserBridgeContent.applyOverlayCommands(message.commands));
				} catch (error) {
					sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
				}
				return;
			}

			if (isInteractMessage(message)) {
				void PiBrowserBridgeContent.runInteractions(message.request).then(sendResponse, (error) => sendResponse({ ok: false, results: [{ index: 0, type: "error", ok: false, summary: error instanceof Error ? error.message : String(error) }] }));
				return true;
			}

			if (isClipboardMessage(message)) {
				void PiBrowserBridgeContent.runClipboardRequest(message.request).then(sendResponse, (error) => sendResponse({ ok: false, action: "write", chars: 0, summary: error instanceof Error ? error.message : String(error) }));
				return true;
			}
		});
		contentGlobal.__piBrowserBridgeContentInstalled = true;
	}

	function isActivateMessage(value: unknown): value is ActivateMessage {
		return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "pi-bridge:activate";
	}

	function isSelectElementsMessage(value: unknown): value is SelectElementsMessage {
		return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "pi-bridge:select-elements" && typeof (value as { options?: unknown }).options === "object";
	}

	function isOverlayMessage(value: unknown): value is OverlayMessage {
		return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "pi-bridge:overlay" && Array.isArray((value as { commands?: unknown }).commands);
	}

	function isInteractMessage(value: unknown): value is InteractMessage {
		return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "pi-bridge:interact" && typeof (value as { request?: unknown }).request === "object";
	}

	function isClipboardMessage(value: unknown): value is ClipboardMessage {
		return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "pi-bridge:clipboard" && typeof (value as { request?: unknown }).request === "object";
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
}
