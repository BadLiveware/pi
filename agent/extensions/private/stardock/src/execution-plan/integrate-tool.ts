import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { StardockRuntime } from "../runtime/types.ts";
import { nextSequentialId, type FinalVerificationReport, type VerificationArtifact } from "../state/core.ts";
import { loadState, mutateState } from "../state/store.ts";
import type { ArgumentCommandPlan, IntegrationPlanResult } from "../stages/integration.ts";
import { createIntegrationPlan, prepareIntegration, recordIntegrated, reissuePreparedIntegrationToken } from "../stages/integration.ts";
import { releaseStage } from "../stages/reconcile.ts";
import type { RunReadyAdapter } from "../stages/run-ready.ts";
import { DefaultStageGitAdapter, type StageGitAdapter } from "../stages/stage-git-adapter.ts";
import { refreshExecutionPlan, summarizeExecutionPlan } from "./graph.ts";

interface ExecutionPlanIntegrateParams {
	name?: string;
}

interface CommandResult {
	code: number;
	stdout: string;
	stderr: string;
}

export interface ExecutionPlanIntegrateDependencies {
	gitAdapter?: StageGitAdapter;
	leaseAdapter?: RunReadyAdapter;
	runCommand?: (command: ArgumentCommandPlan, signal?: AbortSignal) => Promise<CommandResult>;
	createPlan?: typeof createIntegrationPlan;
	prepare?: typeof prepareIntegration;
	record?: typeof recordIntegrated;
	reissue?: typeof reissuePreparedIntegrationToken;
	release?: typeof releaseStage;
}

function compactOutput(result: CommandResult): string {
	return (result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`).slice(0, 500);
}

async function executeCommands(commands: ArgumentCommandPlan[], run: (command: ArgumentCommandPlan, signal?: AbortSignal) => Promise<CommandResult>, signal?: AbortSignal): Promise<void> {
	for (const command of commands) {
		signal?.throwIfAborted();
		const result = await run(command, signal);
		if (result.code !== 0) throw new Error(`${command.command} ${command.args.join(" ")} failed: ${compactOutput(result)}`);
	}
}

interface IntegrationBranchRecovery {
	found: boolean;
	cleaned: boolean;
	reason: string;
}

function acceptedLaneHeads(active: ReturnType<typeof activeWaveState>): string[] {
	return active.stage.integrationOrder.map((nodeId) => {
		const node = active.graph.nodes.find((candidate) => candidate.id === nodeId);
		const runs = active.state.workerRuns.filter((run) => run.graphId === active.graph.id && run.stageId === active.stage.id && run.nodeId === nodeId && run.status === "accepted");
		if (!node || runs.length !== 1) throw new Error(`Cannot classify stale integration branch: lane "${nodeId}" lacks exactly one accepted WorkerRun.`);
		const attempt = node.attempts.find((candidate) => candidate.id === runs[0].attemptId);
		if (!attempt?.headCommit) throw new Error(`Cannot classify stale integration branch: lane "${nodeId}" lacks an exact accepted head.`);
		return attempt.headCommit;
	});
}

async function recoverGeneratedIntegrationBranch(
	active: ReturnType<typeof activeWaveState>,
	cwd: string,
	git: StageGitAdapter,
	run: (command: ArgumentCommandPlan, signal?: AbortSignal) => Promise<CommandResult>,
): Promise<IntegrationBranchRecovery> {
	const branch = active.stage.integrationBranch;
	const actualBranchHead = await git.resolveBranch(cwd, branch);
	if (!actualBranchHead) return { found: false, cleaned: false, reason: "No stale integration branch exists." };
	const parentHead = await git.resolveBranch(cwd, active.stage.parentBranch);
	if (parentHead !== active.stage.integrationBaseCommit) return { found: true, cleaned: false, reason: `Parent ${active.stage.parentBranch} moved from ${active.stage.integrationBaseCommit}; preserved ${branch}.` };
	const inspection = await git.inspectWorktree(cwd);
	if (!inspection.clean) return { found: true, cleaned: false, reason: `Worktree is dirty or conflicted; preserved ${branch}.` };
	const parentRef = `refs/heads/${active.stage.parentBranch}`;
	const integrationRef = `refs/heads/${branch}`;
	if (inspection.branchRef !== parentRef && inspection.branchRef !== integrationRef) return { found: true, cleaned: false, reason: `Current branch is ${inspection.branchRef ?? "detached"}; preserved ${branch}.` };
	const laneHeads = acceptedLaneHeads(active);
	const commits = await git.firstParentCommits(cwd, active.stage.integrationBaseCommit, actualBranchHead);
	if (commits.length === 0) return { found: true, cleaned: false, reason: `Integration branch has no generated merge commit proving provenance; preserved ${branch}.` };
	if (commits.length > laneHeads.length) return { found: true, cleaned: false, reason: `Integration branch has ${commits.length} first-parent commits for ${laneHeads.length} lanes; preserved ${branch}.` };
	let previous = active.stage.integrationBaseCommit;
	for (let index = 0; index < commits.length; index++) {
		const parents = await git.commitParents(cwd, commits[index]);
		if (parents.length !== 2 || parents[0] !== previous || parents[1] !== laneHeads[index]) {
			return { found: true, cleaned: false, reason: `Integration branch commit ${commits[index]} is not the expected generated merge prefix; preserved ${branch}.` };
		}
		previous = commits[index];
	}
	if (previous !== actualBranchHead) return { found: true, cleaned: false, reason: `Integration branch head is not the verified generated merge prefix; preserved ${branch}.` };
	if (inspection.branchRef === integrationRef) {
		const switched = await run({ command: "git", args: ["-C", cwd, "switch", active.stage.parentBranch], cwd });
		if (switched.code !== 0) return { found: true, cleaned: false, reason: `Could not return to ${active.stage.parentBranch}: ${compactOutput(switched)}; preserved ${branch}.` };
	}
	const removed = await run({ command: "git", args: ["-C", cwd, "branch", "-D", branch], cwd });
	if (removed.code !== 0) return { found: true, cleaned: false, reason: `Could not remove verified generated branch ${branch}: ${compactOutput(removed)}.` };
	return { found: true, cleaned: true, reason: `Removed verified generated integration branch ${branch}.` };
}

function activeWaveState(ctx: ExtensionContext, loopName: string) {
	const state = loadState(ctx, loopName);
	const plan = state?.executionPlan;
	const wave = [...(plan?.waves ?? [])].reverse().find((item) => item.status === "integrating");
	const graph = state?.executionGraph;
	const stage = graph?.stages.find((candidate) => candidate.id === wave?.stageId);
	if (!state || !plan || !wave || !graph || !stage) throw new Error("No accepted execution wave is ready for integration.");
	return { state, plan, wave, graph, stage };
}

function finalizeExecutionPlanWave(ctx: ExtensionContext, loopName: string, waveId: string, validation: Array<{ command: string; result: "passed"; summary: string }>) {
	const now = new Date().toISOString();
	const saved = mutateState(ctx, loopName, (state) => {
		const plan = state.executionPlan!;
		const wave = plan.waves.find((item) => item.id === waveId)!;
		wave.status = "integrated";
		wave.integratedAt = now;
		const waveNodes = plan.nodes.filter((node) => node.currentWaveId === wave.id);
		for (const node of waveNodes) node.status = "integrated";
		const criterionIds = waveNodes.map((node) => node.criterionId);
		const artifactIds: string[] = [];
		for (const record of validation) {
			const artifact: VerificationArtifact = {
				id: nextSequentialId("artifact", state.verificationArtifacts),
				kind: "test",
				command: record.command,
				summary: record.summary,
				criterionIds,
				createdAt: now,
			};
			state.verificationArtifacts.push(artifact);
			artifactIds.push(artifact.id);
		}
		plan.revision += 1;
		plan.updatedAt = now;
		refreshExecutionPlan(plan);
		if (plan.status === "completed") {
			const report: FinalVerificationReport = {
				id: `plan:${plan.id}:final`,
				status: "passed",
				summary: `All ${plan.nodes.length} execution-plan nodes were integrated with passing declared validation.`,
				criterionIds: plan.nodes.map((node) => node.criterionId),
				artifactIds: state.verificationArtifacts.filter((artifact) => artifact.criterionIds?.some((criterionId) => plan.nodes.some((node) => node.criterionId === criterionId)) === true).map((artifact) => artifact.id),
				validation: validation.map((record) => ({ ...record })),
				unresolvedGaps: [],
				compatibilityNotes: [],
				securityNotes: [],
				performanceNotes: [],
				createdAt: now,
				updatedAt: now,
			};
			const index = state.finalVerificationReports.findIndex((item) => item.id === report.id);
			if (index >= 0) state.finalVerificationReports[index] = report;
			else state.finalVerificationReports.push(report);
		}
	});
	return summarizeExecutionPlan(saved.executionPlan!);
}

function recordIntegrationRecovery(ctx: ExtensionContext, loopName: string, summary: string): void {
	try {
		mutateState(ctx, loopName, (state) => {
			const plan = state.executionPlan;
			if (!plan) return;
			const wave = [...plan.waves].reverse().find((item) => item.status === "integrating");
			plan.decisions.push({ kind: "integration_recovery", summary, nodeIds: wave?.nodeIds ?? [], createdAt: new Date().toISOString() });
			plan.revision += 1;
			plan.updatedAt = new Date().toISOString();
		});
	} catch {
		// Preserve the original integration failure when ownership evidence itself blocks recording.
	}
}

export async function executeExecutionPlanIntegrate(
	pi: ExtensionAPI,
	runtime: StardockRuntime,
	params: ExecutionPlanIntegrateParams,
	signal: AbortSignal | undefined,
	ctx: ExtensionContext,
	dependencies: ExecutionPlanIntegrateDependencies = {},
) {
	const loopName = params.name ?? runtime.ref.currentLoop;
	if (!loopName) return { content: [{ type: "text" as const, text: "No active Stardock execution plan." }], details: {} };
	const git = dependencies.gitAdapter ?? new DefaultStageGitAdapter();
	const run = dependencies.runCommand ?? (async (command: ArgumentCommandPlan, commandSignal?: AbortSignal) => {
		const result = await pi.exec(command.command, command.args, { cwd: command.cwd, signal: commandSignal });
		return { code: result.code, stdout: result.stdout, stderr: result.stderr };
	});
	const planIntegration = dependencies.createPlan ?? createIntegrationPlan;
	const prepare = dependencies.prepare ?? prepareIntegration;
	const record = dependencies.record ?? recordIntegrated;
	const reissue = dependencies.reissue ?? reissuePreparedIntegrationToken;
	const release = dependencies.release ?? releaseStage;
	let integrationPlan: IntegrationPlanResult | undefined;
	let activeContext: ReturnType<typeof activeWaveState> | undefined;
	let prepared = false;
	try {
		const active = activeWaveState(ctx, loopName);
		activeContext = active;
		prepared = active.stage.status === "integration_prepared" || active.stage.status === "integrated";
		let validation = active.stage.integration?.validation.filter((item): item is { command: string; result: "passed"; summary: string } => item.result === "passed") ?? [];
		let finalizedRevision: number;
		if (active.stage.status === "integrated") {
			finalizedRevision = active.graph.revision;
		} else if (active.stage.status === "integration_prepared") {
			const recovery = await reissue(ctx, { loopName, graphId: active.graph.id, stageId: active.stage.id }, signal, git);
			if (!recovery.parentAlreadyFastForwarded) await executeCommands(recovery.fastForwardCommands, run, signal);
			const parent = await git.resolveBranch(ctx.cwd, active.stage.parentBranch, signal);
			const integrated = await record(ctx, { loopName, graphId: active.graph.id, stageId: active.stage.id, expectedGraphRevision: recovery.stateRevision, prepareToken: recovery.prepareToken, parentResultCommit: parent! }, signal, git);
			finalizedRevision = integrated.stateRevision;
		} else {
			const staleBranch = await recoverGeneratedIntegrationBranch(active, ctx.cwd, git, run);
			if (staleBranch.found && !staleBranch.cleaned) throw new Error(staleBranch.reason);
			integrationPlan = await planIntegration(ctx, { loopName, graphId: active.graph.id, stageId: active.stage.id, expectedGraphRevision: active.graph.revision }, signal, git);
			await executeCommands([integrationPlan.commands[0]], run, signal);
			const laneMerges: Array<{ nodeId: string; sourceHeadCommit: string; mergeCommit: string }> = [];
			for (let index = 0; index < integrationPlan.acceptedLanes.length; index++) {
				await executeCommands([integrationPlan.commands[index + 1]], run, signal);
				const inspection = await git.inspectWorktree(ctx.cwd, signal);
				const lane = integrationPlan.acceptedLanes[index];
				laneMerges.push({ nodeId: lane.nodeId, sourceHeadCommit: lane.headCommit, mergeCommit: inspection.headCommit });
			}
			const integrationHead = (await git.inspectWorktree(ctx.cwd, signal)).headCommit;
			validation = [];
			for (const command of active.stage.status === "awaiting_integration" ? active.graph.nodes.find((node) => node.id === active.stage.fanInNodeId)?.validationCommands ?? [] : []) {
				const result = await run({ command: "/bin/sh", args: ["-lc", command], cwd: ctx.cwd }, signal);
				if (result.code !== 0) throw new Error(`Fan-in validation "${command}" failed: ${compactOutput(result)}`);
				validation.push({ command, result: "passed", summary: compactOutput(result) });
			}
			const preparedResult = await prepare(ctx, { loopName, graphId: active.graph.id, stageId: active.stage.id, expectedGraphRevision: integrationPlan.graphRevision, integrationHeadCommit: integrationHead, laneMerges, fanInCommits: [], validation }, signal, git);
			prepared = true;
			await executeCommands(preparedResult.fastForwardCommands, run, signal);
			const parent = await git.resolveBranch(ctx.cwd, active.stage.parentBranch, signal);
			const integrated = await record(ctx, { loopName, graphId: active.graph.id, stageId: active.stage.id, expectedGraphRevision: preparedResult.stateRevision, prepareToken: preparedResult.prepareToken, parentResultCommit: parent! }, signal, git);
			finalizedRevision = integrated.stateRevision;
		}
		const latest = activeWaveState(ctx, loopName);
		const released = await release(ctx, { loopName, graphId: latest.graph.id, stageId: latest.stage.id, expectedGraphRevision: finalizedRevision }, signal, dependencies.leaseAdapter);
		if (!released.ok) throw new Error(`Integration recorded but some leases were preserved: ${released.preserved.map((item) => `${item.attemptId}: ${item.reason}`).join("; ")}`);
		const snapshot = finalizeExecutionPlanWave(ctx, loopName, latest.wave.id, validation);
		runtime.updateUI(ctx);
		if (snapshot.status === "completed") {
			const state = loadState(ctx, loopName)!;
			runtime.completeLoop(ctx, state, `✅ STARDOCK EXECUTION COMPLETE: ${state.name}`, "clear");
		}
		const validationSummary = validation.length ? "validated the final combined result" : "completed intermediate fan-in using node-level validation";
		return {
			content: [{ type: "text" as const, text: `Integrated the accepted wave back into the governor's original workspace, ${validationSummary}, and released isolated leases.\nSuggested action: ${snapshot.status === "completed" ? "stardock_complete" : `stardock_${snapshot.nextAction}`}.` }],
			details: { loopName, plan: snapshot, releasedAttemptIds: released.releasedAttemptIds },
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		try {
			const latest = activeWaveState(ctx, loopName);
			if (latest.stage.status === "integration_prepared" || latest.stage.status === "integrated") prepared = true;
		} catch {
			// Preserve the original failure if state cannot be reloaded.
		}
		let recoveryMessage = "No temporary integration branch was created; fix the reported issue and rerun stardock_integrate.";
		if (prepared) recoveryMessage = "Rerun stardock_integrate to resume durable finalization or lease release.";
		else if (activeContext) {
			const cleanup = await recoverGeneratedIntegrationBranch(activeContext, ctx.cwd, git, run).catch((cleanupError) => ({ found: true, cleaned: false, reason: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) }));
			if (cleanup.found) recoveryMessage = cleanup.cleaned ? `${cleanup.reason} Fix the reported issue and rerun stardock_integrate.` : `${cleanup.reason} Preserve it and enable legacy recovery if manual reconciliation is required.`;
		}
		recordIntegrationRecovery(ctx, loopName, `${message} Recovery: ${recoveryMessage}`);
		return { content: [{ type: "text" as const, text: `Could not integrate execution wave: ${message}\nRecovery: ${recoveryMessage}` }], details: { loopName, ok: false, prepared, recovery: recoveryMessage }, isError: true };
	}
}

export function registerExecutionPlanIntegrateTool(pi: ExtensionAPI, runtime: StardockRuntime): void {
	pi.registerTool({
		name: "stardock_integrate",
		label: "Integrate Stardock Execution",
		description: "Optional legacy convenience for promoting accepted commit outputs into the governor workspace. Stardock DAG completion never requires this tool; prefer an explicit integration/promotion node when downstream nodes consume combined code.",
		promptSnippet: "Optionally promote accepted commit outputs from a persisted legacy wave.",
		promptGuidelines: [
			"Do not call this merely because nodes were accepted. Reports, findings, throw-away experiments, and evidence-only nodes need no integration.",
			"Use only when the governor explicitly wants commit outputs promoted from a legacy accepted wave; Git identity and workspace cleanliness remain mechanical safety checks.",
		],
		parameters: Type.Object({ name: Type.Optional(Type.String({ description: "Loop name. Defaults to the active plan." })) }),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			return executeExecutionPlanIntegrate(pi, runtime, params, signal, ctx);
		},
	});
}
