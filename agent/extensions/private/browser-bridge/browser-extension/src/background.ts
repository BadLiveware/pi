import { BRIDGE_PROTOCOL_VERSION, makeEnvelope, makeId, parseEnvelope, type BridgeEnvelope } from "./shared/protocol.js";

type BrowserKind = "chrome" | "edge" | "chromium" | "unknown";

interface RuntimeState {
	connected: boolean;
	url?: string;
	clientId?: string;
	lastError?: string;
	activatedTabs: ActivatedTab[];
}

interface ActivatedTab {
	tabId: number;
	title?: string;
	origin?: string;
	capabilities: string[];
	activatedAt: number;
}

interface PendingPair {
	requestId: string;
	resolve: () => void;
	reject: (error: Error) => void;
	timer: number;
}

let socket: WebSocket | undefined;
let connected = false;
let bridgeUrl: string | undefined;
let clientId: string | undefined;
let lastError: string | undefined;
let pendingPair: PendingPair | undefined;
const activatedTabs = new Map<number, ActivatedTab>();

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
		if (typeof message.url !== "string" || typeof message.token !== "string") throw new Error("Bridge URL and token are required.");
		await connectToBridge(message.url, message.token);
		return { ok: true, state: await getRuntimeState() };
	}
	if (message.type === "bridge:disconnect") {
		disconnect("Disconnected from popup.");
		return { ok: true, state: await getRuntimeState() };
	}
	if (message.type === "tabs:activateCurrent") {
		const tab = await activateCurrentTab();
		return { ok: true, tab, state: await getRuntimeState() };
	}
	throw new Error(`Unknown browser bridge popup message ${message.type}.`);
}

async function connectToBridge(url: string, token: string): Promise<void> {
	disconnect("Replacing bridge connection.");
	bridgeUrl = normalizeBridgeUrl(url);
	clientId = await getOrCreateClientId();
	lastError = undefined;

	await new Promise<void>((resolve, reject) => {
		const requestId = makeId("pair");
		const ws = new WebSocket(bridgeUrl!);
		socket = ws;
		pendingPair = {
			requestId,
			resolve: () => {
				connected = true;
				void chrome.storage.local.set({ bridgeUrl, clientId });
				resolve();
			},
			reject,
			timer: window.setTimeout(() => {
				pendingPair = undefined;
				ws.close();
				reject(new Error("Timed out waiting for Pi bridge pairing response."));
			}, 10_000),
		};
		ws.addEventListener("open", () => {
			ws.send(JSON.stringify(makeEnvelope({
				id: requestId,
				direction: "browser-to-pi",
				type: "pair",
				payload: {
					token,
					client: {
						clientId,
						browser: detectBrowser(),
						extensionVersion: chrome.runtime.getManifest().version,
						capabilities: ["tabs", "activation"],
					},
				},
			})));
		});
		ws.addEventListener("message", (event) => handleSocketMessage(String(event.data)));
		ws.addEventListener("close", () => {
			connected = false;
			if (pendingPair) {
				const pending = pendingPair;
				pendingPair = undefined;
				window.clearTimeout(pending.timer);
				pending.reject(new Error("Pi bridge socket closed before pairing completed."));
			}
		});
		ws.addEventListener("error", () => {
			lastError = "Could not connect to the Pi bridge.";
		});
	});
}

async function activateCurrentTab(): Promise<ActivatedTab> {
	if (!socket || socket.readyState !== WebSocket.OPEN || !connected) throw new Error("Connect to Pi before activating a tab.");
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	if (!tab?.id) throw new Error("No active tab is available.");
	if (!isSupportedTabUrl(tab.url)) throw new Error("This page cannot be activated by the browser bridge.");

	await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["dist/content.js"] });
	const response = await chrome.tabs.sendMessage<ActivationResponse>(tab.id, { type: "pi-bridge:activate" });
	if (!response?.ok) throw new Error("Content script did not acknowledge activation.");

	const activated: ActivatedTab = {
		tabId: tab.id,
		title: tab.title ?? response.title,
		origin: response.origin,
		capabilities: response.capabilities,
		activatedAt: Date.now(),
	};
	activatedTabs.set(tab.id, activated);
	sendToBridge(makeEnvelope({
		direction: "browser-to-pi",
		type: "tab:activated",
		payload: {
			tabId: activated.tabId,
			title: activated.title,
			origin: activated.origin,
			active: true,
			capabilities: activated.capabilities,
			viewport: response.viewport,
		},
	}));
	return activated;
}

function handleSocketMessage(text: string): void {
	const envelope = parseEnvelope(text);
	if (!envelope) return;
	if (pendingPair && envelope.requestId === pendingPair.requestId) {
		const pending = pendingPair;
		pendingPair = undefined;
		window.clearTimeout(pending.timer);
		if (envelope.type === "pair:accepted") {
			const accepted = isRecord(envelope.payload) && typeof envelope.payload.clientId === "string" ? envelope.payload.clientId : clientId;
			clientId = accepted;
			pending.resolve();
			return;
		}
		if (envelope.type === "error") {
			const message = isRecord(envelope.payload) && typeof envelope.payload.message === "string" ? envelope.payload.message : "Pairing failed.";
			lastError = message;
			pending.reject(new Error(message));
			return;
		}
		pending.reject(new Error(`Unexpected pairing response ${envelope.type}.`));
		return;
	}

	if (envelope.direction === "pi-to-browser" && envelope.type === "select-elements") {
		void handleSelectElementsRequest(envelope);
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

function sendToBridge(envelope: BridgeEnvelope): void {
	if (!socket || socket.readyState !== WebSocket.OPEN) return;
	socket.send(JSON.stringify(envelope));
}

function resolveTargetTabId(envelope: BridgeEnvelope): number | undefined {
	if (typeof envelope.target?.tabId === "number") return envelope.target.tabId;
	const latest = [...activatedTabs.values()].sort((a, b) => b.activatedAt - a.activatedAt)[0];
	return latest?.tabId;
}

function selectionOptions(payload: unknown): Record<string, unknown> {
	if (!isRecord(payload)) return { mode: "single" };
	return {
		mode: payload.mode === "multiple" ? "multiple" : "single",
		includeHtml: payload.includeHtml === true,
		includeText: payload.includeText !== false,
		maxHtmlChars: typeof payload.maxHtmlChars === "number" ? payload.maxHtmlChars : undefined,
		timeoutMs: typeof payload.timeoutMs === "number" ? payload.timeoutMs : undefined,
	};
}

function disconnect(reason: string): void {
	if (pendingPair) {
		window.clearTimeout(pendingPair.timer);
		pendingPair = undefined;
	}
	if (socket && socket.readyState === WebSocket.OPEN) socket.close(1000, reason);
	socket = undefined;
	connected = false;
}

async function getRuntimeState(): Promise<RuntimeState> {
	const stored = await chrome.storage.local.get(["bridgeUrl", "clientId"]);
	bridgeUrl = bridgeUrl ?? (typeof stored.bridgeUrl === "string" ? stored.bridgeUrl : undefined);
	clientId = clientId ?? (typeof stored.clientId === "string" ? stored.clientId : undefined);
	return {
		connected,
		url: bridgeUrl,
		clientId,
		lastError,
		activatedTabs: [...activatedTabs.values()],
	};
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

function isSupportedTabUrl(url: string | undefined): boolean {
	return typeof url === "string" && /^(https?:|file:)/.test(url);
}

function detectBrowser(): BrowserKind {
	const userAgent = navigator.userAgent.toLowerCase();
	if (userAgent.includes("edg/")) return "edge";
	if (userAgent.includes("chrome/")) return "chrome";
	if (userAgent.includes("chromium/")) return "chromium";
	return "unknown";
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
