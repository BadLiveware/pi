import { runSubagentThroughBridge, type EventBus, type SubagentResponse } from "./brief-worker-run-bridge.ts";

export interface PreparedWorkerInvocation {
	requestId: string;
	params: Record<string, unknown>;
}

export interface ExecuteWorkerInvocationInput extends PreparedWorkerInvocation {
	events: EventBus | undefined;
	signal?: AbortSignal;
	onUpdate?: (text: string, details?: Record<string, unknown>) => void;
}

export function prepareWorkerInvocation(
	invocation: Record<string, unknown>,
	options: { requestId: string; output: string | false; outputMode: "inline" | "file-only" },
): PreparedWorkerInvocation {
	return {
		requestId: options.requestId,
		params: {
			...invocation,
			output: options.output,
			outputMode: options.outputMode,
			async: false,
			clarify: false,
		},
	};
}

export async function executeWorkerInvocation(input: ExecuteWorkerInvocationInput): Promise<SubagentResponse> {
	return runSubagentThroughBridge({
		events: input.events,
		requestId: input.requestId,
		params: input.params,
		signal: input.signal,
		onUpdate: input.onUpdate,
	});
}
