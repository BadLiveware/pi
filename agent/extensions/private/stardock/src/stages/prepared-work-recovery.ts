import type { LoopState, WorkerReport, WorkerRun } from "../state/core.ts";
import { digestExecutionNodeContract, type ExecutionAttempt, type ExecutionNode } from "./contracts.ts";
import { assertNoActiveStageWork } from "./active-work.ts";

interface PreparedWork {
	node: ExecutionNode;
	attempt: ExecutionAttempt;
	run: WorkerRun;
	report: WorkerReport;
}

/** A prepared marker is proof only with complete, exact, latest lane identity. */
export function assertStageWorkRecoverable(state: LoopState, graphId: string, stageId: string): PreparedWork[] {
	const graph = state.executionGraph;
	const stage = graph?.stages.find((item) => item.id === stageId);
	if (!graph || graph.id !== graphId || !stage) {
		assertNoActiveStageWork(state, graphId, stageId);
		return [];
	}
	const runningRuns = state.workerRuns.filter((run) => run.graphId === graphId && run.stageId === stageId && run.status === "running");
	const prepared: PreparedWork[] = [];
	let ambiguous = false;
	for (const nodeId of stage.implementationNodeIds) {
		const node = graph.nodes.find((item) => item.id === nodeId);
		if (!node) { ambiguous = true; continue; }
		const activeAttempts = node.attempts.filter((attempt) => attempt.status === "prepared" || attempt.status === "running");
		if (!["leased", "running", "reconciling"].includes(node.status) && !activeAttempts.length && !runningRuns.some((run) => run.nodeId === nodeId)) continue;
		const attempt = node.attempts.at(-1);
		const runs = state.workerRuns.filter((run) => run.id === attempt?.workerRunId);
		const reports = state.workerReports.filter((report) => report.id === attempt?.workerReportId);
		const run = runs[0];
		const report = reports[0];
		if (!attempt || activeAttempts.length !== 1 || activeAttempts[0] !== attempt
			|| !["leased", "running", "reconciling", "detached"].includes(node.status)
			|| attempt.dispatchState !== "prepared" || attempt.dispatchCommittedAt !== undefined || attempt.bridgeRunId !== undefined
			|| !attempt.worktreePath || !attempt.repositoryCommonDir || !attempt.leaseHolder || attempt.leaseDisposition !== "held"
			|| attempt.nodeContractDigest !== digestExecutionNodeContract(node) || attempt.stageContractDigest !== stage.contractDigest
			|| attempt.baseCommit !== stage.contractCommit || attempt.completedAt !== undefined
			|| runs.length !== 1 || reports.length !== 1 || !run || !report
			|| run.status !== "running" || run.role !== "implementer" || run.isolation !== "treehouse" || run.completedAt !== undefined
			|| run.graphId !== graphId || run.stageId !== stageId || run.nodeId !== node.id || run.attemptId !== attempt.id
			|| run.reportId !== report.id || run.briefId !== node.briefId
			|| run.baseCommit !== attempt.baseCommit || run.branchRef !== attempt.branchRef || run.leaseHolder !== attempt.leaseHolder
			|| report.status !== "draft" || report.role !== "implementer") {
			ambiguous = true;
			continue;
		}
		prepared.push({ node, attempt, run, report });
	}
	if (ambiguous || runningRuns.some((run) => !prepared.some((item) => item.run === run))) {
		// Keep existing refusal codes for every dispatched, legacy or contradictory active lane.
		assertNoActiveStageWork(state, graphId, stageId);
	}
	return prepared;
}

/** Called only inside dead-owner acquisition CAS; never returns or erases a lease. */
export function settleNeverDispatchedStageWork(state: LoopState, graphId: string, stageId: string, now: string): string[] {
	const prepared = assertStageWorkRecoverable(state, graphId, stageId);
	for (const { node, attempt, run, report } of prepared) {
		const summary = `Recovered attempt "${attempt.id}" after confirmed owner death before dispatch. No worker was invoked; workspace lease is preserved for governor review and exact resource inspection.`;
		node.status = "failed";
		attempt.status = "failed";
		attempt.completedAt = now;
		attempt.leaseDisposition = "preserved";
		(attempt.violations ??= []).push(summary);
		run.status = "failed";
		run.summary = summary;
		run.completedAt = now;
		run.updatedAt = now;
		report.status = "needs_review";
		report.summary = summary;
		report.risks.push("No worker evidence exists. The retained lease has not been inspected or returned.");
		report.updatedAt = now;
	}
	if (prepared.length) {
		state.executionGraph!.stages.find((stage) => stage.id === stageId)!.status = "failed";
		state.executionGraph!.status = "blocked";
	}
	assertNoActiveStageWork(state, graphId, stageId);
	return prepared.map((item) => item.attempt.id);
}
