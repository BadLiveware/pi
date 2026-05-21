import { formatDrawingGeometry, formatStrokeRegions, isRootOnlyDrawingTarget } from "./drawing-format.ts";

export const BROWSER_BRIDGE_HOST = "127.0.0.1" as const;
export const BROWSER_BRIDGE_PORT = 43871 as const;
export const BROWSER_BRIDGE_DEFAULT_URL = `ws://${BROWSER_BRIDGE_HOST}:${BROWSER_BRIDGE_PORT}` as const;
export const BROWSER_BRIDGE_CAPABILITIES = ["state", "bridge-server", "pairing", "tab-activation", "element-selection", "context-menu-selection", "drawing", "overlay", "style-inspection", "design-preview", "style-copy", "capture-view", "preview-pages", "interaction", "clipboard"] as const;

export type BridgeListenerStatus = "stopped" | "running";
export type BrowserBridgeDebugLevel = "debug" | "info" | "warn" | "error";

export interface BrowserBridgeDebugLogEntry {
	at: number;
	source: "server" | "tool" | "command" | "browser";
	level: BrowserBridgeDebugLevel;
	event: string;
	message?: string;
	data?: Record<string, string | number | boolean | undefined>;
}

export interface BrowserBridgePairingState {
	active: boolean;
	expiresAt?: number;
}

export interface BrowserBridgeServerState {
	enabled: boolean;
	host: typeof BROWSER_BRIDGE_HOST;
	port?: number;
	listener: BridgeListenerStatus;
	pairedClientCount: number;
	pairing?: BrowserBridgePairingState;
	diagnostics: string[];
}

export interface BrowserClientSummary {
	clientId: string;
	browser: "chrome" | "edge" | "chromium" | "unknown";
	extensionVersion?: string;
	connectedAt: number;
	activeTabId?: number;
	capabilities: string[];
}

export interface BrowserTabSummary {
	tabId: number;
	clientId: string;
	title?: string;
	url?: string;
	origin?: string;
	active: boolean;
	capabilities: string[];
}

export interface BrowserElementDescriptorSummary {
	elementId?: string;
	selectorCandidates?: string[];
	tagName?: string;
	role?: string;
	accessibleName?: string;
	textPreview?: string;
	attributes?: Record<string, string>;
	boundingBox?: { x: number; y: number; width: number; height: number; coordinateSpace?: string };
	htmlPreview?: string;
}

export interface BrowserSelectionContextSummary {
	[key: string]: string | number | boolean | undefined;
}

export interface BrowserSharedSelectionSummary {
	selectionId: string;
	clientId: string;
	tabId?: number;
	source?: string;
	title?: string;
	url?: string;
	pageUrl?: string;
	frameUrl?: string;
	origin?: string;
	status: "selected" | "cancelled" | "unknown";
	reason?: string;
	userNote?: string;
	selectedAt: number;
	context?: BrowserSelectionContextSummary;
	elements: BrowserElementDescriptorSummary[];
}

export interface BrowserDrawingPointSummary {
	x: number;
	y: number;
	t?: number;
	pressure?: number;
}

export interface BrowserDrawingStrokeSummary {
	color?: string;
	width?: number;
	points: BrowserDrawingPointSummary[];
	boundingBox?: BrowserDrawingBoxSummary;
	pageBoundingBox?: BrowserDrawingBoxSummary;
}

export interface BrowserDrawingGestureSummary {
	type?: string;
	confidence?: string;
	start?: { x: number; y: number };
	end?: { x: number; y: number };
	fromElement?: BrowserElementDescriptorSummary;
	toElement?: BrowserElementDescriptorSummary;
}

export interface BrowserDrawingBoxSummary {
	x: number;
	y: number;
	width: number;
	height: number;
	coordinateSpace?: string;
}

export interface BrowserDrawingViewportSummary {
	width?: number;
	height?: number;
	scrollX?: number;
	scrollY?: number;
	devicePixelRatio?: number;
}

export interface BrowserDrawingPreviewSummary {
	path?: string;
	mediaType?: string;
	crop?: BrowserDrawingBoxSummary;
	imageSize?: { width: number; height: number };
	viewport?: { width: number; height: number };
	scale?: { x: number; y: number };
}

export interface BrowserSharedDrawingSummary {
	drawingId: string;
	clientId: string;
	tabId?: number;
	source?: string;
	title?: string;
	url?: string;
	pageUrl?: string;
	frameUrl?: string;
	origin?: string;
	status: "drawn" | "cancelled" | "unknown";
	reason?: string;
	userNote?: string;
	sharedAt: number;
	context?: BrowserSelectionContextSummary;
	boundingBox?: BrowserDrawingBoxSummary;
	pageBoundingBox?: BrowserDrawingBoxSummary;
	viewport?: BrowserDrawingViewportSummary;
	pointCount: number;
	strokes: BrowserDrawingStrokeSummary[];
	gesture?: BrowserDrawingGestureSummary;
	previewImage?: BrowserDrawingPreviewSummary;
	nearbyElements: BrowserElementDescriptorSummary[];
}

export interface BrowserDesignPreviewSummary {
	patchId: string;
	clientId?: string;
	tabId?: number;
	action: string;
	selector?: string;
	elementId?: string;
	elementCount: number;
	summary: string;
	createdAt: number;
}

export interface PendingBridgeRequestSummary {
	requestId: string;
	clientId?: string;
	type: string;
	startedAt: number;
	timeoutMs: number;
	target?: { tabId?: number; frameId?: number };
}

export interface PreviewServerState {
	enabled: boolean;
	host: typeof BROWSER_BRIDGE_HOST;
	port?: number;
	artifactRoot?: string;
}

export interface BrowserBridgeState {
	server: BrowserBridgeServerState;
	clients: BrowserClientSummary[];
	tabs: BrowserTabSummary[];
	sharedSelections: BrowserSharedSelectionSummary[];
	sharedDrawings: BrowserSharedDrawingSummary[];
	designPreviews: BrowserDesignPreviewSummary[];
	pendingRequests: PendingBridgeRequestSummary[];
	previewServer?: PreviewServerState;
	capabilities: string[];
	diagnostics: string[];
	debugLog: BrowserBridgeDebugLogEntry[];
	createdAt: number;
}

export interface BrowserBridgeRuntime {
	state: BrowserBridgeState;
}

export interface BrowserBridgeSnapshot {
	server: BrowserBridgeServerState;
	clients: BrowserClientSummary[];
	tabs: BrowserTabSummary[];
	sharedSelections: BrowserSharedSelectionSummary[];
	sharedDrawings: BrowserSharedDrawingSummary[];
	designPreviews: BrowserDesignPreviewSummary[];
	pendingRequests: PendingBridgeRequestSummary[];
	previewServer?: PreviewServerState;
	capabilities: string[];
	diagnostics: string[];
	debugLog: BrowserBridgeDebugLogEntry[];
	createdAt: number;
}

export function createBrowserBridgeRuntime(now = Date.now()): BrowserBridgeRuntime {
	return { state: createInitialBrowserBridgeState(now) };
}

export function createInitialBrowserBridgeState(now = Date.now()): BrowserBridgeState {
	return {
		server: {
			enabled: false,
			host: BROWSER_BRIDGE_HOST,
			listener: "stopped",
			pairedClientCount: 0,
			diagnostics: [
				"Bridge server is disabled and no browser clients are connected.",
				"Run `/browser-bridge pair` to start the local bridge and create a short-lived pairing token.",
			],
		},
		clients: [],
		tabs: [],
		sharedSelections: [],
		sharedDrawings: [],
		designPreviews: [],
		pendingRequests: [],
		capabilities: [...BROWSER_BRIDGE_CAPABILITIES],
		diagnostics: [],
		debugLog: [],
		createdAt: now,
	};
}

export function browserBridgeStatePayload(state: BrowserBridgeState): BrowserBridgeSnapshot {
	const server: BrowserBridgeServerState = {
		...state.server,
		pairedClientCount: state.clients.length,
		pairing: state.server.pairing ? { ...state.server.pairing } : undefined,
		diagnostics: [...state.server.diagnostics],
	};
	return {
		server,
		clients: state.clients.map((client) => ({ ...client, capabilities: [...client.capabilities] })),
		tabs: state.tabs.map((tab) => ({ ...tab, capabilities: [...tab.capabilities] })),
		sharedSelections: state.sharedSelections.map((selection) => ({
			...selection,
			context: selection.context ? { ...selection.context } : undefined,
			elements: selection.elements.map((element) => cloneElementDescriptor(element)),
		})),
		sharedDrawings: state.sharedDrawings.map((drawing) => ({
			...drawing,
			context: drawing.context ? { ...drawing.context } : undefined,
			boundingBox: drawing.boundingBox ? { ...drawing.boundingBox } : undefined,
			pageBoundingBox: drawing.pageBoundingBox ? { ...drawing.pageBoundingBox } : undefined,
			viewport: drawing.viewport ? { ...drawing.viewport } : undefined,
			strokes: drawing.strokes.map((stroke) => ({ ...stroke, boundingBox: stroke.boundingBox ? { ...stroke.boundingBox } : undefined, pageBoundingBox: stroke.pageBoundingBox ? { ...stroke.pageBoundingBox } : undefined, points: stroke.points.map((point) => ({ ...point })) })),
			gesture: drawing.gesture ? cloneGesture(drawing.gesture) : undefined,
			previewImage: drawing.previewImage ? { ...drawing.previewImage, crop: drawing.previewImage.crop ? { ...drawing.previewImage.crop } : undefined, imageSize: drawing.previewImage.imageSize ? { ...drawing.previewImage.imageSize } : undefined, viewport: drawing.previewImage.viewport ? { ...drawing.previewImage.viewport } : undefined, scale: drawing.previewImage.scale ? { ...drawing.previewImage.scale } : undefined } : undefined,
			nearbyElements: drawing.nearbyElements.map((element) => cloneElementDescriptor(element)),
		})),
		designPreviews: state.designPreviews.map((preview) => ({ ...preview })),
		pendingRequests: state.pendingRequests.map((request) => ({ ...request, target: request.target ? { ...request.target } : undefined })),
		previewServer: state.previewServer ? { ...state.previewServer } : undefined,
		capabilities: [...state.capabilities],
		diagnostics: [...state.diagnostics, ...server.diagnostics],
		debugLog: state.debugLog.map((entry) => ({ ...entry, data: entry.data ? { ...entry.data } : undefined })),
		createdAt: state.createdAt,
	};
}

function cloneElementDescriptor(element: BrowserElementDescriptorSummary): BrowserElementDescriptorSummary {
	return { ...element, selectorCandidates: element.selectorCandidates ? [...element.selectorCandidates] : undefined, attributes: element.attributes ? { ...element.attributes } : undefined, boundingBox: element.boundingBox ? { ...element.boundingBox } : undefined };
}

function cloneGesture(gesture: BrowserDrawingGestureSummary): BrowserDrawingGestureSummary {
	return { ...gesture, start: gesture.start ? { ...gesture.start } : undefined, end: gesture.end ? { ...gesture.end } : undefined, fromElement: gesture.fromElement ? cloneElementDescriptor(gesture.fromElement) : undefined, toElement: gesture.toElement ? cloneElementDescriptor(gesture.toElement) : undefined };
}

export function appendBrowserBridgeDebugLog(state: BrowserBridgeState, entry: Omit<BrowserBridgeDebugLogEntry, "at"> & { at?: number }, limit = 100): void {
	state.debugLog = [
		...state.debugLog,
		{
			...entry,
			at: entry.at ?? Date.now(),
			data: entry.data ? { ...entry.data } : undefined,
		},
	].slice(-limit);
}

export function formatBrowserBridgeDebugLog(entries: BrowserBridgeDebugLogEntry[], limit = 12): string[] {
	return entries.slice(-limit).map((entry) => {
		const data = entry.data && Object.keys(entry.data).length > 0 ? ` ${JSON.stringify(entry.data)}` : "";
		const message = entry.message ? ` ${entry.message}` : "";
		return `${new Date(entry.at).toISOString()} [${entry.level}] ${entry.source}:${entry.event}${message}${data}`;
	});
}

export function formatSharedSelectionSummary(selection: BrowserSharedSelectionSummary, limit = 3): string[] {
	const source = selection.source ? ` source=${selection.source}` : "";
	const lines = [`shared selection: ${selection.selectionId}${source}, ${selection.status}, ${selection.elements.length} element(s), ${selection.url ?? selection.origin ?? "unknown origin"}`];
	if (selection.userNote) lines.push(`  note: ${clipText(selection.userNote, 240)}`);
	lines.push(...formatElementList(selection.elements, limit));
	return lines;
}

export function formatSharedDrawingSummary(drawing: BrowserSharedDrawingSummary, limit = 3): string[] {
	const source = drawing.source ? ` source=${drawing.source}` : "";
	const box = drawing.boundingBox ? ` bbox ${Math.round(drawing.boundingBox.width)}x${Math.round(drawing.boundingBox.height)} at ${Math.round(drawing.boundingBox.x)},${Math.round(drawing.boundingBox.y)}` : "";
	const lines = [`shared drawing: ${drawing.drawingId}${source}, ${drawing.status}, ${drawing.strokes.length} stroke(s), ${drawing.pointCount} point(s), ${drawing.url ?? drawing.origin ?? "unknown origin"}${box}`];
	if (drawing.userNote) lines.push(`  note: ${clipText(drawing.userNote, 240)}`);
	if (drawing.previewImage?.path) lines.push(`  preview: ${drawing.previewImage.path}`);
	lines.push(...formatDrawingGeometry(drawing));
	lines.push(...formatStrokeRegions(drawing));
	if (drawing.gesture?.type) lines.push(...formatDrawingGesture(drawing.gesture));
	if (isRootOnlyDrawingTarget(drawing)) lines.push("  target: page/root area (no specific element detected)");
	if (drawing.nearbyElements.length > 0) {
		lines.push("  nearby:");
		lines.push(...formatElementList(drawing.nearbyElements, limit).map((line) => `  ${line.trimStart()}`));
	}
	return lines;
}

function formatDrawingGesture(gesture: BrowserDrawingGestureSummary): string[] {
	const lines = [`  gesture: ${gesture.type}${gesture.confidence ? ` (${gesture.confidence})` : ""}${gesture.start && gesture.end ? ` from ${Math.round(gesture.start.x)},${Math.round(gesture.start.y)} to ${Math.round(gesture.end.x)},${Math.round(gesture.end.y)}` : ""}`];
	if (gesture.fromElement) lines.push(`  from: ${formatElementDescriptor(gesture.fromElement)}`);
	if (gesture.toElement) lines.push(`  to: ${formatElementDescriptor(gesture.toElement)}`);
	return lines;
}

function formatElementList(elements: BrowserElementDescriptorSummary[], limit = 3): string[] {
	const lines = elements.slice(0, limit).map((element, index) => `  ${index + 1}. ${formatElementDescriptor(element)}`);
	if (elements.length > limit) lines.push(`  … ${elements.length - limit} more element(s)`);
	return lines;
}

function formatElementDescriptor(element: BrowserElementDescriptorSummary): string {
	const selector = element.selectorCandidates?.[0] ?? element.tagName ?? element.elementId ?? "element";
	const elementId = element.elementId && element.elementId !== selector ? ` [${element.elementId}]` : "";
	const accessible = element.accessibleName ? ` (${clipText(element.accessibleName, 80)})` : "";
	const text = element.textPreview ? ` — ${clipText(element.textPreview, 140)}` : "";
	return `${selector}${elementId}${accessible}${text}`;
}

function clipText(value: string, maxChars: number): string {
	return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function formatBrowserBridgeStatus(snapshot: BrowserBridgeSnapshot, options: { includeDiagnostics?: boolean; includeDebugLog?: boolean; debugLogLimit?: number } = {}): string {
	const status = snapshot.server.enabled ? "enabled" : "disabled";
	const listener = snapshot.server.listener;
	const port = snapshot.server.port === undefined ? "none" : String(snapshot.server.port);
	const lines = [
		`browser-bridge: ${status}`,
		`listener: ${listener} (${snapshot.server.host}, port ${port})`,
		`clients: ${snapshot.clients.length}`,
		`tabs: ${snapshot.tabs.length}`,
		`shared selections: ${snapshot.sharedSelections.length}`,
		`shared drawings: ${snapshot.sharedDrawings.length}`,
		`design previews: ${snapshot.designPreviews.length}`,
		`pending requests: ${snapshot.pendingRequests.length}`,
		`capabilities: ${snapshot.capabilities.join(", ") || "none"}`,
	];

	if (snapshot.server.pairing?.active) {
		const expires = snapshot.server.pairing.expiresAt === undefined ? "unknown" : new Date(snapshot.server.pairing.expiresAt).toISOString();
		lines.push(`pairing: active until ${expires}`);
	}

	if (snapshot.previewServer) {
		const previewPort = snapshot.previewServer.port === undefined ? "none" : String(snapshot.previewServer.port);
		lines.push(`preview server: ${snapshot.previewServer.enabled ? "enabled" : "disabled"} (${snapshot.previewServer.host}, port ${previewPort})`);
	}

	const latestSelection = snapshot.sharedSelections.at(-1);
	if (latestSelection) {
		const [summary, ...details] = formatSharedSelectionSummary(latestSelection);
		lines.push(`latest ${summary}`);
		lines.push(...details);
	}

	const latestDesignPreview = snapshot.designPreviews.at(-1);
	if (latestDesignPreview) lines.push(`latest design preview: ${latestDesignPreview.action}, ${latestDesignPreview.elementCount} element(s), ${latestDesignPreview.summary}`);

	const latestDrawing = snapshot.sharedDrawings.at(-1);
	if (latestDrawing) {
		const [summary, ...details] = formatSharedDrawingSummary(latestDrawing);
		lines.push(`latest ${summary}`);
		lines.push(...details);
	}

	if (options.includeDiagnostics !== false && snapshot.diagnostics.length > 0) {
		lines.push("diagnostics:");
		for (const diagnostic of snapshot.diagnostics) lines.push(`- ${diagnostic}`);
	}

	if (options.includeDebugLog && snapshot.debugLog.length > 0) {
		lines.push("debug log:");
		for (const entry of formatBrowserBridgeDebugLog(snapshot.debugLog, options.debugLogLimit)) lines.push(`- ${entry}`);
	}

	return lines.join("\n");
}
