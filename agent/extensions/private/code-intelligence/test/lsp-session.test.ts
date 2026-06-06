import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { JsonRpcClient } from "code-intel/pi-integration";
import { LspSession } from "code-intel/pi-integration";

function fixtureRepo(): string {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-code-intel-lsp-session-"));
	fs.writeFileSync(path.join(repo, "main.cpp"), "int target() { return 1; }\nint caller() { return target(); }\n");
	fs.writeFileSync(path.join(repo, "fake-lsp.mjs"), fakeServerSource());
	return repo;
}

function fakeServerSource(): string {
	return String.raw`
const mode = process.argv[2] || "happy";
let buffer = Buffer.alloc(0);
function write(message) {
  const body = JSON.stringify(message);
  process.stdout.write("Content-Length: " + Buffer.byteLength(body, "utf-8") + "\r\n\r\n" + body);
}
function parse() {
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) return;
    const header = buffer.subarray(0, headerEnd).toString("utf-8");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) { buffer = buffer.subarray(headerEnd + 4); continue; }
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + Number(match[1]);
    if (buffer.length < bodyEnd) return;
    const message = JSON.parse(buffer.subarray(bodyStart, bodyEnd).toString("utf-8"));
    buffer = buffer.subarray(bodyEnd);
    handle(message);
  }
}
function handle(message) {
  if (mode === "timeout" || mode === "abort") return;
  if (mode === "malformed-error" && message.method === "initialize") {
    process.stdout.write("Content-Length: 8\r\n\r\nnot-json");
    write({ jsonrpc: "2.0", id: message.id, result: { capabilities: {} } });
    return;
  }
  if (message.method === "initialize") write({ jsonrpc: "2.0", id: message.id, result: { capabilities: {} } });
  else if (message.method === "textDocument/didOpen") {
    const uri = message.params?.textDocument?.uri;
    write({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri, diagnostics: [{ range: { start: { line: 1, character: 4 }, end: { line: 1, character: 10 } }, severity: 1, message: "fake diagnostic" }] } });
  } else if (message.method === "textDocument/references") {
    if (mode === "malformed-error") write({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "bad refs" } });
    else {
      const uri = message.params?.textDocument?.uri;
      write({ jsonrpc: "2.0", id: message.id, result: [{ uri, range: { start: { line: 1, character: 22 }, end: { line: 1, character: 28 } } }] });
    }
  } else if (message.method === "shutdown") write({ jsonrpc: "2.0", id: message.id, result: null });
  else if (message.method === "exit") process.exit(0);
}
process.stdin.on("data", (chunk) => { buffer = Buffer.concat([buffer, chunk]); parse(); });
`;
}

test("LspSession initializes, opens files, collects diagnostics, and requests references", async () => {
	const repo = fixtureRepo();
	try {
		const session = new LspSession({ command: process.execPath, args: [path.join(repo, "fake-lsp.mjs"), "happy"], cwd: repo, repoRoot: repo, timeoutMs: 1_000, name: "fake-lsp" });
		const init = await session.initialize();
		assert.equal(init.error, undefined);
		const document = session.didOpen("main.cpp", "cpp");
		const diagnostics = await session.waitForDiagnostics(document.uri, 500);
		assert.equal(diagnostics?.diagnostics?.length, 1);
		const references = await session.references(document, 1, 22, true);
		assert.equal(Array.isArray(references.result), true);
		assert.equal((references.result as any[])[0].uri, document.uri);
		await session.shutdown();
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("JsonRpcClient surfaces malformed messages and LSP response errors", async () => {
	const repo = fixtureRepo();
	try {
		const session = new LspSession({ command: process.execPath, args: [path.join(repo, "fake-lsp.mjs"), "malformed-error"], cwd: repo, repoRoot: repo, timeoutMs: 1_000, name: "fake-lsp" });
		await session.initialize();
		assert.match(session.diagnostics.join("\n"), /Malformed JSON-RPC message/);
		const document = session.didOpen("main.cpp", "cpp");
		const response = await session.references(document, 1, 22, false);
		assert.equal(response.error?.message, "bad refs");
		await session.shutdown();
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("JsonRpcClient rejects and kills timed-out requests", async () => {
	const repo = fixtureRepo();
	try {
		const client = new JsonRpcClient({ command: process.execPath, args: [path.join(repo, "fake-lsp.mjs"), "timeout"], cwd: repo, timeoutMs: 100, name: "fake-timeout" });
		await assert.rejects(() => client.request("initialize", {}), /timed out/);
		await client.dispose();
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

test("JsonRpcClient rejects pending requests on abort", async () => {
	const repo = fixtureRepo();
	try {
		const controller = new AbortController();
		const client = new JsonRpcClient({ command: process.execPath, args: [path.join(repo, "fake-lsp.mjs"), "abort"], cwd: repo, timeoutMs: 5_000, signal: controller.signal, name: "fake-abort" });
		const pending = client.request("initialize", {});
		controller.abort();
		await assert.rejects(() => pending, /aborted/);
		await client.dispose();
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});
