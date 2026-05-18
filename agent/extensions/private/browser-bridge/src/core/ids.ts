import { randomBytes } from "node:crypto";

export function makeBridgeId(prefix: string): string {
	return `${prefix}-${randomBytes(8).toString("hex")}`;
}

export function makePairingToken(): string {
	return randomBytes(18).toString("base64url");
}
