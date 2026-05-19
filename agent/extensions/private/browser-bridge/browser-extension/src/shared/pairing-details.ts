export interface PairingDetails {
	url: string;
	token: string;
}

const BRIDGE_URL_PATTERN = /ws:\/\/127\.0\.0\.1:\d+(?:\/[^\s"'<>]*)?/;
const TOKEN_PATTERN = /[A-Za-z0-9_-]{16,}/;

export function parsePairingDetails(value: string): PairingDetails | undefined {
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	const jsonDetails = parseJsonPairingDetails(trimmed);
	if (jsonDetails) return jsonDetails;

	const url = trimmed.match(BRIDGE_URL_PATTERN)?.[0];
	if (!url) return undefined;
	const labeledToken = trimmed.match(/pairing\s+token\s*:\s*([A-Za-z0-9_-]{16,})/i)?.[1];
	const token = labeledToken ?? tokenAfterUrl(trimmed, url);
	return token ? { url, token } : undefined;
}

function parseJsonPairingDetails(value: string): PairingDetails | undefined {
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!isRecord(parsed) || typeof parsed.url !== "string" || typeof parsed.token !== "string") return undefined;
		const url = parsed.url.match(BRIDGE_URL_PATTERN)?.[0];
		const token = parsed.token.match(TOKEN_PATTERN)?.[0];
		return url && token ? { url, token } : undefined;
	} catch {
		return undefined;
	}
}

function tokenAfterUrl(value: string, url: string): string | undefined {
	const afterUrl = value.slice(value.indexOf(url) + url.length);
	return afterUrl.match(TOKEN_PATTERN)?.[0];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
