import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerImpactMapTool } from "./src/slices/impact-map/tool.ts";
import { registerLocalMapTool } from "./src/slices/local-map/tool.ts";
import { registerOrientationTools } from "./src/slices/orientation/tools.ts";
import { registerStateTool, refreshFooterStatus } from "./src/slices/state/tool.ts";
import { registerSyntaxSearchTool } from "./src/slices/syntax-search/tool.ts";
import { registerTargetedContextTools } from "./src/slices/targeted-symbols/tools.ts";
import { clearTouchedFilesForContext, recordTouchedFileFromToolResult } from "./src/slices/post-edit-map/touched-files.ts";
import { recordUsageToolCall, recordUsageToolResult } from "./src/slices/usage/usage.ts";

const extensionDir = path.dirname(fileURLToPath(import.meta.url));

export default function codeIntelligence(pi: ExtensionAPI): void {
	pi.on("resources_discover", async () => ({ skillPaths: [path.join(extensionDir, "skills")] }));
	pi.on("tool_call", (event, ctx) => recordUsageToolCall(event, ctx));
	pi.on("tool_result", (event, ctx) => {
		recordUsageToolResult(event, ctx);
		recordTouchedFileFromToolResult(event, ctx);
	});
	pi.on("session_shutdown", (_event, ctx) => clearTouchedFilesForContext(ctx));
	pi.on("session_start", (_event, ctx) => {
		setTimeout(() => {
			void refreshFooterStatus(ctx);
		}, 0);
	});
	registerStateTool(pi);
	registerOrientationTools(pi);
	registerLocalMapTool(pi);
	registerImpactMapTool(pi);
	registerSyntaxSearchTool(pi);
	registerTargetedContextTools(pi);
}
