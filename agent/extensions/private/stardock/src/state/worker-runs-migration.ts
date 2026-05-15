import { compactText, type AdvisoryHandoffRole, type ChangedFileReport, type WorkerRun, type WorkerRunScope, type WorkerRunStatus } from "./core.ts";

function normalizeId(value: unknown, fallback: string): string {
	const raw = typeof value === "string" ? value.trim() : "";
	return raw || fallback;
}

function normalizeStringList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.map((item) => String(item).trim()).filter(Boolean).slice(0, 50);
}

function isAdvisoryHandoffRole(value: unknown): value is AdvisoryHandoffRole {
	return ["explorer", "test_runner", "researcher", "reviewer", "governor", "auditor", "implementer"].includes(String(value));
}

function isWorkerRunStatus(value: unknown): value is WorkerRunStatus {
	return ["running", "succeeded", "failed", "cancelled", "needs_review", "accepted", "dismissed"].includes(String(value));
}

function isWorkerRunScope(value: unknown): value is WorkerRunScope {
	return ["brief", "outside_request", "loop"].includes(String(value));
}

function migrateChangedFileReports(value: unknown): ChangedFileReport[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((item): ChangedFileReport | null => {
			if (!item || typeof item !== "object") return null;
			const file = item as Partial<ChangedFileReport> & Record<string, unknown>;
			const filePath = typeof file.path === "string" ? file.path.trim() : "";
			if (!filePath) return null;
			const summary = typeof file.summary === "string" && file.summary.trim() ? file.summary.trim() : "Changed file requires parent review if relevant.";
			return {
				path: compactText(filePath, 240) ?? filePath,
				summary: compactText(summary, 240) ?? summary,
				reviewReason: typeof file.reviewReason === "string" && file.reviewReason.trim() ? compactText(file.reviewReason.trim(), 240) ?? file.reviewReason.trim() : undefined,
			};
		})
		.filter((file): file is ChangedFileReport => file !== null);
}

export function migrateWorkerRuns(value: unknown): WorkerRun[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((item, index): WorkerRun | null => {
			if (!item || typeof item !== "object") return null;
			const run = item as Partial<WorkerRun> & Record<string, unknown>;
			const briefId = typeof run.briefId === "string" && run.briefId.trim() ? run.briefId.trim() : "";
			const outsideRequestId = typeof run.outsideRequestId === "string" && run.outsideRequestId.trim() ? run.outsideRequestId.trim() : "";
			const scope: WorkerRunScope = isWorkerRunScope(run.scope) ? run.scope : outsideRequestId ? "outside_request" : briefId ? "brief" : "loop";
			const requestId = typeof run.requestId === "string" && run.requestId.trim() ? run.requestId.trim() : "";
			if (!requestId) return null;
			const now = new Date().toISOString();
			return {
				id: normalizeId(run.id, `run${index + 1}`),
				role: isAdvisoryHandoffRole(run.role) ? run.role : "explorer",
				status: isWorkerRunStatus(run.status) ? run.status : "succeeded",
				scope,
				briefId: briefId || undefined,
				outsideRequestId: outsideRequestId || undefined,
				requestId,
				agentName: typeof run.agentName === "string" && run.agentName.trim() ? compactText(run.agentName.trim(), 120) ?? run.agentName.trim() : "worker",
				model: typeof run.model === "string" && run.model.trim() ? compactText(run.model.trim(), 120) ?? run.model.trim() : undefined,
				context: run.context === "fork" ? "fork" : "fresh",
				outputMode: run.outputMode === "inline" ? "inline" : "file-only",
				outputPath: typeof run.outputPath === "string" && run.outputPath.trim() ? compactText(run.outputPath.trim(), 240) ?? run.outputPath.trim() : undefined,
				reportId: typeof run.reportId === "string" && run.reportId.trim() ? run.reportId.trim() : undefined,
				summary: typeof run.summary === "string" && run.summary.trim() ? compactText(run.summary.trim(), 500) ?? run.summary.trim() : undefined,
				outputRefs: normalizeStringList(run.outputRefs).map((ref) => compactText(ref, 240) ?? ref),
				changedFiles: migrateChangedFileReports(run.changedFiles),
				reviewRationale: typeof run.reviewRationale === "string" && run.reviewRationale.trim() ? compactText(run.reviewRationale.trim(), 500) ?? run.reviewRationale.trim() : undefined,
				expectedMutation: typeof run.expectedMutation === "boolean" ? run.expectedMutation : undefined,
				allowDirtyWorkspace: run.allowDirtyWorkspace === true,
				startedAt: typeof run.startedAt === "string" ? run.startedAt : now,
				completedAt: typeof run.completedAt === "string" ? run.completedAt : undefined,
				updatedAt: typeof run.updatedAt === "string" ? run.updatedAt : now,
			};
		})
		.filter((run): run is WorkerRun => run !== null);
}
