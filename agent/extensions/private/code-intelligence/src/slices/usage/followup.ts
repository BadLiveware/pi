import * as path from "node:path";
import { isRecord } from "../../util.ts";

export type ReturnedFileRecord = {
	file: string;
	rank: number;
	source: string;
};

export type ReturnedSegmentRecord = {
	file: string;
	startLine: number;
	endLine: number;
	rank: number;
	source: string;
	completeness?: string;
	rangeHash?: string;
};

export type CodeIntelResultIndex = {
	invocationId: string;
	sessionId: string;
	repoRoot?: string;
	cwd?: string;
	toolName: string;
	timestampMs: number;
	returnedFiles: ReturnedFileRecord[];
	returnedSegments: ReturnedSegmentRecord[];
};

export type FollowupPendingToolCall = {
	sessionId: string;
	repoRoot?: string;
	cwd?: string;
	toolName: string;
	category: string;
	followupShape?: Record<string, unknown>;
};

type MutationFollowup = {
	sessionId: string;
	repoRoot?: string;
	toolName: "edit" | "write";
	timestampMs: number;
};

const recentCodeIntelResults: CodeIntelResultIndex[] = [];
const recentMutationFollowups: MutationFollowup[] = [];
const maxRecentCodeIntelResults = 80;

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function rows(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? value.filter(isRecord) : [];
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
	return isRecord(value) ? value : undefined;
}

function normalizeRepoRelativePath(repoRoot: string | undefined, cwd: string | undefined, inputPath: unknown): string | undefined {
	const raw = stringValue(inputPath)?.replace(/^@/, "");
	if (!raw) return undefined;
	const normalized = raw.split(path.sep).join(path.posix.sep).replace(/^\.\//, "");
	if (!path.isAbsolute(raw)) return normalized;
	const roots = [repoRoot, cwd].filter((item): item is string => typeof item === "string" && item.length > 0);
	for (const root of roots) {
		const relative = path.relative(root, raw);
		if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return relative.split(path.sep).join(path.posix.sep);
	}
	return path.basename(raw);
}

function addReturnedFile(files: ReturnedFileRecord[], seen: Set<string>, file: unknown, source: string): void {
	const value = stringValue(file)?.replace(/^\.\//, "");
	if (!value || seen.has(value)) return;
	seen.add(value);
	files.push({ file: value, rank: files.length + 1, source });
}

function segmentFromValue(value: unknown, rank: number, source: string): ReturnedSegmentRecord | undefined {
	const row = recordValue(value);
	const target = recordValue(row?.target);
	const range = recordValue(row?.range) ?? recordValue(target?.range);
	const file = stringValue(target?.path);
	const startLine = numberValue(range?.startLine);
	const endLine = numberValue(range?.endLine);
	if (!file || !startLine || !endLine) return undefined;
	return { file, startLine, endLine, rank, source, completeness: stringValue(row?.sourceCompleteness), rangeHash: stringValue(target?.rangeHash) };
}

export function returnedSegmentsForResult(toolName: string, details: Record<string, unknown>): ReturnedSegmentRecord[] {
	if (toolName !== "code_intel_read_symbol") return [];
	const segments: ReturnedSegmentRecord[] = [];
	const targetSegment = segmentFromValue(details.targetSegment, 1, "read_symbol:target");
	if (targetSegment) segments.push(targetSegment);
	for (const row of rows(details.contextSegments)) {
		const segment = segmentFromValue(row, segments.length + 1, "read_symbol:context");
		if (segment) segments.push(segment);
	}
	return segments;
}

export function returnedFilesForResult(toolName: string, details: Record<string, unknown>): ReturnedFileRecord[] {
	const files: ReturnedFileRecord[] = [];
	const seen = new Set<string>();
	if (toolName === "code_intel_file_outline") addReturnedFile(files, seen, details.file, "outline:file");
	if (toolName === "code_intel_impact_map") {
		for (const row of rows(details.related).slice(0, 200)) addReturnedFile(files, seen, row.file, "impact:related");
		for (const row of rows(details.roots).slice(0, 50)) addReturnedFile(files, seen, row.file, "impact:root");
	}
	if (toolName === "code_intel_local_map") for (const row of rows(recordValue(details.summary)?.suggestedFiles).slice(0, 100)) addReturnedFile(files, seen, row.file, "local:suggested");
	if (toolName === "code_intel_syntax_search") for (const row of rows(details.matches).slice(0, 200)) addReturnedFile(files, seen, row.file, "syntax:match");
	if (toolName === "code_intel_repo_route") for (const row of rows(details.candidates).slice(0, 100)) addReturnedFile(files, seen, row.file, "route:candidate");
	if (toolName === "code_intel_test_map") for (const row of rows(details.candidates).slice(0, 100)) addReturnedFile(files, seen, row.file, "test:candidate");
	if (toolName === "code_intel_read_symbol") {
		for (const segment of returnedSegmentsForResult(toolName, details)) addReturnedFile(files, seen, segment.file, segment.source);
	}
	if (toolName === "code_intel_post_edit_map") {
		for (const row of rows(details.changedSymbols).slice(0, 100)) addReturnedFile(files, seen, recordValue(row.target)?.path, "post_edit:changed");
		for (const row of rows(details.diagnosticTargets).slice(0, 100)) addReturnedFile(files, seen, recordValue(row.target)?.path ?? recordValue(row.diagnostic)?.path, "post_edit:diagnostic");
		for (const row of rows(details.related).slice(0, 100)) addReturnedFile(files, seen, row.file, "post_edit:related");
		for (const row of rows(details.testCandidates).slice(0, 100)) addReturnedFile(files, seen, row.file, "post_edit:test");
	}
	if (toolName === "code_intel_repo_overview") {
		const visit = (dir: Record<string, unknown>): void => {
			for (const row of rows(dir.fileEntries)) addReturnedFile(files, seen, row.path, "overview:file");
			for (const child of rows(dir.children)) visit(child);
		};
		for (const dir of rows(details.directories)) visit(dir);
	}
	return files;
}

export function rememberCodeIntelResult(index: CodeIntelResultIndex): void {
	if (index.returnedFiles.length === 0 && index.returnedSegments.length === 0) return;
	recentCodeIntelResults.push(index);
	while (recentCodeIntelResults.length > maxRecentCodeIntelResults) recentCodeIntelResults.shift();
}

export function rememberMutationFollowup(pending: FollowupPendingToolCall): void {
	if ((pending.toolName !== "edit" && pending.toolName !== "write") || !pending.followupShape) return;
	if (pending.followupShape.afterCodeIntel !== true) return;
	recentMutationFollowups.push({ sessionId: pending.sessionId, repoRoot: pending.repoRoot, toolName: pending.toolName, timestampMs: Date.now() });
	while (recentMutationFollowups.length > maxRecentCodeIntelResults) recentMutationFollowups.shift();
}

export function followupShape(toolName: string, input: unknown, pending: FollowupPendingToolCall): Record<string, unknown> | undefined {
	if (toolName.startsWith("code_intel_") && toolName !== "code_intel_post_edit_map") return undefined;
	const category = pending.category;
	const recent = recentCodeIntelResults.filter((result) => result.sessionId === pending.sessionId && (!result.repoRoot || !pending.repoRoot || result.repoRoot === pending.repoRoot)).slice(-20);
	if (recent.length === 0) return undefined;
	const targetPath = isRecord(input) && (toolName === "read" || toolName === "edit" || toolName === "write") ? normalizeRepoRelativePath(pending.repoRoot, pending.cwd, input.path) : undefined;
	const readStart = isRecord(input) ? numberValue(input.offset) : undefined;
	const readLimit = isRecord(input) ? numberValue(input.limit) : undefined;
	const readEnd = readStart && readLimit ? readStart + readLimit - 1 : undefined;
	const fileMatches = targetPath ? recent.flatMap((result) => result.returnedFiles.filter((file) => file.file === targetPath).map((file) => ({ invocationId: result.invocationId, toolName: result.toolName, rank: file.rank, source: file.source }))).slice(-5) : [];
	const segmentMatches = targetPath ? recent.flatMap((result) => result.returnedSegments.filter((segment) => segment.file === targetPath && (!readStart || !readEnd || (readStart <= segment.startLine && readEnd >= segment.endLine) || (readStart >= segment.startLine && readStart <= segment.endLine))).map((segment) => ({ invocationId: result.invocationId, toolName: result.toolName, rank: segment.rank, source: segment.source, startLine: segment.startLine, endLine: segment.endLine, completeness: segment.completeness }))).slice(-5) : [];
	let followupKind: string | undefined;
	const recentMutations = recentMutationFollowups.filter((mutation) => mutation.sessionId === pending.sessionId && (!mutation.repoRoot || !pending.repoRoot || mutation.repoRoot === pending.repoRoot)).slice(-10);
	if (segmentMatches.length > 0 && toolName === "read") followupKind = "returned-segment-read";
	else if (segmentMatches.length > 0 && toolName === "edit") followupKind = "returned-segment-edit";
	else if (fileMatches.length > 0 && toolName === "write") followupKind = "returned-file-write";
	else if (fileMatches.length > 0 && toolName === "read") followupKind = "returned-file-read";
	else if (fileMatches.length > 0 && toolName === "edit") followupKind = "returned-file-edit";
	else if (toolName === "code_intel_post_edit_map" && recentMutations.some((mutation) => mutation.toolName === "write")) followupKind = "post-edit-map-after-write";
	else if (toolName === "code_intel_post_edit_map" && recentMutations.some((mutation) => mutation.toolName === "edit")) followupKind = "post-edit-map-after-edit";
	else if (toolName === "code_intel_post_edit_map" && recent.some((result) => result.toolName === "code_intel_read_symbol")) followupKind = "post-edit-map-after-code-intel";
	else if (category === "bash:search") followupKind = "compensatory-search";
	else if (category === "bash:test") followupKind = "validation-test";
	else if (category === "edit") followupKind = "edit-after-code-intel";
	else if (category === "write") followupKind = "write-after-code-intel";
	else if (category === "read") followupKind = "unmatched-read-after-code-intel";
	if (!followupKind) return undefined;
	return {
		afterCodeIntel: true,
		followupKind,
		recentCodeIntelCount: recent.length,
		matchedReturnedFileCount: fileMatches.length,
		matchedReturnedSegmentCount: segmentMatches.length,
		minReturnedFileRank: fileMatches.length ? Math.min(...fileMatches.map((match) => match.rank)) : undefined,
		minReturnedSegmentRank: segmentMatches.length ? Math.min(...segmentMatches.map((match) => match.rank)) : undefined,
		recentMutationFollowupCount: recentMutations.length || undefined,
		possibleDuplicateRead: toolName === "read" && segmentMatches.some((match) => match.completeness === "complete-segment"),
		matchedReturnedFiles: fileMatches.length ? fileMatches : undefined,
		matchedReturnedSegments: segmentMatches.length ? segmentMatches : undefined,
	};
}
