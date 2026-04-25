import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

type ChecksState = "pass" | "fail" | "running" | "unknown";

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

interface BranchSnapshot {
	branch?: string;
	pr?: PullRequestInfo;
	updatedAt?: number;
	error?: string;
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
}

const REFRESH_INTERVAL_MS = 90_000;
const REFRESH_MIN_GAP_MS = 15_000;
const AUTO_SOLVE_MIN_GAP_MS = 120_000;

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

function checksAreComplete(checks: ChecksState): boolean {
	return checks === "pass" || checks === "fail";
}

function feedbackKey(item: PullRequestFeedback): string {
	return `${item.kind}:${item.id}:${item.updatedAt ?? ""}`;
}

function summarizeFeedback(items: PullRequestFeedback[]): string {
	return items
		.map((item, index) => {
			const loc = item.path ? ` (${item.path})` : "";
			const link = item.url ? `\nURL: ${item.url}` : "";
			return `${index + 1}. [${item.kind}] @${item.author}${loc}\n${item.body}${link}`;
		})
		.join("\n\n");
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

				const checks = await fetchGitHubJson<{ state?: string }>(
					`/repos/${baseRepo.owner}/${baseRepo.repo}/commits/${pr.head?.sha ?? ""}/status`,
					token,
				);
				const checkState = checks?.state === "success" ? "pass" : checks?.state === "failure" ? "fail" : checks?.state === "pending" ? "running" : "unknown";

				return {
					number: pr.number,
					title: pr.title,
					url: pr.html_url,
					comments: (pr.comments ?? 0) + (pr.review_comments ?? 0),
					checks: checkState,
					headSha: pr.head?.sha,
					base: baseRepo,
				};
			}
		}
		return undefined;
	},
	async fetchOpenFeedback({ pr, token, maxItems = 20 }) {
		const [issueComments, reviewComments] = await Promise.all([
			fetchGitHubJson<
				Array<{
					id: number;
					body?: string;
					updated_at?: string;
					html_url?: string;
					user?: { login?: string };
				}>
			>(`/repos/${pr.base.owner}/${pr.base.repo}/issues/${pr.number}/comments?per_page=100`, token),
			fetchGitHubJson<
				Array<{
					id: number;
					body?: string;
					updated_at?: string;
					html_url?: string;
					path?: string;
					in_reply_to_id?: number;
					user?: { login?: string };
				}>
			>(`/repos/${pr.base.owner}/${pr.base.repo}/pulls/${pr.number}/comments?per_page=100`, token),
		]);

		const merged: PullRequestFeedback[] = [];
		for (const comment of issueComments ?? []) {
			const body = comment.body?.trim();
			if (!body) continue;
			merged.push({
				id: `issue-${comment.id}`,
				kind: "issue",
				author: comment.user?.login ?? "unknown",
				body,
				url: comment.html_url,
				updatedAt: comment.updated_at,
			});
		}
		for (const comment of reviewComments ?? []) {
			if (comment.in_reply_to_id) continue;
			const body = comment.body?.trim();
			if (!body) continue;
			merged.push({
				id: `review-${comment.id}`,
				kind: "review",
				author: comment.user?.login ?? "unknown",
				body,
				url: comment.html_url,
				path: comment.path,
				updatedAt: comment.updated_at,
			});
		}

		merged.sort((a, b) => (a.updatedAt ?? "").localeCompare(b.updatedAt ?? ""));
		return merged.slice(-maxItems);
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

export default function prUpstreamStatus(pi: ExtensionAPI): void {
	const provider = githubProvider;
	let token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
	let attemptedGhToken = false;

	let snapshot: BranchSnapshot = {};
	let refreshTimer: ReturnType<typeof setInterval> | undefined;
	let refreshInFlight = false;
	let autoSolveEnabled = false;
	let autoSolvePromptInFlight = false;
	let lastAutoSolveAt = 0;
	let lastPromptedHeadSha: string | undefined;
	let promptedFeedbackKeys = new Set<string>();
	let lastRefreshAt = 0;

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

	async function maybeAutoSolveComments(ctx: ExtensionContext, force = false): Promise<void> {
		const pr = snapshot.pr;
		if (!autoSolveEnabled || !pr) return;
		if (!checksAreComplete(pr.checks)) return;
		if (!ctx.isIdle() || ctx.hasPendingMessages()) return;
		if (autoSolvePromptInFlight) return;

		if (lastPromptedHeadSha && pr.headSha && pr.headSha !== lastPromptedHeadSha) {
			promptedFeedbackKeys = new Set<string>();
		}
		lastPromptedHeadSha = pr.headSha;

		const now = Date.now();
		if (!force && now - lastAutoSolveAt < AUTO_SOLVE_MIN_GAP_MS) return;

		autoSolvePromptInFlight = true;
		try {
			const feedback = await provider.fetchOpenFeedback({ pr, token, maxItems: 30 });
			const unseen = feedback.filter((item) => !promptedFeedbackKeys.has(feedbackKey(item)));
			if (unseen.length === 0) return;

			const keys = unseen.map(feedbackKey);
			for (const key of keys) promptedFeedbackKeys.add(key);
			lastAutoSolveAt = now;

			const prompt = [
				`Review feedback needs triage for PR #${pr.number} (${pr.url}).`,
				"Checks have completed and Pi is idle.",
				"For each comment below:",
				"1) Verify whether the feedback is factually true and relevant to this PR.",
				"2) If not true/relevant, explain briefly why and do not change code for that comment.",
				"3) If true and relevant, implement the fix with minimal, reviewable changes.",
				"4) Summarize which comments were addressed vs dismissed.",
				"",
				"Comments:",
				summarizeFeedback(unseen),
			].join("\n");

			ctx.ui.notify(`Auto-solve queued for ${unseen.length} new PR comment(s).`, "info");
			pi.sendUserMessage(prompt);
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
			await maybeAutoSolveComments(ctx);
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
		description: "Control auto-solving new PR comments after checks complete (default: off)",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();
			if (action === "on" || action === "enable") {
				autoSolveEnabled = true;
				emitPrimitives();
				ctx.ui.notify("PR auto-solve enabled.", "info");
				await maybeAutoSolveComments(ctx, true);
				return;
			}
			if (action === "off" || action === "disable") {
				autoSolveEnabled = false;
				emitPrimitives();
				ctx.ui.notify("PR auto-solve disabled.", "info");
				return;
			}
			if (action === "now" || action === "run" || action === "refresh") {
				if (!autoSolveEnabled) {
					ctx.ui.notify("PR auto-solve is off. Enable it with /pr-autosolve on.", "warning");
					return;
				}
				await maybeAutoSolveComments(ctx, true);
				return;
			}
			ctx.ui.notify(`PR auto-solve: ${autoSolveEnabled ? "on" : "off"} (default off)`, "info");
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
					`Open PR #${snapshot.pr.number} (${check}, 💬${snapshot.pr.comments})\n${snapshot.pr.url}\nAuto-solve: ${autoSolveEnabled ? "on" : "off"}`,
					"info",
				);
			} else {
				ctx.ui.notify(snapshot.error ?? "No open upstream PR for current branch.", "info");
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
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
