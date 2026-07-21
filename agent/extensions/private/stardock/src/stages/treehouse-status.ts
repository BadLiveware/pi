import * as os from "node:os";
import * as path from "node:path";
import type { PartialTreehouseLease } from "./treehouse-adapter.ts";

export interface TreehouseStatusEntry {
	status: "leased" | "available" | "unknown";
	worktreePath: string;
	poolPath: string;
	leaseHolder?: string;
	rawLine: string;
}

export interface LeaseReservationInspection {
	state: "held" | "absent" | "ambiguous";
	poolPath?: string;
	reason: string;
	entries: TreehouseStatusEntry[];
	exactPathEntry?: TreehouseStatusEntry;
	holderEntries: TreehouseStatusEntry[];
	statusStdout: string;
}

function nonEmpty(value: string, label: string): string {
	const trimmed = value.trim();
	if (!trimmed) throw new Error(`${label} must not be empty.`);
	return trimmed;
}

function normalizeStatusPath(cwd: string, rawPath: string): string {
	const trimmed = nonEmpty(rawPath, "Treehouse status path");
	if (trimmed.startsWith("~/") || trimmed === "~") return path.join(os.homedir(), trimmed.slice(2));
	if (path.isAbsolute(trimmed)) return path.normalize(trimmed);
	return path.resolve(cwd, trimmed);
}

export function poolPathFromWorktreePath(worktreePath: string): string {
	const normalized = path.resolve(nonEmpty(worktreePath, "worktreePath"));
	const worktreeDir = path.dirname(normalized);
	const laneSegment = path.basename(worktreeDir);
	if (/^\d+$/.test(laneSegment)) return path.dirname(worktreeDir);
	return worktreeDir;
}

interface ParsedTreehouseStatus {
	entries: TreehouseStatusEntry[];
	unrecognizedLines: string[];
	emptyPool: boolean;
}

function parseTreehouseStatusEntries(stdout: string, cwd: string): ParsedTreehouseStatus {
	const entries: TreehouseStatusEntry[] = [];
	const unrecognizedLines: string[] = [];
	let emptyPool = false;
	for (const rawLine of stdout.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line) continue;
		if (/no worktrees in pool/i.test(line)) {
			emptyPool = true;
			continue;
		}
		const prefixed = line.match(/^(leased|available):\s+(.+)$/i);
		if (prefixed) {
			const worktreePath = normalizeStatusPath(cwd, prefixed[2]);
			entries.push({
				status: prefixed[1].toLowerCase() as TreehouseStatusEntry["status"],
				worktreePath,
				poolPath: poolPathFromWorktreePath(worktreePath),
				rawLine,
			});
			continue;
		}
		const table = line.match(/^\d+\s+(leased|available)\s+(.+?)(?:\s+\(held by (.+)\))?$/i);
		if (table) {
			const worktreePath = normalizeStatusPath(cwd, table[2]);
			entries.push({
				status: table[1].toLowerCase() as TreehouseStatusEntry["status"],
				worktreePath,
				poolPath: poolPathFromWorktreePath(worktreePath),
				leaseHolder: table[3]?.trim(),
				rawLine,
			});
			continue;
		}
		const inline = line.match(/^(leased|available)\s+holder=([^\s]+)\s+(.+)$/i);
		if (inline) {
			const worktreePath = normalizeStatusPath(cwd, inline[3]);
			entries.push({
				status: inline[1].toLowerCase() as TreehouseStatusEntry["status"],
				worktreePath,
				poolPath: poolPathFromWorktreePath(worktreePath),
				leaseHolder: inline[2],
				rawLine,
			});
			continue;
		}
		unrecognizedLines.push(rawLine);
	}
	return { entries, unrecognizedLines, emptyPool };
}

export function inspectLeaseReservationStatus(lease: PartialTreehouseLease, statusStdout: string): LeaseReservationInspection {
	let parseCwd = process.cwd();
	if (lease.statusContextCwd) parseCwd = path.resolve(lease.statusContextCwd);
	else if (lease.repositoryCommonDir) {
		parseCwd = path.resolve(lease.repositoryCommonDir);
		if (path.basename(parseCwd) === ".git") parseCwd = path.dirname(parseCwd);
	} else if (lease.worktreePath) parseCwd = path.resolve(lease.worktreePath);
	const parsed = parseTreehouseStatusEntries(statusStdout, parseCwd);
	if (parsed.unrecognizedLines.length > 0) {
		return {
			state: "ambiguous",
			reason: `Treehouse status stdout included unrecognized nonempty lines: ${parsed.unrecognizedLines.join(" | ")}`,
			entries: parsed.entries,
			holderEntries: [],
			statusStdout,
		};
	}
	let worktreePath: string | undefined;
	if (lease.worktreePath) worktreePath = path.resolve(lease.worktreePath);
	let poolPath: string | undefined;
	if (worktreePath) poolPath = poolPathFromWorktreePath(worktreePath);
	let entries = parsed.entries;
	if (poolPath) entries = parsed.entries.filter((entry) => entry.poolPath === poolPath);
	let holderEntries: TreehouseStatusEntry[] = [];
	if (lease.leaseHolder) holderEntries = entries.filter((entry) => entry.leaseHolder === lease.leaseHolder);
	if (!worktreePath) {
		if (!lease.leaseHolder) {
			return {
				state: "ambiguous",
				reason: "Lease reservation inspection requires an exact worktree path or exact lease holder.",
				entries,
				holderEntries,
				statusStdout,
			};
		}
		if (holderEntries.length > 1) {
			return { state: "ambiguous", reason: `Treehouse status reported multiple entries for exact holder "${lease.leaseHolder}".`, entries, holderEntries, statusStdout };
		}
		if (holderEntries.length === 1) {
			return {
				state: "held",
				poolPath: holderEntries[0].poolPath,
				reason: `Treehouse pool "${holderEntries[0].poolPath}" still reports exact holder "${lease.leaseHolder}" on worktree path "${holderEntries[0].worktreePath}".`,
				entries,
				holderEntries,
				statusStdout,
			};
		}
		if (parsed.emptyPool) {
			return {
				state: "absent",
				reason: `Treehouse status for the parent repository context reports an empty queried pool for holder "${lease.leaseHolder}".`,
				entries,
				holderEntries,
				statusStdout,
			};
		}
		if (entries.length === 0) {
			return {
				state: "ambiguous",
				reason: `Treehouse status did not provide exact pool evidence for holder "${lease.leaseHolder}".`,
				entries,
				holderEntries,
				statusStdout,
			};
		}
		const holderlessLeasedEntries = entries.filter((entry) => entry.status === "leased" && !entry.leaseHolder);
		if (holderlessLeasedEntries.length > 0) {
			return {
				state: "ambiguous",
				reason: `Treehouse status for the parent repository context includes leased rows without holder evidence, so holder-only absence for "${lease.leaseHolder}" cannot be proven.`,
				entries,
				holderEntries,
				statusStdout,
			};
		}
		return {
			state: "absent",
			reason: `Treehouse status for the parent repository context does not report holder "${lease.leaseHolder}" in the queried pool.`,
			entries,
			holderEntries,
			statusStdout,
		};
	}
	const exactPathEntries = entries.filter((entry) => entry.worktreePath === worktreePath);
	if (exactPathEntries.length > 1) {
		return { state: "ambiguous", poolPath, reason: `Treehouse status reported multiple entries for exact worktree path "${worktreePath}".`, entries, holderEntries, statusStdout };
	}
	const exactPathEntry = exactPathEntries[0];
	if (exactPathEntry) {
		if (exactPathEntry.status === "available") {
			if (lease.leaseHolder && holderEntries.some((entry) => entry.worktreePath !== worktreePath)) {
				return { state: "ambiguous", poolPath, reason: `Treehouse pool "${poolPath}" still reports lease holder "${lease.leaseHolder}" on a different worktree path.`, entries, exactPathEntry, holderEntries, statusStdout };
			}
			return { state: "absent", poolPath, reason: `Treehouse pool "${poolPath}" reports worktree path "${worktreePath}" as available, not leased.`, entries, exactPathEntry, holderEntries, statusStdout };
		}
		if (lease.leaseHolder && exactPathEntry.leaseHolder && exactPathEntry.leaseHolder !== lease.leaseHolder) {
			return { state: "ambiguous", poolPath, reason: `Treehouse pool "${poolPath}" reports worktree path "${worktreePath}" with holder "${exactPathEntry.leaseHolder}", not expected "${lease.leaseHolder}".`, entries, exactPathEntry, holderEntries, statusStdout };
		}
		return { state: "held", poolPath, reason: `Treehouse pool "${poolPath}" still reports worktree path "${worktreePath}" as leased.`, entries, exactPathEntry, holderEntries, statusStdout };
	}
	if (parsed.emptyPool) {
		return { state: "absent", poolPath, reason: `Treehouse pool "${poolPath}" is empty.`, entries, holderEntries, statusStdout };
	}
	if (holderEntries.length > 1) {
		return { state: "ambiguous", poolPath, reason: `Treehouse pool "${poolPath}" reported multiple entries for holder "${lease.leaseHolder}".`, entries, holderEntries, statusStdout };
	}
	if (holderEntries.length === 1) {
		return {
			state: "ambiguous",
			poolPath,
			reason: `Treehouse pool "${poolPath}" still reports holder "${lease.leaseHolder}" on worktree path "${holderEntries[0].worktreePath}" instead of expected "${worktreePath}".`,
			entries,
			holderEntries,
			statusStdout,
		};
	}
	if (entries.length === 0) {
		return {
			state: "ambiguous",
			poolPath,
			reason: `Treehouse status did not yield parseable exact-path evidence for worktree path "${worktreePath}".`,
			entries,
			holderEntries,
			statusStdout,
		};
	}
	return {
		state: "ambiguous",
		poolPath,
		reason: `Treehouse pool "${poolPath}" does not report exact holder evidence, so absence of worktree path "${worktreePath}" alone cannot prove the lease is gone.`,
		entries,
		holderEntries,
		statusStdout,
	};
}
