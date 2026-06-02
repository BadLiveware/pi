import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCodeIntelSpecTool } from "../../pi-tool-adapter.ts";
import { fileOutlineToolSpec, repoOverviewToolSpec, repoRouteToolSpec, testMapToolSpec } from "./specs.ts";

export function registerOrientationTools(pi: ExtensionAPI): void {
	for (const spec of [repoOverviewToolSpec, fileOutlineToolSpec, repoRouteToolSpec, testMapToolSpec]) {
		registerCodeIntelSpecTool(pi, spec);
	}
}
