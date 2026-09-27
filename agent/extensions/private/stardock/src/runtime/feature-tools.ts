/** Register vertical-slice Stardock tools. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAdvisoryAdapterTool } from "../advisory-adapters.ts";
import { registerAdvisoryHandoffTool } from "../advisory-handoffs.ts";
import { registerAttemptReportTool } from "../attempt-reports.ts";
import { registerAuditorTool } from "../auditor-reviews.ts";
import { registerBreakoutTool } from "../breakout-packages.ts";
import { registerBriefTool } from "../briefs.ts";
import { registerBriefWorkerRunTool } from "../brief-worker-runs.ts";
import { registerExecutionPlanIntegrateTool } from "../execution-plan/integrate-tool.ts";
import { registerExecutionPlanReviewTool } from "../execution-plan/review-tool.ts";
import { registerExecutionPlanRunTool } from "../execution-plan/run-tool.ts";
import { registerExecutionPlanTools } from "../execution-plan/tools.ts";
import { registerFinalReportTool } from "../final-reports.ts";
import { registerGovernorStateTool } from "../governor-state.ts";
import { formatCriterionCounts, registerLedgerTool } from "../ledger.ts";
import { registerOutsideRequestTools } from "../outside-requests.ts";
import { registerPolicyTool } from "../policy.ts";
import { registerStardockWorkerTool } from "../stardock-worker-tool.ts";
import { registerWorkerReportTool } from "../worker-reports.ts";
import { registerStageTool } from "../stages/tool.ts";
import type { StardockRuntime } from "./types.ts";

export function registerFeatureTools(pi: ExtensionAPI, runtime: StardockRuntime): void {
	registerExecutionPlanTools(pi, runtime);
	registerExecutionPlanRunTool(pi, runtime);
	registerExecutionPlanReviewTool(pi, runtime);
	registerExecutionPlanIntegrateTool(pi, runtime);
	registerBriefTool(pi, { getCurrentLoop: () => runtime.ref.currentLoop, updateUI: runtime.updateUI, optionalLoopDetails: runtime.optionalLoopDetails });
	registerBriefWorkerRunTool(pi, { getCurrentLoop: () => runtime.ref.currentLoop, updateUI: runtime.updateUI });
	registerStardockWorkerTool(pi, { getCurrentLoop: () => runtime.ref.currentLoop, updateUI: runtime.updateUI });
	registerAdvisoryAdapterTool(pi, { getCurrentLoop: () => runtime.ref.currentLoop });
	registerAdvisoryHandoffTool(pi, { getCurrentLoop: () => runtime.ref.currentLoop, updateUI: runtime.updateUI, optionalLoopDetails: runtime.optionalLoopDetails });
	registerAuditorTool(pi, { getCurrentLoop: () => runtime.ref.currentLoop, updateUI: runtime.updateUI, optionalLoopDetails: runtime.optionalLoopDetails });
	registerBreakoutTool(pi, { getCurrentLoop: () => runtime.ref.currentLoop, updateUI: runtime.updateUI, optionalLoopDetails: runtime.optionalLoopDetails });
	registerFinalReportTool(pi, { getCurrentLoop: () => runtime.ref.currentLoop, updateUI: runtime.updateUI, optionalLoopDetails: runtime.optionalLoopDetails }, formatCriterionCounts);
	registerGovernorStateTool(pi, { getCurrentLoop: () => runtime.ref.currentLoop, updateUI: runtime.updateUI });
	registerLedgerTool(pi, { getCurrentLoop: () => runtime.ref.currentLoop, updateUI: runtime.updateUI, optionalLoopDetails: runtime.optionalLoopDetails });
	registerPolicyTool(pi, { getCurrentLoop: () => runtime.ref.currentLoop });
	registerWorkerReportTool(pi, { getCurrentLoop: () => runtime.ref.currentLoop, updateUI: runtime.updateUI, optionalLoopDetails: runtime.optionalLoopDetails });
	registerAttemptReportTool(pi, { getCurrentLoop: () => runtime.ref.currentLoop, updateUI: runtime.updateUI });
	registerOutsideRequestTools(pi, { getCurrentLoop: () => runtime.ref.currentLoop, updateUI: runtime.updateUI });
	registerStageTool(pi, runtime);
}
