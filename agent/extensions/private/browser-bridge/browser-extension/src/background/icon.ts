/// <reference path="../chrome.d.ts" />

export type ActionIconStatus = "active" | "connected" | "disconnected" | "error";
export type ActionIconSource = "path";

export interface ActionIconUpdateResult {
	status: ActionIconStatus;
	ok: boolean;
	source: ActionIconSource;
	error?: string;
}

export const ACTION_ICON_PATHS: Record<ActionIconStatus, Record<number, string>> = {
	active: iconSet("green"),
	connected: iconSet("blue"),
	disconnected: iconSet("yellow"),
	error: iconSet("red"),
};

let iconUpdateQueue: Promise<void> = Promise.resolve();

export function actionIconStatus(connected: boolean, lastError: string | undefined, activeTab = false): ActionIconStatus {
	if (connected && activeTab) return "active";
	if (connected) return "connected";
	return lastError ? "error" : "disconnected";
}

export function actionIconTitle(status: ActionIconStatus, lastError: string | undefined): string {
	if (status === "active") return "Pi Browser Bridge — connected, current tab active";
	if (status === "connected") return "Pi Browser Bridge — connected";
	if (status === "error") return `Pi Browser Bridge — disconnected: ${lastError ?? "error"}`;
	return "Pi Browser Bridge — disconnected";
}

export function updateActionIcon(input: { connected: boolean; lastError?: string; activeTab?: boolean }): Promise<ActionIconUpdateResult> {
	const status = actionIconStatus(input.connected, input.lastError, input.activeTab);
	const title = actionIconTitle(status, input.lastError);
	const run = iconUpdateQueue.then(() => applyActionIcon(status, title));
	iconUpdateQueue = run.then(() => undefined, () => undefined);
	return run;
}

async function applyActionIcon(status: ActionIconStatus, title: string): Promise<ActionIconUpdateResult> {
	try {
		await chrome.action.setIcon({ path: ACTION_ICON_PATHS[status] });
		await chrome.action.setTitle({ title });
		return { status, ok: true, source: "path" };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.debug("[pi-browser-bridge] action-icon-update-failed", error);
		return { status, ok: false, source: "path", error: message };
	}
}

function iconSet(color: "blue" | "green" | "yellow" | "red"): Record<number, string> {
	return {
		16: `/icons/pi-${color}-16.png`,
		32: `/icons/pi-${color}-32.png`,
		48: `/icons/pi-${color}-48.png`,
		128: `/icons/pi-${color}-128.png`,
	};
}
