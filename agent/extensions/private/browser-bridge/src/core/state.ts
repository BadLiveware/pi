export const BROWSER_BRIDGE_HOST = "127.0.0.1" as const;
export const BROWSER_BRIDGE_PORT = 43871 as const;
export const BROWSER_BRIDGE_DEFAULT_URL = `ws://${BROWSER_BRIDGE_HOST}:${BROWSER_BRIDGE_PORT}` as const;
export const BROWSER_BRIDGE_CAPABILITIES = ["state", "bridge-server", "pairing", "tab-activation", "element-selection", "context-menu-selection", "overlay", "preview-pages", "interaction", "clipboard"] as const;

export type BridgeListenerStatus = "stopped" | "running";
export type BrowserBridgeDebugLevel = "debug" | "info" | "warn" | "error";

export interface BrowserBridgeDebugLogEntry {
	at: number;
	source: "server" | "tool" | "command";
	level: BrowserBridgeDebugLevel;
	event: string;
	message?: string;
	data?: Record<string, string | number | boolean | undefined>;
}

export interface BrowserBridgePairingState {
	active: boolean;
	expiresAt?: number;
}

export interface BrowserBridgeServerState {
	enabled: boolean;
	host: typeof BROWSER_BRIDGE_HOST;
	port?: number;
	listener: BridgeListenerStatus;
	pairedClientCount: number;
	pairing?: BrowserBridgePairingState;
	diagnostics: string[];
}

export interface BrowserClientSummary {
	clientId: string;
	browser: "chrome" | "edge" | "chromium" | "unknown";
	extensionVersion?: string;
	connectedAt: number;
	activeTabId?: number;
	capabilities: string[];
}

export interface BrowserTabSummary {
	tabId: number;
	clientId: string;
	title?: string;
	url?: string;
	origin?: string;
	active: boolean;
	capabilities: string[];
}

export interface BrowserElementDescriptorSummary {
	elementId?: string;
	selectorCandidates?: string[];
	tagName?: string;
	role?: string;
	accessibleName?: string;
	textPreview?: string;
	attributes?: Record<string, string>;
	boundingBox?: { x: number; y: number; width: number; height: number; coordinateSpace?: string };
	htmlPreview?: string;
}

export interface BrowserSelectionContextSummary {
	[key: string]: string | number | boolean | undefined;
}

export interface BrowserSharedSelectionSummary {
	selectionId: string;
	clientId: string;
	tabId?: number;
	source?: string;
	title?: string;
	url?: string;
	pageUrl?: string;
	frameUrl?: string;
	origin?: string;
	status: "selected" | "cancelled" | "unknown";
	reason?: string;
	selectedAt: number;
	context?: BrowserSelectionContextSummary;
	elements: BrowserElementDescriptorSummary[];
}

export interface PendingBridgeRequestSummary {
	requestId: string;
	clientId?: string;
	type: string;
	startedAt: number;
	timeoutMs: number;
	target?: { tabId?: number; frameId?: number };
}

export interface PreviewServerState {
	enabled: boolean;
	host: typeof BROWSER_BRIDGE_HOST;
	port?: number;
	artifactRoot?: string;
}

export interface BrowserBridgeState {
	server: BrowserBridgeServerState;
	clients: BrowserClientSummary[];
	tabs: BrowserTabSummary[];
	sharedSelections: BrowserSharedSelectionSummary[];
	pendingRequests: PendingBridgeRequestSummary[];
	previewServer?: PreviewServerState;
	capabilities: string[];
	diagnostics: string[];
	debugLog: BrowserBridgeDebugLogEntry[];
	createdAt: number;
}

export interface BrowserBridgeRuntime {
	state: BrowserBridgeState;
}

export interface BrowserBridgeSnapshot {
	server: BrowserBridgeServerState;
	clients: BrowserClientSummary[];
	tabs: BrowserTabSummary[];
	sharedSelections: BrowserSharedSelectionSummary[];
	pendingRequests: PendingBridgeRequestSummary[];
	previewServer?: PreviewServerState;
	capabilities: string[];
	diagnostics: string[];
	debugLog: BrowserBridgeDebugLogEntry[];
	createdAt: number;
}

export function createBrowserBridgeRuntime(now = Date.now()): BrowserBridgeRuntime {
	return { state: createInitialBrowserBridgeState(now) };
}

export function createInitialBrowserBridgeState(now = Date.now()): BrowserBridgeState {
	return {
		server: {
			enabled: false,
			host: BROWSER_BRIDGE_HOST,
			listener: "stopped",
			pairedClientCount: 0,
			diagnostics: [
				"Bridge server is disabled and no browser clients are connected.",
				"Run `/browser-bridge pair` to start the local bridge and create a short-lived pairing token.",
			],
		},
		clients: [],
		tabs: [],
		sharedSelections: [],
		pendingRequests: [],
		capabilities: [...BROWSER_BRIDGE_CAPABILITIES],
		diagnostics: [],
		debugLog: [],
		createdAt: now,
	};
}

export function browserBridgeStatePayload(state: BrowserBridgeState): BrowserBridgeSnapshot {
	const server: BrowserBridgeServerState = {
		...state.server,
		pairedClientCount: state.clients.length,
		pairing: state.server.pairing ? { ...state.server.pairing } : undefined,
		diagnostics: [...state.server.diagnostics],
	};
	return {
		server,
		clients: state.clients.map((client) => ({ ...client, capabilities: [...client.capabilities] })),
		tabs: state.tabs.map((tab) => ({ ...tab, capabilities: [...tab.capabilities] })),
		sharedSelections: state.sharedSelections.map((selection) => ({
			...selection,
			context: selection.context ? { ...selection.context } : undefined,
			elements: selection.elements.map((element) => ({ ...element, selectorCandidates: element.selectorCandidates ? [...element.selectorCandidates] : undefined, attributes: element.attributes ? { ...element.attributes } : undefined, boundingBox: element.boundingBox ? { ...element.boundingBox } : undefined })),
		})),
		pendingRequests: state.pendingRequests.map((request) => ({ ...request, target: request.target ? { ...request.target } : undefined })),
		previewServer: state.previewServer ? { ...state.previewServer } : undefined,
		capabilities: [...state.capabilities],
		diagnostics: [...state.diagnostics, ...server.diagnostics],
		debugLog: state.debugLog.map((entry) => ({ ...entry, data: entry.data ? { ...entry.data } : undefined })),
		createdAt: state.createdAt,
	};
}

export function appendBrowserBridgeDebugLog(state: BrowserBridgeState, entry: Omit<BrowserBridgeDebugLogEntry, "at"> & { at?: number }, limit = 100): void {
	state.debugLog = [
		...state.debugLog,
		{
			...entry,
			at: entry.at ?? Date.now(),
			data: entry.data ? { ...entry.data } : undefined,
		},
	].slice(-limit);
}

export function formatBrowserBridgeDebugLog(entries: BrowserBridgeDebugLogEntry[], limit = 12): string[] {
	return entries.slice(-limit).map((entry) => {
		const data = entry.data && Object.keys(entry.data).length > 0 ? ` ${JSON.stringify(entry.data)}` : "";
		const message = entry.message ? ` ${entry.message}` : "";
		return `${new Date(entry.at).toISOString()} [${entry.level}] ${entry.source}:${entry.event}${message}${data}`;
	});
}

export function formatBrowserBridgeStatus(snapshot: BrowserBridgeSnapshot, options: { includeDiagnostics?: boolean; includeDebugLog?: boolean; debugLogLimit?: number } = {}): string {
	const status = snapshot.server.enabled ? "enabled" : "disabled";
	const listener = snapshot.server.listener;
	const port = snapshot.server.port === undefined ? "none" : String(snapshot.server.port);
	const lines = [
		`browser-bridge: ${status}`,
		`listener: ${listener} (${snapshot.server.host}, port ${port})`,
		`clients: ${snapshot.clients.length}`,
		`tabs: ${snapshot.tabs.length}`,
		`shared selections: ${snapshot.sharedSelections.length}`,
		`pending requests: ${snapshot.pendingRequests.length}`,
		`capabilities: ${snapshot.capabilities.join(", ") || "none"}`,
	];

	if (snapshot.server.pairing?.active) {
		const expires = snapshot.server.pairing.expiresAt === undefined ? "unknown" : new Date(snapshot.server.pairing.expiresAt).toISOString();
		lines.push(`pairing: active until ${expires}`);
	}

	if (snapshot.previewServer) {
		const previewPort = snapshot.previewServer.port === undefined ? "none" : String(snapshot.previewServer.port);
		lines.push(`preview server: ${snapshot.previewServer.enabled ? "enabled" : "disabled"} (${snapshot.previewServer.host}, port ${previewPort})`);
	}

	const latestSelection = snapshot.sharedSelections.at(-1);
	if (latestSelection) lines.push(`latest shared selection: ${latestSelection.source ?? "unknown source"}, ${latestSelection.status}, ${latestSelection.elements.length} element(s), ${latestSelection.url ?? latestSelection.origin ?? "unknown origin"}`);

	if (options.includeDiagnostics !== false && snapshot.diagnostics.length > 0) {
		lines.push("diagnostics:");
		for (const diagnostic of snapshot.diagnostics) lines.push(`- ${diagnostic}`);
	}

	if (options.includeDebugLog && snapshot.debugLog.length > 0) {
		lines.push("debug log:");
		for (const entry of formatBrowserBridgeDebugLog(snapshot.debugLog, options.debugLogLimit)) lines.push(`- ${entry}`);
	}

	return lines.join("\n");
}
