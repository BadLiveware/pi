import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { nextSequentialId, type WorkerReport, type WorkerRun } from "../state/core.ts";
import { mutateState } from "../state/store.ts";
import { digestExecutionNodeContract, type ExecutionAttempt, type ExecutionNode } from "./contracts.ts";
import { readyExecutionNodeIds } from "./graph.ts";
import type { RunReadyAdapter, RunReadyRequest } from "./run-ready.ts";
import type { PartialTreehouseLease, TreehouseLease } from "./treehouse-adapter.ts";

export interface PreparedLane {
	nodeId: string;
	briefId: string;
	attemptId: string;
	workerRunId: string;
	workerReportId: string;
	requestId: string;
	outputPath: string;
	lease: TreehouseLease;
	attempt: ExecutionAttempt;
}

function placeholderReport(id: string, node: ExecutionNode, now: string): WorkerReport {
	return {
		id,
		status: "draft",
		role: "implementer",
		objective: `Execution node ${node.id}: ${node.objective}`,
		summary: "Treehouse lane is prepared; worker result has not settled yet.",
		advisoryHandoffIds: [],
		evaluatedCriterionIds: [],
		artifactIds: [],
		changedFiles: [],
		validation: [],
		risks: [],
		openQuestions: [],
		reviewHints: ["Stage lane awaits an explicit governor accept or dismiss decision by WorkerRun id."],
		createdAt: now,
		updatedAt: now,
	};
}

export function precreateLane(
	ctx: ExtensionContext,
	request: RunReadyRequest,
	node: ExecutionNode,
	lease: TreehouseLease,
	attemptId: string,
	requestId: string,
	outputPath: string,
	now: string,
): PreparedLane {
	let prepared: PreparedLane | undefined;
	mutateState(ctx, request.loopName, (state) => {
		const graph = state.executionGraph;
		const current = graph?.nodes.find((candidate) => candidate.id === node.id);
		const stage = graph?.stages.find((candidate) => candidate.id === request.stageId);
		if (!graph || graph.id !== request.graphId || !stage || !current || !readyExecutionNodeIds(graph).includes(current.id)) throw new Error(`Node "${node.id}" changed before lane persistence.`);
		const workerRunId = nextSequentialId("run", state.workerRuns);
		const workerReportId = nextSequentialId("wr", state.workerReports);
		const attempt: ExecutionAttempt = {
			id: attemptId,
			workerRunId,
			workerReportId,
			nodeContractDigest: digestExecutionNodeContract(current),
			stageContractDigest: stage.contractDigest,
			writes: [...current.writes],
			resourceClaims: structuredClone(current.resourceClaims),
			validationCommands: [...current.validationCommands],
			baseCommit: lease.contractCommit,
			branchRef: lease.branchRef,
			laneCommits: [],
			worktreePath: lease.worktreePath,
			repositoryCommonDir: lease.repositoryCommonDir,
			leaseHolder: lease.leaseHolder,
			leaseDisposition: "held",
			changedPaths: [],
			violations: [],
			validation: [],
			status: "prepared",
			startedAt: now,
		};
		const run: WorkerRun = {
			id: workerRunId,
			role: "implementer",
			status: "running",
			scope: "brief",
			briefId: current.briefId,
			graphId: graph.id,
			stageId: request.stageId,
			nodeId: current.id,
			attemptId,
			isolation: "treehouse",
			baseCommit: lease.contractCommit,
			branchRef: lease.branchRef,
			leaseHolder: lease.leaseHolder,
			requestId,
			agentName: "implementer",
			context: "fresh",
			outputMode: "file-only",
			outputPath,
			reportId: workerReportId,
			outputRefs: [],
			changedFiles: [],
			expectedMutation: false,
			allowDirtyWorkspace: false,
			startedAt: now,
			updatedAt: now,
		};
		current.status = "leased";
		current.attempts.push(attempt);
		state.workerRuns.push(run);
		state.workerReports.push(placeholderReport(workerReportId, current, now));
		prepared = { nodeId: current.id, briefId: current.briefId as string, attemptId, workerRunId, workerReportId, requestId, outputPath, lease, attempt };
	});
	if (!prepared) throw new Error(`Failed to persist lane "${node.id}".`);
	return prepared;
}

export function mutatePreparedLanes(
	ctx: ExtensionContext,
	request: RunReadyRequest,
	prepared: PreparedLane[],
	update: (node: ExecutionNode, attempt: ExecutionAttempt, run: WorkerRun, report: WorkerReport) => void,
): void {
	mutateState(ctx, request.loopName, (state) => {
		const graph = state.executionGraph;
		if (!graph || graph.id !== request.graphId) throw new Error("Execution graph disappeared during lane mutation.");
		for (const lane of prepared) {
			const node = graph.nodes.find((candidate) => candidate.id === lane.nodeId);
			const attempt = node?.attempts.find((candidate) => candidate.id === lane.attemptId);
			const run = state.workerRuns.find((candidate) => candidate.id === lane.workerRunId);
			const report = state.workerReports.find((candidate) => candidate.id === lane.workerReportId);
			if (!node || !attempt || !run || !report) throw new Error(`Stable lane evidence disappeared for "${lane.nodeId}".`);
			update(node, attempt, run, report);
		}
	});
}

export function recordSetupFailure(
	ctx: ExtensionContext,
	request: RunReadyRequest,
	nodeId: string,
	attemptId: string,
	leaseHolder: string,
	lease: PartialTreehouseLease | undefined,
	status: "failed" | "detached",
	error: string,
	now: string,
): void {
	mutateState(ctx, request.loopName, (state) => {
		const graph = state.executionGraph;
		const node = graph?.nodes.find((candidate) => candidate.id === nodeId);
		const stage = graph?.stages.find((candidate) => candidate.id === request.stageId);
		if (!graph || graph.id !== request.graphId || !node || !stage) throw new Error(`Setup failure identity disappeared for node "${nodeId}".`);
		if (node.attempts.some((attempt) => attempt.id === attemptId)) throw new Error(`Setup failure attempt "${attemptId}" already exists.`);
		const failedAttempt: ExecutionAttempt = {
			id: attemptId,
			nodeContractDigest: digestExecutionNodeContract(node),
			stageContractDigest: stage.contractDigest,
			writes: [...node.writes],
			resourceClaims: structuredClone(node.resourceClaims),
			validationCommands: [...node.validationCommands],
			baseCommit: stage.contractCommit,
			branchRef: lease?.branchRef ?? `unanchored/${attemptId}`,
			laneCommits: [],
			worktreePath: lease?.worktreePath,
			repositoryCommonDir: lease?.repositoryCommonDir,
			leaseHolder,
			changedPaths: [],
			violations: [error],
			validation: [],
			status,
			startedAt: now,
			completedAt: now,
		};
		if (lease) failedAttempt.leaseDisposition = "preserved";
		node.attempts.push(failedAttempt);
		node.status = status;
	});
}

export async function returnLeaseWithDeadline(
	adapter: RunReadyAdapter,
	lease: TreehouseLease,
	timeoutMs: number,
): Promise<{ returned: boolean; error?: string }> {
	const controller = new AbortController();
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<{ returned: boolean; error: string }>((resolve) => {
		timeout = setTimeout(() => {
			controller.abort(new Error(`Treehouse lease cleanup timed out after ${timeoutMs}ms.`));
			resolve({ returned: false, error: `Treehouse lease cleanup timed out after ${timeoutMs}ms; preserve the lease for reconciliation.` });
		}, timeoutMs);
	});
	const cleanup = adapter.returnLease({ lease, expectedHeadCommit: lease.contractCommit, signal: controller.signal }).then(
		() => ({ returned: true }),
		(error: unknown) => {
			let message = String(error);
			if (error instanceof Error) message = error.message;
			return { returned: false, error: message };
		},
	);
	const result = await Promise.race([cleanup, deadline]);
	if (timeout) clearTimeout(timeout);
	return result;
}

export async function settleSetupFailure(
	ctx: ExtensionContext,
	request: RunReadyRequest,
	prepared: PreparedLane[],
	adapter: RunReadyAdapter,
	error: string,
	now: string,
	cleanupTimeoutMs: number,
	preserveNodeIds: ReadonlySet<string> = new Set(),
): Promise<void> {
	for (const lane of prepared) {
		let returned = false;
		let cleanupError: string | undefined;
		if (preserveNodeIds.has(lane.nodeId)) {
			cleanupError = "Ambiguous duplicate lease identity was preserved for reconciliation.";
		} else {
			const cleanup = await returnLeaseWithDeadline(adapter, lane.lease, cleanupTimeoutMs);
			returned = cleanup.returned;
			cleanupError = cleanup.error;
		}
		mutatePreparedLanes(ctx, request, [lane], (node, attempt, run, report) => {
			if (returned) {
				attempt.status = "failed";
				attempt.leaseDisposition = "released";
				node.status = "retry_ready";
				run.status = "failed";
			} else {
				attempt.status = "detached";
				attempt.leaseDisposition = "preserved";
				node.status = "detached";
				run.status = "cancelled";
			}
			(attempt.violations ??= []).push(error);
			if (cleanupError) (attempt.violations ??= []).push(cleanupError);
			attempt.completedAt = now;
			run.summary = error;
			run.completedAt = now;
			run.updatedAt = now;
			report.status = "needs_review";
			report.summary = error;
			report.risks = [];
			if (!returned) report.risks.push(cleanupError ?? "Lease could not be proven clean and unused; it was preserved.");
			report.updatedAt = now;
		});
	}
	mutateState(ctx, request.loopName, (state) => {
		const graph = state.executionGraph;
		const stage = graph?.stages.find((candidate) => candidate.id === request.stageId);
		if (stage) {
			const detached = stage.implementationNodeIds.some((nodeId) => graph?.nodes.find((node) => node.id === nodeId)?.status === "detached");
			stage.status = "failed";
			if (detached) stage.status = "detached";
		}
		if (graph) graph.status = "blocked";
	});
}
