import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { OwnershipProtocolError } from "../src/stages/ownership-records.ts";
import { mutateState } from "../src/state/store.ts";
import { stageOwnerFile, startOwnershipGraph as startGraph } from "./stage-ownership-test-support.ts";
import { makeHarness, statePath } from "./test-harness.ts";

test("malformed and unreadable owner evidence fail closed at user-facing guard boundaries", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-owner-guard-failure-"));
	try {
		const harness = await startGraph(cwd, "Owner Guard Failure");
		const acquisition = await harness.tools.get("stardock_stage").execute("acquire", {
			action: "acquire",
			loopName: harness.name,
			graphId: harness.graph.id,
			stageId: harness.graph.stages[0].id,
			expectedGraphRevision: harness.graph.revision,
		}, undefined, undefined, harness.ctx);
		assert.equal(acquisition.details.ok, true);
		const ownerPath = stageOwnerFile(cwd, harness.name);
		const sibling = makeHarness(cwd);
		for (const handler of sibling.handlers.get("session_start") ?? []) await handler({}, sibling.ctx);

		fs.writeFileSync(ownerPath, "{not-json", "utf-8");
		const stateBeforeGuards = fs.readFileSync(statePath(cwd, harness.name), "utf-8");
		const blockedMutation = await sibling.tools.get("stardock_done").execute("done", {}, undefined, undefined, sibling.ctx);
		assert.equal(blockedMutation.details.code, "non_owner");
		assert.match(blockedMutation.content[0].text, /evidence_malformed/);
		assert.match(blockedMutation.content[0].text, /No mutation ran/);
		assert.match(blockedMutation.content[0].text, /stardock_stage list/);
		assert.match(blockedMutation.content[0].text, /stardock_stage reconcile/);
		assert.equal(fs.readFileSync(statePath(cwd, harness.name), "utf-8"), stateBeforeGuards);

		await sibling.commands.get("stardock").handler(`cancel ${harness.name}`, sibling.ctx);
		const destructiveGuidance = String(sibling.notifications.at(-1));
		assert.match(destructiveGuidance, /evidence_malformed/);
		assert.match(destructiveGuidance, /No destruction ran/);
		assert.match(destructiveGuidance, /stardock_stage list/);
		assert.match(destructiveGuidance, /stardock_stage reconcile/);
		assert.equal(fs.existsSync(statePath(cwd, harness.name)), true);

		const inspection = await sibling.tools.get("stardock_stage").execute("list", {
			action: "list",
			loopName: harness.name,
		}, undefined, undefined, sibling.ctx);
		assert.equal(inspection.details.code, "evidence_malformed");
		assert.throws(
			() => mutateState(harness.ctx, harness.name, (state) => { state.iteration += 1; }),
			(error: unknown) => error instanceof OwnershipProtocolError && error.code === "evidence_malformed",
		);

		fs.rmSync(ownerPath);
		fs.mkdirSync(ownerPath);
		const unreadable = await sibling.tools.get("stardock_done").execute("done", {}, undefined, undefined, sibling.ctx);
		assert.match(unreadable.content[0].text, /evidence_unreadable/);
		assert.match(unreadable.content[0].text, /No mutation ran/);
		await sibling.commands.get("stardock").handler(`cancel ${harness.name}`, sibling.ctx);
		const unreadableDestructiveGuidance = String(sibling.notifications.at(-1));
		assert.match(unreadableDestructiveGuidance, /evidence_unreadable/);
		assert.match(unreadableDestructiveGuidance, /No destruction ran/);
		assert.equal(fs.existsSync(statePath(cwd, harness.name)), true);
		assert.throws(
			() => mutateState(harness.ctx, harness.name, (state) => { state.iteration += 1; }),
			(error: unknown) => error instanceof OwnershipProtocolError && error.code === "evidence_unreadable",
		);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
