/** Shared guidance for Stardock worker evidence promotion. */

export const WORKER_EVIDENCE_PROMOTION_NOTE = "Worker output is advisory until the parent records it as Stardock state. Inspect WorkerReports/saved output, then explicitly promote useful facts with stardock_ledger recordArtifact(s), stardock_ledger upsertCriterion, stardock_final_report record, stardock_auditor record, stardock_breakout record, or stardock_governor_state append/upsert.";

export const WORKER_EVIDENCE_NO_AUTOMATION_NOTE = "Stardock does not automatically turn worker claims into passed criteria, verification artifacts, final reports, breakout packages, auditor reviews, or governor memory.";

export function formatWorkerEvidencePromotionLines(): string[] {
	return [WORKER_EVIDENCE_PROMOTION_NOTE, WORKER_EVIDENCE_NO_AUTOMATION_NOTE];
}
