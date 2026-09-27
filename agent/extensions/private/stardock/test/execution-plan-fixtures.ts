import type { ExecutionPlanInput } from "../src/execution-plan/contracts.ts";
import { mutateState } from "../src/state/store.ts";

export function fanoutPlan(): ExecutionPlanInput {
	return {
		id: "auth-redesign",
		objective: "Redesign authentication",
		constraints: ["Preserve token format"],
		maxConcurrency: 3,
		defaultMaxAttempts: 2,
		integrationValidationCommands: ["npm test", "npm run typecheck"],
		nodes: [
			{
				id: "interfaces",
				kind: "prerequisite",
				objective: "Freeze interfaces",
				task: "Introduce the shared authentication interfaces.",
				acceptanceCriteria: ["Shared authentication interfaces compile and pass their contract tests."],
				writes: ["src/auth/contracts"],
				validationCommands: ["npm test -- auth-contracts"],
			},
			{
				id: "api",
				objective: "Implement API changes",
				task: "Use the shared interfaces in the API.",
				acceptanceCriteria: ["The API uses the shared interfaces and its focused tests pass."],
				dependsOn: ["interfaces"],
				writes: ["src/api"],
				validationCommands: ["npm test -- api"],
			},
			{
				id: "storage",
				objective: "Implement storage changes",
				task: "Use the shared interfaces in storage.",
				acceptanceCriteria: ["Storage uses the shared interfaces and its focused tests pass."],
				dependsOn: ["interfaces"],
				writes: ["src/storage"],
				validationCommands: ["npm test -- storage"],
			},
			{
				id: "ui",
				objective: "Implement UI changes",
				task: "Use the shared interfaces in the UI.",
				acceptanceCriteria: ["The UI uses the shared interfaces and its focused tests pass."],
				dependsOn: ["interfaces"],
				writes: ["src/ui"],
				validationCommands: ["npm test -- ui"],
			},
		],
	};
}

export function seedReviewWave(ctx: any, loopName: string, validationResult: "passed" | "failed" = "passed"): string[] {
	const now = "2026-01-01T00:00:00.000Z";
	const state = mutateState(ctx, loopName, (candidate) => {
		const plan = candidate.executionPlan!;
		const graph = candidate.executionGraph!;
		const wave = plan.waves.at(-1)!;
		wave.status = "review";
		const stage = graph.stages.find((item) => item.id === wave.stageId)!;
		stage.status = "running";
		for (const [index, planNodeId] of wave.nodeIds.entries()) {
			const planNode = plan.nodes.find((item) => item.id === planNodeId)!;
			const executionNode = graph.nodes.find((item) => item.id === planNode.currentExecutionNodeId)!;
			const runId = `review-run-${index + 1}`;
			const reportId = `review-report-${index + 1}`;
			planNode.status = "needs_review";
			planNode.currentWorkerRunId = runId;
			executionNode.status = "needs_review";
			executionNode.attempts.push({
				id: `review-attempt-${index + 1}`,
				workerRunId: runId,
				workerReportId: reportId,
				baseCommit: stage.contractCommit,
				branchRef: `lane-${index + 1}`,
				laneCommits: [String(index + 1).repeat(40)],
				validation: [{ command: planNode.validationCommands[0] ?? "optional check", result: validationResult, summary: validationResult }],
				status: "needs_review",
				startedAt: now,
				completedAt: now,
			});
			candidate.workerRuns.push({
				id: runId,
				role: "implementer",
				status: "needs_review",
				scope: "brief",
				briefId: planNode.briefId,
				graphId: graph.id,
				stageId: stage.id,
				nodeId: executionNode.id,
				attemptId: `review-attempt-${index + 1}`,
				isolation: "treehouse",
				requestId: `request-${index + 1}`,
				agentName: "implementer",
				context: "fresh",
				outputMode: "file-only",
				reportId,
				outputRefs: [],
				changedFiles: [],
				allowDirtyWorkspace: false,
				startedAt: now,
				completedAt: now,
				updatedAt: now,
			});
			candidate.workerReports.push({
				id: reportId,
				status: "needs_review",
				role: "implementer",
				objective: planNode.objective,
				summary: "implemented",
				advisoryHandoffIds: [],
				evaluatedCriterionIds: [planNode.criterionId],
				artifactIds: [],
				changedFiles: [],
				validation: [{ command: planNode.validationCommands[0] ?? "optional check", result: validationResult, summary: validationResult }],
				risks: [],
				openQuestions: [],
				reviewHints: [],
				createdAt: now,
				updatedAt: now,
			});
		}
		plan.status = "review";
	});
	return state.executionPlan!.nodes.filter((node) => node.status === "needs_review").map((node) => node.currentWorkerRunId!);
}
