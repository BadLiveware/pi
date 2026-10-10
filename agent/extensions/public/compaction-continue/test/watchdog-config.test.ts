import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { configHarness } from "./config-harness.ts";
import { messageEntry } from "./shared.ts";

const disabledConfig = { enabled: false, appendSessionEntries: true, log: true, maxRecentEvents: 20 };

describe("persistent watchdog configuration", () => {
	for (const reason of ["startup", "reload", "new", "resume"]) {
		it(`honors top-level enabled:false on ${reason} independently of tracking`, async (t) => {
			const h = configHarness(t, disabledConfig);
			await h.emit("session_start", { reason });
			assert.equal((await h.state()).enabled, false);
			assert.equal((await h.state()).tracking.enabled, false);
			assert.equal(h.statuses.at(-1), "watchdog:off");
			await h.command("");
			assert.match(h.notifications.at(-1)!, /Compaction continue: disabled/);
			assert.match(h.notifications.at(-1)!, /Assistant stall watch: disabled/);
		});
	}

	it("loads a persisted disable before any session_start event", async (t) => {
		const h = configHarness(t, disabledConfig);
		assert.equal((await h.state()).enabled, false);
	});

	it("top-level enabled:true enables only the watchdog, not passive tracking", async (t) => {
		const h = configHarness(t, { enabled: true });
		await h.emit("session_start");
		const state = await h.state();
		assert.equal(state.enabled, true);
		assert.equal(state.tracking.enabled, false);
	});

	it("suppresses both compaction and stalled-turn nudges when disabled", async (t) => {
		const h = configHarness(t, disabledConfig);
		h.leaf.push(h.compaction);
		await h.emit("session_start", { reason: "resume" });
		await h.emit("session_compact", { compactionEntry: h.compaction });
		await h.emit("turn_end", { message: { role: "assistant", content: [{ type: "text", text: "I'll continue with the next concrete step." }], stopReason: "stop" } });
		t.mock.timers.tick(10_000);
		assert.equal(h.messages.length, 0);
		assert.equal((await h.state()).enabled, false);
	});

	it("does not restore an assistant-stall nudge from a resumed disabled session", async (t) => {
		const h = configHarness(t, disabledConfig);
		h.leaf.push(messageEntry("user", "user", [{ type: "text", text: "Please finish the checks." }]),
			messageEntry("promise", "assistant", [{ type: "text", text: "I'll continue with the next concrete step." }], { stopReason: "stop" }));
		await h.emit("session_start", { reason: "resume" });
		t.mock.timers.tick(10_000);
		assert.equal(h.messages.length, 0);
	});

	it("defaults watchdog on and passive tracking off without a config", async (t) => {
		const h = configHarness(t);
		await h.emit("session_start");
		const state = await h.state();
		assert.equal(state.enabled, true);
		assert.equal(state.tracking.enabled, false);
		await h.emit("session_compact", { compactionEntry: h.compaction });
		t.mock.timers.tick(10_000);
		assert.equal(h.messages.length, 1);
	});

	it("enables nested tracking without enabling the watchdog", async (t) => {
		const h = configHarness(t, { enabled: false, tracking: { enabled: true, log: false, maxRecentEvents: 3 } });
		await h.emit("session_start");
		await h.tools.get("watchdog_answer").execute("answer", { done: true }, undefined, undefined, h.ctx);
		const state = await h.state();
		assert.equal(state.enabled, false);
		assert.equal(state.tracking.enabled, true);
		assert.equal(state.tracking.maxRecentEvents, 3);
		assert.equal(h.entries.length, 1);
	});

	it("keeps command overrides session-local without rewriting the disabled config", async (t) => {
		const h = configHarness(t, disabledConfig);
		await h.emit("session_start");
		const original = fs.readFileSync(h.file, "utf8");
		await h.command("on");
		const overridden = await h.state();
		assert.equal(overridden.enabled, true, "state inspection must not reset the override");
		assert.equal(overridden.configuration.enabled, false);
		assert.equal(overridden.configuration.sessionOverride, true);
		await h.command("");
		assert.equal((await h.state()).enabled, true);
		await h.emit("session_shutdown");
		await h.emit("session_start", { reason: "new" });
		const nextSession = await h.state();
		assert.equal(nextSession.enabled, false);
		assert.equal(nextSession.configuration.sessionOverride, undefined);
		assert.equal(fs.readFileSync(h.file, "utf8"), original);
	});

	it("cancels pending nudges when disabled rather than replaying them on re-enable", async (t) => {
		const h = configHarness(t, { enabled: true });
		await h.emit("session_start");
		await h.emit("session_compact", { compactionEntry: h.compaction });
		await h.emit("turn_end", { message: { role: "assistant", content: [{ type: "text", text: "I'll continue with the next concrete step." }], stopReason: "stop" } });
		await h.command("off");
		await h.command("on");
		t.mock.timers.tick(10_000);
		assert.equal(h.messages.length, 0);
	});

	it("refreshes a config-file disable in state and footer while cancelling pending nudges", async (t) => {
		const h = configHarness(t, { enabled: true });
		await h.emit("session_start");
		await h.emit("session_compact", { compactionEntry: h.compaction });
		fs.writeFileSync(h.file, JSON.stringify({ enabled: false }));
		assert.equal((await h.state()).enabled, false);
		assert.equal(h.statuses.at(-1), "watchdog:off");
		t.mock.timers.tick(10_000);
		assert.equal(h.messages.length, 0);
	});

	it("merges project watchdog and tracking overrides independently", async (t) => {
		const h = configHarness(t, { enabled: false, tracking: { enabled: true, log: false } });
		fs.mkdirSync(path.join(h.cwd, ".pi"));
		fs.writeFileSync(path.join(h.cwd, ".pi", "compaction-continue.json"), JSON.stringify({ enabled: true, tracking: { maxRecentEvents: 8 } }));
		await h.emit("session_start");
		const state = await h.state();
		assert.equal(state.enabled, true);
		assert.equal(state.tracking.enabled, true);
		assert.equal(state.tracking.log, false);
		assert.equal(state.tracking.maxRecentEvents, 8);
		assert.equal(state.configuration.loadedPaths.length, 2);
	});

	it("reports malformed project config without dropping a valid global disable", async (t) => {
		const h = configHarness(t, disabledConfig);
		fs.mkdirSync(path.join(h.cwd, ".pi"));
		fs.writeFileSync(path.join(h.cwd, ".pi", "compaction-continue.json"), "{broken");
		await h.emit("session_start");
		const state = await h.state();
		assert.equal(state.enabled, false);
		assert.equal(state.configuration.diagnostics.length, 1);
	});
});
