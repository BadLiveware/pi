export const BROWSER_BRIDGE_HOST = "127.0.0.1" as const;

export type BridgeListenerStatus = "stopped" | "running";

export interface BrowserBridgeServerState {
	enabled: boolean;
	host: typeof BROWSER_BRIDGE_HOST;
	port?: number;
	listener: BridgeListenerStatus;
	pairedClientCount: number;
	diagnostics: string[];
}

export interface BrowserClientSummary {
	clientId: string;
	browser: "chrome" | "edge" | "chromium" | "unknown";
	extensionVersion?: string;
	connectedAt: number;
	activeTabId?: number;
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
				"This build currently exposes state inspection only; pairing and browser control commands are not registered yet.",
			],
		},
		clients: [],
		tabs: [],
		pendingRequests: [],
		capabilities: ["state"],
		diagnostics: [],
		createdAt: now,
	};
}

export function browserBridgeStatePayload(state: BrowserBridgeState): BrowserBridgeSnapshot {
	const server: BrowserBridgeServerState = {
		...state.server,
		pairedClientCount: state.clients.length,
		diagnostics: [...state.server.diagnostics],
	};
	return {
		server,
		clients: state.clients.map((client) => ({ ...client })),
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
