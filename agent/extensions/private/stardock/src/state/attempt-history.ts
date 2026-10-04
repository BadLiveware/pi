import type { LoopState } from "./core.ts";
import { digestExecutionNodeContract, digestExecutionStageContract, type ExecutionAttempt, type LeaseDisposition } from "../stages/contracts.ts";
import { OwnershipProtocolError } from "../stages/ownership-records.ts";

function assertAppendOnly<T>(attemptId: string, field: string, current: T[], candidate: T[]): void {
	if (candidate.length < current.length) throw new OwnershipProtocolError("attempt_history_removed", `Execution attempt "${attemptId}" ${field} history cannot shrink.`);
	for (let index = 0; index < current.length; index++) {
		if (JSON.stringify(current[index]) !== JSON.stringify(candidate[index])) {
			throw new OwnershipProtocolError("attempt_history_immutable", `Execution attempt "${attemptId}" ${field} history is append-only.`);
		}
	}
}

function assertLeaseDispositionTransition(current: LeaseDisposition | undefined, candidate: LeaseDisposition | undefined, attemptId: string): void {
	if (current === candidate || current === undefined) return;
	const allowed: Record<LeaseDisposition, LeaseDisposition[]> = {
		held: ["release_pending", "released", "preserved", "abandoned"],
		release_pending: ["released", "preserved"],
		released: [],
		preserved: ["release_pending", "released", "abandoned"],
		abandoned: ["release_pending", "released"],
	};
	if (candidate && allowed[current].includes(candidate)) return;
	throw new OwnershipProtocolError("attempt_history_immutable", `Execution attempt "${attemptId}" lease disposition cannot change from "${current}" to "${String(candidate)}".`);
}

function assertDispatchEvidencePreserved(current: ExecutionAttempt, candidate: ExecutionAttempt): void {
	const unchanged = candidate.dispatchState === current.dispatchState && candidate.dispatchCommittedAt === current.dispatchCommittedAt;
	const committing = current.dispatchState === "prepared" && current.dispatchCommittedAt === undefined
		&& candidate.dispatchState === "committed" && typeof candidate.dispatchCommittedAt === "string" && Boolean(candidate.dispatchCommittedAt);
	if (!unchanged && !committing) {
		throw new OwnershipProtocolError("attempt_history_immutable", `Execution attempt "${current.id}" dispatch evidence cannot be backfilled, removed, or regressed.`);
	}
}

function assertAttemptPreserved(current: ExecutionAttempt, candidate: ExecutionAttempt): void {
	assertDispatchEvidencePreserved(current, candidate);
	for (const field of ["id", "baseCommit", "branchRef", "startedAt"] as const) {
		if (candidate[field] !== current[field]) throw new OwnershipProtocolError("attempt_history_immutable", `Execution attempt "${current.id}" field "${field}" is immutable.`);
	}
	for (const field of ["workerRunId", "workerReportId", "bridgeRunId", "nodeContractDigest", "stageContractDigest", "headCommit", "worktreePath", "repositoryCommonDir", "leaseHolder", "clean", "completedAt"] as const) {
		if (current[field] !== undefined && candidate[field] !== current[field]) {
			throw new OwnershipProtocolError("attempt_history_immutable", `Execution attempt "${current.id}" once-set field "${field}" is immutable.`);
		}
	}
	for (const field of ["writes", "resourceClaims", "validationCommands"] as const) {
		if (current[field] !== undefined && JSON.stringify(candidate[field]) !== JSON.stringify(current[field])) {
			throw new OwnershipProtocolError("attempt_history_immutable", `Execution attempt "${current.id}" contract field "${field}" is immutable.`);
		}
	}
	assertLeaseDispositionTransition(current.leaseDisposition, candidate.leaseDisposition, current.id);
	assertAppendOnly(current.id, "lane commit", current.laneCommits, candidate.laneCommits);
	assertAppendOnly(current.id, "changed path", current.changedPaths ?? [], candidate.changedPaths ?? []);
	assertAppendOnly(current.id, "violation", current.violations ?? [], candidate.violations ?? []);
	assertAppendOnly(current.id, "validation", current.validation, candidate.validation);
}

export function assertPriorAttemptsPreserved(current: LoopState, candidate: LoopState): void {
	if (JSON.stringify(current.recoveryEventsUnparsed) !== JSON.stringify(candidate.recoveryEventsUnparsed)) {
		throw new OwnershipProtocolError("recovery_history_immutable", "Unparsed recovery evidence must be preserved for explicit repair.");
	}
	const recoveryEvents = current.recoveryEvents ?? [];
	if (JSON.stringify(recoveryEvents) !== JSON.stringify((candidate.recoveryEvents ?? []).slice(0, recoveryEvents.length))) {
		throw new OwnershipProtocolError("recovery_history_immutable", "Recovery events are append-only.");
	}
	const currentGraph = current.executionGraph;
	if (!currentGraph) return;
	const candidateGraph = candidate.executionGraph;
	if (!candidateGraph) throw new OwnershipProtocolError("attempt_history_removed", "Execution graph removal would discard durable attempt history.");
	const hasDurableAttempts = currentGraph.nodes.some((node) => node.attempts.length > 0);
	if (hasDurableAttempts && currentGraph.id !== candidateGraph.id) throw new OwnershipProtocolError("execution_contract_immutable", "Execution graph identity cannot change after durable attempts exist.");
	const candidateAttempts = candidateGraph.nodes.flatMap((node) => node.attempts);
	if (new Set(candidateAttempts.map((attempt) => attempt.id)).size !== candidateAttempts.length) {
		throw new OwnershipProtocolError("attempt_identity_duplicate", "Execution attempt ids must remain unique across the graph.");
	}
	const candidateNodes = new Map(candidateGraph.nodes.map((node) => [node.id, node]));
	for (const currentNode of currentGraph.nodes) {
		const candidateNode = candidateNodes.get(currentNode.id);
		if (!candidateNode && currentNode.attempts.length > 0) throw new OwnershipProtocolError("attempt_history_removed", `Execution node "${currentNode.id}" with durable attempts cannot be removed.`);
		if (!candidateNode) continue;
		if (currentNode.attempts.length > 0 && digestExecutionNodeContract(currentNode) !== digestExecutionNodeContract(candidateNode)) {
			throw new OwnershipProtocolError("execution_contract_immutable", `Execution node "${currentNode.id}" contract cannot change after its first durable attempt.`);
		}
		if (candidateNode.attempts.length < currentNode.attempts.length) {
			throw new OwnershipProtocolError("attempt_history_removed", `Execution node "${currentNode.id}" attempt history cannot shrink.`);
		}
		for (let index = 0; index < currentNode.attempts.length; index++) {
			const attempt = currentNode.attempts[index];
			const next = candidateNode.attempts[index];
			if (!next || next.id !== attempt.id) {
				throw new OwnershipProtocolError("attempt_history_immutable", `Execution node "${currentNode.id}" attempt order is append-only.`);
			}
			assertAttemptPreserved(attempt, next);
		}
	}
	const candidateStages = new Map(candidateGraph.stages.map((stage) => [stage.id, stage]));
	for (const currentStage of currentGraph.stages) {
		const hasAttempts = [currentStage.contractNodeId, ...currentStage.implementationNodeIds, currentStage.fanInNodeId]
			.some((nodeId) => currentGraph.nodes.find((node) => node.id === nodeId)?.attempts.length);
		if (!hasAttempts) continue;
		const candidateStage = candidateStages.get(currentStage.id);
		if (!candidateStage) throw new OwnershipProtocolError("execution_contract_immutable", `Execution stage "${currentStage.id}" cannot be removed after durable attempts exist.`);
		if (currentStage.contractDigest !== candidateStage.contractDigest || digestExecutionStageContract(currentGraph, currentStage) !== digestExecutionStageContract(candidateGraph, candidateStage)) {
			throw new OwnershipProtocolError("execution_contract_immutable", `Execution stage "${currentStage.id}" contract cannot change after its first durable attempt.`);
		}
	}
}
