import { WebSocket, WebSocketServer } from "ws";
import { isRecord, parseClientAuthDetails, parsePairPayload, parseResumePayload, rawDataToText, type BrowserClientAuthDetails } from "./auth-payloads.ts";
import { BROWSER_BRIDGE_HOST, BROWSER_BRIDGE_PORT, appendBrowserBridgeDebugLog, type BrowserBridgeState, type BrowserClientSummary, type PendingBridgeRequestSummary } from "../core/state.ts";
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

interface AuthorizedClient {
	clientId: string;
	resumeSecret: string;
	client?: BrowserClientAuthDetails;
}

export class BrowserBridgeServer {
	private wss: WebSocketServer | undefined;
	private readonly sockets = new Map<WebSocket, SocketRecord>();
	private readonly clients = new Map<string, SocketRecord>();
	private readonly authorizedClients = new Map<string, AuthorizedClient>();
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

		this.debug("info", "server-starting", { port: this.options.port ?? BROWSER_BRIDGE_PORT });
		const wss = new WebSocketServer({ host: BROWSER_BRIDGE_HOST, port: this.options.port ?? BROWSER_BRIDGE_PORT });
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
			this.debug("error", "server-start-failed", { message: error instanceof Error ? error.message : String(error) });
			this.setStoppedDiagnostics(`Failed to start bridge server: ${error instanceof Error ? error.message : String(error)}`);
			throw error;
		}

		this.state.server.enabled = true;
		this.state.server.listener = "running";
		this.state.server.host = BROWSER_BRIDGE_HOST;
		this.state.server.port = this.currentPort();
		this.state.server.diagnostics = ["Bridge gateway is running. Run `/browser-bridge pair` to open a short-lived pairing window."];
		this.debug("info", "server-started", { url: this.url(), port: this.currentPort() });
		return { url: this.url(), port: this.currentPort() };
	}

	async stop(reason = "Bridge stopped"): Promise<void> {
		this.debug("info", "server-stopping", { reason });
		this.clearPairing();
		for (const pending of [...this.pending.values()]) this.rejectPending(pending, new Error(reason));
		for (const record of [...this.sockets.values()]) record.socket.terminate();
		this.sockets.clear();
		this.clients.clear();
		this.authorizedClients.clear();
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
		this.state.server.diagnostics = ["Pairing window is active. Click Connect in the browser extension, or paste the fallback pairing token before it expires."];
		this.debug("info", "pairing-window-open", { expiresAt, url: this.url() });
		return { token, expiresAt, url: this.url() };
	}

	async sendRequestToClient(clientId: string, type: string, payload: unknown, options: { timeoutMs?: number; target?: { tabId?: number; frameId?: number } } = {}): Promise<BridgeEnvelope> {
		const record = this.clients.get(clientId);
		if (!record || record.socket.readyState !== WebSocket.OPEN) {
			this.debug("warn", "client-request-not-connected", { clientId, type });
			throw new Error(`Browser client ${clientId} is not connected.`);
		}
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
			this.debug("debug", "client-request-sent", { requestId, clientId, type, timeoutMs });
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
		this.debug("info", "socket-connected", { sockets: this.sockets.size });
		socket.on("message", (data) => this.onMessage(record, data));
		socket.on("close", (code, reason) => this.onClose(record, code, reason.toString("utf8")));
		socket.on("error", (error) => {
			this.debug("warn", "socket-error", { message: error instanceof Error ? error.message : String(error), clientId: record.clientId });
			this.onClose(record);
		});
	}

	private onMessage(record: SocketRecord, data: WebSocket.RawData): void {
		const parsed = parseBridgeEnvelopeJson(rawDataToText(data), "browser-to-pi");
		if (!parsed.ok) {
			this.debug("warn", "message-parse-failed", { code: parsed.code, message: parsed.message });
			this.sendError(record.socket, undefined, parsed.code, parsed.message);
			return;
		}

		const envelope = parsed.envelope;
		this.debug("debug", "message-received", { type: envelope.type, requestId: envelope.requestId, clientId: record.clientId });
		if (!record.clientId) {
			if (envelope.type === "pair") {
				this.handlePair(record, envelope);
				return;
			}
			if (envelope.type === "pair-request") {
				this.handlePairRequest(record, envelope);
				return;
			}
			if (envelope.type === "resume") {
				this.handleResume(record, envelope);
				return;
			}
			this.sendError(record.socket, envelope.id, "pairing_required", "Pairing or resume is required before sending browser bridge messages.");
			record.socket.close(4001, "pairing required");
			return;
		}

		if (envelope.requestId && this.pending.has(envelope.requestId)) {
			const pending = this.pending.get(envelope.requestId);
			if (!pending) return;
			this.resolvePending(pending, envelope);
			return;
		}

		if (envelope.type === "client:keepalive") {
			this.debug("debug", "client-keepalive", { clientId: record.clientId, requestId: envelope.id });
			this.send(record.socket, makeBridgeEnvelope({ id: makeBridgeId("ack"), requestId: envelope.id, direction: "pi-to-browser", type: "ack", payload: { ok: true } }));
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
			this.debug("warn", "pair-invalid-payload", { requestId: envelope.id });
			this.sendError(record.socket, envelope.id, "invalid_envelope", "Pair message payload is invalid.");
			record.socket.close(4002, "invalid pair payload");
			return;
		}
		if (!this.pairing || this.pairing.token !== payload.token || this.pairing.expiresAt <= this.now()) {
			this.debug("warn", "pair-rejected", { requestId: envelope.id, hasPairingWindow: Boolean(this.pairing), clientId: payload.client?.clientId });
			this.sendError(record.socket, envelope.id, "pairing_failed", "Pairing token is missing, invalid, or expired.");
			record.socket.close(4003, "pairing failed");
			return;
		}

		const clientId = this.uniqueClientId(payload.client?.clientId);
		const resumeSecret = makePairingToken();
		this.authorizedClients.set(clientId, { clientId, resumeSecret, client: payload.client });
		this.attachClient(record, clientId, payload.client);
		this.clearPairing();
		this.debug("info", "pair-accepted", { requestId: envelope.id, clientId });
		this.send(record.socket, makeBridgeEnvelope({
			id: makeBridgeId("pair"),
			requestId: envelope.id,
			direction: "pi-to-browser",
			type: "pair:accepted",
			payload: { ok: true, clientId, resumeSecret, version: BRIDGE_PROTOCOL_VERSION, serverTime: this.now() },
		}));
	}

	private handlePairRequest(record: SocketRecord, envelope: BridgeEnvelope): void {
		if (!this.pairing || this.pairing.expiresAt <= this.now()) {
			this.debug("warn", "pair-request-rejected", { requestId: envelope.id, hasPairingWindow: Boolean(this.pairing) });
			this.sendError(record.socket, envelope.id, "pairing_failed", "No active browser bridge pairing window. Run `/browser-bridge pair` in Pi first.");
			record.socket.close(4003, "no active pairing window");
			return;
		}
		const payload = isRecord(envelope.payload) ? envelope.payload : {};
		this.acceptPairingWindowClient(record, envelope, parseClientAuthDetails(payload.client));
	}

	private acceptPairingWindowClient(record: SocketRecord, envelope: BridgeEnvelope, clientDetails: BrowserClientAuthDetails | undefined): void {
		const clientId = this.uniqueClientId(clientDetails?.clientId);
		const resumeSecret = makePairingToken();
		this.authorizedClients.set(clientId, { clientId, resumeSecret, client: clientDetails });
		this.attachClient(record, clientId, clientDetails);
		this.clearPairing();
		this.debug("info", "pair-window-client-accepted", { requestId: envelope.id, clientId });
		this.send(record.socket, makeBridgeEnvelope({
			id: makeBridgeId("pair"),
			requestId: envelope.id,
			direction: "pi-to-browser",
			type: "pair:accepted",
			payload: { ok: true, clientId, resumeSecret, version: BRIDGE_PROTOCOL_VERSION, serverTime: this.now() },
		}));
	}

	private handleResume(record: SocketRecord, envelope: BridgeEnvelope): void {
		const payload = parseResumePayload(envelope.payload);
		if (!payload) {
			this.debug("warn", "resume-invalid-payload", { requestId: envelope.id });
			this.sendError(record.socket, envelope.id, "invalid_envelope", "Resume message payload is invalid.");
			record.socket.close(4004, "invalid resume payload");
			return;
		}
		const authorized = this.authorizedClients.get(payload.clientId);
		if (!authorized || authorized.resumeSecret !== payload.resumeSecret) {
			if (this.pairing && this.pairing.expiresAt > this.now()) {
				this.debug("warn", "resume-stale-accepted-by-pair-window", { requestId: envelope.id, clientId: payload.clientId });
				this.acceptPairingWindowClient(record, envelope, payload.client ? { ...payload.client, clientId: payload.clientId } : { clientId: payload.clientId });
				return;
			}
			this.debug("warn", "resume-rejected", { requestId: envelope.id, clientId: payload.clientId, knownClient: Boolean(authorized) });
			this.sendError(record.socket, envelope.id, "pairing_failed", "Resume secret is missing, invalid, or expired for this Pi session.");
			record.socket.close(4005, "resume failed");
			return;
		}
		const client = payload.client ? { ...authorized.client, ...payload.client, clientId: payload.clientId } : authorized.client;
		this.authorizedClients.set(payload.clientId, { ...authorized, client });
		this.attachClient(record, payload.clientId, client);
		this.debug("info", "resume-accepted", { requestId: envelope.id, clientId: payload.clientId });
		this.send(record.socket, makeBridgeEnvelope({
			id: makeBridgeId("resume"),
			requestId: envelope.id,
			direction: "pi-to-browser",
			type: "resume:accepted",
			payload: { ok: true, clientId: payload.clientId, resumeSecret: authorized.resumeSecret, version: BRIDGE_PROTOCOL_VERSION, serverTime: this.now() },
		}));
	}

	private attachClient(record: SocketRecord, clientId: string, clientDetails: BrowserClientAuthDetails | undefined): void {
		const existing = this.clients.get(clientId);
		if (existing && existing !== record) existing.socket.terminate();
		record.clientId = clientId;
		this.clients.set(clientId, record);
		const client: BrowserClientSummary = {
			clientId,
			browser: clientDetails?.browser ?? "unknown",
			extensionVersion: clientDetails?.extensionVersion,
			connectedAt: this.now(),
			activeTabId: clientDetails?.activeTabId,
			capabilities: clientDetails?.capabilities ?? [],
		};
		this.state.clients = [...this.state.clients.filter((existingClient) => existingClient.clientId !== clientId), client];
		this.state.server.pairedClientCount = this.state.clients.length;
		this.state.server.diagnostics = this.state.clients.length === 0 ? [] : [`${this.state.clients.length} browser client(s) connected.`];
		this.debug("info", "client-attached", { clientId, browser: client.browser, activeTabId: client.activeTabId });
	}

	private onClose(record: SocketRecord, code?: number, reason?: string): void {
		this.sockets.delete(record.socket);
		this.debug("info", "socket-closed", { clientId: record.clientId, code, reason: reason || undefined, sockets: this.sockets.size });
		if (!record.clientId || this.clients.get(record.clientId) !== record) return;
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
		this.debug("info", "tab-activated", { clientId, tabId: tab.tabId, origin: tab.origin });
	}

	private rejectPending(pending: PendingRequest, error: Error): void {
		this.debug("warn", "client-request-rejected", { requestId: pending.request.requestId, clientId: pending.clientId, type: pending.request.type, message: error.message });
		clearTimeout(pending.timer);
		this.pending.delete(pending.request.requestId);
		this.state.pendingRequests = this.state.pendingRequests.filter((request) => request.requestId !== pending.request.requestId);
		pending.reject(error);
	}

	private resolvePending(pending: PendingRequest, envelope: BridgeEnvelope): void {
		this.debug("debug", "client-request-resolved", { requestId: pending.request.requestId, clientId: pending.clientId, type: pending.request.type, responseType: envelope.type });
		clearTimeout(pending.timer);
		this.pending.delete(pending.request.requestId);
		this.state.pendingRequests = this.state.pendingRequests.filter((request) => request.requestId !== pending.request.requestId);
		pending.resolve(envelope);
	}

	private sendError(socket: WebSocket, requestId: string | undefined, code: BridgeErrorCode, message: string): void {
		this.debug("warn", "error-sent", { requestId, code, message });
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

	private debug(level: "debug" | "info" | "warn" | "error", event: string, data?: Record<string, string | number | boolean | undefined>): void {
		appendBrowserBridgeDebugLog(this.state, { at: this.now(), source: "server", level, event, data });
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
