/// <reference path="./chrome.d.ts" />

import type { ActivatedTab, RuntimeState } from "./background/types.js";
import { DEFAULT_BRIDGE_URL } from "./shared/defaults.js";
import { formatExtensionDebugLog } from "./shared/debug-log.js";
import { parsePairingDetails } from "./shared/pairing-details.js";

const BRIDGE_URL_DRAFT_KEY = "bridgeUrlDraft";
const PAIRING_TOKEN_DRAFT_KEY = "pairingTokenDraft";
const PAIRING_DETAILS_DRAFT_KEY = "pairingDetailsDraft";

interface PopupResponse<T = unknown> {
	ok: boolean;
	state?: RuntimeState;
	tab?: ActivatedTab;
	message?: string;
	error?: string;
}

const statusEl = requireElement("status");
const detailsInput = requireInput("pairing-details");
const urlInput = requireInput("bridge-url");
const tokenInput = requireInput("pairing-token");
const messageEl = requireElement("message");
const debugLogEl = requireElement("debug-log");
const connectButton = requireButton("connect");
const disconnectButton = requireButton("disconnect");
const activateButton = requireButton("activate");
const shareSelectionButton = requireButton("share-selection");
const shareDrawingButton = requireButton("share-drawing");

for (const input of [detailsInput, urlInput, tokenInput]) {
	input.addEventListener("input", () => handlePairingInput(input.value));
}

connectButton.addEventListener("click", () => {
	void runAction(async () => {
		const response = await send<PopupResponse<RuntimeState>>({ type: "bridge:connect", url: urlInput.value, token: tokenInput.value });
		if (response.ok) await clearSensitivePairingDrafts();
		handleResponse(response, "Connected to Pi bridge.");
	});
});

disconnectButton.addEventListener("click", () => {
	void runAction(async () => {
		const response = await send<PopupResponse<RuntimeState>>({ type: "bridge:disconnect" });
		handleResponse(response, "Disconnected.");
	});
});

activateButton.addEventListener("click", () => {
	void runAction(async () => {
		const response = await send<PopupResponse<ActivatedTab>>({ type: "tabs:activateCurrent" });
		handleResponse(response, response.tab ? `Activated tab ${response.tab.tabId}.` : "Activated current tab.");
	});
});

shareSelectionButton.addEventListener("click", () => {
	void runAction(async () => {
		const response = await send<PopupResponse>({ type: "tabs:shareSelection" });
		handleResponse(response, "Selection shared with Pi.");
	});
});

shareDrawingButton.addEventListener("click", () => {
	void runAction(async () => {
		const response = await send<PopupResponse>({ type: "tabs:shareDrawing" });
		handleResponse(response, "Drawing shared with Pi.");
	});
});

void init();

async function init(): Promise<void> {
	await loadPairingDrafts();
	await refresh();
}

async function loadPairingDrafts(): Promise<void> {
	urlInput.value = DEFAULT_BRIDGE_URL;
	await chrome.storage.local.remove([BRIDGE_URL_DRAFT_KEY, PAIRING_TOKEN_DRAFT_KEY, PAIRING_DETAILS_DRAFT_KEY]);
}

function handlePairingInput(value: string): void {
	if (applyPairingDetails(value, true)) return;
	void persistPairingDrafts();
}

function applyPairingDetails(value: string, showMessage: boolean): boolean {
	const details = parsePairingDetails(value);
	if (!details) return false;
	urlInput.value = details.url;
	tokenInput.value = details.token;
	detailsInput.value = value.trim();
	void persistPairingDrafts();
	if (showMessage) setMessage("Filled URL and token from one pairing value.", false);
	return true;
}

async function persistPairingDrafts(): Promise<void> {
	await chrome.storage.local.set({
		[BRIDGE_URL_DRAFT_KEY]: urlInput.value,
		[PAIRING_TOKEN_DRAFT_KEY]: tokenInput.value,
		[PAIRING_DETAILS_DRAFT_KEY]: detailsInput.value,
	});
}

async function clearSensitivePairingDrafts(): Promise<void> {
	detailsInput.value = "";
	tokenInput.value = "";
	await chrome.storage.local.remove([PAIRING_TOKEN_DRAFT_KEY, PAIRING_DETAILS_DRAFT_KEY]);
	await chrome.storage.local.set({ [BRIDGE_URL_DRAFT_KEY]: urlInput.value });
}

async function refresh(): Promise<void> {
	const response = await send<PopupResponse<RuntimeState>>({ type: "bridge:getState" });
	if (!response.ok || !response.state) {
		setMessage(response.error ?? "Could not load bridge state.", true);
		return;
	}
	renderState(response.state);
}

async function runAction(action: () => Promise<void>): Promise<void> {
	setBusy(true);
	try {
		await action();
	} catch (error) {
		setMessage(error instanceof Error ? error.message : String(error), true);
	} finally {
		setBusy(false);
		await refresh();
	}
}

function handleResponse(response: PopupResponse, successMessage: string): void {
	if (!response.ok) {
		setMessage(response.error ?? "Browser bridge action failed.", true);
		void refresh();
		return;
	}
	if (response.state) renderState(response.state);
	setMessage(response.message ?? successMessage, false);
}

function renderState(state: RuntimeState): void {
	if (state.url && (!urlInput.value || urlInput.value === DEFAULT_BRIDGE_URL)) urlInput.value = state.url;
	const lines = [
		`Connection: ${state.connected ? "connected" : "disconnected"}`,
		`Client: ${state.clientId ?? "not paired"}`,
		`Activated tabs: ${state.activatedTabs.length}`,
	];
	if (state.lastError) lines.push(`Last error: ${state.lastError}`);
	debugLogEl.textContent = state.debugLog.length > 0 ? formatExtensionDebugLog(state.debugLog, 30) : "No debug events yet.";
	if (state.activatedTabs.length > 0) {
		for (const tab of state.activatedTabs.slice(-3)) {
			lines.push(`- ${tab.title ?? "Untitled"} (${tab.origin ?? "unknown origin"})`);
		}
	}
	statusEl.textContent = lines.join("\n");
	connectButton.disabled = state.connected;
	disconnectButton.disabled = !state.connected;
	activateButton.disabled = !state.connected;
	shareSelectionButton.disabled = !state.connected;
	shareDrawingButton.disabled = !state.connected;
}

function setBusy(busy: boolean): void {
	if (!busy) return;
	connectButton.disabled = true;
	disconnectButton.disabled = true;
	activateButton.disabled = true;
	shareSelectionButton.disabled = true;
	shareDrawingButton.disabled = true;
}

function setMessage(message: string, isError: boolean): void {
	messageEl.textContent = message;
	messageEl.classList.toggle("error", isError);
}

async function send<T>(message: unknown): Promise<T> {
	return await chrome.runtime.sendMessage<T>(message);
}

function requireElement(id: string): HTMLElement {
	const element = document.getElementById(id);
	if (!element) throw new Error(`Missing popup element #${id}.`);
	return element;
}

function requireInput(id: string): HTMLInputElement {
	const element = requireElement(id);
	if (!(element instanceof HTMLInputElement)) throw new Error(`Popup element #${id} is not an input.`);
	return element;
}

function requireButton(id: string): HTMLButtonElement {
	const element = requireElement(id);
	if (!(element instanceof HTMLButtonElement)) throw new Error(`Popup element #${id} is not a button.`);
	return element;
}
