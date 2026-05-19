import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { WebSocket } from "ws";
import { BrowserBridgeServer } from "../src/bridge-server/lifecycle.ts";
import { createBrowserBridgeRuntime } from "../src/core/state.ts";
import { makeBridgeEnvelope, parseBridgeEnvelopeJson, type BridgeEnvelope } from "../src/core/protocol.ts";

async function openClient(url: string): Promise<WebSocket> {
	const socket = new WebSocket(url);
	await once(socket, "open");
	return socket;
}

async function nextEnvelope(socket: WebSocket): Promise<BridgeEnvelope> {
	const [data] = await once(socket, "message") as [WebSocket.RawData];
	const parsed = parseBridgeEnvelopeJson(rawDataToText(data), "pi-to-browser");
	if (!parsed.ok) throw new Error("Failed to parse bridge envelope from test client.");
	return parsed.envelope;
}

function rawDataToText(data: WebSocket.RawData): string {
	if (typeof data === "string") return data;
	if (Buffer.isBuffer(data)) return data.toString("utf8");
	if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
	return Buffer.from(data).toString("utf8");
}

function pairMessage(token: string, clientId = "client-a"): string {
	return JSON.stringify(makeBridgeEnvelope({
		id: "pair-1",
		direction: "browser-to-pi",
		type: "pair",
		payload: {
			token,
			client: {
				clientId,
				browser: "chromium",
				extensionVersion: "0.1.0",
				capabilities: ["tabs", "selection"],
			},
		},
	}));
}

function pairRequestMessage(clientId = "client-a"): string {
	return JSON.stringify(makeBridgeEnvelope({
		id: "pair-request-1",
		direction: "browser-to-pi",
		type: "pair-request",
		payload: {
			client: {
				clientId,
				browser: "chromium",
				extensionVersion: "0.1.0",
				capabilities: ["tabs", "selection"],
			},
		},
	}));
}

function resumeMessage(clientId: string, resumeSecret: string): string {
	return JSON.stringify(makeBridgeEnvelope({
		id: "resume-1",
		direction: "browser-to-pi",
		type: "resume",
		payload: {
			clientId,
			resumeSecret,
			client: {
				clientId,
				browser: "chromium",
				extensionVersion: "0.1.0",
				capabilities: ["tabs", "selection"],
			},
		},
	}));
}

test("server starts inertly, pairs a client, and exposes state", async () => {
	const runtime = createBrowserBridgeRuntime(1000);
	const server = new BrowserBridgeServer(runtime.state, { port: 0, now: () => 1000 });
	assert.equal(runtime.state.server.listener, "stopped");

	const started = await server.start();
	const pairing = server.createPairingToken(30_000);
	const socket = await openClient(started.url);
	try {
		socket.send(pairMessage(pairing.token));
		const response = await nextEnvelope(socket);
		assert.equal(response.type, "pair:accepted");
		assert.equal(response.requestId, "pair-1");
		assert.equal(typeof (response.payload as { resumeSecret?: unknown }).resumeSecret, "string");
		assert.equal(runtime.state.clients.length, 1);
		assert.equal(runtime.state.clients[0]?.clientId, "client-a");
		assert.deepEqual(runtime.state.clients[0]?.capabilities, ["tabs", "selection"]);
		assert.equal(runtime.state.server.pairing, undefined);
	} finally {
		socket.close();
		await server.stop("test cleanup");
	}
});

test("server accepts no-copy pair requests during the pairing window", async () => {
	const runtime = createBrowserBridgeRuntime(1000);
	const server = new BrowserBridgeServer(runtime.state, { port: 0, now: () => 1000 });
	const started = await server.start();
	server.createPairingToken(30_000);
	const socket = await openClient(started.url);
	try {
		socket.send(pairRequestMessage());
		const response = await nextEnvelope(socket);
		assert.equal(response.type, "pair:accepted");
		assert.equal(response.requestId, "pair-request-1");
		assert.equal(typeof (response.payload as { resumeSecret?: unknown }).resumeSecret, "string");
		assert.equal(runtime.state.clients.length, 1);
		assert.equal(runtime.state.clients[0]?.clientId, "client-a");
		assert.equal(runtime.state.server.pairing, undefined);
	} finally {
		socket.terminate();
		await server.stop("test cleanup");
	}
});

test("server treats stale resume as no-copy pair during the pairing window", async () => {
	const runtime = createBrowserBridgeRuntime(1000);
	const server = new BrowserBridgeServer(runtime.state, { port: 0, now: () => 1000 });
	const started = await server.start();
	server.createPairingToken(30_000);
	const socket = await openClient(started.url);
	try {
		socket.send(resumeMessage("client-a", "stale-resume-secret"));
		const response = await nextEnvelope(socket);
		assert.equal(response.type, "pair:accepted");
		assert.equal(response.requestId, "resume-1");
		assert.equal(typeof (response.payload as { resumeSecret?: unknown }).resumeSecret, "string");
		assert.notEqual((response.payload as { resumeSecret?: string }).resumeSecret, "stale-resume-secret");
		assert.equal(runtime.state.clients.length, 1);
		assert.equal(runtime.state.clients[0]?.clientId, "client-a");
		assert.equal(runtime.state.server.pairing, undefined);
		assert.match(runtime.state.debugLog.map((entry) => entry.event).join("\n"), /resume-stale-accepted-by-pair-window/);
	} finally {
		socket.terminate();
		await server.stop("test cleanup");
	}
});

test("server resumes a previously paired browser client without a new pairing token", async () => {
	const runtime = createBrowserBridgeRuntime(1000);
	const server = new BrowserBridgeServer(runtime.state, { port: 0, now: () => 1000 });
	const started = await server.start();
	const pairing = server.createPairingToken(30_000);
	const socket = await openClient(started.url);
	let resumed: WebSocket | undefined;
	try {
		socket.send(pairMessage(pairing.token));
		const paired = await nextEnvelope(socket);
		const resumeSecret = (paired.payload as { resumeSecret?: string }).resumeSecret;
		assert.equal(typeof resumeSecret, "string");
		socket.close();
		await once(socket, "close");
		assert.equal(runtime.state.clients.length, 0);

		resumed = await openClient(started.url);
		resumed.send(resumeMessage("client-a", resumeSecret!));
		const response = await nextEnvelope(resumed);
		assert.equal(response.type, "resume:accepted");
		assert.equal(response.requestId, "resume-1");
		assert.equal(runtime.state.clients.length, 1);
		assert.equal(runtime.state.clients[0]?.clientId, "client-a");
	} finally {
		socket.terminate();
		resumed?.terminate();
		await server.stop("test cleanup");
	}
});

test("server rejects bad pairing tokens without registering clients", async () => {
	const runtime = createBrowserBridgeRuntime(1000);
	const server = new BrowserBridgeServer(runtime.state, { port: 0, now: () => 1000 });
	const started = await server.start();
	server.createPairingToken(30_000);
	const socket = await openClient(started.url);
	try {
		socket.send(pairMessage("bad-token", "bad-client"));
		const response = await nextEnvelope(socket);
		assert.equal(response.type, "error");
		assert.equal((response.payload as { code?: string }).code, "pairing_failed");
		assert.equal(runtime.state.clients.length, 0);
	} finally {
		socket.terminate();
		await server.stop("test cleanup");
	}
});

test("client keepalive messages are acknowledged", async () => {
	const runtime = createBrowserBridgeRuntime(1000);
	const server = new BrowserBridgeServer(runtime.state, { port: 0, now: () => 1000 });
	const started = await server.start();
	const pairing = server.createPairingToken(30_000);
	const socket = await openClient(started.url);
	try {
		socket.send(pairMessage(pairing.token));
		await nextEnvelope(socket);
		socket.send(JSON.stringify(makeBridgeEnvelope({
			id: "keepalive-1",
			direction: "browser-to-pi",
			type: "client:keepalive",
			payload: { sentAt: 1000 },
		})));
		const ack = await nextEnvelope(socket);
		assert.equal(ack.type, "ack");
		assert.equal(ack.requestId, "keepalive-1");
		assert.match(runtime.state.debugLog.map((entry) => entry.event).join("\n"), /client-keepalive/);
	} finally {
		socket.terminate();
		await server.stop("test cleanup");
	}
});

test("browser-initiated element selections are stored in state", async () => {
	const runtime = createBrowserBridgeRuntime(1000);
	const server = new BrowserBridgeServer(runtime.state, { port: 0, now: () => 1000 });
	const started = await server.start();
	const pairing = server.createPairingToken(30_000);
	const socket = await openClient(started.url);
	try {
		socket.send(pairMessage(pairing.token));
		await nextEnvelope(socket);
		socket.send(JSON.stringify(makeBridgeEnvelope({
			id: "selection-1",
			direction: "browser-to-pi",
			type: "elements:selected",
			payload: {
				tabId: 42,
				title: "Fixture",
				origin: "https://example.test",
				selectedAt: 1234,
				selection: { status: "selected", elements: [{ elementId: "el-1", tagName: "button", selectorCandidates: ["button"], textPreview: "Click me" }] },
			},
		})));
		const ack = await nextEnvelope(socket);
		assert.equal(ack.type, "ack");
		assert.equal(runtime.state.sharedSelections.length, 1);
		assert.equal(runtime.state.sharedSelections[0]?.tabId, 42);
		assert.equal(runtime.state.sharedSelections[0]?.elements[0]?.textPreview, "Click me");
	} finally {
		socket.terminate();
		await server.stop("test cleanup");
	}
});

test("tab activation messages update bridge state", async () => {
	const runtime = createBrowserBridgeRuntime(1000);
	const server = new BrowserBridgeServer(runtime.state, { port: 0, now: () => 1000 });
	const started = await server.start();
	const pairing = server.createPairingToken(30_000);
	const socket = await openClient(started.url);
	try {
		socket.send(pairMessage(pairing.token));
		await nextEnvelope(socket);
		socket.send(JSON.stringify(makeBridgeEnvelope({
			id: "tab-1",
			direction: "browser-to-pi",
			type: "tab:activated",
			payload: { tabId: 42, title: "Fixture", origin: "https://example.test", active: true, capabilities: ["activation"] },
		})));
		const ack = await nextEnvelope(socket);
		assert.equal(ack.type, "ack");
		assert.equal(runtime.state.tabs.length, 1);
		assert.equal(runtime.state.tabs[0]?.tabId, 42);
		assert.equal(runtime.state.tabs[0]?.origin, "https://example.test");
		assert.equal(runtime.state.clients[0]?.activeTabId, 42);
	} finally {
		socket.terminate();
		await server.stop("test cleanup");
	}
});

test("client requests time out and clear pending state", async () => {
	const runtime = createBrowserBridgeRuntime(1000);
	const server = new BrowserBridgeServer(runtime.state, { port: 0, now: () => 1000 });
	const started = await server.start();
	const pairing = server.createPairingToken(30_000);
	const socket = await openClient(started.url);
	try {
		socket.send(pairMessage(pairing.token));
		await nextEnvelope(socket);
		await assert.rejects(
			server.sendRequestToClient("client-a", "ping", {}, { timeoutMs: 5 }),
			/timed out/,
		);
		assert.equal(runtime.state.pendingRequests.length, 0);
	} finally {
		socket.terminate();
		await server.stop("test cleanup");
	}
});

test("client responses resolve pending requests", async () => {
	const runtime = createBrowserBridgeRuntime(1000);
	let now = 1000;
	const server = new BrowserBridgeServer(runtime.state, { port: 0, now: () => now });
	const started = await server.start();
	const pairing = server.createPairingToken(30_000);
	const socket = await openClient(started.url);
	try {
		socket.send(pairMessage(pairing.token));
		await nextEnvelope(socket);
		const pending = server.sendRequestToClient("client-a", "ping", { n: 1 }, { timeoutMs: 1000 });
		const request = await nextEnvelope(socket);
		assert.equal(request.type, "ping");
		now = 1001;
		socket.send(JSON.stringify(makeBridgeEnvelope({ id: "resp-1", requestId: request.id, direction: "browser-to-pi", type: "pong", payload: { ok: true } })));
		const response = await pending;
		assert.equal(response.type, "pong");
		assert.equal(runtime.state.pendingRequests.length, 0);
	} finally {
		socket.terminate();
		await server.stop("test cleanup");
	}
});

test("stop and disconnect cleanup clear clients and pending requests", async () => {
	const runtime = createBrowserBridgeRuntime(1000);
	const server = new BrowserBridgeServer(runtime.state, { port: 0, now: () => 1000 });
	const started = await server.start();
	const pairing = server.createPairingToken(30_000);
	const socket = await openClient(started.url);
	try {
		socket.send(pairMessage(pairing.token));
		await nextEnvelope(socket);
		const pending = server.sendRequestToClient("client-a", "ping", {}, { timeoutMs: 1000 });
		assert.equal(runtime.state.pendingRequests.length, 1);
		await server.stop("cleanup test stop");
		await assert.rejects(pending, /cleanup test stop/);
		assert.equal(runtime.state.clients.length, 0);
		assert.equal(runtime.state.pendingRequests.length, 0);
		assert.equal(runtime.state.server.listener, "stopped");
	} finally {
		socket.terminate();
		await server.stop("test cleanup");
	}
});
