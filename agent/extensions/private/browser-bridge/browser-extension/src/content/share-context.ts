namespace PiBrowserBridgeContent {
	export type ShareContextKind = "selection" | "drawing" | "page";

	export interface ShareContextResult {
		cancelled: boolean;
		userNote?: string;
	}

	const FEEDBACK_ID = "pi-browser-bridge-share-feedback";

	export function promptShareContext(kind: ShareContextKind): ShareContextResult {
		const label = kind === "drawing" ? "drawing" : kind === "page" ? "page" : "selection";
		const value = window.prompt(`Add context for Pi about this ${label}.\n\nLeave blank and press OK to share without a note, or press Cancel to stop sharing.`);
		if (value === null) return { cancelled: true };
		const userNote = value.trim();
		return userNote ? { cancelled: false, userNote } : { cancelled: false };
	}

	export function showShareFeedback(message: string, isError = false): void {
		document.getElementById("pi-browser-bridge-drawing-layer")?.remove();
		document.getElementById(FEEDBACK_ID)?.remove();
		const toast = document.createElement("div");
		toast.id = FEEDBACK_ID;
		toast.textContent = message;
		Object.assign(toast.style, {
			position: "fixed",
			right: "14px",
			bottom: "14px",
			zIndex: "2147483647",
			maxWidth: "360px",
			padding: "9px 12px",
			borderRadius: "8px",
			background: isError ? "rgba(197, 34, 31, 0.96)" : "rgba(24, 128, 56, 0.96)",
			color: "white",
			font: "13px system-ui, sans-serif",
			boxShadow: "0 2px 12px rgba(0,0,0,0.28)",
			pointerEvents: "none",
		});
		document.documentElement.appendChild(toast);
		window.setTimeout(() => toast.remove(), isError ? 4200 : 2600);
	}
}
