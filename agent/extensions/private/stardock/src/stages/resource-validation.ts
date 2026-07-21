import {
	type ExecutionGraph,
	type ResourceClaim,
} from "./contracts.ts";

function addError(errors: string[], message: string): void {
	if (!errors.includes(message)) errors.push(message);
}

function claimsConflict(left: ResourceClaim, right: ResourceClaim): string | undefined {
	if (!left.key.trim() || !right.key.trim()) return undefined;
	if (left.key !== right.key) return undefined;
	if (left.mode === "exclusive" || right.mode === "exclusive") return `exclusive key "${left.key}"`;
	if (!left.value?.trim() || !right.value?.trim()) return undefined;
	if (left.value !== right.value) return `shared key "${left.key}" has values "${left.value}" and "${right.value}"`;
	return undefined;
}

function allocatedResourceType(key: string): "port" | "database" | "cache" | undefined {
	const prefix = key.split(":", 1)[0].toLowerCase();
	if (prefix === "port") return "port";
	if (prefix === "db" || prefix === "database") return "database";
	if (prefix === "cache") return "cache";
	return undefined;
}

function allocatedValueConflict(left: ResourceClaim, right: ResourceClaim): string | undefined {
	const leftType = allocatedResourceType(left.key);
	const rightType = allocatedResourceType(right.key);
	if (!leftType || leftType !== rightType) return undefined;
	if (!left.value?.trim() || !right.value?.trim() || left.value !== right.value) return undefined;
	const sameSharedClaim = left.key === right.key && left.mode === "shared" && right.mode === "shared";
	if (sameSharedClaim) return undefined;
	return `duplicate ${leftType} allocation value "${left.value}" for keys "${left.key}" and "${right.key}"`;
}

export function validateResources(graph: ExecutionGraph, errors: string[]): void {
	const nodes = [...graph.nodes].sort((left, right) => left.id.localeCompare(right.id));
	for (const node of nodes) {
		for (const claim of node.resourceClaims) {
			if (!claim.key.trim()) addError(errors, `Node "${node.id}" resource claim key must not be empty.`);
			if (claim.mode === "shared" && !claim.value?.trim()) {
				addError(errors, `Node "${node.id}" shared resource claim "${claim.key}" must have a nonblank explicit value.`);
			}
		}
	}
	const nodeById = new Map(nodes.map((node) => [node.id, node]));
	for (const stage of [...graph.stages].sort((left, right) => left.id.localeCompare(right.id))) {
		const nodeIds = [...stage.implementationNodeIds].sort();
		for (let leftIndex = 0; leftIndex < nodeIds.length; leftIndex++) {
			const left = nodeById.get(nodeIds[leftIndex]);
			if (!left) continue;
			for (let rightIndex = leftIndex + 1; rightIndex < nodeIds.length; rightIndex++) {
				const right = nodeById.get(nodeIds[rightIndex]);
				if (!right) continue;
				for (const leftClaim of left.resourceClaims) {
					for (const rightClaim of right.resourceClaims) {
						const keyConflict = claimsConflict(leftClaim, rightClaim);
						if (keyConflict) {
							addError(errors, `Stage "${stage.id}" resource conflict between nodes "${left.id}" and "${right.id}": ${keyConflict}.`);
							continue;
						}
						const valueConflict = allocatedValueConflict(leftClaim, rightClaim);
						if (valueConflict) addError(errors, `Stage "${stage.id}" resource conflict between nodes "${left.id}" and "${right.id}": ${valueConflict}.`);
					}
				}
			}
		}
	}
}
