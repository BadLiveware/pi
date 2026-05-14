import * as fs from "node:fs";

const SUBAGENT_REQUEST_EVENT = "subagent:slash:request";
const SUBAGENT_STARTED_EVENT = "subagent:slash:started";
const SUBAGENT_RESPONSE_EVENT = "subagent:slash:response";
const SUBAGENT_UPDATE_EVENT = "subagent:slash:update";
const SUBAGENT_CANCEL_EVENT = "subagent:slash:cancel";
const START_TIMEOUT_MS = 15_000;
const MAX_SAVED_OUTPUT_EXCERPT_BYTES = 64_000;

export type EventBus = {
	on(event: string, handler: (data: unknown) => void): (() => void) | void;
	emit(event: string, data: unknown): void;
};

export type SubagentResult = {
	content?: Array<{ type?: string; text?: string }>;
	details?: {
		runId?: string;
		results?: Array<{
			agent?: string;
			exitCode?: number;
			finalOutput?: string;
			error?: string;
			sessionFile?: string;
			savedOutputPath?: string;
			outputReference?: { path?: string; message?: string };
			artifactPaths?: { outputPath?: string };
		}>;
	};
	isError?: boolean;
};

export type SubagentResponse = {
	requestId: string;
	result: SubagentResult;
	isError: boolean;
	errorText?: string;
};

function firstText(content: SubagentResult["content"]): string | undefined {
	return content?.find((part) => part?.type === "text" && typeof part.text === "string")?.text;
}

function readFilePrefix(filePath: string): string | undefined {
	try {
		const stat = fs.statSync(filePath);
		if (!stat.isFile()) return undefined;
		const limit = Math.min(stat.size, MAX_SAVED_OUTPUT_EXCERPT_BYTES);
		const buffer = Buffer.alloc(limit);
		const fd = fs.openSync(filePath, "r");
		try {
			const bytesRead = fs.readSync(fd, buffer, 0, limit, 0);
			const text = buffer.subarray(0, bytesRead).toString("utf-8").trim();
			if (!text) return undefined;
			return stat.size > limit ? `${text}\n...[truncated; full worker output saved to ${filePath}]` : text;
		} finally {
			fs.closeSync(fd);
		}
	} catch {
		return undefined;
	}
}

function savedOutputText(response: SubagentResponse): string | undefined {
	for (const result of response.result.details?.results ?? []) {
		const candidatePaths = [result.savedOutputPath, result.outputReference?.path, result.artifactPaths?.outputPath];
		for (const candidate of candidatePaths) {
			if (!candidate) continue;
			const text = readFilePrefix(candidate);
			if (text) return text;
		}
	}
	return undefined;
}

export function finalOutput(response: SubagentResponse): string {
	const first = response.result.details?.results?.[0];
	return savedOutputText(response)
		?? first?.finalOutput
		?? first?.error
		?? firstText(response.result.content)
		?? response.errorText
		?? "(no output)";
}

export function outputRefs(response: SubagentResponse): string[] {
	const refs = new Set<string>();
	for (const result of response.result.details?.results ?? []) {
		if (result.savedOutputPath) refs.add(result.savedOutputPath);
		if (result.outputReference?.path) refs.add(result.outputReference.path);
		if (result.artifactPaths?.outputPath) refs.add(result.artifactPaths.outputPath);
		if (result.sessionFile) refs.add(result.sessionFile);
	}
	return [...refs];
}

function subscribe(events: EventBus, event: string, handler: (data: unknown) => void, subscriptions: Array<() => void>): void {
	const unsubscribe = events.on(event, handler);
	if (typeof unsubscribe === "function") subscriptions.push(unsubscribe);
}

export async function runSubagentThroughBridge(input: {
	events: EventBus | undefined;
	requestId: string;
	params: Record<string, unknown>;
	signal?: AbortSignal;
	onUpdate?: (text: string, details?: Record<string, unknown>) => void;
}): Promise<SubagentResponse> {
	const { events, requestId, params, signal, onUpdate } = input;
	if (!events || typeof events.on !== "function" || typeof events.emit !== "function") {
		throw new Error("pi-subagents event bridge is unavailable. Ensure pi-subagents is installed and loaded.");
	}

	return await new Promise<SubagentResponse>((resolve, reject) => {
		let done = false;
		let started = false;
		const subscriptions: Array<() => void> = [];
		let timeout: ReturnType<typeof setTimeout> | undefined;

		const finish = (next: () => void) => {
			if (done) return;
			done = true;
			if (timeout) clearTimeout(timeout);
			for (const unsubscribe of subscriptions) unsubscribe();
			if (signal) signal.removeEventListener("abort", abortHandler);
			next();
		};

		const abortHandler = () => {
			try {
				events.emit(SUBAGENT_CANCEL_EVENT, { requestId });
			} catch {
				// Cancellation is best-effort; finish still reports the abort.
			}
			finish(() => reject(new Error("Subagent run cancelled.")));
		};

		subscribe(events, SUBAGENT_STARTED_EVENT, (data) => {
			if (!data || typeof data !== "object") return;
			if ((data as { requestId?: unknown }).requestId !== requestId) return;
			started = true;
			if (timeout) clearTimeout(timeout);
			onUpdate?.("Subagent run started.", { requestId });
		}, subscriptions);

		subscribe(events, SUBAGENT_UPDATE_EVENT, (data) => {
			if (!data || typeof data !== "object") return;
			const update = data as { requestId?: unknown; currentTool?: unknown; toolCount?: unknown };
			if (update.requestId !== requestId) return;
			const tool = typeof update.currentTool === "string" && update.currentTool ? ` Current tool: ${update.currentTool}.` : "";
			onUpdate?.(`Subagent running.${tool}`, { requestId, update });
		}, subscriptions);

		subscribe(events, SUBAGENT_RESPONSE_EVENT, (data) => {
			if (!data || typeof data !== "object") return;
			const response = data as Partial<SubagentResponse>;
			if (response.requestId !== requestId || !response.result) return;
			finish(() => resolve({ requestId, result: response.result as SubagentResult, isError: response.isError === true, errorText: response.errorText }));
		}, subscriptions);

		if (signal?.aborted) return abortHandler();
		if (signal) signal.addEventListener("abort", abortHandler, { once: true });

		timeout = setTimeout(() => {
			finish(() => reject(new Error("Subagent bridge did not start within 15s. Ensure pi-subagents is loaded correctly.")));
		}, START_TIMEOUT_MS);

		events.emit(SUBAGENT_REQUEST_EVENT, { requestId, params });
		if (!started && !done) {
			finish(() => reject(new Error("No subagent bridge responded. Ensure pi-subagents is installed and loaded.")));
		}
	});
}
