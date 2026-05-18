import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBrowserBridgeRuntime } from "./src/core/state.ts";
import { registerBrowserBridgeCommands } from "./src/slices/commands/commands.ts";
import { registerBrowserBridgeStateTool } from "./src/slices/state-tool/tool.ts";

export default function browserBridge(pi: ExtensionAPI): void {
	const runtime = createBrowserBridgeRuntime();

	registerBrowserBridgeCommands(pi, runtime);
	registerBrowserBridgeStateTool(pi, runtime);
}
