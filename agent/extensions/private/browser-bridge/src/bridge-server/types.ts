import type { WebSocket } from "ws";
import type { BrowserClientAuthDetails } from "./auth-payloads.ts";
import type { BridgeEnvelope } from "../core/protocol.ts";
import type { PendingBridgeRequestSummary } from "../core/state.ts";

export interface SocketRecord {
	socket: WebSocket;
	clientId?: string;
}

export interface PendingRequest {
	clientId: string;
	request: PendingBridgeRequestSummary;
	resolve: (envelope: BridgeEnvelope) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
}

export interface AuthorizedClient {
	clientId: string;
	resumeSecret: string;
	client?: BrowserClientAuthDetails;
}
