import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { recordWorkerReport } from "./worker-reports.ts";
import { compactText, type LoopState, type WorkerRun, type WorkerRunStatus } from "./state/core.ts";
import { loadState, saveState } from "./state/store.ts";

const MUTABLE_RUN_OPEN_STATUSES = new Set<WorkerRunStatus>(["running", "needs_review"]);

type ReviewStatus = "accepted" | "dismissed";

function textContent(text: string): { type: "text"; text: string } {
	return { type: "text", text };
}

export function openMutableWorkerRun(state: LoopState): WorkerRun | undefined {
	return state.workerRuns.find((run) => run.role === "implementer" && MUTABLE_RUN_OPEN_STATUSES.has(run.status));
}

export function formatWorkerRunOverview(state: LoopState): string {
	const lines = [`Worker runs for ${state.name}`, `Runs: ${state.workerRuns.length} total`];
	if (!state.workerRuns.length) return lines.join("\n");
	for (const run of state.workerRuns.slice(0, 12)) {
		const scope = run.briefId ? `brief=${run.briefId}` : run.outsideRequestId ? `request=${run.outsideRequestId}` : `scope=${run.scope ?? "loop"}`;
		lines.push(`- ${run.id} [${run.status}/${run.role}] ${scope} agent=${run.agentName}${run.model ? ` model=${run.model}` : ""}${run.reportId ? ` report=${run.reportId}` : ""}`);
		if (run.summary) lines.push(`  ${compactText(run.summary, 160)}`);
		if (run.changedFiles.length) lines.push(`  Files: ${run.changedFiles.slice(0, 4).map((file) => file.path).join(", ")}${run.changedFiles.length > 4 ? ",..." : ""}`);
		if (run.reviewRationale) lines.push(`  Review: ${compactText(run.reviewRationale, 140)}`);
	}
	if (state.workerRuns.length > 12) lines.push(`... ${state.workerRuns.length - 12} more worker runs`);
	return lines.join("\n");
}

export function updateWorkerRun(ctx: ExtensionContext, loopName: string, runId: string, update: (run: WorkerRun, state: LoopState) => void): WorkerRun | undefined {
	const state = loadState(ctx, loopName);
	if (!state) return undefined;
	const run = state.workerRuns.find((item) => item.id === runId);
	if (!run) return undefined;
	update(run, state);
	run.updatedAt = new Date().toISOString();
	saveState(ctx, state);
	return run;
}

export function reviewWorkerRun(ctx: ExtensionContext, loopName: string, params: { runId?: string; reviewStatus?: ReviewStatus; reviewRationale?: string }, updateUI: (ctx: ExtensionContext) => void) {
	const state = loadState(ctx, loopName);
	if (!state) return { content: [textContent(`Loop "${loopName}" not found.`)], details: { loopName }, isError: true };
	const run = params.runId ? state.workerRuns.find((item) => item.id === params.runId) : openMutableWorkerRun(state);
	if (!run) return { content: [textContent(params.runId ? `WorkerRun "${params.runId}" not found.` : "No open implementer WorkerRun needs review.")], details: { loopName }, isError: true };
	if (run.role !== "implementer") return { content: [textContent(`WorkerRun ${run.id} is ${run.role}; only implementer runs use review acceptance.`)], details: { loopName, run }, isError: true };
	if (run.status !== "needs_review") return { content: [textContent(`WorkerRun ${run.id} is ${run.status}; only needs_review runs can be accepted or dismissed.`)], details: { loopName, run }, isError: true };
	const status = params.reviewStatus ?? "accepted";
	run.status = status;
	run.reviewRationale = params.reviewRationale?.trim() || `${status} by parent/governor.`;
	run.updatedAt = new Date().toISOString();
	saveState(ctx, state);
	let reportError: string | undefined;
	if (run.reportId) {
		const recorded = recordWorkerReport(ctx, loopName, { id: run.reportId, status });
		if (!recorded.ok) reportError = recorded.error;
	}
	updateUI(ctx);
	const text = [`WorkerRun ${run.id} marked ${status}.`, run.reportId ? `WorkerReport ${run.reportId} marked ${status}.` : undefined, reportError ? `WorkerReport update failed: ${reportError}` : undefined].filter(Boolean).join("\n");
	return { content: [textContent(text)], details: { loopName, run, reportError }, ...(reportError ? { isError: true } : {}) };
}
