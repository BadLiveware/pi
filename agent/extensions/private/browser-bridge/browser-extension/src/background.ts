/// <reference path="./chrome.d.ts" />

import { bridgeCloseBeforeAcceptMessage, errorMessage, shouldFallbackBridgeUrlToDefault, shouldFallbackResumeToPairRequest } from "./shared/connection-plan.js";
import { createActionIconController } from "./background/action-icon-controller.js";
import { createBridgeAckController } from "./background/bridge-acks.js";
import { mirrorBrowserDebugToPi } from "./background/client-debug.js";
import { installElementContextMenu } from "./background/context-menu.js";
import { createContentRequestHandlers } from "./background/content-requests.js";
import { createKeepAliveController } from "./background/keepalive.js";
import { MAIN_FRAME_ID, resolveTargetFrameId } from "./background/frame-target.js";
import { detectBrowser, isSupportedTabUrl, selectionOptions, type BrowserKind } from "./background/request-helpers.js";
import { shareDrawingFromCurrentTab } from "./background/share-drawing.js";
import { createShareFeedback } from "./background/share-feedback.js";
import { shareSelectionFromCurrentTab } from "./background/share-selection.js";
import type { ActivatedTab, PendingPair, RuntimeState } from "./background/types.js";
import { appendExtensionDebugLog, parseStoredDebugLog, type ExtensionDebugLogEntry } from "./shared/debug-log.js";
import { DEFAULT_BRIDGE_URL } from "./shared/defaults.js";
import { BRIDGE_PROTOCOL_VERSION, makeEnvelope, makeId, parseEnvelope, type BridgeEnvelope } from "./shared/protocol.js";

let socket: WebSocket | undefined;
let connected = false;
let bridgeUrl: string | undefined;
let clientId: string | undefined;
let resumeSecret: string | undefined;
let lastError: string | undefined;
let pendingPair: PendingPair | undefined;
let reconnectTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
let intentionalDisconnect = false;
let previewTabId: number | undefined;
let debugLog: ExtensionDebugLogEntry[] = [];
const DEBUG_LOG_KEY = "debugLog";
const activatedTabs = new Map<number, ActivatedTab>();
const keepAlive = createKeepAliveController(sendToBridge, recordDebug);
const ackController = createBridgeAckController({ isOpen: () => Boolean(socket && socket.readyState === WebSocket.OPEN), send: sendToBridge });
const showShareFeedback = createShareFeedback({ recordDebug });
const actionIcon = createActionIconController({
	isConnected: () => connected,
	getLastError: () => lastError,
	isActivatedTab: (tabId) => activatedTabs.has(tabId),
	clearActivatedTab: (tabId) => activatedTabs.delete(tabId),
	recordDebug,
});
const { handleOverlayRequest, handleDesignPreviewRequest, handleStyleInspectionRequest, handleCaptureViewRequest, handleInteractRequest, handleClipboardRequest } = createContentRequestHandlers({ resolveTargetTabId, resolveTargetFrameId: (envelope) => resolveTargetFrameId(envelope, activatedTabs), sendToBridge, recordDebug });
installElementContextMenu({ isConnected: () => connected, sendToBridgeWithAck: ackController.sendWithAck, showShareFeedback, recordDebug });
actionIcon.install();
actionIcon.update();
void actionIcon.refreshCurrentTab();

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
	void handleRuntimeMessage(message)
		.then((response) => sendResponse(response))
		.catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
	return true;
});

async function handleRuntimeMessage(message: unknown): Promise<unknown> {
	if (!isRecord(message) || typeof message.type !== "string") throw new Error("Invalid browser bridge popup message.");
	if (message.type === "bridge:getState") return { ok: true, state: await getRuntimeState() };
	if (message.type === "bridge:connect") {
		if (typeof message.url !== "string") throw new Error("Bridge URL is required.");
		if (message.token !== undefined && typeof message.token !== "string") throw new Error("Pairing token must be text when provided.");
		recordDebug({ level: "info", event: "popup-connect", data: { url: message.url, hasToken: Boolean(message.token && message.token.trim()) } });
		await connectToBridge(message.url, message.token ?? "");
		return { ok: true, state: await getRuntimeState() };
	}
	if (message.type === "bridge:disconnect") {
		recordDebug({ level: "info", event: "popup-disconnect" });
		disconnect("Disconnected from popup.");
		return { ok: true, state: await getRuntimeState() };
	}
	if (message.type === "tabs:activateCurrent") {
		recordDebug({ level: "info", event: "popup-activate-current-tab" });
		const tab = await activateCurrentTab();
		return { ok: true, tab, state: await getRuntimeState() };
	}
	if (message.type === "tabs:shareSelection") {
		recordDebug({ level: "info", event: "popup-share-selection" });
		const result = await shareSelectionFromCurrentTab({ activateCurrentTab, sendToBridgeWithAck: ackController.sendWithAck, showShareFeedback, recordDebug });
		return { ok: true, selection: result.response, message: result.message, state: await getRuntimeState() };
	}
	if (message.type === "tabs:shareDrawing") {
		recordDebug({ level: "info", event: "popup-share-drawing" });
		const result = await shareDrawingFromCurrentTab({ activateCurrentTab, sendToBridgeWithAck: ackController.sendWithAck, showShareFeedback, recordDebug });
		return { ok: true, drawing: result.response, message: result.message, state: await getRuntimeState() };
	}
	throw new Error(`Unknown browser bridge popup message ${message.type}.`);
}

async function connectToBridge(url: string, token: string): Promise<void> {
	disconnect("Replacing bridge connection.");
	const requestedUrl = normalizeBridgeUrl(url);
	bridgeUrl = requestedUrl;
	clientId = await getOrCreateClientId();
	resumeSecret = resumeSecret ?? await getStoredResumeSecret();
	lastError = undefined;
	actionIcon.update();
	recordDebug({ level: "info", event: "connect-start", data: { url: requestedUrl, hasToken: Boolean(token.trim()), hasResumeSecret: Boolean(resumeSecret) } });
	try {
		await connectWithAvailableAuth(token);
		recordDebug({ level: "info", event: "connect-success", data: { url: bridgeUrl } });
		actionIcon.update();
	} catch (error) {
		lastError = errorMessage(error);
		actionIcon.update();
		recordDebug({ level: "warn", event: "connect-failed", message: lastError, data: { url: requestedUrl } });
		if (requestedUrl === DEFAULT_BRIDGE_URL || !shouldFallbackBridgeUrlToDefault(error)) throw error;
		bridgeUrl = DEFAULT_BRIDGE_URL;
		lastError = undefined;
		actionIcon.update();
		recordDebug({ level: "info", event: "connect-url-fallback", data: { fromUrl: requestedUrl, toUrl: DEFAULT_BRIDGE_URL } });
		await chrome.storage.local.set({ bridgeUrl });
		await connectWithAvailableAuth(token);
		recordDebug({ level: "info", event: "connect-success", data: { url: bridgeUrl, afterUrlFallback: true } });
		actionIcon.update();
	}
}

async function connectWithAvailableAuth(token: string): Promise<void> {
	const trimmedToken = token.trim();
	if (trimmedToken) {
		recordDebug({ level: "info", event: "auth-path", data: { auth: "pair-token" } });
		await openBridgeSocket({ type: "pair", token: trimmedToken });
		return;
	}
	if (resumeSecret) {
		try {
			recordDebug({ level: "info", event: "auth-path", data: { auth: "resume" } });
			await openBridgeSocket({ type: "resume", resumeSecret });
			return;
		} catch (error) {
			if (!shouldFallbackResumeToPairRequest(error)) throw error;
			recordDebug({ level: "warn", event: "resume-fallback-to-pair-request", message: errorMessage(error) });
			resumeSecret = undefined;
			lastError = undefined;
			actionIcon.update();
			await chrome.storage.local.remove(["resumeSecret"]);
		}
	}
	recordDebug({ level: "info", event: "auth-path", data: { auth: "pair-request" } });
	await openBridgeSocket({ type: "pair-request" });
}

async function openBridgeSocket(auth: { type: "pair"; token: string } | { type: "pair-request" } | { type: "resume"; resumeSecret: string }): Promise<void> {
	if (!bridgeUrl || !clientId) throw new Error("Bridge URL and client id are required before connecting.");
	clearReconnectTimer();
	intentionalDisconnect = false;
	await new Promise<void>((resolve, reject) => {
		const requestId = makeId(auth.type === "pair-request" ? "pair" : auth.type);
		recordDebug({ level: "debug", event: "ws-create", data: { url: bridgeUrl, auth: auth.type, requestId } });
		const ws = new WebSocket(bridgeUrl!);
		socket = ws;
		pendingPair = {
			requestId,
			resolve: () => {
				connected = true;
				lastError = undefined;
				actionIcon.update();
				recordDebug({ level: "info", event: "connection-accepted", data: { url: bridgeUrl, clientId } });
				keepAlive.start();
				void chrome.storage.local.set({ bridgeUrl, clientId, resumeSecret });
				void restoreActivatedTabsToBridge();
				resolve();
			},
			reject,
			timer: globalThis.setTimeout(() => {
				pendingPair = undefined;
				lastError = "Timed out waiting for Pi bridge connection response.";
				actionIcon.update();
				recordDebug({ level: "warn", event: "connection-timeout", data: { auth: auth.type, requestId } });
				ws.close();
				reject(new Error("Timed out waiting for Pi bridge connection response."));
			}, 10_000),
		};
		ws.addEventListener("open", () => {
			recordDebug({ level: "debug", event: "ws-open", data: { auth: auth.type, requestId } });
			ws.send(JSON.stringify(makeEnvelope({
				id: requestId,
				direction: "browser-to-pi",
				type: auth.type,
				payload: authPayload(auth),
			})));
		});
		ws.addEventListener("message", (event) => handleSocketMessage(String(event.data)));
		ws.addEventListener("close", (event) => handleSocketClose(ws, event));
		ws.addEventListener("error", () => {
			lastError = "Could not connect to the Pi bridge.";
			actionIcon.update();
			recordDebug({ level: "error", event: "ws-error", message: lastError, data: { url: bridgeUrl, auth: auth.type, requestId } });
		});
	});
}

function handleSocketClose(ws: WebSocket, event?: CloseEvent): void {
	const wasConnected = connected;
	connected = false;
	keepAlive.stop();
	recordDebug({ level: wasConnected ? "warn" : "debug", event: "ws-close", data: { code: event?.code, wasClean: event?.wasClean, reason: event?.reason || undefined, wasConnected } });
	if (socket === ws) socket = undefined;
	ackController.rejectAll(new Error(event?.reason || "Pi bridge socket closed before acknowledgement."));
	if (pendingPair) {
		const pending = pendingPair;
		pendingPair = undefined;
		globalThis.clearTimeout(pending.timer);
		const message = bridgeCloseBeforeAcceptMessage(event, lastError);
		lastError = message;
		actionIcon.update();
		recordDebug({ level: "warn", event: "connection-closed-before-accept", message, data: { requestId: pending.requestId } });
		pending.reject(new Error(message));
	}
	if (wasConnected && !intentionalDisconnect) {
		lastError = event?.reason || "Pi bridge connection closed.";
		scheduleReconnect();
	}
	actionIcon.update();
	intentionalDisconnect = false;
}

function scheduleReconnect(): void {
	if (!bridgeUrl || !clientId || !resumeSecret || reconnectTimer) return;
	recordDebug({ level: "info", event: "reconnect-scheduled", data: { url: bridgeUrl, clientId } });
	reconnectTimer = globalThis.setTimeout(() => {
		reconnectTimer = undefined;
		void openBridgeSocket({ type: "resume", resumeSecret: resumeSecret! }).catch((error) => {
			lastError = errorMessage(error);
			actionIcon.update();
			recordDebug({ level: "warn", event: "reconnect-failed", message: lastError });
			scheduleReconnect();
		});
	}, 1000);
}

function clearReconnectTimer(): void {
	if (!reconnectTimer) return;
	globalThis.clearTimeout(reconnectTimer);
	reconnectTimer = undefined;
}

function authPayload(auth: { type: "pair"; token: string } | { type: "pair-request" } | { type: "resume"; resumeSecret: string }): Record<string, unknown> {
	if (auth.type === "pair") return { token: auth.token, client: clientInfo() };
	if (auth.type === "resume") return { clientId, resumeSecret: auth.resumeSecret, client: clientInfo() };
	return { client: clientInfo() };
}

function clientInfo(): Record<string, unknown> {
	return {
		clientId,
		browser: detectBrowser(),
		extensionVersion: chrome.runtime.getManifest().version,
		capabilities: ["tabs", "activation", "element-selection", "context-menu-selection", "drawing", "overlay", "style-inspection", "design-preview", "style-copy", "capture-view", "preview", "interaction", "clipboard"],
		activeTabId: [...activatedTabs.values()].sort((a, b) => b.activatedAt - a.activatedAt)[0]?.tabId,
	};
}

async function restoreActivatedTabsToBridge(): Promise<void> {
	for (const tab of activatedTabs.values()) sendActivatedTab(tab);
}

async function activateCurrentTab(): Promise<ActivatedTab> {
	if (!socket || socket.readyState !== WebSocket.OPEN || !connected) throw new Error("Connect to Pi before activating a tab.");
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	if (!tab?.id) throw new Error("No active tab is available.");
	if (!isSupportedTabUrl(tab.url)) throw new Error("This page cannot be activated by the browser bridge.");

	await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [MAIN_FRAME_ID] }, files: ["dist/content.js"] });
	const response = await chrome.tabs.sendMessage<ActivationResponse>(tab.id, { type: "pi-bridge:activate" }, { frameId: MAIN_FRAME_ID });
	if (!response?.ok) throw new Error("Content script did not acknowledge activation.");

	const activated: ActivatedTab = {
		tabId: tab.id,
		frameId: MAIN_FRAME_ID,
		windowId: tab.windowId,
		title: tab.title ?? response.title,
		url: tab.url,
		origin: response.origin,
		capabilities: response.capabilities,
		activatedAt: Date.now(),
	};
	activatedTabs.set(tab.id, activated);
	actionIcon.markCurrentTab(tab.id);
	recordDebug({ level: "info", event: "tab-activated", data: { tabId: tab.id, origin: response.origin } });
	sendActivatedTab(activated, response.viewport);
	return activated;
}

function sendActivatedTab(activated: ActivatedTab, viewport?: ActivationResponse["viewport"]): void {
	sendToBridge(makeEnvelope({
		direction: "browser-to-pi",
		type: "tab:activated",
		payload: {
			tabId: activated.tabId,
			frameId: activated.frameId,
			title: activated.title,
			origin: activated.origin,
			url: activated.url,
			active: true,
			capabilities: activated.capabilities,
			viewport,
		},
	}));
}

function handleSocketMessage(text: string): void {
	const envelope = parseEnvelope(text);
	if (!envelope) {
		recordDebug({ level: "warn", event: "message-parse-failed", data: { length: text.length } });
		return;
	}
	recordDebug({ level: "debug", event: "message-received", data: { type: envelope.type, requestId: envelope.requestId } });
	if (pendingPair && envelope.requestId === pendingPair.requestId) {
		const pending = pendingPair;
		pendingPair = undefined;
		globalThis.clearTimeout(pending.timer);
		if (envelope.type === "pair:accepted" || envelope.type === "resume:accepted") {
			const accepted = isRecord(envelope.payload) && typeof envelope.payload.clientId === "string" ? envelope.payload.clientId : clientId;
			clientId = accepted;
			if (isRecord(envelope.payload) && typeof envelope.payload.resumeSecret === "string") resumeSecret = envelope.payload.resumeSecret;
			recordDebug({ level: "info", event: "auth-accepted", data: { type: envelope.type, clientId } });
			pending.resolve();
			return;
		}
		if (envelope.type === "error") {
			const message = isRecord(envelope.payload) && typeof envelope.payload.message === "string" ? envelope.payload.message : "Pairing failed.";
			lastError = message;
			actionIcon.update();
			recordDebug({ level: "warn", event: "auth-error", message, data: { requestId: envelope.requestId } });
			pending.reject(new Error(message));
			return;
		}
		pending.reject(new Error(`Unexpected bridge connection response ${envelope.type}.`));
		return;
	}

	if (envelope.direction === "pi-to-browser" && ackController.resolve(envelope)) return;

	if (envelope.direction === "pi-to-browser" && envelope.type === "select-elements") {
		void handleSelectElementsRequest(envelope);
		return;
	}
	if (envelope.direction === "pi-to-browser" && envelope.type === "overlay") {
		void handleOverlayRequest(envelope);
		return;
	}
	if (envelope.direction === "pi-to-browser" && envelope.type === "design-preview") {
		void handleDesignPreviewRequest(envelope);
		return;
	}
	if (envelope.direction === "pi-to-browser" && envelope.type === "style-inspection") {
		void handleStyleInspectionRequest(envelope);
		return;
	}
	if (envelope.direction === "pi-to-browser" && envelope.type === "capture-view") {
		void handleCaptureViewRequest(envelope);
		return;
	}
	if (envelope.direction === "pi-to-browser" && envelope.type === "open-preview") {
		void handleOpenPreviewRequest(envelope);
		return;
	}
	if (envelope.direction === "pi-to-browser" && envelope.type === "interact") {
		void handleInteractRequest(envelope);
		return;
	}
	if (envelope.direction === "pi-to-browser" && envelope.type === "clipboard") {
		void handleClipboardRequest(envelope);
	}
}

async function handleSelectElementsRequest(envelope: BridgeEnvelope): Promise<void> {
	try {
		const tabId = resolveTargetTabId(envelope);
		if (!tabId) throw new Error("No activated browser tab is available for element selection.");
		await chrome.scripting.executeScript({ target: { tabId }, files: ["dist/content.js"] });
		const response = await chrome.tabs.sendMessage(tabId, { type: "pi-bridge:select-elements", options: selectionOptions(envelope.payload) });
		sendToBridge(makeEnvelope({ direction: "browser-to-pi", requestId: envelope.id, type: "select-elements:result", payload: response }));
	} catch (error) {
		sendToBridge(makeEnvelope({
			direction: "browser-to-pi",
			requestId: envelope.id,
			type: "error",
			payload: { code: "selection_failed", message: error instanceof Error ? error.message : String(error) },
		}));
	}
}

async function handleOpenPreviewRequest(envelope: BridgeEnvelope): Promise<void> {
	try {
		if (!isRecord(envelope.payload) || typeof envelope.payload.url !== "string") throw new Error("Preview URL is required.");
		const mode = envelope.payload.mode === "reuse-preview-tab" ? "reuse-preview-tab" : "new-tab";
		const tab = mode === "reuse-preview-tab" && previewTabId !== undefined
			? await chrome.tabs.update(previewTabId, { url: envelope.payload.url, active: true })
			: await chrome.tabs.create({ url: envelope.payload.url, active: true });
		previewTabId = tab.id;
		sendToBridge(makeEnvelope({ direction: "browser-to-pi", requestId: envelope.id, type: "open-preview:result", payload: { ok: true, tabId: tab.id } }));
	} catch (error) {
		sendToBridge(makeEnvelope({
			direction: "browser-to-pi",
			requestId: envelope.id,
			type: "error",
			payload: { code: "open_preview_failed", message: error instanceof Error ? error.message : String(error) },
		}));
	}
}

function sendToBridge(envelope: BridgeEnvelope): void {
	if (!socket || socket.readyState !== WebSocket.OPEN) {
		recordDebug({ level: "warn", event: "send-dropped", data: { type: envelope.type, requestId: envelope.requestId } });
		return;
	}
	recordDebug({ level: "debug", event: "message-sent", data: { type: envelope.type, requestId: envelope.requestId } });
	socket.send(JSON.stringify(envelope));
}

function resolveTargetTabId(envelope: BridgeEnvelope): number | undefined {
	if (typeof envelope.target?.tabId === "number") return envelope.target.tabId;
	const latest = [...activatedTabs.values()].sort((a, b) => b.activatedAt - a.activatedAt)[0];
	return latest?.tabId;
}

function disconnect(reason: string): void {
	recordDebug({ level: "info", event: "disconnect", message: reason, data: { hadSocket: Boolean(socket), connected } });
	clearReconnectTimer();
	keepAlive.stop();
	intentionalDisconnect = true;
	if (pendingPair) {
		globalThis.clearTimeout(pendingPair.timer);
		pendingPair = undefined;
	}
	ackController.rejectAll(new Error(reason));
	if (socket && socket.readyState === WebSocket.OPEN) socket.close(1000, reason);
	socket = undefined;
	connected = false;
	lastError = undefined;
	actionIcon.update();
}

async function getRuntimeState(): Promise<RuntimeState> {
	const stored = await chrome.storage.local.get(["bridgeUrl", "clientId", "resumeSecret", DEBUG_LOG_KEY]);
	if (debugLog.length === 0) debugLog = parseStoredDebugLog(stored[DEBUG_LOG_KEY]);
	if (!bridgeUrl) bridgeUrl = typeof stored.bridgeUrl === "string" ? stored.bridgeUrl : DEFAULT_BRIDGE_URL;
	if (!connected && bridgeUrl !== DEFAULT_BRIDGE_URL) bridgeUrl = DEFAULT_BRIDGE_URL;
	clientId = clientId ?? (typeof stored.clientId === "string" ? stored.clientId : undefined);
	resumeSecret = resumeSecret ?? (typeof stored.resumeSecret === "string" ? stored.resumeSecret : undefined);
	actionIcon.update();
	return {
		connected,
		url: bridgeUrl,
		clientId,
		lastError,
		activatedTabs: [...activatedTabs.values()],
		debugLog: debugLog.map((entry) => ({ ...entry, data: entry.data ? { ...entry.data } : undefined })),
	};
}

async function getStoredResumeSecret(): Promise<string | undefined> {
	const stored = await chrome.storage.local.get(["resumeSecret"]);
	return typeof stored.resumeSecret === "string" && stored.resumeSecret.length > 0 ? stored.resumeSecret : undefined;
}

async function getOrCreateClientId(): Promise<string> {
	const stored = await chrome.storage.local.get(["clientId"]);
	if (typeof stored.clientId === "string" && stored.clientId.length > 0) return stored.clientId;
	const generated = makeId("browser");
	await chrome.storage.local.set({ clientId: generated });
	return generated;
}

function normalizeBridgeUrl(url: string): string {
	const trimmed = url.trim();
	if (!trimmed.startsWith("ws://127.0.0.1:")) throw new Error("Bridge URL must use ws://127.0.0.1:<port>.");
	return trimmed;
}

function recordDebug(entry: Omit<ExtensionDebugLogEntry, "at" | "source"> & { at?: number }): void {
	debugLog = appendExtensionDebugLog(debugLog, { ...entry, source: "background" });
	const latest = debugLog[debugLog.length - 1];
	if (latest) {
		console.debug("[pi-browser-bridge]", latest.event, latest.message ?? "", latest.data ?? "");
		mirrorBrowserDebugToPi(latest, socket, connected);
	}
	void chrome.storage.local.set({ [DEBUG_LOG_KEY]: debugLog });
}


interface ActivationResponse {
	ok: true;
	title: string;
	origin: string;
	viewport: { width: number; height: number; devicePixelRatio: number };
	capabilities: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
