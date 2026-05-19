export function shouldFallbackResumeToPairRequest(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /\bresume\b/i.test(message) && /\b(failed|invalid|expired|missing|rejected)\b/i.test(message);
}

export function bridgeCloseBeforeAcceptMessage(event?: { code?: number; reason?: string }, lastError?: string): string {
	const reason = event?.reason?.trim();
	if (reason) return `Pi bridge rejected the connection before it accepted the browser: ${reason}.`;
	if (lastError) return lastError;
	if (typeof event?.code === "number" && event.code !== 1000) return `Pi bridge socket closed before connection completed with close code ${event.code}.`;
	return "Pi bridge socket closed before connection completed.";
}
