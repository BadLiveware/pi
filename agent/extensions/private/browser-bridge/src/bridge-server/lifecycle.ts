import { WebSocket, WebSocketServer } from "ws";
import { BROWSER_BRIDGE_HOST, type BrowserBridgeState, type BrowserClientSummary, type PendingBridgeRequestSummary } from "../core/state.ts";
import { makeBridgeId, makePairingToken } from "../core/ids.ts";
import {
	BRIDGE_PROTOCOL_VERSION,
	makeBridgeEnvelope,
	makeBridgeErrorEnvelope,
	parseBridgeEnvelopeJson,
	type BridgeEnvelope,
	type BridgeErrorCode,
} from "../core/protocol.ts";

const DEFAULT_PAIRING_TTL_MS = 2 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export interface PairingTokenInfo {
	token: string;
	expiresAt: number;
	url: string;
}

export interface BridgeServerOptions {
	port?: number;
	now?: () => number;
}

interface SocketRecord {
	socket: WebSocket;
	clientId?: string;
}

interface PendingRequest {
	clientId: string;
	request: PendingBridgeRequestSummary;
	resolve: (envelope: BridgeEnvelope) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
}

interface PairPayload {
	token: string;
	client?: {
		clientId?: string;
		browser?: BrowserClientSummary["browser"];
		extensionVersion?: string;
		capabilities?: string[];
		activeTabId?: number;
	};
}

export class BrowserBridgeServer {
	private wss: WebSocketServer | undefined;
	private readonly sockets = new Map<WebSocket, SocketRecord>();
	private readonly clients = new Map<string, SocketRecord>();
	private readonly pending = new Map<string, PendingRequest>();
	private pairing: { token: string; expiresAt: number; timer: NodeJS.Timeout } | undefined;
	private readonly now: () => number;
	private readonly state: BrowserBridgeState;
	private readonly options: BridgeServerOptions;

	constructor(state: BrowserBridgeState, options: BridgeServerOptions = {}) {
		this.state = state;
		this.options = options;
		this.now = options.now ?? (() => Date.now());
	}

	get isRunning(): boolean {
		return this.wss !== undefined;
	}

	async start(): Promise<{ url: string; port: number }> {
		if (this.wss) return { url: this.url(), port: this.currentPort() };

		const wss = new WebSocketServer({ host: BROWSER_BRIDGE_HOST, port: this.options.port ?? 0 });
		this.wss = wss;
		wss.on("connection", (socket) => this.onConnection(socket));

		try {
			await new Promise<void>((resolve, reject) => {
				const onListening = () => {
					cleanup();
					resolve();
				};
				const onError = (error: Error) => {
					cleanup();
					reject(error);
				};
				const cleanup = () => {
					wss.off("listening", onListening);
					wss.off("error", onError);
				};
				wss.once("listening", onListening);
				wss.once("error", onError);
			});
		} catch (error) {
			this.wss = undefined;
			this.setStoppedDiagnostics(`Failed to start bridge server: ${error instanceof Error ? error.message : String(error)}`);
			throw error;
		}

		this.state.server.enabled = true;
		this.state.server.listener = "running";
		this.state.server.host = BROWSER_BRIDGE_HOST;
		this.state.server.port = this.currentPort();
		this.state.server.diagnostics = ["Bridge server is running. Run `/browser-bridge pair` to create a short-lived pairing token."];
		return { url: this.url(), port: this.currentPort() };
	}

	async stop(reason = "Bridge stopped"): Promise<void> {
		this.clearPairing();
		for (const pending of [...this.pending.values()]) this.rejectPending(pending, new Error(reason));
		for (const record of [...this.sockets.values()]) record.socket.terminate();
		this.sockets.clear();
		this.clients.clear();
		this.state.clients = [];
		this.state.tabs = [];
		this.state.pendingRequests = [];

		const wss = this.wss;
		this.wss = undefined;
		if (wss) {
			await new Promise<void>((resolve) => wss.close(() => resolve()));
		}
		this.setStoppedDiagnostics(reason);
	}

	createPairingToken(ttlMs = DEFAULT_PAIRING_TTL_MS): PairingTokenInfo {
		if (!this.wss) throw new Error("Bridge server must be started before creating a pairing token.");
		this.clearPairing();
		const token = makePairingToken();
		const expiresAt = this.now() + ttlMs;
		const timer = setTimeout(() => {
			if (this.pairing?.token !== token) return;
			this.clearPairing();
			this.state.server.diagnostics = ["Pairing token expired. Run `/browser-bridge pair` to create a new token."];
		}, ttlMs);
		this.pairing = { token, expiresAt, timer };
		this.state.server.pairing = { active: true, expiresAt };
		this.state.server.diagnostics = ["Pairing token is active. Enter it in the browser extension before it expires."];
		return { token, expiresAt, url: this.url() };
	}

	async sendRequestToClient(clientId: string, type: string, payload: unknown, options: { timeoutMs?: number; target?: { tabId?: number; frameId?: number } } = {}): Promise<BridgeEnvelope> {
		const record = this.clients.get(clientId);
		if (!record || record.socket.readyState !== WebSocket.OPEN) throw new Error(`Browser client ${clientId} is not connected.`);
		const requestId = makeBridgeId("req");
		const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
		const envelope = makeBridgeEnvelope({
			id: requestId,
			direction: "pi-to-browser",
			type,
			payload,
			target: options.target,
		});
		return await new Promise<BridgeEnvelope>((resolve, reject) => {
			const request: PendingBridgeRequestSummary = { requestId, clientId, type, startedAt: this.now(), timeoutMs, target: options.target };
			const timer = setTimeout(() => {
				const pending = this.pending.get(requestId);
				if (!pending) return;
				this.rejectPending(pending, new Error(`Bridge request ${requestId} timed out after ${timeoutMs}ms.`));
			}, timeoutMs);
			this.pending.set(requestId, { clientId, request, resolve, reject, timer });
			this.state.pendingRequests.push(request);
			this.send(record.socket, envelope);
		});
	}

	private onConnection(socket: WebSocket): void {
		const record: SocketRecord = { socket };
		this.sockets.set(socket, record);
		socket.on("message", (data) => this.onMessage(record, data));
		socket.on("close", () => this.onClose(record));
		socket.on("error", () => this.onClose(record));
	}

	private onMessage(record: SocketRecord, data: WebSocket.RawData): void {
		const parsed = parseBridgeEnvelopeJson(rawDataToText(data), "browser-to-pi");
		if (!parsed.ok) {
			this.sendError(record.socket, undefined, parsed.code, parsed.message);
			return;
		}

		const envelope = parsed.envelope;
		if (!record.clientId) {
			if (envelope.type !== "pair") {
				this.sendError(record.socket, envelope.id, "pairing_required", "Pairing is required before sending browser bridge messages.");
				record.socket.close(4001, "pairing required");
				return;
			}
			this.handlePair(record, envelope);
			return;
		}

		if (envelope.requestId && this.pending.has(envelope.requestId)) {
			const pending = this.pending.get(envelope.requestId);
			if (!pending) return;
			this.resolvePending(pending, envelope);
			return;
		}

		if (envelope.type === "client:capabilities") {
			this.updateClientCapabilities(record.clientId, envelope.payload);
			this.send(record.socket, makeBridgeEnvelope({ id: makeBridgeId("ack"), requestId: envelope.id, direction: "pi-to-browser", type: "ack", payload: { ok: true } }));
			return;
		}

		if (envelope.type === "tab:activated") {
			this.updateActivatedTab(record.clientId, envelope.payload);
			this.send(record.socket, makeBridgeEnvelope({ id: makeBridgeId("ack"), requestId: envelope.id, direction: "pi-to-browser", type: "ack", payload: { ok: true } }));
			return;
		}

		this.sendError(record.socket, envelope.id, "unknown_request", `Unknown browser bridge message type "${envelope.type}".`);
	}

	private handlePair(record: SocketRecord, envelope: BridgeEnvelope): void {
		const payload = parsePairPayload(envelope.payload);
		if (!payload) {
			this.sendError(record.socket, envelope.id, "invalid_envelope", "Pair message payload is invalid.");
			record.socket.close(4002, "invalid pair payload");
			return;
		}
		if (!this.pairing || this.pairing.token !== payload.token || this.pairing.expiresAt <= this.now()) {
			this.sendError(record.socket, envelope.id, "pairing_failed", "Pairing token is missing, invalid, or expired.");
			record.socket.close(4003, "pairing failed");
			return;
		}

		const clientId = this.uniqueClientId(payload.client?.clientId);
		record.clientId = clientId;
		this.clients.set(clientId, record);
		const client: BrowserClientSummary = {
			clientId,
			browser: payload.client?.browser ?? "unknown",
			extensionVersion: payload.client?.extensionVersion,
			connectedAt: this.now(),
			activeTabId: payload.client?.activeTabId,
			capabilities: payload.client?.capabilities ?? [],
		};
		this.state.clients = [...this.state.clients.filter((existing) => existing.clientId !== clientId), client];
		this.state.server.pairedClientCount = this.state.clients.length;
		this.clearPairing();
		this.state.server.diagnostics = this.state.clients.length === 0 ? [] : [`${this.state.clients.length} browser client(s) connected.`];
		this.send(record.socket, makeBridgeEnvelope({
			id: makeBridgeId("pair"),
			requestId: envelope.id,
			direction: "pi-to-browser",
			type: "pair:accepted",
			payload: { ok: true, clientId, version: BRIDGE_PROTOCOL_VERSION, serverTime: this.now() },
		}));
	}

	private onClose(record: SocketRecord): void {
		this.sockets.delete(record.socket);
		if (!record.clientId) return;
		this.clients.delete(record.clientId);
		this.state.clients = this.state.clients.filter((client) => client.clientId !== record.clientId);
		this.state.tabs = this.state.tabs.filter((tab) => tab.clientId !== record.clientId);
		for (const pending of [...this.pending.values()]) {
			if (pending.clientId === record.clientId) this.rejectPending(pending, new Error(`Browser client ${record.clientId} disconnected.`));
		}
		this.state.server.pairedClientCount = this.state.clients.length;
		this.state.server.diagnostics = this.state.clients.length === 0 ? ["No browser clients are connected."] : [`${this.state.clients.length} browser client(s) connected.`];
	}

	private updateClientCapabilities(clientId: string, payload: unknown): void {
		if (!isRecord(payload) || !Array.isArray(payload.capabilities)) return;
		const capabilities = payload.capabilities.filter((capability): capability is string => typeof capability === "string");
		this.state.clients = this.state.clients.map((client) => client.clientId === clientId ? { ...client, capabilities } : client);
	}

	private updateActivatedTab(clientId: string, payload: unknown): void {
		if (!isRecord(payload) || typeof payload.tabId !== "number" || !Number.isSafeInteger(payload.tabId) || payload.tabId < 0) return;
		const capabilities = Array.isArray(payload.capabilities) ? payload.capabilities.filter((capability): capability is string => typeof capability === "string") : [];
		const tab = {
			tabId: payload.tabId,
			clientId,
			title: typeof payload.title === "string" ? payload.title : undefined,
			url: typeof payload.url === "string" ? payload.url : undefined,
			origin: typeof payload.origin === "string" ? payload.origin : undefined,
			active: payload.active !== false,
			capabilities,
		};
		this.state.tabs = [
			...this.state.tabs.filter((existing) => !(existing.clientId === clientId && existing.tabId === tab.tabId)),
			tab,
		];
		const client = this.state.clients.find((candidate) => candidate.clientId === clientId);
		if (client) client.activeTabId = tab.tabId;
	}

	private rejectPending(pending: PendingRequest, error: Error): void {
		clearTimeout(pending.timer);
		this.pending.delete(pending.request.requestId);
		this.state.pendingRequests = this.state.pendingRequests.filter((request) => request.requestId !== pending.request.requestId);
		pending.reject(error);
	}

	private resolvePending(pending: PendingRequest, envelope: BridgeEnvelope): void {
		clearTimeout(pending.timer);
		this.pending.delete(pending.request.requestId);
		this.state.pendingRequests = this.state.pendingRequests.filter((request) => request.requestId !== pending.request.requestId);
		pending.resolve(envelope);
	}

	private sendError(socket: WebSocket, requestId: string | undefined, code: BridgeErrorCode, message: string): void {
		this.send(socket, makeBridgeErrorEnvelope({ id: makeBridgeId("err"), requestId, code, message }));
	}

	private send(socket: WebSocket, envelope: BridgeEnvelope): void {
		if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(envelope));
	}

	private clearPairing(): void {
		if (this.pairing) clearTimeout(this.pairing.timer);
		this.pairing = undefined;
		this.state.server.pairing = undefined;
	}

	private currentPort(): number {
		const address = this.wss?.address();
		if (!address || typeof address === "string") throw new Error("Bridge server address is unavailable.");
		return address.port;
	}

	private url(): string {
		return `ws://${BROWSER_BRIDGE_HOST}:${this.currentPort()}`;
	}

	private setStoppedDiagnostics(reason: string): void {
		this.state.server.enabled = false;
		this.state.server.listener = "stopped";
		this.state.server.port = undefined;
		this.state.server.pairing = undefined;
		this.state.server.pairedClientCount = 0;
		this.state.server.diagnostics = [reason, "Run `/browser-bridge pair` to start the local bridge and create a short-lived pairing token."];
	}

	private uniqueClientId(preferred: string | undefined): string {
		const candidate = preferred && preferred.length > 0 ? preferred : makeBridgeId("client");
		return this.clients.has(candidate) ? makeBridgeId("client") : candidate;
	}
}

function rawDataToText(data: WebSocket.RawData): string {
	if (typeof data === "string") return data;
	if (Buffer.isBuffer(data)) return data.toString("utf8");
	if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
	return Buffer.from(data).toString("utf8");
}

function parsePairPayload(payload: unknown): PairPayload | undefined {
	if (!isRecord(payload) || typeof payload.token !== "string") return undefined;
	const client = isRecord(payload.client) ? payload.client : undefined;
	const browser = parseBrowser(client?.browser);
	const capabilities = Array.isArray(client?.capabilities) ? client.capabilities.filter((capability): capability is string => typeof capability === "string") : undefined;
	const activeTabId = typeof client?.activeTabId === "number" && Number.isSafeInteger(client.activeTabId) && client.activeTabId >= 0 ? client.activeTabId : undefined;
	return {
		token: payload.token,
		client: client ? {
			clientId: typeof client.clientId === "string" ? client.clientId : undefined,
			browser,
			extensionVersion: typeof client.extensionVersion === "string" ? client.extensionVersion : undefined,
			capabilities,
			activeTabId,
		} : undefined,
	};
}

function parseBrowser(value: unknown): BrowserClientSummary["browser"] | undefined {
	return value === "chrome" || value === "edge" || value === "chromium" || value === "unknown" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
