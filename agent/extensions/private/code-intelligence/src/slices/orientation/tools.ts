import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fileOutlineToolSpec, repoOverviewToolSpec, repoRouteToolSpec, testMapToolSpec } from "code-intel/pi-integration";
import { registerCodeIntelSpecTool } from "../../pi-tool-adapter.ts";

export function registerOrientationTools(pi: ExtensionAPI): void {
	for (const spec of [repoOverviewToolSpec, fileOutlineToolSpec, repoRouteToolSpec, testMapToolSpec]) {
		registerCodeIntelSpecTool(pi, spec);
	}
}
