export function shouldFallbackResumeToPairRequest(error: unknown): boolean {
	const message = errorMessage(error);
	return /\bresume\b/i.test(message) && /\b(failed|invalid|expired|missing|rejected)\b/i.test(message);
}

export function shouldFallbackBridgeUrlToDefault(error: unknown): boolean {
	const message = errorMessage(error);
	return /could not connect to the pi bridge/i.test(message) || /socket closed before connection completed/i.test(message);
}

export function bridgeCloseBeforeAcceptMessage(event?: { code?: number; reason?: string }, lastError?: string): string {
	const reason = event?.reason?.trim();
	if (reason) return `Pi bridge rejected the connection before it accepted the browser: ${reason}.`;
	if (lastError) return lastError;
	if (typeof event?.code === "number" && event.code !== 1000) return `Pi bridge socket closed before connection completed with close code ${event.code}.`;
	return "Pi bridge socket closed before connection completed.";
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
