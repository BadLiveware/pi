import assert from "node:assert/strict";
import { test } from "node:test";
import {
	TreehouseAdapter,
	TreehouseLeaseSetupError,
	type ArgumentProcessResult,
	type ArgumentProcessRunner,
	type LeaseAndAnchorInput,
	type TreehouseLease,
} from "../src/stages/treehouse-adapter.ts";

const SHA = "1".repeat(40);
const OTHER_SHA = "2".repeat(40);
const PARENT_PATH = "/tmp/treehouse parent repo";
const LEASE_PATH = "/tmp/treehouse pool/lane one";
const COMMON_DIR = "/tmp/treehouse parent repo/.git";

interface RecordedCall {
	command: string;
	args: readonly string[];
	cwd: string;
}

class FakeProcess {
	readonly calls: RecordedCall[] = [];
	readonly signals: Array<AbortSignal | undefined> = [];
	readonly existingBranches = new Set<string>();
	parentBranchRef = "refs/heads/main";
	parentHead = SHA;
	parentDirty = false;
	leaseDirty = false;
	leaseManaged = true;
	leaseCommonDir = COMMON_DIR;
	leaseHead = SHA;
	leaseBranchRef: string | undefined;
	leaseFailure: ArgumentProcessResult | undefined;
	wrongHeadAfterDetach: string | undefined;
	leased = false;
	returned = false;

	readonly runner: ArgumentProcessRunner = async (command, args, options) => {
		this.calls.push({ command, args: [...args], cwd: options.cwd });
		this.signals.push(options.signal);
		if (command === "treehouse") return this.treehouse(args);
		if (command === "git") return this.git(args);
		return { exitCode: 127, stdout: "", stderr: `unknown command ${command}` };
	};

	private treehouse(args: readonly string[]): ArgumentProcessResult {
		if (args.length === 1 && args[0] === "--version") {
			return { exitCode: 0, stdout: "v2.0.0\n", stderr: "upgrade banner on stderr\n" };
		}
		if (args.length === 1 && args[0] === "status") {
			let stdout = "🌳 No worktrees in pool.\n";
			if (this.leased) stdout = `leased: ${LEASE_PATH}\n`;
			return { exitCode: 0, stdout, stderr: "status banner\n" };
		}
		if (args[0] === "get") {
			if (this.leaseFailure) return this.leaseFailure;
			this.leased = true;
			return { exitCode: 0, stdout: `${LEASE_PATH}\n`, stderr: "created pool entry banner\n" };
		}
		if (args[0] === "return") {
			this.returned = true;
			this.leased = false;
			return { exitCode: 0, stdout: "returned\n", stderr: "return banner\n" };
		}
		return { exitCode: 2, stdout: "", stderr: `unsupported treehouse args: ${args.join("|")}` };
	}

	private git(args: readonly string[]): ArgumentProcessResult {
		if (args[0] !== "-C") return { exitCode: 2, stdout: "", stderr: "missing -C" };
		const cwd = args[1];
		const operation = args.slice(2);
		const parent = cwd === PARENT_PATH;
		const lease = cwd === LEASE_PATH;
		if (!parent && !lease) return { exitCode: 128, stdout: "", stderr: "not a repository" };
		if (operation[0] === "rev-parse" && operation[1] === "--is-inside-work-tree") {
			let managed = true;
			if (lease) managed = this.leaseManaged;
			return { exitCode: 0, stdout: `${String(managed)}\n`, stderr: "" };
		}
		if (operation[0] === "rev-parse" && operation[1] === "--path-format=absolute") {
			let commonDir = COMMON_DIR;
			if (lease) commonDir = this.leaseCommonDir;
			return { exitCode: 0, stdout: `${commonDir}\n`, stderr: "" };
		}
		if (operation[0] === "symbolic-ref") {
			if (parent) return { exitCode: 0, stdout: `${this.parentBranchRef}\n`, stderr: "" };
			if (this.leaseBranchRef) return { exitCode: 0, stdout: `${this.leaseBranchRef}\n`, stderr: "" };
			return { exitCode: 1, stdout: "", stderr: "" };
		}
		if (operation[0] === "rev-parse" && operation[1] === "--verify") {
			let head = this.parentHead;
			if (lease) head = this.leaseHead;
			return { exitCode: 0, stdout: `${head}\n`, stderr: "" };
		}
		if (operation[0] === "status") {
			let dirty = this.parentDirty;
			if (lease) dirty = this.leaseDirty;
			let stdout = "";
			if (dirty) stdout = " M file with spaces.ts\n";
			return { exitCode: 0, stdout, stderr: "" };
		}
		if (operation[0] === "switch" && operation[1] === "--detach") {
			this.leaseBranchRef = undefined;
			this.leaseHead = operation[2];
			if (this.wrongHeadAfterDetach) this.leaseHead = this.wrongHeadAfterDetach;
			return { exitCode: 0, stdout: "", stderr: "detached banner\n" };
		}
		if (operation[0] === "show-ref") {
			const fullRef = operation[3];
			if (this.existingBranches.has(fullRef)) return { exitCode: 0, stdout: "", stderr: "" };
			return { exitCode: 1, stdout: "", stderr: "" };
		}
		if (operation[0] === "switch" && operation[1] === "-c") {
			const branch = operation[2];
			const fullRef = `refs/heads/${branch}`;
			if (this.existingBranches.has(fullRef)) return { exitCode: 128, stdout: "", stderr: "already exists" };
			this.existingBranches.add(fullRef);
			this.leaseBranchRef = fullRef;
			this.leaseHead = operation[3];
			return { exitCode: 0, stdout: "", stderr: "switched banner\n" };
		}
		return { exitCode: 2, stdout: "", stderr: `unsupported git args: ${operation.join("|")}` };
	}
}

function leaseInput(overrides: Partial<LeaseAndAnchorInput> = {}): LeaseAndAnchorInput {
	return {
		parentRepositoryPath: PARENT_PATH,
		parentBranch: "main",
		parentHeadCommit: SHA,
		integrationBaseCommit: SHA,
		contractCommit: SHA,
		leaseHolder: "stardock:loop:stage:node:attempt",
		loopId: "loop with spaces",
		stageId: "stage/status",
		nodeId: "node activity",
		attemptId: "attempt-1",
		...overrides,
	};
}

function adapterFor(fake: FakeProcess, ids: string[] = ["fresh123"]): TreehouseAdapter {
	let index = 0;
	return new TreehouseAdapter({
		runner: fake.runner,
		idFactory: () => {
			const value = ids[index];
			index += 1;
			if (value === undefined) return `generated${index}`;
			return value;
		},
	});
}

function treehouseCalls(fake: FakeProcess, operation: string): RecordedCall[] {
	return fake.calls.filter((call) => call.command === "treehouse" && call.args[0] === operation);
}

async function anchoredLease(fake: FakeProcess): Promise<{ adapter: TreehouseAdapter; lease: TreehouseLease }> {
	const adapter = adapterFor(fake);
	const lease = await adapter.leaseAndAnchor(leaseInput());
	return { adapter, lease };
}

test("version and status preserve structured stderr banners", async () => {
	const fake = new FakeProcess();
	const adapter = adapterFor(fake);
	const version = await adapter.version(PARENT_PATH);
	const status = await adapter.status(PARENT_PATH);
	assert.equal(version.stdout, "v2.0.0\n");
	assert.equal(version.stderr, "upgrade banner on stderr\n");
	assert.match(status.stdout, /No worktrees/);
	assert.equal(status.stderr, "status banner\n");
	assert.deepEqual(fake.calls.slice(0, 2), [
		{ command: "treehouse", args: ["--version"], cwd: PARENT_PATH },
		{ command: "treehouse", args: ["status"], cwd: PARENT_PATH },
	]);
});

test("one durable lease uses argument arrays, survives spaces and banners, anchors exact base, and returns cleanly", async () => {
	const fake = new FakeProcess();
	const { adapter, lease } = await anchoredLease(fake);
	assert.equal(lease.worktreePath, LEASE_PATH);
	assert.equal(lease.contractCommit, SHA);
	assert.equal(lease.branchRef, "stardock/loop-with-spaces/stage-status/node-activity/attempt-1-fresh123");
	assert.deepEqual(treehouseCalls(fake, "get")[0], {
		command: "treehouse",
		args: ["get", "--lease", "--lease-holder", "stardock:loop:stage:node:attempt"],
		cwd: PARENT_PATH,
	});
	assert.ok(fake.calls.some((call) => call.command === "git" && call.args[1] === LEASE_PATH));
	assert.ok(fake.calls.some((call) => call.args.includes("--detach") && call.args.includes(SHA)));
	await adapter.returnLease({ lease, expectedHeadCommit: SHA });
	assert.equal(fake.returned, true);
	assert.equal(fake.leased, false);
	assert.deepEqual(treehouseCalls(fake, "return")[0]?.args, ["return", LEASE_PATH]);
});

test("lease setup propagates one AbortSignal through every Treehouse and Git subprocess", async () => {
	const fake = new FakeProcess();
	const controller = new AbortController();
	await adapterFor(fake).leaseAndAnchor(leaseInput({ signal: controller.signal }));
	assert.ok(fake.signals.length > 0);
	assert.ok(fake.signals.every((signal) => signal === controller.signal));
});

test("an already-aborted signal prevents Treehouse setup subprocesses", async () => {
	const fake = new FakeProcess();
	const controller = new AbortController();
	controller.abort(new Error("cancelled before setup"));
	await assert.rejects(adapterFor(fake).leaseAndAnchor(leaseInput({ signal: controller.signal })), /cancelled before setup/);
	assert.equal(fake.calls.length, 0);
});

test("immutable parent input mismatch fails before any process runs", async () => {
	const fake = new FakeProcess();
	await assert.rejects(
		adapterFor(fake).leaseAndAnchor(leaseInput({ contractCommit: OTHER_SHA })),
		/Immutable parent preflight mismatch/,
	);
	assert.equal(fake.calls.length, 0);
});

test("wrong parent branch, wrong parent SHA, and dirty parent each fail before leasing", async (context) => {
	const cases: Array<{ name: string; configure: (fake: FakeProcess) => void; expected: RegExp }> = [
		{ name: "branch", configure: (fake) => { fake.parentBranchRef = "refs/heads/other"; }, expected: /Parent branch mismatch/ },
		{ name: "SHA", configure: (fake) => { fake.parentHead = OTHER_SHA; }, expected: /Parent HEAD mismatch/ },
		{ name: "dirty", configure: (fake) => { fake.parentDirty = true; }, expected: /Parent repository.*dirty/ },
	];
	for (const item of cases) {
		await context.test(item.name, async () => {
			const fake = new FakeProcess();
			item.configure(fake);
			await assert.rejects(adapterFor(fake).leaseAndAnchor(leaseInput()), item.expected);
			assert.equal(treehouseCalls(fake, "get").length, 0);
		});
	}
});

test("lease command failure reports stderr and does not fabricate a lease", async () => {
	const fake = new FakeProcess();
	fake.leaseFailure = { exitCode: 17, stdout: "", stderr: "pool exhausted" };
	await assert.rejects(adapterFor(fake).leaseAndAnchor(leaseInput()), /pool exhausted/);
	assert.equal(fake.leased, false);
});

test("unmanaged, wrong-repository, dirty, and wrong-base leases remain retained for inspection", async (context) => {
	const cases: Array<{ name: string; configure: (fake: FakeProcess) => void; expected: RegExp }> = [
		{ name: "unmanaged", configure: (fake) => { fake.leaseManaged = false; }, expected: /not a managed Git worktree/ },
		{ name: "wrong repository", configure: (fake) => { fake.leaseCommonDir = "/tmp/other/.git"; }, expected: /repository mismatch/ },
		{ name: "dirty", configure: (fake) => { fake.leaseDirty = true; }, expected: /Leased worktree.*dirty/ },
		{ name: "wrong SHA", configure: (fake) => { fake.wrongHeadAfterDetach = OTHER_SHA; }, expected: /HEAD mismatch/ },
	];
	for (const item of cases) {
		await context.test(item.name, async () => {
			const fake = new FakeProcess();
			item.configure(fake);
			await assert.rejects(adapterFor(fake).leaseAndAnchor(leaseInput()), item.expected);
			assert.equal(fake.leased, true);
			assert.equal(treehouseCalls(fake, "return").length, 0);
		});
	}
});

test("post-get setup failures expose typed partial lease evidence", async () => {
	const fake = new FakeProcess();
	fake.leaseCommonDir = "/tmp/different-repository/.git";
	let received: unknown;
	try {
		await adapterFor(fake).leaseAndAnchor(leaseInput());
	} catch (error) {
		received = error;
	}
	assert.ok(received instanceof TreehouseLeaseSetupError);
	assert.equal(received.partialLease.worktreePath, LEASE_PATH);
	assert.equal(received.partialLease.repositoryCommonDir, COMMON_DIR);
	assert.equal(received.partialLease.contractCommit, SHA);
	assert.equal(received.partialLease.leaseHolder, "stardock:loop:stage:node:attempt");
	assert.equal(received.partialLease.branchRef, undefined);
});

test("branch collisions generate a new suffix without deleting or overwriting the existing ref", async () => {
	const fake = new FakeProcess();
	const colliding = "refs/heads/stardock/loop-with-spaces/stage-status/node-activity/attempt-1-collision";
	fake.existingBranches.add(colliding);
	const adapter = adapterFor(fake, ["collision", "fresh"]);
	const lease = await adapter.leaseAndAnchor(leaseInput());
	assert.equal(lease.branchRef, "stardock/loop-with-spaces/stage-status/node-activity/attempt-1-fresh");
	assert.equal(fake.existingBranches.has(colliding), true);
	const creationCalls = fake.calls.filter((call) => call.command === "git" && call.args[2] === "switch" && call.args[3] === "-c");
	assert.equal(creationCalls.length, 1);
	assert.equal(creationCalls[0]?.args[4], lease.branchRef);
});

test("dirty, wrong-head, wrong-branch, and wrong-repository return attempts are refused", async (context) => {
	const cases: Array<{ name: string; configure: (fake: FakeProcess, lease: TreehouseLease) => void; expected: RegExp }> = [
		{ name: "dirty", configure: (fake) => { fake.leaseDirty = true; }, expected: /dirty/ },
		{ name: "wrong head", configure: (fake) => { fake.leaseHead = OTHER_SHA; }, expected: /HEAD mismatch/ },
		{ name: "wrong branch", configure: (fake) => { fake.leaseBranchRef = "refs/heads/unrelated"; }, expected: /branch mismatch/ },
		{ name: "wrong repository", configure: (fake) => { fake.leaseCommonDir = "/tmp/unrelated/.git"; }, expected: /repository mismatch/ },
	];
	for (const item of cases) {
		await context.test(item.name, async () => {
			const fake = new FakeProcess();
			const { adapter, lease } = await anchoredLease(fake);
			item.configure(fake, lease);
			await assert.rejects(adapter.returnLease({ lease, expectedHeadCommit: SHA }), item.expected);
			assert.equal(fake.leased, true);
			assert.equal(treehouseCalls(fake, "return").length, 0);
		});
	}
});

test("status command failures retain structured command evidence", async () => {
	const runner: ArgumentProcessRunner = async () => ({ exitCode: 9, stdout: "partial", stderr: "status unavailable" });
	const adapter = new TreehouseAdapter({ runner });
	await assert.rejects(adapter.status(PARENT_PATH), (error: unknown) => {
		assert.ok(error instanceof Error);
		assert.match(error.message, /status unavailable/);
		assert.match(error.message, /exit code 9/);
		return true;
	});
});
