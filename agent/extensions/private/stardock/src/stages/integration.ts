import { createHash, randomBytes } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { LoopState } from "../state/core.ts";
import { loadState, mutateState } from "../state/store.ts";
import type {
	ExecutionAttempt,
	ExecutionGraph,
	ExecutionStage,
	ExecutionValidationRecord,
	IntegrationLaneMerge,
} from "./contracts.ts";
import { normalizeWriteClaim, validateExecutionGraph } from "./graph.ts";
import { DefaultStageGitAdapter, type StageGitAdapter } from "./stage-git-adapter.ts";

const EXACT_SHA_PATTERN = /^[0-9a-f]{40}$/;

export interface ArgumentCommandPlan {
	command: string;
	args: string[];
	cwd: string;
}

export interface AcceptedLaneEvidence {
	nodeId: string;
	attemptId: string;
	workerRunId: string;
	branchRef: string;
	baseCommit: string;
	headCommit: string;
	commits: string[];
	changedPaths: string[];
	writes: string[];
	resourceClaims: unknown[];
}

export interface IntegrationPlanResult {
	ok: true;
	graphId: string;
	stageId: string;
	graphRevision: number;
	expectedParent: { branch: string; branchRef: string; headCommit: string; worktreePath: string; repositoryCommonDir: string };
	integration: { branch: string; branchRef: string; baseCommit: string };
	acceptedLanes: AcceptedLaneEvidence[];
	preflight: {
		parentClean: true;
		integrationBranchAvailable: true;
		laneBranchesExact: true;
		sourceAncestryValid: true;
		pathConflicts: [];
		resourceConflicts: [];
		conflictPolicy: string;
	};
	commands: ArgumentCommandPlan[];
}

export interface PrepareIntegrationInput {
	loopName: string;
	graphId: string;
	stageId: string;
	expectedGraphRevision: number;
	integrationHeadCommit: string;
	laneMerges: IntegrationLaneMerge[];
	fanInCommits: string[];
	validation: ExecutionValidationRecord[];
}

export interface PreparedIntegrationResult {
	ok: true;
	graphId: string;
	stageId: string;
	stateRevision: number;
	prepareToken: string;
	preparedHeadCommit: string;
	expectedParentHead: string;
	fastForwardCommands: ArgumentCommandPlan[];
}

export interface RecordIntegratedInput {
	loopName: string;
	graphId: string;
	stageId: string;
	expectedGraphRevision: number;
	prepareToken: string;
	parentResultCommit: string;
}

function exactSha(value: string, label: string): string {
	if (!EXACT_SHA_PATTERN.test(value)) throw new Error(`${label} must be an exact 40-character lowercase Git SHA; received "${value}".`);
	return value;
}

function tokenDigest(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

function stageState(state: LoopState, graphId: string, stageId: string): { graph: ExecutionGraph; stage: ExecutionStage } {
	const graph = state.executionGraph;
	if (!graph || graph.id !== graphId) throw new Error(`Execution graph "${graphId}" was not found.`);
	const stage = graph.stages.find((candidate) => candidate.id === stageId);
	if (!stage) throw new Error(`Execution stage "${stageId}" was not found.`);
	return { graph, stage };
}

function acceptedLanes(state: LoopState, graph: ExecutionGraph, stage: ExecutionStage): AcceptedLaneEvidence[] {
	const result: AcceptedLaneEvidence[] = [];
	for (const nodeId of stage.integrationOrder) {
		const node = graph.nodes.find((candidate) => candidate.id === nodeId);
		if (!node || node.status !== "succeeded") throw new Error(`Integration lane "${nodeId}" is not accepted and succeeded.`);
		const acceptedRuns = state.workerRuns.filter((run) => run.graphId === graph.id && run.stageId === stage.id && run.nodeId === node.id && run.status === "accepted");
		if (acceptedRuns.length !== 1) throw new Error(`Integration lane "${nodeId}" must have exactly one accepted WorkerRun; found ${acceptedRuns.length}.`);
		const run = acceptedRuns[0];
		const attempt = node.attempts.find((candidate) => candidate.id === run.attemptId);
		if (!attempt || attempt.workerRunId !== run.id) throw new Error(`Accepted WorkerRun "${run.id}" does not map to immutable lane attempt evidence.`);
		if (!attempt.headCommit || attempt.clean !== true || attempt.laneCommits.length === 0 || attempt.status !== "needs_review") {
			throw new Error(`Accepted lane "${nodeId}" lacks clean committed completion evidence.`);
		}
		if (attempt.baseCommit !== stage.contractCommit) throw new Error(`Accepted lane "${nodeId}" base ${attempt.baseCommit} does not match contract ${stage.contractCommit}.`);
		result.push({
			nodeId,
			attemptId: attempt.id,
			workerRunId: run.id,
			branchRef: attempt.branchRef,
			baseCommit: attempt.baseCommit,
			headCommit: attempt.headCommit,
			commits: [...attempt.laneCommits],
			changedPaths: [...(attempt.changedPaths ?? [])],
			writes: [...(attempt.writes ?? node.writes)],
			resourceClaims: structuredClone(attempt.resourceClaims ?? node.resourceClaims),
		});
	}
	return result;
}

function changedPathsOverlap(left: string, right: string): boolean {
	if (left === right) return true;
	if (left.startsWith(`${right}/`)) return true;
	return right.startsWith(`${left}/`);
}

function assertNoChangedPathConflicts(lanes: AcceptedLaneEvidence[]): void {
	const priorPaths: Array<{ nodeId: string; path: string }> = [];
	for (const lane of lanes) {
		for (const changedPath of lane.changedPaths) {
			const conflict = priorPaths.find((prior) => prior.nodeId !== lane.nodeId && changedPathsOverlap(prior.path, changedPath));
			if (conflict) throw new Error(`Accepted lanes "${conflict.nodeId}" and "${lane.nodeId}" changed overlapping paths "${conflict.path}" and "${changedPath}"; integration conflict preflight failed.`);
			priorPaths.push({ nodeId: lane.nodeId, path: changedPath });
		}
	}
}

function gitCommand(cwd: string, args: string[]): ArgumentCommandPlan {
	return { command: "git", args: ["-C", cwd, ...args], cwd };
}

export async function createIntegrationPlan(
	ctx: ExtensionContext,
	input: { loopName: string; graphId: string; stageId: string; expectedGraphRevision: number },
	signal?: AbortSignal,
	adapter: StageGitAdapter = new DefaultStageGitAdapter(),
): Promise<IntegrationPlanResult> {
	const state = loadState(ctx, input.loopName);
	if (!state) throw new Error(`Loop "${input.loopName}" not found.`);
	const { graph, stage } = stageState(state, input.graphId, input.stageId);
	if (graph.revision !== input.expectedGraphRevision) throw new Error(`Stale execution graph revision: expected ${input.expectedGraphRevision}, current ${graph.revision}.`);
	if (stage.status !== "awaiting_integration") throw new Error(`Stage "${stage.id}" must be awaiting_integration; current status is "${stage.status}".`);
	if (stage.integration) throw new Error(`Stage "${stage.id}" already has durable integration evidence with status "${stage.integration.status}".`);
	const validation = validateExecutionGraph(graph, ctx.cwd);
	if (!validation.ok) throw new Error(`Execution graph validation failed: ${validation.errors.join(" ")}`);
	const parent = await adapter.inspectWorktree(ctx.cwd, signal);
	const expectedParentRef = `refs/heads/${stage.parentBranch}`;
	if (parent.branchRef !== expectedParentRef) throw new Error(`Parent branch mismatch: expected "${expectedParentRef}", received "${parent.branchRef ?? "detached HEAD"}".`);
	if (parent.headCommit !== stage.integrationBaseCommit) throw new Error(`Parent drift: expected ${stage.integrationBaseCommit}, received ${parent.headCommit}. Parent was not mutated.`);
	if (!parent.clean) throw new Error("Parent worktree must be clean before integration planning.");
	const existingIntegration = await adapter.resolveBranch(ctx.cwd, stage.integrationBranch, signal);
	if (existingIntegration) throw new Error(`Integration branch collision: refs/heads/${stage.integrationBranch} already resolves to ${existingIntegration}. Existing refs were preserved.`);
	const lanes = acceptedLanes(state, graph, stage);
	assertNoChangedPathConflicts(lanes);
	for (const lane of lanes) {
		const actualHead = await adapter.resolveBranch(ctx.cwd, lane.branchRef, signal);
		if (actualHead !== lane.headCommit) throw new Error(`Lane "${lane.nodeId}" branch mapping mismatch: expected ${lane.headCommit}, received ${actualHead ?? "missing ref"}.`);
		if (!await adapter.isAncestor(ctx.cwd, stage.contractCommit, lane.headCommit, signal)) throw new Error(`Lane "${lane.nodeId}" source head ${lane.headCommit} does not descend from contract ${stage.contractCommit}.`);
	}
	const commands = [gitCommand(ctx.cwd, ["switch", "-c", stage.integrationBranch, stage.integrationBaseCommit])];
	for (const lane of lanes) commands.push(gitCommand(ctx.cwd, ["merge", "--no-ff", "--no-edit", lane.headCommit]));
	return {
		ok: true,
		graphId: graph.id,
		stageId: stage.id,
		graphRevision: graph.revision,
		expectedParent: { branch: stage.parentBranch, branchRef: expectedParentRef, headCommit: stage.integrationBaseCommit, worktreePath: parent.worktreePath, repositoryCommonDir: parent.repositoryCommonDir },
		integration: { branch: stage.integrationBranch, branchRef: `refs/heads/${stage.integrationBranch}`, baseCommit: stage.integrationBaseCommit },
		acceptedLanes: lanes,
		preflight: {
			parentClean: true,
			integrationBranchAvailable: true,
			laneBranchesExact: true,
			sourceAncestryValid: true,
			pathConflicts: [],
			resourceConflicts: [],
			conflictPolicy: "Run commands in order. On a merge conflict, run git merge --abort; preserve the integration branch, source refs, attempts, and leases. The parent ref remains unchanged.",
		},
		commands,
	};
}

function assertExactValidation(stage: ExecutionStage, graph: ExecutionGraph, records: ExecutionValidationRecord[]): void {
	const fanIn = graph.nodes.find((node) => node.id === stage.fanInNodeId);
	if (!fanIn) throw new Error(`Fan-in node "${stage.fanInNodeId}" was not found.`);
	if (records.length !== fanIn.validationCommands.length) throw new Error(`Fan-in validation evidence count mismatch: expected ${fanIn.validationCommands.length}, received ${records.length}.`);
	for (let index = 0; index < fanIn.validationCommands.length; index++) {
		const record = records[index];
		if (!record || record.command !== fanIn.validationCommands[index]) throw new Error(`Fan-in validation command mismatch at index ${index}.`);
		if (record.result !== "passed") throw new Error(`Fan-in validation "${record.command}" did not pass: ${record.summary}`);
	}
}

function sameMappings(left: IntegrationLaneMerge[], right: IntegrationLaneMerge[]): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function fanInNode(graph: ExecutionGraph, stage: ExecutionStage) {
	const node = graph.nodes.find((candidate) => candidate.id === stage.fanInNodeId);
	if (!node) throw new Error(`Fan-in node "${stage.fanInNodeId}" was not found.`);
	return node;
}

function ownedByWrites(repoRoot: string, changedPath: string, writes: string[]): boolean {
	const normalizedPath = normalizeWriteClaim(repoRoot, changedPath);
	for (const write of writes) {
		const normalizedWrite = normalizeWriteClaim(repoRoot, write);
		if (normalizedPath === normalizedWrite) return true;
		if (normalizedPath.startsWith(`${normalizedWrite}/`)) return true;
	}
	return false;
}

function assertFanInOwnedPaths(repoRoot: string, graph: ExecutionGraph, stage: ExecutionStage, changedPaths: string[]): void {
	const fanIn = fanInNode(graph, stage);
	const outside = changedPaths.filter((changedPath) => !ownedByWrites(repoRoot, changedPath, fanIn.writes));
	if (outside.length === 0) return;
	throw new Error(`Fan-in changed paths must stay within node "${fanIn.id}" owned writes [${fanIn.writes.join(", ")}]; received out-of-scope paths [${outside.join(", ")}].`);
}

export async function prepareIntegration(
	ctx: ExtensionContext,
	input: PrepareIntegrationInput,
	signal?: AbortSignal,
	adapter: StageGitAdapter = new DefaultStageGitAdapter(),
): Promise<PreparedIntegrationResult> {
	const state = loadState(ctx, input.loopName);
	if (!state) throw new Error(`Loop "${input.loopName}" not found.`);
	const { graph, stage } = stageState(state, input.graphId, input.stageId);
	if (graph.revision !== input.expectedGraphRevision) throw new Error(`Stale execution graph revision: expected ${input.expectedGraphRevision}, current ${graph.revision}.`);
	if (stage.status !== "awaiting_integration") throw new Error(`Stage "${stage.id}" must be awaiting_integration before preparation.`);
	const lanes = acceptedLanes(state, graph, stage);
	const expectedMappings = lanes.map((lane, index) => ({ nodeId: lane.nodeId, sourceHeadCommit: lane.headCommit, mergeCommit: input.laneMerges[index]?.mergeCommit ?? "" }));
	if (input.laneMerges.length !== lanes.length || !sameMappings(input.laneMerges, expectedMappings)) throw new Error("Lane merge mappings do not exactly match accepted lane order and source heads.");
	exactSha(input.integrationHeadCommit, "integrationHeadCommit");
	for (const commit of input.fanInCommits) exactSha(commit, "fanInCommit");
	assertExactValidation(stage, graph, input.validation);
	const worktree = await adapter.inspectWorktree(ctx.cwd, signal);
	if (!worktree.clean) throw new Error("Integration worktree has uncommitted changes. Commit or preserve them before preparation.");
	if (worktree.branchRef !== `refs/heads/${stage.integrationBranch}`) throw new Error(`Integration worktree must be on refs/heads/${stage.integrationBranch}; received ${worktree.branchRef ?? "detached HEAD"}.`);
	if (worktree.headCommit !== input.integrationHeadCommit) throw new Error(`Integration HEAD mismatch: expected ${input.integrationHeadCommit}, received ${worktree.headCommit}.`);
	const integrationRef = await adapter.resolveBranch(ctx.cwd, stage.integrationBranch, signal);
	if (integrationRef !== input.integrationHeadCommit) throw new Error(`Integration branch mapping mismatch: expected ${input.integrationHeadCommit}, received ${integrationRef ?? "missing ref"}.`);
	const parentHead = await adapter.resolveBranch(ctx.cwd, stage.parentBranch, signal);
	if (parentHead !== stage.integrationBaseCommit) throw new Error(`Parent drift: expected refs/heads/${stage.parentBranch} at ${stage.integrationBaseCommit}, received ${parentHead ?? "missing ref"}. Parent was not mutated.`);
	let prior = stage.integrationBaseCommit;
	for (let index = 0; index < input.laneMerges.length; index++) {
		const mapping = input.laneMerges[index];
		exactSha(mapping.mergeCommit, "mergeCommit");
		const parents = await adapter.commitParents(ctx.cwd, mapping.mergeCommit, signal);
		if (parents.length !== 2 || parents[0] !== prior || parents[1] !== mapping.sourceHeadCommit) {
			throw new Error(`Merge mapping for lane "${mapping.nodeId}" is incorrect: expected parents [${prior}, ${mapping.sourceHeadCommit}], received [${parents.join(", ")}].`);
		}
		prior = mapping.mergeCommit;
	}
	const actualFanIn = await adapter.firstParentCommits(ctx.cwd, prior, input.integrationHeadCommit, signal);
	if (JSON.stringify(actualFanIn) !== JSON.stringify(input.fanInCommits)) throw new Error(`Fan-in commit mapping mismatch: expected [${input.fanInCommits.join(", ")}], received [${actualFanIn.join(", ")}].`);
	const fanInChangedPaths = await adapter.changedPaths(ctx.cwd, prior, input.integrationHeadCommit, signal);
	assertFanInOwnedPaths(ctx.cwd, graph, stage, fanInChangedPaths);
	if (!await adapter.isAncestor(ctx.cwd, stage.integrationBaseCommit, input.integrationHeadCommit, signal)) throw new Error("Integration head does not descend from the immutable integration base.");
	for (const lane of lanes) {
		if (!await adapter.isAncestor(ctx.cwd, lane.headCommit, input.integrationHeadCommit, signal)) throw new Error(`Accepted lane source head ${lane.headCommit} is not an ancestor of integration head ${input.integrationHeadCommit}.`);
	}
	const token = randomBytes(32).toString("base64url");
	const digest = tokenDigest(token);
	const preparedAt = new Date().toISOString();
	const saved = mutateState(ctx, input.loopName, (candidate) => {
		const current = stageState(candidate, input.graphId, input.stageId).stage;
		if (current.status !== "awaiting_integration" || current.integration) throw new Error("Integration state changed before durable preparation.");
		current.integration = {
			status: "prepared",
			expectedParentHead: current.integrationBaseCommit,
			integrationBranch: current.integrationBranch,
			laneMerges: structuredClone(input.laneMerges),
			fanInCommits: [...input.fanInCommits],
			integrationHeadCommit: input.integrationHeadCommit,
			prepareTokenDigest: digest,
			preparedAt,
			validation: structuredClone(input.validation),
		};
		current.status = "integration_prepared";
	}, { expectedGraphRevision: input.expectedGraphRevision });
	return {
		ok: true,
		graphId: input.graphId,
		stageId: input.stageId,
		stateRevision: saved.executionGraph?.revision as number,
		prepareToken: token,
		preparedHeadCommit: input.integrationHeadCommit,
		expectedParentHead: stage.integrationBaseCommit,
		fastForwardCommands: preparedFastForwardCommands(ctx, stage, stage.integrationBaseCommit, input.integrationHeadCommit),
	};
}

export function preparedFastForwardCommands(ctx: ExtensionContext, stage: ExecutionStage, expectedParentHead: string, head: string): ArgumentCommandPlan[] {
	const parentRef = `refs/heads/${stage.parentBranch}`;
	return [
		gitCommand(ctx.cwd, ["switch", stage.parentBranch]),
		gitCommand(ctx.cwd, ["merge-base", "--is-ancestor", expectedParentHead, parentRef]),
		gitCommand(ctx.cwd, ["merge-base", "--is-ancestor", parentRef, expectedParentHead]),
		gitCommand(ctx.cwd, ["merge", "--ff-only", head]),
	];
}

export async function reissuePreparedIntegrationToken(
	ctx: ExtensionContext,
	input: { loopName: string; graphId: string; stageId: string },
	signal?: AbortSignal,
	adapter: StageGitAdapter = new DefaultStageGitAdapter(),
): Promise<PreparedIntegrationResult & { parentAlreadyFastForwarded: boolean }> {
	const state = loadState(ctx, input.loopName);
	if (!state) throw new Error(`Loop "${input.loopName}" not found.`);
	const { graph, stage } = stageState(state, input.graphId, input.stageId);
	const integration = stage.integration;
	if (stage.status !== "integration_prepared" || integration?.status !== "prepared") throw new Error(`Stage "${stage.id}" has no exact prepared integration evidence to recover.`);
	const integrationHead = await adapter.resolveBranch(ctx.cwd, stage.integrationBranch, signal);
	if (integrationHead !== integration.integrationHeadCommit) throw new Error(`Prepared integration branch changed: expected ${integration.integrationHeadCommit}, received ${integrationHead ?? "missing"}.`);
	const parentHead = await adapter.resolveBranch(ctx.cwd, stage.parentBranch, signal);
	const parentAlreadyFastForwarded = parentHead === integration.integrationHeadCommit;
	if (parentHead !== integration.expectedParentHead && !parentAlreadyFastForwarded) {
		throw new Error(`Prepared parent evidence changed: expected ${integration.expectedParentHead} or completed fast-forward ${integration.integrationHeadCommit}, received ${parentHead ?? "missing"}.`);
	}
	const token = randomBytes(32).toString("base64url");
	const digest = tokenDigest(token);
	const saved = mutateState(ctx, input.loopName, (candidate) => {
		const current = stageState(candidate, input.graphId, input.stageId).stage.integration;
		if (!current || current.status !== "prepared" || current.integrationHeadCommit !== integration.integrationHeadCommit || current.expectedParentHead !== integration.expectedParentHead) {
			throw new Error("Prepared integration evidence changed before token recovery.");
		}
		current.prepareTokenDigest = digest;
		current.preparedAt = new Date().toISOString();
	}, { expectedGraphRevision: graph.revision });
	return {
		ok: true,
		graphId: graph.id,
		stageId: stage.id,
		stateRevision: saved.executionGraph?.revision as number,
		prepareToken: token,
		preparedHeadCommit: integration.integrationHeadCommit,
		expectedParentHead: integration.expectedParentHead,
		fastForwardCommands: preparedFastForwardCommands(ctx, stage, integration.expectedParentHead, integration.integrationHeadCommit),
		parentAlreadyFastForwarded,
	};
}

export async function recordIntegrated(
	ctx: ExtensionContext,
	input: RecordIntegratedInput,
	signal?: AbortSignal,
	adapter: StageGitAdapter = new DefaultStageGitAdapter(),
): Promise<{ ok: true; idempotent: boolean; graphId: string; stageId: string; stateRevision: number; parentResultCommit: string }> {
	exactSha(input.parentResultCommit, "parentResultCommit");
	const state = loadState(ctx, input.loopName);
	if (!state) throw new Error(`Loop "${input.loopName}" not found.`);
	const { graph, stage } = stageState(state, input.graphId, input.stageId);
	const integration = stage.integration;
	if (!integration || !integration.prepareTokenDigest) throw new Error(`Stage "${stage.id}" has no prepared integration token evidence.`);
	if (tokenDigest(input.prepareToken) !== integration.prepareTokenDigest) throw new Error("prepareToken does not match durable prepared integration evidence.");
	if (input.parentResultCommit !== integration.integrationHeadCommit) throw new Error(`parentResultCommit must equal prepared integration head ${integration.integrationHeadCommit}.`);
	const parentHead = await adapter.resolveBranch(ctx.cwd, stage.parentBranch, signal);
	if (parentHead !== input.parentResultCommit) throw new Error(`Parent fast-forward verification failed: refs/heads/${stage.parentBranch} is ${parentHead ?? "missing"}, expected ${input.parentResultCommit}.`);
	const integrationHead = await adapter.resolveBranch(ctx.cwd, stage.integrationBranch, signal);
	if (integrationHead !== integration.integrationHeadCommit) throw new Error(`Integration branch changed after preparation: expected ${integration.integrationHeadCommit}, received ${integrationHead ?? "missing"}.`);
	if (integration.status === "integrated") {
		if (integration.parentResultCommit !== input.parentResultCommit) throw new Error("Integrated result evidence changed; idempotent finalization refused.");
		return { ok: true, idempotent: true, graphId: graph.id, stageId: stage.id, stateRevision: graph.revision, parentResultCommit: input.parentResultCommit };
	}
	if (graph.revision !== input.expectedGraphRevision) throw new Error(`Stale execution graph revision: expected ${String(input.expectedGraphRevision)}, current ${graph.revision}.`);
	if (stage.status !== "integration_prepared" || integration.status !== "prepared") throw new Error(`Stage "${stage.id}" is not durably prepared for finalization.`);
	const saved = mutateState(ctx, input.loopName, (candidate) => {
		const current = stageState(candidate, input.graphId, input.stageId).stage;
		const record = current.integration;
		if (!record || record.status !== "prepared" || record.prepareTokenDigest !== integration.prepareTokenDigest) throw new Error("Prepared integration evidence changed before finalization.");
		record.status = "integrated";
		record.parentResultCommit = input.parentResultCommit;
		record.integratedAt = new Date().toISOString();
		current.status = "integrated";
		const candidateGraph = candidate.executionGraph as ExecutionGraph;
		for (const nodeId of [current.fanInNodeId, ...current.implementationNodeIds]) {
			const node = candidateGraph.nodes.find((value) => value.id === nodeId);
			if (node) node.status = "integrated";
		}
	}, { expectedGraphRevision: input.expectedGraphRevision });
	return { ok: true, idempotent: false, graphId: input.graphId, stageId: input.stageId, stateRevision: saved.executionGraph?.revision as number, parentResultCommit: input.parentResultCommit };
}
