export const BROWSER_BRIDGE_HOST = "127.0.0.1" as const;
export const BROWSER_BRIDGE_PORT = 43871 as const;
export const BROWSER_BRIDGE_DEFAULT_URL = `ws://${BROWSER_BRIDGE_HOST}:${BROWSER_BRIDGE_PORT}` as const;
export const BROWSER_BRIDGE_CAPABILITIES = ["state", "bridge-server", "pairing", "tab-activation", "element-selection", "overlay", "preview-pages", "interaction", "clipboard"] as const;

export type BridgeListenerStatus = "stopped" | "running";

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
	pendingRequests: PendingBridgeRequestSummary[];
	previewServer?: PreviewServerState;
	capabilities: string[];
	diagnostics: string[];
	createdAt: number;
}

export interface BrowserBridgeRuntime {
	state: BrowserBridgeState;
}

export interface BrowserBridgeSnapshot {
	server: BrowserBridgeServerState;
	clients: BrowserClientSummary[];
	tabs: BrowserTabSummary[];
	pendingRequests: PendingBridgeRequestSummary[];
	previewServer?: PreviewServerState;
	capabilities: string[];
	diagnostics: string[];
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
		pendingRequests: [],
		capabilities: [...BROWSER_BRIDGE_CAPABILITIES],
		diagnostics: [],
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
		pendingRequests: state.pendingRequests.map((request) => ({ ...request, target: request.target ? { ...request.target } : undefined })),
		previewServer: state.previewServer ? { ...state.previewServer } : undefined,
		capabilities: [...state.capabilities],
		diagnostics: [...state.diagnostics, ...server.diagnostics],
		createdAt: state.createdAt,
	};
}

export function formatBrowserBridgeStatus(snapshot: BrowserBridgeSnapshot, options: { includeDiagnostics?: boolean } = {}): string {
	const status = snapshot.server.enabled ? "enabled" : "disabled";
	const listener = snapshot.server.listener;
	const port = snapshot.server.port === undefined ? "none" : String(snapshot.server.port);
	const lines = [
		`browser-bridge: ${status}`,
		`listener: ${listener} (${snapshot.server.host}, port ${port})`,
		`clients: ${snapshot.clients.length}`,
		`tabs: ${snapshot.tabs.length}`,
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

	if (options.includeDiagnostics !== false && snapshot.diagnostics.length > 0) {
		lines.push("diagnostics:");
		for (const diagnostic of snapshot.diagnostics) lines.push(`- ${diagnostic}`);
	}

	return lines.join("\n");
}
