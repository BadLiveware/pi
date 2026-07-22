import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { detachOwnedStages } from "../src/stages/ownership.ts";
import { loadState, mutateState } from "../src/state/store.ts";
import { startOwnershipGraph as startGraph } from "./stage-ownership-test-support.ts";
import { makeHarness } from "./test-harness.ts";

test("release self-guard still rejects a non-owner live terminal stage", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-owner-release-guard-"));
	try {
		const ownerHarness = await startGraph(cwd, "Owner Release Guard");
		const acquisition = await ownerHarness.tools.get("stardock_stage").execute("acquire", {
			action: "acquire",
			loopName: ownerHarness.name,
			graphId: ownerHarness.graph.id,
			stageId: ownerHarness.graph.stages[0].id,
			expectedGraphRevision: ownerHarness.graph.revision,
		}, undefined, undefined, ownerHarness.ctx);
		assert.equal(acquisition.details.ok, true);
		mutateState(ownerHarness.ctx, ownerHarness.name, (state) => {
			const graph = state.executionGraph;
			assert.ok(graph);
			for (const node of graph.nodes) node.status = "integrated";
			graph.stages[0].status = "integrated";
		});
		const terminal = loadState(ownerHarness.ctx, ownerHarness.name)?.executionGraph;
		assert.ok(terminal?.ownership);

		const sibling = makeHarness(cwd);
		for (const handler of sibling.handlers.get("session_start") ?? []) await handler({}, sibling.ctx);
		const result = await sibling.tools.get("stardock_stage").execute("release", {
			action: "release",
			loopName: ownerHarness.name,
			graphId: ownerHarness.graph.id,
			stageId: ownerHarness.graph.stages[0].id,
			expectedGraphRevision: terminal.revision,
		}, undefined, undefined, sibling.ctx);
		assert.equal(result.details.code, "non_owner");
		assert.ok(loadState(ownerHarness.ctx, ownerHarness.name)?.executionGraph?.ownership);
		detachOwnedStages(ownerHarness.ctx, acquisition.details.acquisition.owner.sessionId);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
