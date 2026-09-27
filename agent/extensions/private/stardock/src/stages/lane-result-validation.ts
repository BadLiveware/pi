import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { digestExecutionNodeContract, type ExecutionAttempt, type ExecutionNode, type ExecutionValidationRecord, type ResourceClaim } from "./contracts.ts";
import { normalizeWriteClaim } from "./graph.ts";
import type { LaneCompletionEvidence, TreehouseLease } from "./treehouse-adapter.ts";

function pathsOutsideOwnership(repoRoot: string, changedPaths: string[], writes: string[]): string[] {
	const normalizedWrites = writes.map((claim) => normalizeWriteClaim(repoRoot, claim));
	return changedPaths.filter((candidate) => {
		const changed = normalizeWriteClaim(repoRoot, candidate);
		return !normalizedWrites.some((claim) => changed === claim || changed.startsWith(`${claim}/`));
	});
}

function sameClaims(left: ResourceClaim[], right: ResourceClaim[]): boolean {
	const key = (claim: ResourceClaim) => `${claim.mode}\u0000${claim.key}\u0000${claim.value ?? ""}`;
	return JSON.stringify(left.map(key).sort()) === JSON.stringify(right.map(key).sort());
}

export function validateLaneResult(
	ctx: ExtensionContext,
	node: ExecutionNode,
	attempt: ExecutionAttempt,
	stageCommit: string,
	stageContractDigest: string,
	lease: TreehouseLease,
	completion: LaneCompletionEvidence,
	validation: ExecutionValidationRecord[],
): string[] {
	const violations: string[] = [];
	if (attempt.baseCommit !== stageCommit || lease.contractCommit !== stageCommit) violations.push(`Lease contract commit ${lease.contractCommit} does not match ${stageCommit}.`);
	if (attempt.nodeContractDigest !== digestExecutionNodeContract(node)) violations.push("Node contract changed after the durable attempt was created.");
	if (attempt.stageContractDigest !== stageContractDigest) violations.push("Stage contract changed after the durable attempt was created.");
	if (JSON.stringify(attempt.writes) !== JSON.stringify(node.writes)) violations.push("Durable write ownership differs from the current node contract.");
	if (!sameClaims(attempt.resourceClaims ?? [], node.resourceClaims)) violations.push("Durable resource claims differ from the current node contract.");
	if (JSON.stringify(attempt.validationCommands) !== JSON.stringify(node.validationCommands)) violations.push("Durable validation commands differ from the current node contract.");
	if (completion.branchRef !== `refs/heads/${lease.branchRef}`) violations.push(`Recorded lane branch mismatch: expected refs/heads/${lease.branchRef}, received ${completion.branchRef ?? "detached HEAD"}.`);
	if (!completion.clean) violations.push("Lane worktree is dirty.");
	if (!completion.baseIsAncestor) violations.push("Frozen contract base is not an ancestor of the lane head commit.");
	// Nodes may be evidence-only or use throw-away filesystem changes. An
	// unchanged HEAD is a valid outcome for the governor to assess.
	if (completion.laneCommits.length > 0 && completion.laneCommits.at(-1) !== completion.headCommit) violations.push("Ordered lane commits do not end at the recorded head commit.");
	for (const filePath of pathsOutsideOwnership(ctx.cwd, completion.changedPaths, attempt.writes ?? [])) violations.push(`Changed path "${filePath}" is outside node write ownership.`);
	if (validation.length !== (attempt.validationCommands ?? []).length || validation.some((record, index) => record.command !== attempt.validationCommands?.[index] || record.result !== "passed")) {
		violations.push("Validation warning: one or more declared commands did not pass exactly as durably recorded.");
	}
	return violations;
}
