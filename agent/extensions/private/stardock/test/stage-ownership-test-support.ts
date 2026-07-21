import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { fiveNodeWaveFixture } from "./fixtures/execution-graphs.ts";
import { makeHarness, runDir, statePath } from "./test-harness.ts";

const CHILD_FIXTURE = fileURLToPath(new URL("./fixtures/stage-owner-child.ts", import.meta.url));
export const MUTEX_CHILD_FIXTURE = fileURLToPath(new URL("./fixtures/state-mutex-child.ts", import.meta.url));
export const HEARTBEAT_INTERVAL_WAIT_MS = 5_300;

export async function startOwnershipGraph(cwd: string, loopName: string) {
	const harness = makeHarness(cwd);
	const start = harness.tools.get("stardock_start");
	assert.ok(start);
	await start.execute("start", { name: loopName, taskContent: "# Ownership\n" }, undefined, undefined, harness.ctx);
	const name = loopName.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_");
	const raw = JSON.parse(fs.readFileSync(statePath(cwd, name), "utf-8"));
	const graph = fiveNodeWaveFixture();
	raw.executionGraph = graph;
	fs.writeFileSync(statePath(cwd, name), JSON.stringify(raw, null, 2));
	return { ...harness, name, graph };
}

export function runAcquisitionChild(args: string[]): Promise<{ code: number | null; result: { ok: boolean; code?: string; stateRevision?: number } }> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ["--experimental-strip-types", CHILD_FIXTURE, ...args], { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => { stdout += String(chunk); });
		child.stderr.on("data", (chunk) => { stderr += String(chunk); });
		child.on("error", reject);
		child.on("close", (code) => {
			if (!stdout) {
				reject(new Error(`Child emitted no result: ${stderr}`));
				return;
			}
			resolve({ code, result: JSON.parse(stdout) });
		});
	});
}

export async function waitForFile(filePath: string): Promise<void> {
	const deadline = Date.now() + 5_000;
	while (!fs.existsSync(filePath)) {
		if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${filePath}`);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

export function stageOwnerFile(cwd: string, loopName: string): string {
	return path.join(runDir(cwd, loopName), "stage-owner.json");
}

export function stateMutexFile(cwd: string, loopName: string): string {
	return path.join(runDir(cwd, loopName), "state-mutation.json");
}
