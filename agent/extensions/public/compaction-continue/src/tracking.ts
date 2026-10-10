import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type TrackingEventKind = "watchdog_candidate" | "watchdog_nudge" | "watchdog_skip" | "watchdog_answer";
export type TrackingSource = "compaction" | "assistant-stall";

interface TrackingEventBase {
	version: 1;
	kind: TrackingEventKind;
	timestamp: string;
	sessionId: string;
	repoRoot: string;
	source?: TrackingSource;
	recoveryKind?: string;
	reason?: string;
	loop?: string;
	iteration?: number;
	compactionId?: string;
}

export interface WatchdogCandidateEvent extends TrackingEventBase {
	kind: "watchdog_candidate";
}

export interface WatchdogNudgeEvent extends TrackingEventBase {
	kind: "watchdog_nudge";
}

export interface WatchdogSkipEvent extends TrackingEventBase {
	kind: "watchdog_skip";
	skipReason: string;
}

export interface WatchdogAnswerEvent extends TrackingEventBase {
	kind: "watchdog_answer";
	done: boolean;
	confidence?: string;
	note?: string;
	noteLength?: number;
	noteHash?: string;
}

export type TrackingEvent = WatchdogCandidateEvent | WatchdogNudgeEvent | WatchdogSkipEvent | WatchdogAnswerEvent;
export type TrackingEventInput =
	| Omit<WatchdogCandidateEvent, "version" | "timestamp" | "sessionId" | "repoRoot">
	| Omit<WatchdogNudgeEvent, "version" | "timestamp" | "sessionId" | "repoRoot">
	| Omit<WatchdogSkipEvent, "version" | "timestamp" | "sessionId" | "repoRoot">
	| Omit<WatchdogAnswerEvent, "version" | "timestamp" | "sessionId" | "repoRoot">;

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function safeSessionPathSegment(sessionId: string): string {
	return sessionId.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 160) || "unknown";
}

function trackingLogDir(): string {
	return process.env.PI_COMPACTION_CONTINUE_DIR ?? path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"), "pi-compaction-continue");
}

export function trackingLogPath(sessionId = "unknown"): string {
	return process.env.PI_COMPACTION_CONTINUE_LOG ?? path.join(trackingLogDir(), `${safeSessionPathSegment(sessionId)}.jsonl`);
}

export function sessionIdFromContext(ctx: ExtensionContext): string {
	const manager = ctx.sessionManager as unknown as { getSessionId?: () => string } | undefined;
	try {
		const sessionId = manager?.getSessionId?.();
		if (sessionId) return sessionId;
	} catch {
		// Fall through.
	}
	return `process:${process.pid}:${ctx.cwd}`;
}

function nowIso(): string {
	return new Date().toISOString();
}

function shortHash(value: string): string {
	return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function makeTrackingEvent(ctx: ExtensionContext, event: TrackingEventInput): TrackingEvent {
	if (event.kind === "watchdog_answer") {
		const note = typeof event.note === "string" && event.note.trim() ? event.note.trim() : undefined;
		return {
			...event,
			version: 1,
			timestamp: nowIso(),
			sessionId: sessionIdFromContext(ctx),
			repoRoot: ctx.cwd,
			note,
			noteLength: note ? note.length : undefined,
			noteHash: note ? shortHash(note) : undefined,
		};
	}
	return {
		...event,
		version: 1,
		timestamp: nowIso(),
		sessionId: sessionIdFromContext(ctx),
		repoRoot: ctx.cwd,
	};
}

export function appendTrackingLog(event: TrackingEvent): void {
	try {
		const logPath = trackingLogPath(event.sessionId);
		fs.mkdirSync(path.dirname(logPath), { recursive: true });
		fs.appendFileSync(logPath, `${JSON.stringify(logSafeTrackingEvent(event))}\n`);
	} catch {
		// Passive tracking must never affect extension behavior.
	}
}

export function logSafeTrackingEvent(event: TrackingEvent): Record<string, unknown> {
	if (event.kind !== "watchdog_answer") return event as unknown as Record<string, unknown>;
	const { note: _note, ...safe } = event;
	return safe;
}
