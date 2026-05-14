/** Register vertical-slice Stardock tools. */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerAdvisoryAdapterTool } from "../advisory-adapters.ts";
import { registerAdvisoryHandoffTool } from "../advisory-handoffs.ts";
import { registerAttemptReportTool } from "../attempt-reports.ts";
import { registerAuditorTool } from "../auditor-reviews.ts";
import { registerBreakoutTool } from "../breakout-packages.ts";
import { registerBriefTool } from "../briefs.ts";
import { registerBriefWorkerRunTool } from "../brief-worker-runs.ts";
import { registerFinalReportTool } from "../final-reports.ts";
import { formatCriterionCounts, registerLedgerTool } from "../ledger.ts";
import { registerOutsideRequestTools } from "../outside-requests.ts";
import { registerPolicyTool } from "../policy.ts";
import { registerWorkerReportTool } from "../worker-reports.ts";
import type { StardockRuntime } from "./types.ts";

export function registerFeatureTools(pi: ExtensionAPI, runtime: StardockRuntime): void {
	registerBriefTool(pi, { getCurrentLoop: () => runtime.ref.currentLoop, updateUI: runtime.updateUI, optionalLoopDetails: runtime.optionalLoopDetails });
	registerBriefWorkerRunTool(pi, { getCurrentLoop: () => runtime.ref.currentLoop, updateUI: runtime.updateUI });
	registerAdvisoryAdapterTool(pi, { getCurrentLoop: () => runtime.ref.currentLoop });
	registerAdvisoryHandoffTool(pi, { getCurrentLoop: () => runtime.ref.currentLoop, updateUI: runtime.updateUI, optionalLoopDetails: runtime.optionalLoopDetails });
	registerAuditorTool(pi, { getCurrentLoop: () => runtime.ref.currentLoop, updateUI: runtime.updateUI, optionalLoopDetails: runtime.optionalLoopDetails });
	registerBreakoutTool(pi, { getCurrentLoop: () => runtime.ref.currentLoop, updateUI: runtime.updateUI, optionalLoopDetails: runtime.optionalLoopDetails });
	registerFinalReportTool(pi, { getCurrentLoop: () => runtime.ref.currentLoop, updateUI: runtime.updateUI, optionalLoopDetails: runtime.optionalLoopDetails }, formatCriterionCounts);
	registerLedgerTool(pi, { getCurrentLoop: () => runtime.ref.currentLoop, updateUI: runtime.updateUI, optionalLoopDetails: runtime.optionalLoopDetails });
	registerPolicyTool(pi, { getCurrentLoop: () => runtime.ref.currentLoop });
	registerWorkerReportTool(pi, { getCurrentLoop: () => runtime.ref.currentLoop, updateUI: runtime.updateUI, optionalLoopDetails: runtime.optionalLoopDetails });
	registerAttemptReportTool(pi, { getCurrentLoop: () => runtime.ref.currentLoop, updateUI: runtime.updateUI });
	registerOutsideRequestTools(pi, { getCurrentLoop: () => runtime.ref.currentLoop, updateUI: runtime.updateUI });
}
