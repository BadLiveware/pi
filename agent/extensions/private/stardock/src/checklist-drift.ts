import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import * as path from "node:path";
import { compactText, type Criterion, type LoopState } from "./state/core.ts";
import { tryRead } from "./state/paths.ts";

export interface TaskChecklistItem {
	id: string;
	line: number;
	text: string;
	checked: boolean;
}

export type ChecklistLedgerDriftKind = "criterion_passed_task_unchecked" | "criterion_blocked_task_unchecked" | "task_checked_criterion_pending";

export interface ChecklistLedgerDrift {
	kind: ChecklistLedgerDriftKind;
	criterionId: string;
	criterionStatus: Criterion["status"];
	taskLine: number;
	taskText: string;
	checked: boolean;
	note: string;
}

function normalizeText(value: string | undefined): string {
	return (value ?? "")
		.toLowerCase()
		.replace(/`/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

export function extractTaskChecklistItems(taskContent: string, options: { idPrefix?: string; maxItems?: number } = {}): TaskChecklistItem[] {
	const idPrefix = options.idPrefix ?? "c-task";
	const maxItems = options.maxItems ?? 80;
	const items: TaskChecklistItem[] = [];
	for (const [index, line] of taskContent.split(/\r?\n/).entries()) {
		const checkbox = line.match(/^\s*[-*+]\s+\[([ xX])]\s+(.+)$/);
		if (!checkbox) continue;
		const text = checkbox[2].replace(/\s+/g, " ").trim();
		if (!text) continue;
		items.push({ id: `${idPrefix}-${String(items.length + 1).padStart(2, "0")}`, line: index + 1, text, checked: checkbox[1].toLowerCase() === "x" });
		if (items.length >= maxItems) break;
	}
	return items;
}

function criterionForItem(criteria: Criterion[], item: TaskChecklistItem): Criterion | undefined {
	const lineRef = `:L${item.line}`;
	return (
		criteria.find((criterion) => criterion.sourceRef?.endsWith(lineRef)) ??
		criteria.find((criterion) => criterion.id === item.id) ??
		criteria.find((criterion) => {
			const itemText = normalizeText(item.text);
			return normalizeText(criterion.requirement) === itemText || normalizeText(criterion.description) === itemText;
		})
	);
}

function hasAcceptedBreakoutPackage(state: LoopState, criterionId: string): boolean {
	return state.breakoutPackages.some((breakout) => (breakout.status === "resolved" || breakout.status === "dismissed") && breakout.blockedCriterionIds.includes(criterionId));
}

export function detectChecklistLedgerDrift(state: LoopState, taskContent: string): ChecklistLedgerDrift[] {
	const items = extractTaskChecklistItems(taskContent);
	const drift: ChecklistLedgerDrift[] = [];
	for (const item of items) {
		const criterion = criterionForItem(state.criterionLedger.criteria, item);
		if (!criterion) continue;
		if (!item.checked && criterion.status === "passed") {
			drift.push({ kind: "criterion_passed_task_unchecked", criterionId: criterion.id, criterionStatus: criterion.status, taskLine: item.line, taskText: item.text, checked: item.checked, note: "Criterion is passed but the matching task checklist item remains unchecked." });
		} else if (!item.checked && criterion.status === "blocked" && !hasAcceptedBreakoutPackage(state, criterion.id)) {
			drift.push({ kind: "criterion_blocked_task_unchecked", criterionId: criterion.id, criterionStatus: criterion.status, taskLine: item.line, taskText: item.text, checked: item.checked, note: "Criterion is blocked and the task item is unchecked without an accepted breakout package." });
		} else if (item.checked && criterion.status === "pending") {
			drift.push({ kind: "task_checked_criterion_pending", criterionId: criterion.id, criterionStatus: criterion.status, taskLine: item.line, taskText: item.text, checked: item.checked, note: "Task checklist item is checked but the matching criterion is still pending." });
		}
	}
	return drift;
}

export function loadChecklistLedgerDrift(ctx: ExtensionContext, state: LoopState): ChecklistLedgerDrift[] {
	const taskFile = path.isAbsolute(state.taskFile) ? state.taskFile : path.resolve(ctx.cwd, state.taskFile);
	const taskContent = tryRead(taskFile);
	return taskContent === null ? [] : detectChecklistLedgerDrift(state, taskContent);
}

export function formatChecklistLedgerDrift(drift: ChecklistLedgerDrift[]): string[] {
	if (!drift.length) return [];
	return ["Checklist / ledger drift", ...drift.slice(0, 8).map((item) => `  - ${item.kind}: ${item.criterionId} [${item.criterionStatus}] at task line ${item.taskLine} — ${compactText(item.taskText, 120)}`), ...(drift.length > 8 ? [`  ... ${drift.length - 8} more drift items`] : [])];
}
