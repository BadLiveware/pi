import { batchFailureDetails, runOrderedBatch, type AppToolMutationResponse } from "./batch.ts";
import { compactText, type Criterion, type LoopState, type VerificationArtifact } from "../state/core.ts";

export interface CriterionMutationParams extends Partial<Criterion> {
	criteria?: Array<Partial<Criterion>>;
}

export interface ArtifactMutationParams extends Partial<VerificationArtifact> {
	artifacts?: Array<Partial<VerificationArtifact>>;
}

export interface LedgerOperations {
	upsertCriterion(input: Partial<Criterion>): { ok: true; state: LoopState; criterion: Criterion; created: boolean } | { ok: false; error: string };
	recordArtifact(input: Partial<VerificationArtifact>): { ok: true; state: LoopState; artifact: VerificationArtifact; created: boolean } | { ok: false; error: string };
}

export interface DistilledCriterionSource {
	id: string;
	line: number;
	text: string;
	kind: "checklist" | "goal";
	checked: boolean;
}

function cleanMarkdownItem(line: string): { text: string; checked: boolean; kind: "checklist" | "goal" } | undefined {
	const checkbox = line.match(/^\s*[-*+]\s+\[([ xX])]\s+(.+)$/);
	if (checkbox) return { text: checkbox[2].trim(), checked: checkbox[1].toLowerCase() === "x", kind: "checklist" };
	const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
	if (bullet) return { text: bullet[1].trim(), checked: false, kind: "goal" };
	return undefined;
}

export function extractTaskCriteria(taskContent: string, options: { idPrefix?: string; maxItems?: number } = {}): DistilledCriterionSource[] {
	const idPrefix = options.idPrefix ?? "c-task";
	const maxItems = options.maxItems ?? 40;
	const lines = taskContent.split(/\r?\n/);
	let section = "";
	const checklist: Array<Omit<DistilledCriterionSource, "id">> = [];
	const goals: Array<Omit<DistilledCriterionSource, "id">> = [];
	for (const [index, line] of lines.entries()) {
		const heading = line.match(/^\s{0,3}#{1,6}\s+(.+)$/);
		if (heading) {
			section = heading[1].trim().toLowerCase();
			continue;
		}
		const item = cleanMarkdownItem(line);
		if (!item || !item.text) continue;
		const text = item.text.replace(/\s+/g, " ");
		if (item.kind === "checklist") checklist.push({ line: index + 1, text, kind: "checklist", checked: item.checked });
		else if (/goal|requirement|acceptance|criterion|criteria/.test(section)) goals.push({ line: index + 1, text, kind: "goal", checked: false });
	}
	const sources = checklist.length > 0 ? checklist : goals;
	return sources.slice(0, maxItems).map((source, index) => ({ ...source, id: `${idPrefix}-${String(index + 1).padStart(2, "0")}` }));
}

export function taskCriterionInput(source: DistilledCriterionSource, taskFile: string): Partial<Criterion> {
	const description = compactText(source.text, 240) ?? source.text;
	return {
		id: source.id,
		sourceRef: `${taskFile}:L${source.line}`,
		requirement: description,
		description,
		passCondition: source.kind === "checklist" ? `Checklist item is completed with supporting evidence: ${description}` : `Goal is satisfied with supporting evidence: ${description}`,
		testMethod: "Record validation evidence in the Stardock ledger before completion.",
	};
}

export function runLedgerTaskDistillation(loopName: string, taskFile: string, taskContent: string, operations: Pick<LedgerOperations, "upsertCriterion">): AppToolMutationResponse<LoopState> {
	const sources = extractTaskCriteria(taskContent);
	if (sources.length === 0) return { contentText: "No checklist or goal items found to distill.", details: { loopName, taskFile }, error: "No checklist or goal items found to distill." };
	const inputs = sources.map((source) => taskCriterionInput(source, taskFile));
	const response = runLedgerCriteriaUpsert(loopName, inputs, true, operations);
	return {
		...response,
		contentText: response.error ? response.contentText : `Distilled ${inputs.length} task criteria in loop "${loopName}".`,
		details: { ...response.details, taskFile, distilledSources: sources },
	};
}

export function runLedgerCriteriaUpsert(loopName: string, inputs: Array<Partial<Criterion>>, isBatch: boolean, operations: Pick<LedgerOperations, "upsertCriterion">): AppToolMutationResponse<LoopState> {
	if (inputs.length === 0) return { contentText: "No criteria provided.", details: { loopName }, error: "No criteria provided." };
	const batch = runOrderedBatch(inputs, isBatch, (input) => {
		const result = operations.upsertCriterion(input);
		return result.ok ? { state: result.state, item: result.criterion, created: result.created } : result;
	});
	if (!batch.ok) return { contentText: batch.error, details: { ...batchFailureDetails(loopName, batch), criteria: [] }, error: batch.error };
	const created = batch.results.filter((result) => result.created).length;
	const contentText = batch.isBatch ? `Upserted ${batch.items.length} criteria in loop "${loopName}" (${created} created, ${batch.items.length - created} updated).` : `${created === 1 ? "Created" : "Updated"} criterion ${batch.items[0].id} in loop "${loopName}".`;
	return {
		contentText,
		details: { loopName, criteria: batch.items, criterion: batch.items[0], criterionLedger: batch.lastState.criterionLedger },
		state: batch.lastState,
	};
}

export function runLedgerArtifactRecord(loopName: string, inputs: Array<Partial<VerificationArtifact>>, isBatch: boolean, operations: Pick<LedgerOperations, "recordArtifact">): AppToolMutationResponse<LoopState> {
	if (inputs.length === 0) return { contentText: "No artifacts provided.", details: { loopName }, error: "No artifacts provided." };
	const batch = runOrderedBatch(inputs, isBatch, (input) => {
		const result = operations.recordArtifact(input);
		return result.ok ? { state: result.state, item: result.artifact, created: result.created } : result;
	});
	if (!batch.ok) return { contentText: batch.error, details: { ...batchFailureDetails(loopName, batch), artifacts: [] }, error: batch.error };
	const created = batch.results.filter((result) => result.created).length;
	const contentText = batch.isBatch ? `Recorded ${batch.items.length} artifacts in loop "${loopName}" (${created} created, ${batch.items.length - created} updated).` : `${created === 1 ? "Recorded" : "Updated"} artifact ${batch.items[0].id} in loop "${loopName}".`;
	return {
		contentText,
		details: { loopName, artifacts: batch.items, artifact: batch.items[0], verificationArtifacts: batch.lastState.verificationArtifacts },
		state: batch.lastState,
	};
}
