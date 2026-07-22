import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { ensureDir, ownershipQuarantineDir, stageOwnerPath, stateMutationPath } from "../state/paths.ts";

export const MUTATION_WAIT_MS = 750;
export const MUTATION_RETRY_MS = 15;
export const OWNER_HEARTBEAT_MS = 5_000;
export const OWNER_SUSPECT_MS = 20_000;

export type OwnerRecordStatus = "acquiring" | "active";

export interface StageOwnerRecord {
	version: 1;
	status: OwnerRecordStatus;
	graphId: string;
	stageId: string;
	sessionId: string;
	pid: number;
	tokenDigest: string;
	expectedGraphRevision: number;
	acquiredAt: string;
	heartbeatAt: string;
	stateRevision?: number;
	detachedAt?: string;
}

export interface StateMutationRecord {
	version: 1;
	graphId: string;
	stageId?: string;
	sessionId: string;
	pid: number;
	tokenDigest: string;
	acquiredAt: string;
}

interface RegistryEntry {
	cwd: string;
	loopName: string;
	graphId: string;
	stageId: string;
	sessionId: string;
	token: string;
	tokenDigest: string;
	heartbeat?: NodeJS.Timeout;
}

const sessionByContext = new WeakMap<object, string>();
const registry = new Map<string, RegistryEntry>();

function registryKey(cwd: string, loopName: string, sessionId: string): string {
	return `${path.resolve(cwd)}\u0000${loopName}\u0000${sessionId}`;
}

export function digestOwnershipToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

export function generateOwnershipToken(): string {
	return randomBytes(32).toString("base64url");
}

export function bindOwnershipContext(ctx: ExtensionContext, sessionId: string): void {
	sessionByContext.set(ctx as object, sessionId);
}

export function ownershipSessionForContext(ctx: ExtensionContext): string | undefined {
	return sessionByContext.get(ctx as object);
}

export function registerOwnershipToken(ctx: ExtensionContext, entry: Omit<RegistryEntry, "cwd" | "heartbeat">): void {
	bindOwnershipContext(ctx, entry.sessionId);
	const value: RegistryEntry = { ...entry, cwd: path.resolve(ctx.cwd) };
	registry.set(registryKey(value.cwd, value.loopName, value.sessionId), value);
}

export function ownershipTokenForContext(ctx: ExtensionContext, loopName: string): RegistryEntry | undefined {
	const sessionId = sessionByContext.get(ctx as object);
	if (!sessionId) return undefined;
	return registry.get(registryKey(ctx.cwd, loopName, sessionId));
}

export function removeOwnershipToken(ctx: ExtensionContext, loopName: string, sessionId: string): void {
	const key = registryKey(ctx.cwd, loopName, sessionId);
	const entry = registry.get(key);
	if (entry?.heartbeat) clearInterval(entry.heartbeat);
	registry.delete(key);
}

export function setOwnershipHeartbeat(ctx: ExtensionContext, loopName: string, sessionId: string, timer: NodeJS.Timeout): void {
	const entry = registry.get(registryKey(ctx.cwd, loopName, sessionId));
	if (!entry) {
		clearInterval(timer);
		return;
	}
	if (entry.heartbeat) clearInterval(entry.heartbeat);
	entry.heartbeat = timer;
	timer.unref();
}

export function ownedLoopsForSession(ctx: ExtensionContext, sessionId: string): string[] {
	const cwd = path.resolve(ctx.cwd);
	return [...registry.values()]
		.filter((entry) => entry.cwd === cwd && entry.sessionId === sessionId)
		.map((entry) => entry.loopName)
		.sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function isDigest(value: unknown): value is string {
	return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isTimestamp(value: unknown): value is string {
	return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isPositivePid(value: unknown): value is number {
	return Number.isInteger(value) && Number(value) > 0;
}

function isRevision(value: unknown): value is number {
	return Number.isInteger(value) && Number(value) >= 0;
}

function isOwnerRecord(value: unknown): value is StageOwnerRecord {
	if (!isRecord(value) || value.version !== 1) return false;
	if (value.status !== "acquiring" && value.status !== "active") return false;
	for (const key of ["graphId", "stageId", "sessionId"] as const) {
		if (!isNonEmptyString(value[key])) return false;
	}
	if (!isPositivePid(value.pid) || !isDigest(value.tokenDigest) || !isRevision(value.expectedGraphRevision)) return false;
	if (!isTimestamp(value.acquiredAt) || !isTimestamp(value.heartbeatAt)) return false;
	if (value.stateRevision !== undefined && !isRevision(value.stateRevision)) return false;
	if (value.status === "active" && !isRevision(value.stateRevision)) return false;
	if (value.detachedAt !== undefined && !isTimestamp(value.detachedAt)) return false;
	return true;
}

function isMutationRecord(value: unknown): value is StateMutationRecord {
	if (!isRecord(value) || value.version !== 1) return false;
	for (const key of ["graphId", "sessionId"] as const) {
		if (!isNonEmptyString(value[key])) return false;
	}
	if (value.stageId !== undefined && !isNonEmptyString(value.stageId)) return false;
	return isPositivePid(value.pid) && isDigest(value.tokenDigest) && isTimestamp(value.acquiredAt);
}

function parseRecord<T>(filePath: string, kind: "owner" | "mutex", validate: (value: unknown) => value is T): T | null {
	let raw: string;
	try {
		raw = fs.readFileSync(filePath, "utf-8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw new OwnershipProtocolError("evidence_unreadable", `Durable ${kind} evidence exists but cannot be read at its managed loop path.`);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new OwnershipProtocolError("evidence_malformed", `Durable ${kind} evidence is not valid JSON. Reconciliation must fail closed until it is inspected.`);
	}
	if (!validate(parsed)) throw new OwnershipProtocolError("evidence_malformed", `Durable ${kind} evidence has an invalid protocol shape. Reconciliation must fail closed until it is inspected.`);
	return parsed;
}

export function readOwnerRecord(ctx: ExtensionContext, loopName: string): StageOwnerRecord | null {
	return parseRecord(stageOwnerPath(ctx, loopName), "owner", isOwnerRecord);
}

export function readMutationRecord(ctx: ExtensionContext, loopName: string): StateMutationRecord | null {
	return parseRecord(stateMutationPath(ctx, loopName), "mutex", isMutationRecord);
}

export function atomicWriteJson(filePath: string, value: unknown): void {
	ensureDir(filePath);
	const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
	try {
		fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: "utf-8", flag: "wx" });
		fs.renameSync(temporary, filePath);
	} finally {
		if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
	}
}

export function createOwnerRecordExclusive(ctx: ExtensionContext, loopName: string, record: StageOwnerRecord): void {
	const filePath = stageOwnerPath(ctx, loopName);
	ensureDir(filePath);
	fs.writeFileSync(filePath, JSON.stringify(record, null, 2), { encoding: "utf-8", flag: "wx" });
}

function waitBriefly(milliseconds: number): void {
	const signal = new Int32Array(new SharedArrayBuffer(4));
	Atomics.wait(signal, 0, 0, milliseconds);
}

export function acquireMutationMutex(ctx: ExtensionContext, loopName: string, record: StateMutationRecord, waitMs = MUTATION_WAIT_MS): void {
	const filePath = stateMutationPath(ctx, loopName);
	ensureDir(filePath);
	const deadline = Date.now() + Math.max(0, waitMs);
	while (true) {
		try {
			fs.writeFileSync(filePath, JSON.stringify(record, null, 2), { encoding: "utf-8", flag: "wx" });
			return;
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== "EEXIST") throw error;
			readMutationRecord(ctx, loopName);
			if (Date.now() >= deadline) throw new OwnershipProtocolError("mutex_busy", `State mutation is busy for loop "${loopName}". Inspect ownership and reconcile explicitly; stale mutex evidence is never cleared automatically.`);
			waitBriefly(MUTATION_RETRY_MS);
		}
	}
}

export function releaseMatchingMutationMutex(ctx: ExtensionContext, loopName: string, tokenDigest: string): void {
	const filePath = stateMutationPath(ctx, loopName);
	const current = readMutationRecord(ctx, loopName);
	if (current?.tokenDigest !== tokenDigest) return;
	fs.unlinkSync(filePath);
}

export function removeMatchingAcquiringOwner(ctx: ExtensionContext, loopName: string, tokenDigest: string): void {
	const record = readOwnerRecord(ctx, loopName);
	if (record?.status !== "acquiring" || record.tokenDigest !== tokenDigest) return;
	fs.unlinkSync(stageOwnerPath(ctx, loopName));
}

export function removeMatchingActiveOwner(ctx: ExtensionContext, loopName: string, tokenDigest: string): void {
	const record = readOwnerRecord(ctx, loopName);
	if (record?.status !== "active" || record.tokenDigest !== tokenDigest) {
		throw new OwnershipProtocolError("evidence_changed", "Active owner evidence changed before terminal ownership release.");
	}
	fs.unlinkSync(stageOwnerPath(ctx, loopName));
}

export function clearTerminalOwnerEvidence(
	ctx: ExtensionContext,
	loopName: string,
	expected: { graphId: string; stageId: string; sessionId: string; pid: number; tokenDigest: string; stateRevision: number },
	currentStateRevision: number,
): { removed: boolean } {
	const record = readOwnerRecord(ctx, loopName);
	if (!record) return { removed: false };
	if (currentStateRevision !== expected.stateRevision + 1) {
		throw new OwnershipProtocolError("state_mismatch", `Terminal ownership cleanup requires graph revision ${expected.stateRevision + 1}, current ${currentStateRevision}.`);
	}
	if (record.status !== "active"
		|| record.graphId !== expected.graphId
		|| record.stageId !== expected.stageId
		|| record.sessionId !== expected.sessionId
		|| record.pid !== expected.pid
		|| record.tokenDigest !== expected.tokenDigest
		|| record.stateRevision !== expected.stateRevision) {
		throw new OwnershipProtocolError("evidence_changed", "Active owner evidence changed before terminal ownership cleanup.");
	}
	fs.unlinkSync(stageOwnerPath(ctx, loopName));
	return { removed: true };
}

export function quarantineOwnershipFile(ctx: ExtensionContext, loopName: string, kind: "owner" | "mutex", expectedDigest: string): string {
	let source = stateMutationPath(ctx, loopName);
	let record: StageOwnerRecord | StateMutationRecord | null = readMutationRecord(ctx, loopName);
	if (kind === "owner") {
		source = stageOwnerPath(ctx, loopName);
		record = readOwnerRecord(ctx, loopName);
	}
	if (!record || record.tokenDigest !== expectedDigest) throw new OwnershipProtocolError("evidence_changed", `Cannot quarantine ${kind} evidence because it changed during reconciliation.`);
	const directory = ownershipQuarantineDir(ctx, loopName);
	fs.mkdirSync(directory, { recursive: true });
	const destination = path.join(directory, `${kind}-${Date.now()}-${randomUUID()}.json`);
	fs.renameSync(source, destination);
	return path.basename(destination);
}

export function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ESRCH") return false;
		return true;
	}
}

export class OwnershipProtocolError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "OwnershipProtocolError";
		this.code = code;
	}
}
