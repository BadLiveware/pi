import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

type ChecksState = "pass" | "fail" | "running" | "unknown";

interface GitHubCombinedStatus {
	state?: string;
	total_count?: number;
	statuses?: GitHubStatusContext[];
}

interface GitHubStatusContext {
	state?: string;
	context?: string;
	description?: string;
	target_url?: string | null;
}

interface GitHubCheckRuns {
	total_count?: number;
	check_runs?: GitHubCheckRun[];
}

interface GitHubCheckRun {
	id?: number;
	name?: string;
	status?: string;
	conclusion?: string | null;
	details_url?: string | null;
	html_url?: string | null;
	external_id?: string | null;
	output?: {
		title?: string | null;
		summary?: string | null;
		text?: string | null;
		annotations_count?: number;
	};
}

interface GitHubActionsJobs {
	total_count?: number;
	jobs?: GitHubActionsJob[];
}

interface GitHubActionsJob {
	id?: number;
	run_id?: number;
	name?: string;
	status?: string;
	conclusion?: string | null;
	html_url?: string | null;
	steps?: GitHubActionsJobStep[];
}

interface GitHubActionsJobStep {
	name?: string;
	number?: number;
	status?: string;
	conclusion?: string | null;
}

interface GitHubCheckRunAnnotation {
	path?: string;
	start_line?: number;
	end_line?: number;
	annotation_level?: string;
	message?: string;
	raw_details?: string | null;
}

interface RepoRef {
	host: "github";
	owner: string;
	repo: string;
}

interface PullRequestInfo {
	number: number;
	title: string;
	url: string;
	comments: number;
	checks: ChecksState;
	headSha?: string;
	base: RepoRef;
}

interface PullRequestFeedback {
	id: string;
	kind: "issue" | "review";
	author: string;
	body: string;
	url?: string;
	path?: string;
	updatedAt?: string;
}

interface PullRequestOpenFeedbackResult {
	items: PullRequestFeedback[];
	openCount: number;
}

interface PullRequestCiFailure {
	id: string;
	source: "check-run" | "status";
	name: string;
	conclusion: string;
	description?: string;
	url?: string;
	detailsUrl?: string;
	workflowRunId?: number;
	jobId?: number;
	failingSteps: Array<{
		name: string;
		number?: number;
		conclusion?: string | null;
	}>;
	annotations: Array<{
		path?: string;
		startLine?: number;
		endLine?: number;
		level?: string;
		message: string;
		rawDetails?: string;
	}>;
	logExcerpt?: string;
	outputSummary?: string;
}

interface BranchSnapshot {
	branch?: string;
	pr?: PullRequestInfo;
	updatedAt?: number;
	error?: string;
}

interface PrUpstreamSettings {
	autoSolveEnabled: boolean;
}

interface PrUpstreamStateEvent {
	branch?: string;
	error?: string;
	autoSolveEnabled: boolean;
	pr?: {
		number: number;
		title: string;
		url: string;
		comments: number;
		checks: ChecksState;
		headSha?: string;
		base: RepoRef;
	};
}

interface PrAutoSolveMessageDetails {
	kind: "auto_solve";
	pr: {
		number: number;
		title: string;
		url: string;
		checks: ChecksState;
		headSha?: string;
	};
	feedbackCount: number;
	ciFailureCount: number;
}

interface CodeHostProvider {
	id: string;
	parseRepo(remoteUrl: string): RepoRef | undefined;
	findOpenPullRequest(params: {
		repos: RepoRef[];
		headOwners: string[];
		branch: string;
		token?: string;
	}): Promise<PullRequestInfo | undefined>;
	fetchOpenFeedback(params: { pr: PullRequestInfo; token?: string; maxItems?: number }): Promise<PullRequestFeedback[]>;
	fetchCiFailures(params: { pr: PullRequestInfo; token?: string; maxItems?: number }): Promise<PullRequestCiFailure[]>;
}

const REFRESH_INTERVAL_MS = 90_000;
const REFRESH_MIN_GAP_MS = 15_000;
const AUTO_SOLVE_MIN_GAP_MS = 120_000;
const FRESH_SESSION_AUTO_SOLVE_GRACE_MS = 300_000;
const SUPPRESSION_NOTICE_GAP_MS = 300_000;
const CONFIG_FILE_NAME = "pr-upstream-status.json";
const MESSAGE_TYPE_PR_AUTO_SOLVE = "pr-upstream:auto-solve";
const DEFAULT_SETTINGS: PrUpstreamSettings = {
	autoSolveEnabled: true,
};

function agentDir(): string {
	return process.env.PI_CODING_AGENT_DIR ?? process.env.PI_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
}

function userConfigPath(): string {
	return path.join(agentDir(), CONFIG_FILE_NAME);
}

function normalizeSettings(input: Partial<PrUpstreamSettings>): Partial<PrUpstreamSettings> {
	const normalized: Partial<PrUpstreamSettings> = {};
	if (typeof input.autoSolveEnabled === "boolean") normalized.autoSolveEnabled = input.autoSolveEnabled;
	return normalized;
}

function readConfigFile(filePath: string): Partial<PrUpstreamSettings> | undefined {
	try {
		if (!fs.existsSync(filePath)) return undefined;
		const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Partial<PrUpstreamSettings>;
		return normalizeSettings(parsed);
	} catch {
		return undefined;
	}
}

function writeConfigFile(filePath: string, settings: PrUpstreamSettings): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
}

function safeRealpath(targetPath: string): string {
	try {
		return fs.realpathSync.native(targetPath);
	} catch {
		return path.resolve(targetPath);
	}
}

function readProcFile(filePath: string): string | undefined {
	try {
		return fs.readFileSync(filePath, "utf-8");
	} catch {
		return undefined;
	}
}

function isPiProcessCmdline(cmdline: string | undefined): boolean {
	if (!cmdline) return false;
	const firstArg = cmdline.split("\0").find(Boolean);
	if (!firstArg) return false;
	return path.basename(firstArg) === "pi";
}

function countOlderPiProcessesInWorkspace(cwd: string): number {
	if (process.platform !== "linux") return 0;
	const workspace = safeRealpath(cwd);
	let count = 0;
	for (const entry of fs.readdirSync("/proc", { withFileTypes: true })) {
		if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
		const pid = Number(entry.name);
		if (!Number.isFinite(pid) || pid >= process.pid) continue;

		const procDir = path.join("/proc", entry.name);
		if (!isPiProcessCmdline(readProcFile(path.join(procDir, "cmdline")))) continue;

		let procCwd: string;
		try {
			procCwd = fs.realpathSync.native(path.join(procDir, "cwd"));
		} catch {
			continue;
		}
		if (procCwd === workspace) count += 1;
	}
	return count;
}

function osc8(label: string, url: string): string {
	return `\u001b]8;;${url}\u0007${label}\u001b]8;;\u0007`;
}

function normalizeRemoteUrl(remoteUrl: string): string {
	const trimmed = remoteUrl.trim();
	if (trimmed.startsWith("git@")) {
		const withoutUser = trimmed.slice(4);
		const colon = withoutUser.indexOf(":");
		if (colon > -1) return `ssh://git@${withoutUser.slice(0, colon)}/${withoutUser.slice(colon + 1)}`;
	}
	return trimmed;
}

function parseGitHubRepo(remoteUrl: string): RepoRef | undefined {
	const normalized = normalizeRemoteUrl(remoteUrl);
	const match = normalized.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/i);
	if (!match) return undefined;
	return {
		host: "github",
		owner: match[1],
		repo: match[2],
	};
}

async function fetchGitHubJson<T>(path: string, token?: string, timeoutMs = 8_000): Promise<T | undefined> {
	const headers: Record<string, string> = {
		Accept: "application/vnd.github+json",
		"User-Agent": "pi-pr-upstream-status",
	};
	if (token) headers.Authorization = `Bearer ${token}`;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(`https://api.github.com${path}`, {
			headers,
			signal: controller.signal,
		});
		if (!response.ok) return undefined;
		return (await response.json()) as T;
	} catch {
		return undefined;
	} finally {
		clearTimeout(timer);
	}
}

async function fetchGitHubText(path: string, token?: string, timeoutMs = 15_000): Promise<string | undefined> {
	const headers: Record<string, string> = {
		Accept: "text/plain, application/vnd.github+json",
		"User-Agent": "pi-pr-upstream-status",
	};
	if (token) headers.Authorization = `Bearer ${token}`;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(`https://api.github.com${path}`, {
			headers,
			signal: controller.signal,
			redirect: "follow",
		});
		if (!response.ok) return undefined;
		return await response.text();
	} catch {
		return undefined;
	} finally {
		clearTimeout(timer);
	}
}

async function fetchGitHubGraphQL<T>(query: string, variables: Record<string, unknown>, token?: string, timeoutMs = 8_000): Promise<T | undefined> {
	if (!token) return undefined;
	const headers: Record<string, string> = {
		Accept: "application/vnd.github+json",
		"Content-Type": "application/json",
		"User-Agent": "pi-pr-upstream-status",
		Authorization: `Bearer ${token}`,
	};

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch("https://api.github.com/graphql", {
			method: "POST",
			headers,
			body: JSON.stringify({ query, variables }),
			signal: controller.signal,
		});
		if (!response.ok) return undefined;
		const payload = (await response.json()) as { data?: T; errors?: unknown[] };
		if (payload.errors?.length) return undefined;
		return payload.data;
	} catch {
		return undefined;
	} finally {
		clearTimeout(timer);
	}
}

function checksAreComplete(checks: ChecksState): boolean {
	return checks === "pass" || checks === "fail";
}

function resolveGitHubChecks(status: GitHubCombinedStatus | undefined, checkRuns: GitHubCheckRuns | undefined): ChecksState {
	let hasPassingSignal = false;
	let hasRunningSignal = false;
	let hasFailingSignal = false;

	// GitHub's combined status reports "pending" when there are zero legacy statuses;
	// ignore that placeholder and let check-runs determine the PR state.
	if ((status?.total_count ?? 0) > 0) {
		if (status?.state === "failure" || status?.state === "error") hasFailingSignal = true;
		else if (status?.state === "pending") hasRunningSignal = true;
		else if (status?.state === "success") hasPassingSignal = true;
	}

	for (const run of checkRuns?.check_runs ?? []) {
		if (run.status && run.status !== "completed") {
			hasRunningSignal = true;
			continue;
		}

		if (isFailureConclusion(run.conclusion)) {
			hasFailingSignal = true;
		} else if (["success", "neutral", "skipped"].includes(run.conclusion ?? "")) {
			hasPassingSignal = true;
		} else {
			hasRunningSignal = true;
		}
	}

	if (hasFailingSignal) return "fail";
	if (hasRunningSignal) return "running";
	if (hasPassingSignal) return "pass";
	return "unknown";
}

function isFailureConclusion(conclusion: string | null | undefined): boolean {
	return ["failure", "cancelled", "timed_out", "action_required", "startup_failure", "stale"].includes(conclusion ?? "");
}

function isFailedStatus(state: string | undefined): boolean {
	return state === "failure" || state === "error";
}

function parseGitHubActionsJobRef(detailsUrl: string | null | undefined): { runId?: number; jobId?: number } {
	if (!detailsUrl) return {};
	const match = detailsUrl.match(/\/actions\/runs\/(\d+)\/job\/(\d+)/);
	if (!match) return {};
	return {
		runId: Number(match[1]),
		jobId: Number(match[2]),
	};
}

function truncateText(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]`;
}

function stripAnsi(text: string): string {
	return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function ciFailureKey(pr: PullRequestInfo, failure: PullRequestCiFailure): string {
	const stepKey = failure.failingSteps.map((step) => `${step.number ?? "?"}:${step.name}:${step.conclusion ?? ""}`).join("|");
	return `${pr.headSha ?? "unknown-head"}:${failure.source}:${failure.id}:${failure.conclusion}:${stepKey}`;
}

function extractFailureLogExcerpt(logText: string, failedStepNames: string[]): string | undefined {
	const lines = stripAnsi(logText).replace(/\r/g, "").split("\n");
	if (lines.length === 0) return undefined;

	const anchors: number[] = [];
	const lowerFailedStepNames = failedStepNames.map((name) => name.toLowerCase()).filter(Boolean);
	const errorPattern = /##\[error\]|\b(error|failed|failure|panic|exception|traceback)\b|exit code|^FAIL\b|\bFAILED\b/i;

	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i];
		const lower = line.toLowerCase();
		if (errorPattern.test(line)) anchors.push(i);
		else if (lowerFailedStepNames.some((name) => lower.includes(name))) anchors.push(i);
		if (anchors.length >= 10) break;
	}

	if (anchors.length === 0) {
		const tail = lines.slice(Math.max(0, lines.length - 120));
		return truncateText(tail.join("\n"), 18_000);
	}

	const windows = anchors.map((anchor) => ({ start: Math.max(0, anchor - 25), end: Math.min(lines.length, anchor + 35) }));
	windows.sort((a, b) => a.start - b.start);
	const merged: Array<{ start: number; end: number }> = [];
	for (const window of windows) {
		const last = merged[merged.length - 1];
		if (last && window.start <= last.end + 5) {
			last.end = Math.max(last.end, window.end);
		} else {
			merged.push({ ...window });
		}
	}

	let remainingLines = 180;
	const chunks: string[] = [];
	for (const window of merged) {
		if (remainingLines <= 0) break;
		const slice = lines.slice(window.start, Math.min(window.end, window.start + remainingLines));
		remainingLines -= slice.length;
		chunks.push(`[log lines ${window.start + 1}-${window.start + slice.length}]\n${slice.join("\n")}`);
	}

	return truncateText(chunks.join("\n\n...\n\n"), 22_000);
}

function feedbackKey(item: PullRequestFeedback): string {
	return `${item.kind}:${item.id}:${item.updatedAt ?? ""}`;
}

const FEEDBACK_BODY_MAX_CHARS = 1_200;
const FEEDBACK_DESCRIPTION_MAX_CHARS = 700;

function compactWhitespace(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function markedHtmlCommentSection(body: string, name: string): string | undefined {
	const match = body.match(new RegExp(`<!--\\s*${name} START\\s*-->([\\s\\S]*?)<!--\\s*${name} END\\s*-->`, "i"));
	return match?.[1]?.trim();
}

function stripReviewBotChrome(body: string): string {
	return body
		.replace(/<details\b[\s\S]*?<\/details>/gi, "")
		.replace(/<div\b[\s\S]*?<\/div>/gi, "")
		.replace(/<sup\b[\s\S]*?<\/sup>/gi, "")
		.replace(/<!--([\s\S]*?)-->/g, "")
		.trim();
}

export function summarizeFeedbackBody(body: string): string {
	const title = body.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim();
	const severity = body.match(/^(Low|Medium|High|Critical) Severity$/im)?.[0]?.trim();
	const description = markedHtmlCommentSection(body, "DESCRIPTION");
	const locations = markedHtmlCommentSection(body, "LOCATIONS")
		?.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.join(", ");

	const parts = [
		title ? `Title: ${title}` : undefined,
		severity ? `Severity: ${severity}` : undefined,
		description ? `Summary: ${truncateText(compactWhitespace(description), FEEDBACK_DESCRIPTION_MAX_CHARS)}` : undefined,
		locations ? `Locations: ${locations}` : undefined,
	].filter(Boolean);
	if (parts.length > 0) return parts.join("\n");

	return truncateText(stripReviewBotChrome(body), FEEDBACK_BODY_MAX_CHARS);
}

export function summarizeFeedback(items: PullRequestFeedback[]): string {
	return items
		.map((item, index) => {
			const loc = item.path ? ` (${item.path})` : "";
			const link = item.url ? `\nURL: ${item.url}` : "";
			return `${index + 1}. [${item.kind}] @${item.author}${loc}\n${summarizeFeedbackBody(item.body)}${link}`;
		})
		.join("\n\n");
}

function summarizeCiFailures(items: PullRequestCiFailure[]): string {
	return items
		.map((item, index) => {
			const links = [item.url ? `URL: ${item.url}` : undefined, item.detailsUrl && item.detailsUrl !== item.url ? `Details: ${item.detailsUrl}` : undefined]
				.filter(Boolean)
				.join("\n");
			const steps = item.failingSteps.length
				? item.failingSteps
					.map((step) => `- ${step.number ? `#${step.number} ` : ""}${step.name}${step.conclusion ? ` (${step.conclusion})` : ""}`)
					.join("\n")
				: "- No failed step metadata available; inspect the log/context below.";
			const annotations = item.annotations.length
				? item.annotations
					.map((annotation) => {
						const loc = annotation.path ? `${annotation.path}${annotation.startLine ? `:${annotation.startLine}` : ""}${annotation.endLine && annotation.endLine !== annotation.startLine ? `-${annotation.endLine}` : ""}` : "no file";
						const raw = annotation.rawDetails ? `\n  raw: ${truncateText(annotation.rawDetails, 1_500)}` : "";
						return `- ${annotation.level ?? "annotation"} ${loc}: ${annotation.message}${raw}`;
					})
					.join("\n")
				: "- None returned by GitHub.";
			const summary = item.outputSummary ? `\nCheck output summary:\n${truncateText(item.outputSummary, 3_000)}\n` : "";
			const log = item.logExcerpt ? `\nLog excerpt:\n\`\`\`text\n${item.logExcerpt}\n\`\`\`` : "\nLog excerpt: unavailable from GitHub API; use the linked check details if needed.";
			return [
				`${index + 1}. ${item.name} [${item.source}] -> ${item.conclusion}`,
				item.description ? `Description: ${item.description}` : undefined,
				links || undefined,
				item.workflowRunId || item.jobId ? `Workflow run/job: ${item.workflowRunId ?? "unknown"}/${item.jobId ?? "unknown"}` : undefined,
				`Failed step(s):\n${steps}`,
				`Annotations:\n${annotations}`,
				summary.trim() ? summary.trim() : undefined,
				log,
			]
				.filter(Boolean)
				.join("\n");
		})
		.join("\n\n");
}

async function fetchGitHubOpenFeedback(params: {
	owner: string;
	repo: string;
	number: number;
	token?: string;
	maxItems?: number;
}): Promise<PullRequestOpenFeedbackResult | undefined> {
	const maxItems = params.maxItems ?? 20;
	const data = await fetchGitHubGraphQL<{
		repository?: {
			pullRequest?: {
				comments?: {
					totalCount?: number;
					nodes?: Array<{
						id: string;
						body?: string;
						url?: string;
						updatedAt?: string;
						author?: { login?: string } | null;
					}>;
				};
				reviewThreads?: {
					nodes?: Array<{
						id: string;
						isResolved?: boolean;
						path?: string;
						comments?: {
							nodes?: Array<{
								id: string;
								body?: string;
								url?: string;
								updatedAt?: string;
								path?: string;
								author?: { login?: string } | null;
							}>;
						};
					}>;
				};
			};
		};
	}>(
		`query($owner: String!, $repo: String!, $number: Int!) {
			repository(owner: $owner, name: $repo) {
				pullRequest(number: $number) {
					comments(first: 100) {
						totalCount
						nodes { id body url updatedAt author { login } }
					}
					reviewThreads(first: 100) {
						nodes {
							id
							isResolved
							path
							comments(first: 20) { nodes { id body url updatedAt path author { login } } }
						}
					}
				}
			}
		}`,
		{ owner: params.owner, repo: params.repo, number: params.number },
		params.token,
	);
	const pr = data?.repository?.pullRequest;
	if (!pr) return undefined;

	const items: PullRequestFeedback[] = [];
	for (const comment of pr.comments?.nodes ?? []) {
		const body = comment.body?.trim();
		if (!body) continue;
		items.push({
			id: `issue-${comment.id}`,
			kind: "issue",
			author: comment.author?.login ?? "unknown",
			body,
			url: comment.url,
			updatedAt: comment.updatedAt,
		});
	}

	for (const thread of pr.reviewThreads?.nodes ?? []) {
		if (thread.isResolved) continue;
		const firstComment = thread.comments?.nodes?.[0];
		const body = firstComment?.body?.trim();
		if (!body) continue;
		items.push({
			id: `review-thread-${thread.id}`,
			kind: "review",
			author: firstComment?.author?.login ?? "unknown",
			body,
			url: firstComment?.url,
			path: firstComment?.path ?? thread.path,
			updatedAt: firstComment?.updatedAt,
		});
	}

	items.sort((a, b) => (a.updatedAt ?? "").localeCompare(b.updatedAt ?? ""));
	return {
		items: maxItems > 0 ? items.slice(-maxItems) : [],
		openCount: (pr.comments?.totalCount ?? 0) + (pr.reviewThreads?.nodes ?? []).filter((thread) => !thread.isResolved).length,
	};
}

const githubProvider: CodeHostProvider = {
	id: "github",
	parseRepo: parseGitHubRepo,
	async findOpenPullRequest({ repos, headOwners, branch, token }) {
		const uniqueRepos = dedupeRepos(repos);
		const owners = Array.from(new Set(headOwners.filter(Boolean)));

		for (const baseRepo of uniqueRepos) {
			const ownerCandidates = Array.from(new Set([baseRepo.owner, ...owners]));
			for (const headOwner of ownerCandidates) {
				const pulls = await fetchGitHubJson<
					Array<{
						number: number;
						title: string;
						html_url: string;
						comments: number;
						review_comments: number;
						head?: { sha?: string };
					}>
				>(`/repos/${baseRepo.owner}/${baseRepo.repo}/pulls?state=open&head=${encodeURIComponent(`${headOwner}:${branch}`)}&per_page=1`, token);

				const pr = pulls?.[0];
				if (!pr) continue;

				// GitHub's list endpoint omits comment counts; the PR detail endpoint includes them.
				const details = await fetchGitHubJson<{
					number: number;
					title?: string;
					html_url?: string;
					comments?: number;
					review_comments?: number;
					head?: { sha?: string };
				}>(`/repos/${baseRepo.owner}/${baseRepo.repo}/pulls/${pr.number}`, token);
				const headSha = details?.head?.sha ?? pr.head?.sha;

				const [status, checkRuns] = headSha
					? await Promise.all([
						fetchGitHubJson<GitHubCombinedStatus>(`/repos/${baseRepo.owner}/${baseRepo.repo}/commits/${headSha}/status`, token),
						fetchGitHubJson<GitHubCheckRuns>(`/repos/${baseRepo.owner}/${baseRepo.repo}/commits/${headSha}/check-runs?per_page=100&filter=latest`, token),
					])
					: [undefined, undefined];
				const checkState = resolveGitHubChecks(status, checkRuns);
				const openFeedback = await fetchGitHubOpenFeedback({
					owner: baseRepo.owner,
					repo: baseRepo.repo,
					number: pr.number,
					token,
					maxItems: 0,
				});

				return {
					number: pr.number,
					title: details?.title ?? pr.title,
					url: details?.html_url ?? pr.html_url,
					comments: openFeedback?.openCount ?? (details?.comments ?? pr.comments ?? 0),
					checks: checkState,
					headSha,
					base: baseRepo,
				};
			}
		}
		return undefined;
	},
	async fetchOpenFeedback({ pr, token, maxItems = 20 }) {
		const openFeedback = await fetchGitHubOpenFeedback({
			owner: pr.base.owner,
			repo: pr.base.repo,
			number: pr.number,
			token,
			maxItems,
		});
		if (openFeedback) return openFeedback.items;

		const issueComments = await fetchGitHubJson<
			Array<{
				id: number;
				body?: string;
				updated_at?: string;
				html_url?: string;
				user?: { login?: string };
			}>
		>(`/repos/${pr.base.owner}/${pr.base.repo}/issues/${pr.number}/comments?per_page=100`, token);

		const fallbackItems: PullRequestFeedback[] = [];
		for (const comment of issueComments ?? []) {
			const body = comment.body?.trim();
			if (!body) continue;
			fallbackItems.push({
				id: `issue-${comment.id}`,
				kind: "issue",
				author: comment.user?.login ?? "unknown",
				body,
				url: comment.html_url,
				updatedAt: comment.updated_at,
			});
		}
		return fallbackItems
			.sort((a, b) => (a.updatedAt ?? "").localeCompare(b.updatedAt ?? ""))
			.slice(-maxItems);
	},
	async fetchCiFailures({ pr, token, maxItems = 10 }) {
		if (!pr.headSha) return [];

		const [status, checkRuns] = await Promise.all([
			fetchGitHubJson<GitHubCombinedStatus>(`/repos/${pr.base.owner}/${pr.base.repo}/commits/${pr.headSha}/status`, token),
			fetchGitHubJson<GitHubCheckRuns>(`/repos/${pr.base.owner}/${pr.base.repo}/commits/${pr.headSha}/check-runs?per_page=100&filter=latest`, token),
		]);

		const failures: PullRequestCiFailure[] = [];
		const failedRunNames = new Set<string>();
		for (const run of checkRuns?.check_runs ?? []) {
			if (run.status && run.status !== "completed") continue;
			if (!isFailureConclusion(run.conclusion)) continue;
			const name = run.name ?? `check-run-${run.id ?? failures.length + 1}`;
			failedRunNames.add(name);

			const { runId, jobId } = parseGitHubActionsJobRef(run.details_url);
			let job: GitHubActionsJob | undefined;
			if (runId) {
				const jobs = await fetchGitHubJson<GitHubActionsJobs>(`/repos/${pr.base.owner}/${pr.base.repo}/actions/runs/${runId}/jobs?per_page=100&filter=latest`, token);
				job = jobs?.jobs?.find((candidate) => candidate.id === jobId)
					?? jobs?.jobs?.find((candidate) => candidate.name === name && isFailureConclusion(candidate.conclusion));
			}

			const failingSteps = (job?.steps ?? [])
				.filter((step) => step.status === "completed" && isFailureConclusion(step.conclusion))
				.map((step) => ({
					name: step.name ?? `step-${step.number ?? "unknown"}`,
					number: step.number,
					conclusion: step.conclusion,
				}));

			const annotations = run.id
				? await fetchGitHubJson<GitHubCheckRunAnnotation[]>(`/repos/${pr.base.owner}/${pr.base.repo}/check-runs/${run.id}/annotations?per_page=50`, token)
				: undefined;

			const logText = job?.id
				? await fetchGitHubText(`/repos/${pr.base.owner}/${pr.base.repo}/actions/jobs/${job.id}/logs`, token)
				: undefined;
			const outputSummary = [run.output?.title, run.output?.summary, run.output?.text]
				.map((value) => value?.trim())
				.filter((value): value is string => Boolean(value))
				.join("\n\n");

			failures.push({
				id: run.id ? String(run.id) : `${name}:${run.conclusion ?? "unknown"}`,
				source: "check-run",
				name,
				conclusion: run.conclusion ?? "unknown",
				url: run.html_url ?? run.details_url ?? undefined,
				detailsUrl: run.details_url ?? undefined,
				workflowRunId: job?.run_id ?? runId,
				jobId: job?.id ?? jobId,
				failingSteps,
				annotations: (annotations ?? []).map((annotation) => ({
					path: annotation.path,
					startLine: annotation.start_line,
					endLine: annotation.end_line,
					level: annotation.annotation_level,
					message: annotation.message ?? "",
					rawDetails: annotation.raw_details ?? undefined,
				})).filter((annotation) => annotation.message.trim().length > 0),
				logExcerpt: logText ? extractFailureLogExcerpt(logText, failingSteps.map((step) => step.name)) : undefined,
				outputSummary: outputSummary || undefined,
			});
		}

		for (const statusContext of status?.statuses ?? []) {
			if (!isFailedStatus(statusContext.state)) continue;
			const name = statusContext.context ?? "legacy-status";
			if (failedRunNames.has(name)) continue;
			failures.push({
				id: `status:${name}:${statusContext.target_url ?? ""}`,
				source: "status",
				name,
				conclusion: statusContext.state ?? "failure",
				description: statusContext.description,
				url: statusContext.target_url ?? undefined,
				detailsUrl: statusContext.target_url ?? undefined,
				failingSteps: [],
				annotations: [],
			});
		}

		return failures.slice(0, maxItems);
	},
};

function dedupeRepos(repos: RepoRef[]): RepoRef[] {
	const seen = new Set<string>();
	const out: RepoRef[] = [];
	for (const repo of repos) {
		const key = `${repo.host}:${repo.owner}/${repo.repo}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(repo);
	}
	return out;
}

async function findOpenPullRequestViaGitRefs(pi: ExtensionAPI, cwd: string, baseRepo: RepoRef): Promise<PullRequestInfo | undefined> {
	const localHeadSha = await runGit(pi, cwd, "rev-parse", "HEAD");
	if (!localHeadSha) return undefined;

	const remotesOut = await runGit(pi, cwd, "remote");
	if (!remotesOut) return undefined;
	const remoteNames = remotesOut
		.split(/\r?\n/)
		.map((r) => r.trim())
		.filter(Boolean);
	const preferred = ["upstream", "origin"];
	const orderedRemotes = [...preferred.filter((name) => remoteNames.includes(name)), ...remoteNames.filter((name) => !preferred.includes(name))];

	for (const remoteName of orderedRemotes) {
		const refs = await pi.exec("git", ["ls-remote", remoteName, "refs/pull/*/head"], { cwd, timeout: 12_000 });
		if (refs.code !== 0 || !refs.stdout.trim()) continue;

		for (const line of refs.stdout.split(/\r?\n/)) {
			if (!line.trim()) continue;
			const [sha, ref] = line.split(/\s+/);
			if (!sha || !ref || sha !== localHeadSha) continue;
			const match = ref.match(/^refs\/pull\/(\d+)\/head$/);
			if (!match) continue;

			const number = Number(match[1]);
			if (!Number.isFinite(number)) continue;
			return {
				number,
				title: `PR #${number}`,
				url: `https://github.com/${baseRepo.owner}/${baseRepo.repo}/pull/${number}`,
				comments: 0,
				checks: "unknown",
				headSha: localHeadSha,
				base: baseRepo,
			};
		}
	}

	return undefined;
}

async function runGit(pi: ExtensionAPI, cwd: string, ...args: string[]): Promise<string | undefined> {
	const result = await pi.exec("git", args, { cwd, timeout: 6_000 });
	if (result.code !== 0) return undefined;
	const value = result.stdout.trim();
	return value.length > 0 ? value : undefined;
}

async function discoverRepoContext(pi: ExtensionAPI, cwd: string, provider: CodeHostProvider): Promise<{ branch: string; repos: RepoRef[]; headOwners: string[] } | undefined> {
	const branch = await runGit(pi, cwd, "branch", "--show-current");
	if (!branch) return undefined;

	const remotesOut = await runGit(pi, cwd, "remote");
	if (!remotesOut) return undefined;

	const remoteNames = remotesOut
		.split(/\r?\n/)
		.map((n) => n.trim())
		.filter(Boolean);

	const preferred = ["upstream", "origin"];
	const orderedNames = [...preferred.filter((name) => remoteNames.includes(name)), ...remoteNames.filter((name) => !preferred.includes(name))];

	const repos: RepoRef[] = [];
	const headOwners: string[] = [];
	for (const remote of orderedNames) {
		const remoteUrl = await runGit(pi, cwd, "remote", "get-url", remote);
		if (!remoteUrl) continue;
		const repo = provider.parseRepo(remoteUrl);
		if (!repo) continue;
		repos.push(repo);
		headOwners.push(repo.owner);
	}

	if (repos.length === 0) return undefined;
	return { branch, repos, headOwners };
}

function renderCheck(theme: ExtensionContext["ui"]["theme"], checks: ChecksState): string {
	if (checks === "pass") return theme.fg("success", "✅");
	if (checks === "fail") return theme.fg("error", "❌");
	if (checks === "running") return theme.fg("warning", "⏳");
	return theme.fg("muted", "•");
}

function countLabel(count: number, singular: string, plural: string): string {
	return count === 1 ? `1 ${singular}` : `${count} ${plural}`;
}

function registerAutoSolveMessageRenderer(pi: ExtensionAPI): void {
	pi.registerMessageRenderer<PrAutoSolveMessageDetails>(MESSAGE_TYPE_PR_AUTO_SOLVE, (message, _options, theme) => {
		const details = message.details;
		if (!details || details.kind !== "auto_solve") return undefined;

		const prLabel = osc8(theme.fg("accent", `#${details.pr.number}`), details.pr.url);
		const feedback = countLabel(details.feedbackCount, "comment", "comments");
		const ciFailures = countLabel(details.ciFailureCount, "CI failure", "CI failures");
		const text =
			theme.fg("warning", "✦ ") +
			theme.fg("warning", "auto-solve queued ") +
			prLabel +
			theme.fg("muted", ` ${feedback}, ${ciFailures}`);

		return {
			render: () => [text],
			invalidate: () => {},
		};
	});
}

export default function prUpstreamStatus(pi: ExtensionAPI): void {
	const provider = githubProvider;
	let token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
	let attemptedGhToken = false;

	let settings: PrUpstreamSettings = { ...DEFAULT_SETTINGS };
	let snapshot: BranchSnapshot = {};
	let refreshTimer: ReturnType<typeof setInterval> | undefined;
	let refreshInFlight = false;
	let autoSolveEnabled = settings.autoSolveEnabled;
	let autoSolvePromptInFlight = false;
	let lastAutoSolveAt = 0;
	let lastFreshSessionSuppressionNoticeAt = 0;
	let lastWorkspaceSuppressionNoticeAt = 0;
	let sessionStartedAt = Date.now();
	let lastPromptedHeadSha: string | undefined;
	let promptedFeedbackKeys = new Set<string>();
	let promptedCiFailureKeys = new Set<string>();
	let lastRefreshAt = 0;

	registerAutoSolveMessageRenderer(pi);

	function loadSettings(): void {
		settings = { ...DEFAULT_SETTINGS, ...readConfigFile(userConfigPath()) };
		autoSolveEnabled = settings.autoSolveEnabled;
	}

	function persistSettings(): void {
		writeConfigFile(userConfigPath(), settings);
		pi.appendEntry("pr-upstream-status-state", settings);
	}

	function setAutoSolveEnabled(enabled: boolean): void {
		autoSolveEnabled = enabled;
		settings.autoSolveEnabled = enabled;
		persistSettings();
		emitPrimitives();
	}

	async function maybeLoadTokenFromGh(ctx: ExtensionContext): Promise<void> {
		if (token || attemptedGhToken) return;
		attemptedGhToken = true;
		const result = await pi.exec("gh", ["auth", "token"], { cwd: ctx.cwd, timeout: 4_000 });
		if (result.code !== 0) return;
		const discovered = result.stdout.trim();
		if (!discovered) return;
		token = discovered;
	}

	function emitPrimitives(): void {
		const payload: PrUpstreamStateEvent = {
			branch: snapshot.branch,
			error: snapshot.error,
			autoSolveEnabled,
			pr: snapshot.pr
				? {
					number: snapshot.pr.number,
					title: snapshot.pr.title,
					url: snapshot.pr.url,
					comments: snapshot.pr.comments,
					checks: snapshot.pr.checks,
					headSha: snapshot.pr.headSha,
					base: snapshot.pr.base,
				}
				: undefined,
		};
		pi.events.emit("pr-upstream:state", payload);
	}

	function updateStatus(ctx: ExtensionContext): void {
		if (!snapshot.pr) {
			ctx.ui.setStatus("pr-upstream", undefined);
			return;
		}
		const parts = [ctx.ui.theme.fg("muted", "PR"), renderCheck(ctx.ui.theme, snapshot.pr.checks)];
		if (snapshot.pr.comments > 0) {
			parts.push(ctx.ui.theme.fg("muted", `💬${snapshot.pr.comments}`));
		}
		const prLabel = osc8(ctx.ui.theme.fg("accent", `#${snapshot.pr.number}`), snapshot.pr.url);
		parts.push(prLabel);
		ctx.ui.setStatus("pr-upstream", parts.join(" "));
	}

	function autoSolveStatusText(ctx?: ExtensionContext): string {
		if (!autoSolveEnabled) return "off";
		const olderCount = ctx ? countOlderPiProcessesInWorkspace(ctx.cwd) : 0;
		if (olderCount > 0) return `on (paused: ${olderCount} older Pi session${olderCount === 1 ? "" : "s"} in this workspace)`;

		const freshRemainingMs = Math.max(0, FRESH_SESSION_AUTO_SOLVE_GRACE_MS - (Date.now() - sessionStartedAt));
		if (freshRemainingMs > 0) return `on (paused: fresh session, ${Math.ceil(freshRemainingMs / 1000)}s remaining)`;
		return "on";
	}

	function shouldSuppressAutoSolveForFreshSession(ctx: ExtensionContext, allowFreshSession: boolean): boolean {
		if (allowFreshSession) return false;
		const freshRemainingMs = FRESH_SESSION_AUTO_SOLVE_GRACE_MS - (Date.now() - sessionStartedAt);
		if (freshRemainingMs <= 0) return false;

		const now = Date.now();
		if (now - lastFreshSessionSuppressionNoticeAt >= SUPPRESSION_NOTICE_GAP_MS) {
			lastFreshSessionSuppressionNoticeAt = now;
			ctx.ui.notify(
				`PR auto-solve would have run, but this Pi session is fresh. It will be allowed in ${Math.ceil(freshRemainingMs / 1000)}s or with /pr-autosolve now.`,
				"info",
			);
		}
		return true;
	}

	function shouldSuppressAutoSolveForWorkspace(ctx: ExtensionContext, allowConcurrentWorkspace: boolean): boolean {
		if (allowConcurrentWorkspace) return false;
		const olderCount = countOlderPiProcessesInWorkspace(ctx.cwd);
		if (olderCount === 0) return false;

		const now = Date.now();
		if (now - lastWorkspaceSuppressionNoticeAt >= SUPPRESSION_NOTICE_GAP_MS) {
			lastWorkspaceSuppressionNoticeAt = now;
			ctx.ui.notify(
				`PR auto-solve would have run, but ${olderCount} older Pi session${olderCount === 1 ? " is" : "s are"} already running in this workspace. Use /pr-autosolve now to force this session.`,
				"info",
			);
		}
		return true;
	}

	async function maybeAutoSolve(
		ctx: ExtensionContext,
		options: {
			force?: boolean;
			allowConcurrentWorkspace?: boolean;
			allowFreshSession?: boolean;
			ignoreDisabled?: boolean;
			ignoreIncompleteChecks?: boolean;
			includePrompted?: boolean;
		} = {},
	): Promise<boolean> {
		const {
			force = false,
			allowConcurrentWorkspace = false,
			allowFreshSession = false,
			ignoreDisabled = false,
			ignoreIncompleteChecks = false,
			includePrompted = false,
		} = options;
		const pr = snapshot.pr;
		if ((!autoSolveEnabled && !ignoreDisabled) || !pr) return false;
		if (!ignoreIncompleteChecks && !checksAreComplete(pr.checks)) return false;
		if (!ctx.isIdle() || ctx.hasPendingMessages()) return false;
		if (autoSolvePromptInFlight) return false;
		if (shouldSuppressAutoSolveForWorkspace(ctx, allowConcurrentWorkspace)) return false;
		if (shouldSuppressAutoSolveForFreshSession(ctx, allowFreshSession)) return false;

		if (lastPromptedHeadSha && pr.headSha && pr.headSha !== lastPromptedHeadSha) {
			promptedFeedbackKeys = new Set<string>();
			promptedCiFailureKeys = new Set<string>();
		}
		lastPromptedHeadSha = pr.headSha;

		const now = Date.now();
		if (!force && now - lastAutoSolveAt < AUTO_SOLVE_MIN_GAP_MS) return false;

		autoSolvePromptInFlight = true;
		try {
			const [feedback, ciFailures] = await Promise.all([
				provider.fetchOpenFeedback({ pr, token, maxItems: 30 }),
				pr.checks === "fail" ? provider.fetchCiFailures({ pr, token, maxItems: 10 }) : Promise.resolve<PullRequestCiFailure[]>([]),
			]);
			const targetFeedback = includePrompted ? feedback : feedback.filter((item) => !promptedFeedbackKeys.has(feedbackKey(item)));
			const targetCiFailures = includePrompted ? ciFailures : ciFailures.filter((item) => !promptedCiFailureKeys.has(ciFailureKey(pr, item)));
			if (targetFeedback.length === 0 && targetCiFailures.length === 0) return false;

			for (const key of targetFeedback.map(feedbackKey)) promptedFeedbackKeys.add(key);
			for (const failure of targetCiFailures) promptedCiFailureKeys.add(ciFailureKey(pr, failure));
			lastAutoSolveAt = now;

			const promptParts = [
				`Auto-solve PR #${pr.number}: ${pr.url}`,
				`Checks: ${pr.checks}${pr.headSha ? `, head: ${pr.headSha}` : ""}.`,
				"Review only true/relevant PR feedback; for CI, find the failing job/step/root cause. Inspect linked details if this summary is incomplete. Make minimal changes, validate locally, and summarize fixes/dismissals/validation.",
			];
			if (targetFeedback.length > 0) {
				promptParts.push("", "PR comments:", summarizeFeedback(targetFeedback));
			}
			if (targetCiFailures.length > 0) {
				promptParts.push("", "CI failure context:", summarizeCiFailures(targetCiFailures));
			}

			const commentText = countLabel(targetFeedback.length, "PR comment", "PR comments");
			const ciText = countLabel(targetCiFailures.length, "CI failure", "CI failures");
			ctx.ui.notify(`Auto-solve queued for ${commentText} and ${ciText}.`, "info");
			pi.sendMessage(
				{
					customType: MESSAGE_TYPE_PR_AUTO_SOLVE,
					content: promptParts.join("\n"),
					display: true,
					details: {
						kind: "auto_solve",
						pr: {
							number: pr.number,
							title: pr.title,
							url: pr.url,
							checks: pr.checks,
							headSha: pr.headSha,
						},
						feedbackCount: targetFeedback.length,
						ciFailureCount: targetCiFailures.length,
					} satisfies PrAutoSolveMessageDetails,
				},
				{ triggerTurn: true },
			);
			return true;
		} finally {
			autoSolvePromptInFlight = false;
		}
	}

	async function refresh(ctx: ExtensionContext, force = false): Promise<void> {
		const now = Date.now();
		if (!force && now - lastRefreshAt < REFRESH_MIN_GAP_MS) return;
		if (refreshInFlight) return;
		refreshInFlight = true;
		lastRefreshAt = now;

		try {
			await maybeLoadTokenFromGh(ctx);
			const repoCtx = await discoverRepoContext(pi, ctx.cwd, provider);
			if (!repoCtx) {
				snapshot = { branch: undefined, pr: undefined, updatedAt: Date.now(), error: "No supported git remote." };
				updateStatus(ctx);
				emitPrimitives();
				return;
			}

			let pr = await provider.findOpenPullRequest({
				repos: repoCtx.repos,
				headOwners: repoCtx.headOwners,
				branch: repoCtx.branch,
				token,
			});
			if (!pr) {
				pr = await findOpenPullRequestViaGitRefs(pi, ctx.cwd, repoCtx.repos[0]);
			}

			snapshot = {
				branch: repoCtx.branch,
				pr,
				updatedAt: Date.now(),
				error: undefined,
			};
			updateStatus(ctx);
			emitPrimitives();
			await maybeAutoSolve(ctx);
		} catch (error) {
			snapshot = {
				...snapshot,
				error: error instanceof Error ? error.message : "Unknown PR status error",
				updatedAt: Date.now(),
			};
			emitPrimitives();
		} finally {
			refreshInFlight = false;
		}
	}

	function ensureTimer(ctx: ExtensionContext): void {
		if (refreshTimer) clearInterval(refreshTimer);
		refreshTimer = setInterval(() => {
			void refresh(ctx);
		}, REFRESH_INTERVAL_MS);
	}

	pi.registerCommand("pr-autosolve", {
		description: "Control automatic PR solving and one-shot runs for PR feedback/CI failures (default: on)",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();
			if (["on", "enable", "enabled", "true", "yes", "1", "start"].includes(action)) {
				setAutoSolveEnabled(true);
				ctx.ui.notify("PR auto-solve enabled.", "info");
				await maybeAutoSolve(ctx, { force: true });
				return;
			}
			if (["off", "disable", "disabled", "false", "no", "0", "stop"].includes(action)) {
				setAutoSolveEnabled(false);
				ctx.ui.notify("PR auto-solve disabled.", "info");
				return;
			}
			if (action === "now" || action === "run" || action === "refresh") {
				const queued = await maybeAutoSolve(ctx, {
					force: true,
					allowConcurrentWorkspace: true,
					allowFreshSession: true,
					ignoreDisabled: true,
					ignoreIncompleteChecks: true,
					includePrompted: true,
				});
				if (!queued) ctx.ui.notify("No PR feedback or CI failures available to auto-solve.", "info");
				return;
			}
			ctx.ui.notify(`PR auto-solve: ${autoSolveStatusText(ctx)} (persisted in ${userConfigPath()})`, "info");
		},
	});

	pi.registerCommand("pr-status", {
		description: "Show or refresh upstream PR status for current branch",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();
			if (action === "refresh") {
				await refresh(ctx, true);
			} else if (action === "off") {
				if (refreshTimer) clearInterval(refreshTimer);
				refreshTimer = undefined;
				ctx.ui.notify("PR status watcher disabled.", "info");
				return;
			} else if (action === "on") {
				ensureTimer(ctx);
				await refresh(ctx, true);
				ctx.ui.notify("PR status watcher enabled.", "info");
				return;
			}

			if (snapshot.pr) {
				const check = snapshot.pr.checks;
				ctx.ui.notify(
					`Open PR #${snapshot.pr.number} (${check}, 💬${snapshot.pr.comments})\n${snapshot.pr.url}\nAuto-solve: ${autoSolveStatusText(ctx)}`,
					"info",
				);
			} else {
				ctx.ui.notify(snapshot.error ?? "No open upstream PR for current branch.", "info");
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		sessionStartedAt = Date.now();
		lastFreshSessionSuppressionNoticeAt = 0;
		lastWorkspaceSuppressionNoticeAt = 0;
		loadSettings();
		updateStatus(ctx);
		emitPrimitives();
		ensureTimer(ctx);
		await refresh(ctx, true);
	});

	pi.on("turn_end", async (_event, ctx) => {
		await refresh(ctx);
	});

	pi.on("session_shutdown", async () => {
		if (refreshTimer) clearInterval(refreshTimer);
		refreshTimer = undefined;
	});
}
