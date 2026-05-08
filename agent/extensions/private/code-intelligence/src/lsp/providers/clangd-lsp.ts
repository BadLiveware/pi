import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { commandDiagnostic, findExecutable, runCommand } from "../../exec.ts";
import { ensureInsideRoot } from "../../repo.ts";
import type { ReferenceConfirmationContext, ReferenceConfirmationLimits, ReferenceConfirmationOptions, ReferenceConfirmationProvider, ReferenceRoot } from "../types.ts";

interface JsonRpcMessage {
	id?: number | string;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: { message?: string; code?: number };
}

function findCompileCommandsDir(repoRoot: string): string | undefined {
	const candidates = ["compile_commands.json", "build/compile_commands.json", "build_debug/compile_commands.json", "build_release/compile_commands.json", "cmake-build-debug/compile_commands.json"];
	for (const candidate of candidates) {
		const full = path.join(repoRoot, candidate);
		if (fs.existsSync(full)) return path.dirname(full);
	}
	return undefined;
}

function symbolColumn(repoRoot: string, root: ReferenceRoot): number {
	try {
		const safeFile = ensureInsideRoot(repoRoot, root.file);
		const line = fs.readFileSync(path.resolve(repoRoot, safeFile), "utf-8").split(/\r?\n/)[root.line - 1];
		if (!line) return root.column;
		const index = line.indexOf(root.name);
		return index >= 0 ? index + 1 : root.column;
	} catch {
		return root.column;
	}
}

function parseMessages(buffer: Buffer, onMessage: (message: JsonRpcMessage) => void): Buffer {
	let remaining = buffer;
	while (true) {
		const headerEnd = remaining.indexOf("\r\n\r\n");
		if (headerEnd < 0) return remaining;
		const header = remaining.subarray(0, headerEnd).toString("utf-8");
		const length = /Content-Length:\s*(\d+)/i.exec(header)?.[1];
		if (!length) return remaining.subarray(headerEnd + 4);
		const bodyLength = Number(length);
		const bodyStart = headerEnd + 4;
		const bodyEnd = bodyStart + bodyLength;
		if (remaining.length < bodyEnd) return remaining;
		try {
			onMessage(JSON.parse(remaining.subarray(bodyStart, bodyEnd).toString("utf-8")) as JsonRpcMessage);
		} catch {
			// Ignore malformed server messages; timeout/error handling will surface failures.
		}
		remaining = remaining.subarray(bodyEnd);
	}
}

function uriToLocation(repoRoot: string, location: any, root: ReferenceRoot): Record<string, unknown> | undefined {
	const uri = typeof location?.uri === "string" ? location.uri : undefined;
	const range = location?.range;
	if (!uri || !range?.start) return undefined;
	let file: string;
	try {
		const absolute = uri.startsWith("file://") ? new URL(uri).pathname : uri;
		file = ensureInsideRoot(repoRoot, decodeURIComponent(absolute));
	} catch {
		return undefined;
	}
	return {
		file,
		line: Number(range.start.line) + 1,
		column: Number(range.start.character) + 1,
		endLine: range.end ? Number(range.end.line) + 1 : undefined,
		endColumn: range.end ? Number(range.end.character) + 1 : undefined,
		rootSymbol: root.name,
		evidence: clangdReferenceProvider.evidence,
	};
}

async function clangdVersion(executable: string, cwd: string, timeoutMs: number): Promise<string | undefined> {
	const result = await runCommand(executable, ["--version"], { cwd, timeoutMs: Math.min(timeoutMs, 5_000), maxOutputBytes: 20_000 });
	if (commandDiagnostic(result)) return undefined;
	return result.stdout.split(/\r?\n/).find(Boolean);
}

async function confirmClangdRoots(roots: ReferenceRoot[], context: ReferenceConfirmationContext, options: ReferenceConfirmationOptions, limits: ReferenceConfirmationLimits) {
	const executable = findExecutable("clangd");
	if (!executable) return { roots: [], references: [], diagnostics: [clangdReferenceProvider.missingDiagnostic], limitations: clangdReferenceProvider.limitations };
	const compileCommandsDir = findCompileCommandsDir(context.repoRoot);
	if (!compileCommandsDir) return { executable, roots: [], references: [], diagnostics: ["compile_commands.json not found in repo root or common build directories"], limitations: clangdReferenceProvider.limitations };

	const child = spawn(executable, [`--compile-commands-dir=${compileCommandsDir}`], { cwd: context.repoRoot, stdio: ["pipe", "pipe", "pipe"] });
	let nextId = 1;
	let stdoutBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
	const diagnostics: string[] = [];
	const pending = new Map<number, { resolve: (message: JsonRpcMessage) => void; reject: (error: Error) => void }>();
	const stderrChunks: Buffer[] = [];
	let settled = false;
	const timer = setTimeout(() => {
		settled = true;
		for (const item of pending.values()) item.reject(new Error("clangd reference confirmation timed out"));
		pending.clear();
		child.kill("SIGTERM");
	}, limits.timeoutMs);
	context.signal?.addEventListener("abort", () => child.kill("SIGTERM"));
	child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
	child.stdout.on("data", (chunk: Buffer) => {
		stdoutBuffer = parseMessages(Buffer.concat([stdoutBuffer, chunk]), (message) => {
			if (typeof message.id === "number") {
				const item = pending.get(message.id);
				if (item) {
					pending.delete(message.id);
					item.resolve(message);
				}
			}
		});
	});
	child.on("error", (error) => diagnostics.push(error.message));

	function send(method: string, params: unknown): Promise<JsonRpcMessage> {
		const id = nextId++;
		const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
		child.stdin.write(`Content-Length: ${Buffer.byteLength(payload, "utf-8")}\r\n\r\n${payload}`);
		return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
	}
	function notify(method: string, params: unknown): void {
		const payload = JSON.stringify({ jsonrpc: "2.0", method, params });
		child.stdin.write(`Content-Length: ${Buffer.byteLength(payload, "utf-8")}\r\n\r\n${payload}`);
	}

	const confirmedRoots: Record<string, unknown>[] = [];
	const references: Record<string, unknown>[] = [];
	try {
		const init = await send("initialize", { processId: process.pid, rootUri: pathToFileURL(context.repoRoot).href, capabilities: {} });
		if (init.error) diagnostics.push(`initialize: ${init.error.message ?? "clangd error"}`);
		notify("initialized", {});
		for (const root of roots) {
			if (references.length >= limits.maxResults) break;
			let safeFile: string;
			try {
				safeFile = ensureInsideRoot(context.repoRoot, root.file);
			} catch (error) {
				diagnostics.push(`${root.name}: ${error instanceof Error ? error.message : String(error)}`);
				continue;
			}
			const absoluteFile = path.resolve(context.repoRoot, safeFile);
			const text = fs.readFileSync(absoluteFile, "utf-8");
			const uri = pathToFileURL(absoluteFile).href;
			const column = symbolColumn(context.repoRoot, { ...root, file: safeFile });
			notify("textDocument/didOpen", { textDocument: { uri, languageId: "cpp", version: 1, text } });
			const response = await send("textDocument/references", { textDocument: { uri }, position: { line: root.line - 1, character: Math.max(0, column - 1) }, context: { includeDeclaration: options.includeDeclarations === true } });
			confirmedRoots.push({ symbol: root.name, file: safeFile, line: root.line, column, kind: root.kind, position: `${safeFile}:${root.line}:${column}` });
			if (response.error) {
				diagnostics.push(`${root.name}: ${response.error.message ?? "clangd references error"}`);
				continue;
			}
			const locations = Array.isArray(response.result) ? response.result : [];
			for (const location of locations) {
				if (references.length >= limits.maxResults) break;
				const parsed = uriToLocation(context.repoRoot, location, root);
				if (parsed) references.push(parsed);
			}
		}
		void send("shutdown", {}).catch(() => undefined);
		notify("exit", {});
	} catch (error) {
		diagnostics.push(error instanceof Error ? error.message : String(error));
	} finally {
		clearTimeout(timer);
		if (!settled) child.kill("SIGTERM");
	}
	const stderr = Buffer.concat(stderrChunks).toString("utf-8").split(/\r?\n/).find((line) => line.trim());
	if (stderr && diagnostics.length > 0) diagnostics.push(stderr.trim());
	const version = await clangdVersion(executable, context.repoRoot, limits.timeoutMs);
	return { executable, roots: confirmedRoots, references, diagnostics, limitations: clangdReferenceProvider.limitations, version, compileCommandsDir };
}

export const clangdReferenceProvider: ReferenceConfirmationProvider = {
	name: "clangd",
	evidence: "clangd:textDocument/references",
	supportedLanguages: ["cpp"],
	missingDiagnostic: "clangd not found on PATH",
	noRootsDiagnostic: "No C/C++ roots with current-source definition locations were available for clangd confirmation.",
	limitations: [
		"clangd confirmation is opt-in and only runs for C/C++ roots with current-source definition locations.",
		"clangd requires a usable compile_commands.json; missing or stale compile databases make reference confirmation unavailable or incomplete.",
		"The default routing map remains Tree-sitter syntax evidence; read the returned files before making compatibility or defect claims.",
	],
	confirmRoots: confirmClangdRoots,
};
