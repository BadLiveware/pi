import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	insertRelativeToolSpec,
	postEditMapToolSpec,
	readSymbolToolSpec,
	replaceSymbolToolSpec,
	resolveRepoRootsFromCwd,
	type CodeIntelEnv,
	type CodeIntelPostEditMapParams,
	type CodeIntelToolResult,
} from "code-intel/pi-integration";
import { registerCodeIntelSpecTool } from "../../pi-tool-adapter.ts";
import { recentTouchedFilesForContext } from "../post-edit-map/touched-files.ts";

const trackedTouchedFilesMarker = "__trackedTouchedFiles";

async function preparePostEditParams(params: CodeIntelPostEditMapParams, ctx: ExtensionContext, _env: CodeIntelEnv): Promise<CodeIntelPostEditMapParams> {
	const useTrackedTouchedFiles = params.changedFiles === undefined && params.baseRef === undefined;
	if (!useTrackedTouchedFiles) return params;
	const roots = await resolveRepoRootsFromCwd(ctx.cwd, params.repoRoot);
	const trackedChangedFiles = recentTouchedFilesForContext(ctx, roots.repoRoot);
	return trackedChangedFiles.length > 0 ? { ...params, changedFiles: trackedChangedFiles, [trackedTouchedFilesMarker]: true } as CodeIntelPostEditMapParams : params;
}

function annotateTrackedPostEditResult(result: CodeIntelToolResult, params: CodeIntelPostEditMapParams): void {
	if ((params as Record<string, unknown>)[trackedTouchedFilesMarker] === true) result.details.touchedFileSource = "session-tracker";
}

export function registerTargetedContextTools(pi: ExtensionAPI): void {
	registerCodeIntelSpecTool(pi, readSymbolToolSpec);
	registerCodeIntelSpecTool(pi, replaceSymbolToolSpec);
	registerCodeIntelSpecTool(pi, insertRelativeToolSpec);
	registerCodeIntelSpecTool(pi, postEditMapToolSpec, {
		prepareParams: preparePostEditParams,
		afterResult: annotateTrackedPostEditResult,
	});
}
