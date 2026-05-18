interface ActivateMessage {
	type: "pi-bridge:activate";
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
	if (!isActivateMessage(message)) return;
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
		capabilities: ["activation"],
	};
	sendResponse(response);
});

function isActivateMessage(value: unknown): value is ActivateMessage {
	return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "pi-bridge:activate";
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
