import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { BrowserBridgeServer } from "./src/bridge-server/lifecycle.ts";
import { createBrowserBridgeRuntime, formatSharedDrawingSummary, formatSharedSelectionSummary } from "./src/core/state.ts";
import { PreviewServer } from "./src/preview/server.ts";
import { registerClipboardTool } from "./src/slices/clipboard/tool.ts";
import { registerBrowserBridgeCommands } from "./src/slices/commands/commands.ts";
import { registerInteractTool } from "./src/slices/interact/tool.ts";
import { registerOpenPreviewTool } from "./src/slices/open-preview/tool.ts";
import { registerOverlayTool } from "./src/slices/overlay/tool.ts";
import { registerSelectElementsTool } from "./src/slices/select-elements/tool.ts";
import { registerBrowserBridgeStateTool } from "./src/slices/state-tool/tool.ts";

export default function browserBridge(pi: ExtensionAPI): void {
	const runtime = createBrowserBridgeRuntime();
	const server = new BrowserBridgeServer(runtime.state, {
		onSharedSelection(selection) {
			pi.sendMessage({
				customType: "browser-bridge.shared-selection",
				content: formatSharedSelectionSummary(selection).join("\n"),
				display: true,
				details: selection,
			}, { deliverAs: "steer" });
		},
		onSharedDrawing(drawing) {
			pi.sendMessage({
				customType: "browser-bridge.shared-drawing",
				content: formatSharedDrawingSummary(drawing).join("\n"),
				display: true,
				details: drawing,
			}, { deliverAs: "steer" });
		},
	});
	const previewServer = new PreviewServer(runtime.state);

	pi.on("session_shutdown", async () => {
		await previewServer.stop();
		await server.stop("Bridge stopped because the Pi session shut down.");
	});

	registerBrowserBridgeCommands(pi, runtime, server);
	registerBrowserBridgeStateTool(pi, runtime);
	registerSelectElementsTool(pi, runtime, server);
	registerOverlayTool(pi, runtime, server);
	registerOpenPreviewTool(pi, runtime, server, previewServer);
	registerInteractTool(pi, runtime, server);
	registerClipboardTool(pi, runtime, server);
}
