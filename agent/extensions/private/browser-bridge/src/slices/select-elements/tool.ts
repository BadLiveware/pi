import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { BrowserBridgeServer } from "../../bridge-server/lifecycle.ts";
import type { BridgeEnvelope } from "../../core/protocol.ts";
import type { BrowserBridgeRuntime, BrowserClientSummary, BrowserTabSummary } from "../../core/state.ts";

interface SelectElementsParams {
	target?: { clientId?: string; tabId?: number };
	mode: "single" | "multiple";
	includeHtml?: boolean;
	includeText?: boolean;
	maxHtmlChars?: number;
	timeoutMs?: number;
}

interface SelectionTarget {
	client: BrowserClientSummary;
	tab: BrowserTabSummary;
}

interface SelectionResultPayload {
	status?: string;
	elements?: Array<{ elementId?: string; tagName?: string; textPreview?: string; selectorCandidates?: string[] }>;
	reason?: string;
}

export function registerSelectElementsTool(pi: ExtensionAPI, runtime: BrowserBridgeRuntime, server: BrowserBridgeServer): void {
	pi.registerTool({
		name: "browser_bridge_select_elements",
		label: "Select Browser Elements",
		description: "Ask the connected browser extension to let the user select one or more elements in an activated tab and return compact element descriptors.",
		promptSnippet: "Ask the connected browser extension to let the user select page elements and return compact descriptors.",
		promptGuidelines: [
			"Use browser_bridge_select_elements when the user asks to point at, choose, inspect, or discuss visible page elements in an activated browser tab.",
			"Call browser_bridge_state first if you are unsure whether a browser client is connected or a tab has been activated.",
		],
		parameters: Type.Object({
			target: Type.Optional(Type.Object({
				clientId: Type.Optional(Type.String({ description: "Specific connected browser client id. Defaults to the active connected client." })),
				tabId: Type.Optional(Type.Number({ description: "Specific activated tab id. Defaults to the client's active tab." })),
			}, { description: "Optional connected browser client/tab target." })),
			mode: Type.Union([Type.Literal("single"), Type.Literal("multiple")], { description: "Select one element or multiple elements." }),
			includeHtml: Type.Optional(Type.Boolean({ description: "Include capped outerHTML preview for selected elements. Default false." })),
			includeText: Type.Optional(Type.Boolean({ description: "Include capped text preview for selected elements. Default true." })),
			maxHtmlChars: Type.Optional(Type.Number({ description: "Maximum HTML preview characters per element. Default 1200." })),
			timeoutMs: Type.Optional(Type.Number({ description: "Selection timeout in milliseconds. Default 60000." })),
		}),
		async execute(_toolCallId: string, params: SelectElementsParams, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: ExtensionContext) {
			const target = chooseSelectionTarget(runtime, params);
			const timeoutMs = clampTimeout(params.timeoutMs);
			const response = await server.sendRequestToClient(target.client.clientId, "select-elements", {
				mode: params.mode,
				includeHtml: params.includeHtml === true,
				includeText: params.includeText !== false,
				maxHtmlChars: clampHtmlChars(params.maxHtmlChars),
				timeoutMs,
			}, { timeoutMs: timeoutMs + 1000, target: { tabId: target.tab.tabId } });
			return formatSelectionToolResult(response);
		},
	});
}

export function chooseSelectionTarget(runtime: BrowserBridgeRuntime, params: Pick<SelectElementsParams, "target">): SelectionTarget {
	const client = params.target?.clientId ? runtime.state.clients.find((candidate) => candidate.clientId === params.target?.clientId) : runtime.state.clients[0];
	if (!client) throw new Error("No browser bridge client is connected. Run `/browser-bridge pair`, connect the browser extension, and activate a tab first.");
	const tab = params.target?.tabId
		? runtime.state.tabs.find((candidate) => candidate.clientId === client.clientId && candidate.tabId === params.target?.tabId)
		: runtime.state.tabs.find((candidate) => candidate.clientId === client.clientId && candidate.tabId === client.activeTabId) ?? runtime.state.tabs.find((candidate) => candidate.clientId === client.clientId && candidate.active);
	if (!tab) throw new Error("No activated tab is available for the selected browser client. Use the browser extension popup to activate the current tab first.");
	return { client, tab };
}

export function formatSelectionToolResult(response: BridgeEnvelope): { content: Array<{ type: "text"; text: string }>; details: unknown } {
	if (response.type === "error") {
		const message = errorMessage(response.payload);
		throw new Error(message);
	}
	const payload = response.payload as SelectionResultPayload;
	const elements = Array.isArray(payload.elements) ? payload.elements : [];
	const status = payload.status === "selected" ? "selected" : "cancelled";
	const lines = [`Selection ${status}: ${elements.length} element(s).`];
	if (status === "cancelled" && payload.reason) lines.push(`Reason: ${payload.reason}.`);
	elements.slice(0, 8).forEach((element, index) => {
		const selector = element.selectorCandidates?.[0] ?? element.tagName ?? element.elementId ?? "element";
		const elementId = element.elementId && element.elementId !== selector ? ` [${element.elementId}]` : "";
		const text = element.textPreview ? ` — ${element.textPreview}` : "";
		lines.push(`${index + 1}. ${selector}${elementId}${text}`);
	});
	return { content: [{ type: "text", text: lines.join("\n") }], details: response.payload };
}

function errorMessage(payload: unknown): string {
	return typeof payload === "object" && payload !== null && typeof (payload as { message?: unknown }).message === "string"
		? (payload as { message: string }).message
		: "Browser element selection failed.";
}

function clampTimeout(value: number | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return 60_000;
	return Math.min(5 * 60_000, Math.max(5_000, Math.trunc(value)));
}

function clampHtmlChars(value: number | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return 1200;
	return Math.min(20_000, Math.max(0, Math.trunc(value)));
}
