export const promqlClickHouseDogfood = {
	sessionPath: "/home/fl/.pi/agent/sessions/--home-fl-code-personal-promshim-ch--/2026-05-05T18-19-48-795Z_019df95e-20ba-7258-b2fe-f7523abd671a.jsonl",
	loopName: "clickhouse-native-promql-upstreaming",
	summary: {
		entries: 4676,
		iterations: 16,
		criteria: { total: 17, passed: 16, blocked: 1 },
		artifacts: 89,
		briefs: 17,
		finalReports: 7,
		breakoutPackages: 1,
		auditorReviews: 1,
	},
	enumFriction: {
		artifactKinds: ["url", "manual", "diff", "pr", "doc", "command"] as const,
		finalReportStatuses: ["blocked", "skipped"] as const,
		breakoutStatusAlias: "blocked" as const,
	},
	acceptedDeferredCriterion: {
		criterionId: "c-pr15",
		finalReportId: "fr-pr15-blocked",
		breakoutPackageId: "bp-pr15-native-histogram-design-gate",
		auditorReviewId: "ar-final-self-assurance-review",
		expectedCompletionStatus: "ready_with_accepted_gaps" as const,
	},
};
