import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { makeHarness } from "./test-harness.ts";

test("stardock tools support reduced-round-trip batch and activation workflows", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { tools, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const ledger = tools.get("stardock_ledger");
		const brief = tools.get("stardock_brief");
		assert.ok(start);
		assert.ok(ledger);
		assert.ok(brief);

		await start.execute(
			"tool-ergonomics-start",
			{
				name: "Ergonomics Loop",
				mode: "checklist",
				taskContent: "# Ergonomics task\n\n## Checklist\n- [ ] Keep default prompts compatible\n",
				maxIterations: 3,
			},
			undefined,
			undefined,
			ctx,
		);

		const criteriaResult = await ledger.execute(
			"tool-ergonomics-criteria",
			{
				action: "upsertCriteria",
				loopName: "Ergonomics_Loop",
				includeState: true,
				criteria: [
					{
						id: "c-one",
						description: "First criterion can be seeded in a batch.",
						passCondition: "Batch upsert returns the created criterion.",
					},
					{
						id: "c-two",
						description: "Second criterion can be seeded in the same call.",
						passCondition: "Batch upsert returns refreshed state counts.",
						status: "passed",
						evidence: "Seeded through batch upsert.",
					},
				],
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(criteriaResult.content[0].text, /Upserted 2 criteria/);
		assert.equal(criteriaResult.details.criteria.length, 2);
		assert.equal(criteriaResult.details.loop.criteria.total, 2);
		assert.equal(criteriaResult.details.loop.criteria.passed, 1);

		const artifactsResult = await ledger.execute(
			"tool-ergonomics-artifacts",
			{
				action: "recordArtifacts",
				loopName: "Ergonomics_Loop",
				includeState: true,
				artifacts: [
					{ id: "a-one", kind: "walkthrough", summary: "First compact artifact.", criterionIds: ["c-one"] },
					{ id: "a-two", kind: "test", summary: "Second compact artifact.", criterionIds: ["c-two"] },
				],
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(artifactsResult.content[0].text, /Recorded 2 artifacts/);
		assert.equal(artifactsResult.details.artifacts.length, 2);
		assert.equal(artifactsResult.details.loop.verificationArtifacts.total, 2);

		const briefResult = await brief.execute(
			"tool-ergonomics-brief",
			{
				action: "upsert",
				loopName: "Ergonomics_Loop",
				id: "b-one",
				objective: "Reduce serial tool calls.",
				task: "Use one call to create and activate a bounded brief.",
				criterionIds: ["c-one"],
				activate: true,
				includeState: true,
				includePromptPreview: true,
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(briefResult.content[0].text, /Created brief b-one and activated it/);
		assert.equal(briefResult.details.currentBriefId, "b-one");
		assert.equal(briefResult.details.brief.status, "active");
		assert.equal(briefResult.details.loop.briefs.currentBriefId, "b-one");
		assert.match(briefResult.details.promptPreview, /## Active Iteration Brief/);
		assert.match(briefResult.details.promptPreview, /c-one \[pending\]/);
		assert.equal(briefResult.details.promptPreview.includes("Keep default prompts compatible"), false);

		const followupResult = await brief.execute(
			"tool-ergonomics-followup",
			{
				action: "upsert",
				loopName: "Ergonomics_Loop",
				id: "b-two",
				objective: "Use generic read-only followups.",
				task: "Attach state output without bespoke include flags.",
				followupTool: { name: "stardock_state", args: { loopName: "Ergonomics_Loop", view: "overview", includeDetails: true } },
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(followupResult.content[0].text, /Created brief b-two/);
		assert.equal(followupResult.details.followupTool.name, "stardock_state");
		assert.match(followupResult.details.followupTool.content, /Stardock run: Ergonomics_Loop/);
		assert.equal(followupResult.details.followupTool.details.loop.name, "Ergonomics_Loop");

		const listFollowup = await brief.execute(
			"tool-ergonomics-list-followup",
			{
				action: "upsert",
				loopName: "Ergonomics_Loop",
				id: "b-three",
				objective: "Use read-only list followups.",
				task: "Attach brief list output without bespoke include flags.",
				followupTool: { name: "stardock_brief", args: { action: "list", loopName: "Ergonomics_Loop" }, attachAs: "both" },
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(listFollowup.content[0].text, /Created brief b-three/);
		assert.match(listFollowup.content[1].text, /Followup stardock_brief:/);
		assert.match(listFollowup.content[1].text, /Briefs for Ergonomics_Loop/);
		assert.equal(listFollowup.details.followupTool.name, "stardock_brief");
		assert.match(listFollowup.details.followupTool.content, /Briefs for Ergonomics_Loop/);
		assert.equal(listFollowup.details.followupTool.details.briefs.length, 3);

		const rejectedFollowup = await brief.execute(
			"tool-ergonomics-rejected-followup",
			{
				action: "upsert",
				loopName: "Ergonomics_Loop",
				id: "b-four",
				objective: "Reject mutating followups.",
				task: "Do not allow followupTool to perform a mutation.",
				followupTool: { name: "stardock_brief", args: { action: "upsert", loopName: "Ergonomics_Loop" } },
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(rejectedFollowup.content[0].text, /Created brief b-four/);
		assert.equal(rejectedFollowup.details.followupTool.details.ok, false);
		assert.equal(rejectedFollowup.details.followupTool.details.reason, "mutating_action");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
test("stardock_brief builds advisory worker payloads and prompts include recorded worker context", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { tools, messages, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const ledger = tools.get("stardock_ledger");
		const brief = tools.get("stardock_brief");
		const handoff = tools.get("stardock_handoff");
		const worker = tools.get("stardock_worker_report");
		const done = tools.get("stardock_done");
		assert.ok(start);
		assert.ok(ledger);
		assert.ok(brief);
		assert.ok(handoff);
		assert.ok(worker);
		assert.ok(done);
		await start.execute("tool-worker-payload-start", { name: "Brief Worker Payload", mode: "checklist", taskContent: "# Worker payload task\n", maxIterations: 3 }, undefined, undefined, ctx);
		await ledger.execute("tool-worker-payload-criterion", { action: "upsertCriterion", loopName: "Brief_Worker_Payload", id: "c-worker", description: "Worker payload includes selected criteria.", passCondition: "Payload includes criterion and brief contract.", testMethod: "Inspect payload." }, undefined, undefined, ctx);
		await brief.execute("tool-worker-payload-brief", { action: "upsert", loopName: "Brief_Worker_Payload", id: "b-worker", objective: "Explore risky files.", task: "Map likely files and validation commands.", criterionIds: ["c-worker"], acceptanceCriteria: ["Explorer returns file map."], verificationRequired: ["No edits."], requiredContext: ["agent/extensions/private/stardock/src"], constraints: ["Advisory only."], avoid: ["Do not edit files."], sourceRefs: [".pi/plans/stardock-subagent-recursive-mode.md"], activate: true }, undefined, undefined, ctx);

		const payload = await brief.execute("tool-worker-payload", { action: "payload", loopName: "Brief_Worker_Payload", role: "explorer" }, undefined, undefined, ctx);
		assert.match(payload.content[0].text, /Stardock advisory worker payload/);
		assert.match(payload.content[0].text, /Role: explorer/);
		assert.match(payload.content[0].text, /Task: Map likely files and validation commands/);
		assert.match(payload.content[0].text, /c-worker \[pending\]/);
		assert.match(payload.content[0].text, /Do not let Stardock or the worker spawn hidden agents/);
		assert.match(payload.content[0].text, /Parent may use stardock_worker_report record/);
		assert.match(payload.content[0].text, /worker should not mutate Stardock state/);

		await handoff.execute("tool-worker-payload-handoff", { action: "record", loopName: "Brief_Worker_Payload", id: "ah-explore", role: "explorer", status: "answered", objective: "Explore files.", summary: "Explorer handoff.", criterionIds: ["c-worker"], resultSummary: "Inspect briefs.ts and worker-reports.ts.", concerns: ["Prompt inclusion may be missing."], recommendations: ["Add a worker context section."] }, undefined, undefined, ctx);
		await handoff.execute("tool-worker-payload-stale-handoff", { action: "record", loopName: "Brief_Worker_Payload", id: "ah-stale", role: "explorer", status: "answered", objective: "Old work.", summary: "Stale handoff.", resultSummary: "Do not include stale handoff." }, undefined, undefined, ctx);
		await worker.execute("tool-worker-payload-report", { action: "record", loopName: "Brief_Worker_Payload", id: "wr-explore", role: "explorer", status: "needs_review", objective: "Explore files.", summary: "Worker mapped likely files.", evaluatedCriterionIds: ["c-worker"], risks: ["Parent should inspect prompt output."], openQuestions: ["Should result summaries be capped?"], suggestedNextMove: "Add prompt inclusion test.", reviewHints: ["Read runtime/prompts.ts."] }, undefined, undefined, ctx);
		await done.execute("tool-worker-payload-done", {}, undefined, undefined, ctx);
		const prompt = messages.at(-1)?.content ?? "";
		assert.match(prompt, /## Recent Worker \/ Advisory Results/);
		assert.match(prompt, /Handoff ah-explore \[explorer\]/);
		assert.match(prompt, /WorkerReport wr-explore \[needs_review\/explorer\]/);
		assert.equal(prompt.includes("Do not include stale handoff"), false);
		assert.match(prompt, /Use stardock_policy\(\{ action: "parentReview" \}\)/);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("stardock_brief records explicit governor-selected brief source", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { tools, messages, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const govern = tools.get("stardock_govern");
		const ledger = tools.get("stardock_ledger");
		const brief = tools.get("stardock_brief");
		const done = tools.get("stardock_done");
		assert.ok(start);
		assert.ok(govern);
		assert.ok(ledger);
		assert.ok(brief);
		assert.ok(done);

		await start.execute(
			"tool-governor-brief-start",
			{
				name: "Governor Brief Loop",
				mode: "recursive",
				taskContent: "# Governor brief task\n\nFull task text should not replay when the governor brief is active.\n",
				objective: "Route governor-selected context explicitly.",
				maxIterations: 4,
			},
			undefined,
			undefined,
			ctx,
		);
		await ledger.execute(
			"tool-governor-brief-criteria",
			{
				action: "upsertCriteria",
				loopName: "Governor_Brief_Loop",
				criteria: [
					{ id: "c-governor", description: "Governor brief carries selected context.", passCondition: "Prompt names the governor brief source." },
					{ id: "c-unselected", description: "Unselected criteria stay out of brief prompts.", passCondition: "Prompt omits this criterion." },
				],
			},
			undefined,
			undefined,
			ctx,
		);
		const governor = await govern.execute("tool-governor-brief-govern", { loopName: "Governor_Brief_Loop" }, undefined, undefined, ctx);
		assert.equal(governor.details.request.id, "governor-manual-1");

		const created = await brief.execute(
			"tool-governor-brief-upsert",
			{
				action: "upsert",
				loopName: "Governor_Brief_Loop",
				id: "b-governor-next",
				source: "governor",
				requestId: "governor-manual-1",
				objective: "Follow the governor-selected bounded context.",
				task: "Work only the selected criterion and report evidence.",
				criterionIds: ["c-governor"],
				verificationRequired: ["Inspect the next prompt."],
				requiredContext: ["Governor request governor-manual-1 selected this brief."],
				activate: true,
				includeState: true,
				includePromptPreview: true,
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(created.content[0].text, /Created brief b-governor-next and activated it/);
		assert.equal(created.details.brief.source, "governor");
		assert.equal(created.details.brief.requestId, "governor-manual-1");
		assert.equal(created.details.loop.briefs.current.source, "governor");
		assert.match(created.details.promptPreview, /Source: governor \(governor-manual-1\)/);
		assert.match(created.details.promptPreview, /c-governor \[pending\]/);
		assert.equal(created.details.promptPreview.includes("c-unselected"), false);
		assert.equal(created.details.promptPreview.includes("Full task text should not replay"), false);

		await done.execute("tool-governor-brief-done", {}, undefined, undefined, ctx);
		assert.equal(messages.at(-1)?.content.includes("Source: governor (governor-manual-1)"), true);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
test("stardock_brief routes bounded prompt context from selected criteria", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stardock-loop-test-"));
	try {
		const { tools, messages, ctx } = makeHarness(cwd);
		const start = tools.get("stardock_start");
		const done = tools.get("stardock_done");
		const ledger = tools.get("stardock_ledger");
		const brief = tools.get("stardock_brief");
		const stateTool = tools.get("stardock_state");
		assert.ok(start);
		assert.ok(done);
		assert.ok(ledger);
		assert.ok(brief);
		assert.ok(stateTool);

		await start.execute(
			"tool-brief-start",
			{
				name: "Brief Loop",
				mode: "checklist",
				taskContent: "# Brief task\n\n## Checklist\n- [ ] Preserve no-brief defaults\n",
				maxIterations: 4,
			},
			undefined,
			undefined,
			ctx,
		);
		assert.equal(messages.length, 1);
		assert.equal(messages[0].content.includes("## Active Iteration Brief"), false);

		await ledger.execute(
			"tool-brief-selected-criterion",
			{
				action: "upsertCriterion",
				loopName: "Brief_Loop",
				id: "c-selected",
				description: "The prompt includes selected criterion details.",
				passCondition: "The next prompt names c-selected and its pass condition.",
				testMethod: "Inspect the queued prompt text.",
			},
			undefined,
			undefined,
			ctx,
		);
		await ledger.execute(
			"tool-brief-unselected-criterion",
			{
				action: "upsertCriterion",
				loopName: "Brief_Loop",
				id: "c-unselected",
				description: "This criterion should not appear in active brief prompts.",
				passCondition: "The active brief prompt omits this criterion.",
			},
			undefined,
			undefined,
			ctx,
		);
		const longArtifactSummary = `${"verbose artifact summary ".repeat(60)}must not be pasted`;
		await ledger.execute(
			"tool-brief-artifact",
			{
				action: "recordArtifact",
				loopName: "Brief_Loop",
				id: "a-selected",
				kind: "log",
				summary: longArtifactSummary,
				criterionIds: ["c-selected"],
			},
			undefined,
			undefined,
			ctx,
		);

		const upsertBrief = await brief.execute(
			"tool-brief-upsert",
			{
				action: "upsert",
				loopName: "Brief_Loop",
				id: "b-implement",
				objective: "Implement the smallest criteria-aware prompt packet.",
				task: "Wire one active brief into the next queued Stardock prompt.",
				criterionIds: ["c-selected"],
				acceptanceCriteria: ["Only selected criteria are included in the brief section."],
				verificationRequired: ["Run the focused Stardock test file."],
				requiredContext: ["agent/extensions/private/stardock/index.ts prompt builders"],
				constraints: ["No automatic plan distillation."],
				avoid: ["Do not paste artifact logs into prompts."],
				outputContract: "Report changed files, validation, risks, and next move.",
				sourceRefs: [".pi/plans/stardock-implementation-framework.md#context-routing"],
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(upsertBrief.content[0].text, /Created brief b-implement/);
		assert.equal(upsertBrief.details.brief.status, "draft");

		const activateBrief = await brief.execute(
			"tool-brief-activate",
			{ action: "activate", loopName: "Brief_Loop", id: "b-implement" },
			undefined,
			undefined,
			ctx,
		);
		assert.match(activateBrief.content[0].text, /Activated brief b-implement/);
		assert.equal(activateBrief.details.currentBriefId, "b-implement");

		const listBriefs = await brief.execute("tool-brief-list", { action: "list", loopName: "Brief_Loop" }, undefined, undefined, ctx);
		assert.match(listBriefs.content[0].text, /Current brief: b-implement/);
		assert.match(listBriefs.content[0].text, /b-implement \[active\]/);

		const inspect = await stateTool.execute("tool-brief-state", { loopName: "Brief_Loop", includeDetails: true }, undefined, undefined, ctx);
		assert.match(inspect.content[0].text, /Briefs: 1 \(current b-implement\)/);
		assert.equal(inspect.details.loop.briefs.currentBriefId, "b-implement");
		assert.equal(inspect.details.loop.briefs.current.task, "Wire one active brief into the next queued Stardock prompt.");
		assert.equal(inspect.details.loop.briefList[0].id, "b-implement");

		await done.execute("tool-brief-done", {}, undefined, undefined, ctx);
		assert.equal(messages.length, 2);
		const prompt = messages[1].content;
		assert.match(prompt, /## Active Iteration Brief/);
		assert.match(prompt, /Brief: b-implement/);
		assert.match(prompt, /c-selected \[pending\]/);
		assert.match(prompt, /Pass: The next prompt names c-selected and its pass condition\./);
		assert.match(prompt, /Verify: Inspect the queued prompt text\./);
		assert.match(prompt, /Only selected criteria are included/);
		assert.match(prompt, /Run the focused Stardock test file/);
		assert.match(prompt, /agent\/extensions\/private\/stardock\/index\.ts prompt builders/);
		assert.match(prompt, /No automatic plan distillation/);
		assert.match(prompt, /Do not paste artifact logs into prompts/);
		assert.match(prompt, /a-selected/);
		assert.match(prompt, /Full task content is omitted from this prompt/);
		assert.equal(prompt.includes("Preserve no-brief defaults"), false);
		assert.equal(prompt.includes("c-unselected"), false);
		assert.equal(prompt.includes(longArtifactSummary), false);

		await brief.execute("tool-brief-clear", { action: "clear", loopName: "Brief_Loop" }, undefined, undefined, ctx);
		await done.execute("tool-brief-done-no-current", {}, undefined, undefined, ctx);
		assert.equal(messages.length, 3);
		assert.equal(messages[2].content.includes("## Active Iteration Brief"), false);
		assert.match(messages[2].content, /Task file: \.stardock\/runs\/Brief_Loop\/task\.md \(not loaded into this prompt\)/);
		assert.equal(messages[2].content.includes("Preserve no-brief defaults"), false);

		const completeBrief = await brief.execute(
			"tool-brief-complete",
			{ action: "complete", loopName: "Brief_Loop", id: "b-implement" },
			undefined,
			undefined,
			ctx,
		);
		assert.match(completeBrief.content[0].text, /Completed brief b-implement/);
		assert.equal(completeBrief.details.brief.status, "completed");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
