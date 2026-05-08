/** Stardock slash command registration. */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { answerOutsideRequest, createManualGovernorPayload, formatOutsideRequests, getOutsideRequestPayload } from "../outside-requests.ts";
import { DEFAULT_TEMPLATE, type LoopState } from "../state/core.ts";
import { defaultCriterionLedger } from "../state/migration.ts";
import { archiveDir, defaultTaskFile, ensureDir, legacyPath, runDir, sanitize, stardockDir, statePath, taskPath, tryDelete, tryRead, tryRemoveDir } from "../state/paths.ts";
import { listLoops, loadState, saveState } from "../state/store.ts";
import { formatLoop, formatRunOverview, formatRunTimeline } from "../views.ts";
import { parseArgs, parseLoopViewArgs, selectLoopForView } from "./args.ts";
import { buildPrompt, createModeState, isImplementedMode, unsupportedModeMessage } from "./prompts.ts";
import type { StardockRuntime } from "./types.ts";

const HELP = `Stardock - Governed implementation loops

Commands:
  /stardock start <name|path> [options]  Start a new loop
  /stardock stop                         Pause current loop
  /stardock resume <name>                Resume a paused loop
  /stardock status                       Show all loops
  /stardock view [loop] [--archived]     Show run overview and timeline
  /stardock timeline [loop] [--archived] Show run timeline only
  /stardock cancel <name>                Delete loop state
  /stardock archive <name>               Move loop to archive
  /stardock clean [--all]                Clean completed loops
  /stardock list --archived              Show archived loops
  /stardock govern [loop]                Create governor request payload
  /stardock outside [loop]               Show outside requests
  /stardock outside payload <loop> <id>  Show ready-to-copy request payload
  /stardock outside answer <loop> <id> <answer>
                                      Record outside request answer
  /stardock nuke [--yes]                 Delete all .stardock data
  /stardock-stop                         Stop active loop (idle only)

Options:
  --items-per-iteration N  Suggest N items per turn (prompt hint)
  --reflect-every N        Reflect every N iterations
  --max-iterations N       Stop after N iterations (default 50)
  --mode checklist|recursive
                            Select loop mode
  --objective TEXT         Required for recursive mode

To stop: press ESC to interrupt, then run /stardock-stop when idle

Examples:
  /stardock start my-feature
  /stardock start review --items-per-iteration 5 --reflect-every 10`;

export function registerCommands(pi: ExtensionAPI, runtime: StardockRuntime): void {
	const commands: Record<string, (rest: string, ctx: ExtensionContext) => void> = {
		start(rest, ctx) {
			const args = parseArgs(rest);
			if (!args.name) {
				ctx.ui.notify("Usage: /stardock start <name|path> [--mode checklist|recursive] [--objective TEXT] [--items-per-iteration N] [--reflect-every N] [--max-iterations N]", "warning");
				return;
			}
			if (!isImplementedMode(args.mode)) {
				ctx.ui.notify(unsupportedModeMessage(args.mode), "warning");
				return;
			}
			const mode = args.mode;
			const modeResult = createModeState(mode, args);
			if (modeResult.error || !modeResult.modeState) {
				ctx.ui.notify(modeResult.error ?? "Could not create Stardock mode state.", "warning");
				return;
			}
			const isPath = args.name.includes("/") || args.name.includes("\\");
			const loopName = isPath ? sanitize(path.basename(args.name, path.extname(args.name))) : args.name;
			const taskFile = isPath ? args.name : defaultTaskFile(loopName);
			const existing = loadState(ctx, loopName);
			if (existing?.status === "active") {
				ctx.ui.notify(`Loop "${loopName}" is already active. Use /stardock resume ${loopName}`, "warning");
				return;
			}
			const fullPath = path.resolve(ctx.cwd, taskFile);
			if (!fs.existsSync(fullPath)) {
				ensureDir(fullPath);
				fs.writeFileSync(fullPath, DEFAULT_TEMPLATE, "utf-8");
				ctx.ui.notify(`Created task file: ${taskFile}`, "info");
			}
			const state: LoopState = {
				schemaVersion: 3,
				name: loopName,
				taskFile,
				mode,
				iteration: 1,
				maxIterations: args.maxIterations,
				itemsPerIteration: args.itemsPerIteration,
				reflectEvery: args.reflectEvery,
				reflectInstructions: args.reflectInstructions,
				active: true,
				status: "active",
				startedAt: existing?.startedAt || new Date().toISOString(),
				lastReflectionAt: 0,
				modeState: modeResult.modeState,
				outsideRequests: [],
				criterionLedger: defaultCriterionLedger(),
				verificationArtifacts: [],
				baselineValidations: [],
				briefs: [],
				finalVerificationReports: [],
				auditorReviews: [],
				advisoryHandoffs: [],
				breakoutPackages: [],
				workerReports: [],
			};
			saveState(ctx, state);
			runtime.ref.currentLoop = loopName;
			runtime.updateUI(ctx);
			const content = tryRead(fullPath);
			if (!content) {
				ctx.ui.notify(`Could not read task file: ${taskFile}`, "error");
				return;
			}
			pi.sendUserMessage(buildPrompt(state, content, "iteration"));
		},
		stop(_rest, ctx) {
			if (!runtime.ref.currentLoop) {
				const active = listLoops(ctx).find((l) => l.status === "active");
				if (active) runtime.pauseLoop(ctx, active, `Paused Stardock loop: ${active.name} (iteration ${active.iteration})`);
				else ctx.ui.notify("No active Stardock loop", "warning");
				return;
			}
			const state = loadState(ctx, runtime.ref.currentLoop);
			if (state) runtime.pauseLoop(ctx, state, `Paused Stardock loop: ${runtime.ref.currentLoop} (iteration ${state.iteration})`);
		},
		resume(rest, ctx) {
			const loopName = rest.trim();
			if (!loopName) {
				ctx.ui.notify("Usage: /stardock resume <name>", "warning");
				return;
			}
			const state = loadState(ctx, loopName);
			if (!state) {
				ctx.ui.notify(`Loop "${loopName}" not found`, "error");
				return;
			}
			if (state.status === "completed") {
				ctx.ui.notify(`Loop "${loopName}" is completed. Use /stardock start ${loopName} to restart`, "warning");
				return;
			}
			if (runtime.ref.currentLoop && runtime.ref.currentLoop !== loopName) {
				const curr = loadState(ctx, runtime.ref.currentLoop);
				if (curr) runtime.pauseLoop(ctx, curr);
			}
			state.status = "active";
			state.active = true;
			state.iteration++;
			saveState(ctx, state);
			runtime.ref.currentLoop = loopName;
			runtime.updateUI(ctx);
			ctx.ui.notify(`Resumed: ${loopName} (iteration ${state.iteration})`, "info");
			const content = tryRead(path.resolve(ctx.cwd, state.taskFile));
			if (!content) {
				ctx.ui.notify(`Could not read task file: ${state.taskFile}`, "error");
				return;
			}
			const needsReflection = state.reflectEvery > 0 && state.iteration > 1 && (state.iteration - 1) % state.reflectEvery === 0;
			pi.sendUserMessage(buildPrompt(state, content, needsReflection ? "reflection" : "iteration"));
		},
		status(_rest, ctx) {
			const loops = listLoops(ctx);
			ctx.ui.notify(loops.length === 0 ? "No Stardock loops found." : `Stardock loops:\n${loops.map((l) => formatLoop(l)).join("\n")}`, "info");
		},
		view(rest, ctx) {
			const args = parseLoopViewArgs(rest);
			const state = selectLoopForView(ctx, runtime.ref.currentLoop, args.loopName, args.archived);
			ctx.ui.notify(state ? formatRunOverview(ctx, state, args.archived) : args.loopName ? `Loop "${args.loopName}" not found.` : "No Stardock loops found.", state ? "info" : "warning");
		},
		timeline(rest, ctx) {
			const args = parseLoopViewArgs(rest);
			const state = selectLoopForView(ctx, runtime.ref.currentLoop, args.loopName, args.archived);
			ctx.ui.notify(state ? formatRunTimeline(state) : args.loopName ? `Loop "${args.loopName}" not found.` : "No Stardock loops found.", state ? "info" : "warning");
		},
		cancel(rest, ctx) {
			const loopName = rest.trim();
			if (!loopName) return ctx.ui.notify("Usage: /stardock cancel <name>", "warning");
			if (!loadState(ctx, loopName)) return ctx.ui.notify(`Loop "${loopName}" not found`, "error");
			if (runtime.ref.currentLoop === loopName) runtime.ref.currentLoop = null;
			tryDelete(statePath(ctx, loopName));
			tryDelete(legacyPath(ctx, loopName, ".state.json"));
			ctx.ui.notify(`Cancelled: ${loopName}`, "info");
			runtime.updateUI(ctx);
		},
		archive(rest, ctx) {
			const loopName = rest.trim();
			if (!loopName) return ctx.ui.notify("Usage: /stardock archive <name>", "warning");
			const state = loadState(ctx, loopName);
			if (!state) return ctx.ui.notify(`Loop "${loopName}" not found`, "error");
			if (state.status === "active") return ctx.ui.notify("Cannot archive active loop. Stop it first.", "warning");
			if (runtime.ref.currentLoop === loopName) runtime.ref.currentLoop = null;
			const sourceRunDir = runDir(ctx, loopName);
			const sourceTask = path.resolve(ctx.cwd, state.taskFile);
			const taskIsManaged = sourceTask.startsWith(stardockDir(ctx)) && !sourceTask.startsWith(archiveDir(ctx));
			if (taskIsManaged) state.taskFile = path.relative(ctx.cwd, taskPath(ctx, loopName, true));
			saveState(ctx, state, true);
			if (taskIsManaged && fs.existsSync(sourceTask)) {
				const destinationTask = taskPath(ctx, loopName, true);
				ensureDir(destinationTask);
				tryDelete(destinationTask);
				fs.renameSync(sourceTask, destinationTask);
			}
			tryRemoveDir(sourceRunDir);
			tryDelete(legacyPath(ctx, loopName, ".state.json"));
			if (taskIsManaged) tryDelete(legacyPath(ctx, loopName, ".md"));
			ctx.ui.notify(`Archived: ${loopName}`, "info");
			runtime.updateUI(ctx);
		},
		clean(rest, ctx) {
			const all = rest.trim() === "--all";
			const completed = listLoops(ctx).filter((l) => l.status === "completed");
			if (completed.length === 0) return ctx.ui.notify("No completed loops to clean", "info");
			for (const loop of completed) {
				tryDelete(statePath(ctx, loop.name));
				tryDelete(legacyPath(ctx, loop.name, ".state.json"));
				if (all) {
					tryRemoveDir(runDir(ctx, loop.name));
					tryDelete(legacyPath(ctx, loop.name, ".md"));
				}
				if (runtime.ref.currentLoop === loop.name) runtime.ref.currentLoop = null;
			}
			const suffix = all ? " (all files)" : " (state only)";
			ctx.ui.notify(`Cleaned ${completed.length} loop(s)${suffix}:\n${completed.map((l) => `  • ${l.name}`).join("\n")}`, "info");
			runtime.updateUI(ctx);
		},
		list(rest, ctx) {
			const archived = rest.trim() === "--archived";
			const loops = listLoops(ctx, archived);
			if (loops.length === 0) return ctx.ui.notify(archived ? "No archived loops" : "No loops found. Use /stardock list --archived for archived.", "info");
			ctx.ui.notify(`${archived ? "Archived loops" : "Stardock loops"}:\n${loops.map((l) => formatLoop(l)).join("\n")}`, "info");
		},
		govern(rest, ctx) {
			const loopName = rest.trim() || runtime.ref.currentLoop;
			if (!loopName) return ctx.ui.notify("Usage: /stardock govern [loop]", "warning");
			const result = createManualGovernorPayload(ctx, loopName, runtime.updateUI);
			ctx.ui.notify(result.ok ? result.payload : result.error, result.ok ? "info" : "error");
		},
		outside(rest, ctx) {
			const [action, loopArg, requestId, ...answerParts] = rest.trim().split(/\s+/).filter(Boolean);
			if (action === "payload") {
				if (!loopArg || !requestId) return ctx.ui.notify("Usage: /stardock outside payload <loop> <request-id>", "warning");
				const result = getOutsideRequestPayload(ctx, loopArg, requestId);
				ctx.ui.notify(result.ok ? result.payload : result.error, result.ok ? "info" : "error");
				return;
			}
			if (action === "answer") {
				if (!loopArg || !requestId || answerParts.length === 0) return ctx.ui.notify("Usage: /stardock outside answer <loop> <request-id> <answer>", "warning");
				const result = answerOutsideRequest(ctx, loopArg, requestId, answerParts.join(" "), runtime.updateUI);
				ctx.ui.notify(result.ok ? `Recorded answer for ${requestId}.` : result.error, result.ok ? "info" : "error");
				return;
			}
			const loopName = action || runtime.ref.currentLoop;
			if (!loopName) return ctx.ui.notify("Usage: /stardock outside [loop]", "warning");
			const state = loadState(ctx, loopName);
			ctx.ui.notify(state ? `Outside requests for ${loopName}:\n${formatOutsideRequests(state)}` : `Loop "${loopName}" not found.`, state ? "info" : "error");
		},
		nuke(rest, ctx) {
			const force = rest.trim() === "--yes";
			const warning = "This deletes all .stardock state, task, and archive files. External task files are not removed.";
			const run = () => {
				const dir = stardockDir(ctx);
				if (!fs.existsSync(dir)) {
					if (ctx.hasUI) ctx.ui.notify("No .stardock directory found.", "info");
					return;
				}
				runtime.ref.currentLoop = null;
				const ok = tryRemoveDir(dir);
				if (ctx.hasUI) ctx.ui.notify(ok ? "Removed .stardock directory." : "Failed to remove .stardock directory.", ok ? "info" : "error");
				runtime.updateUI(ctx);
			};
			if (!force) {
				if (ctx.hasUI) void ctx.ui.confirm("Delete all Stardock loop files?", warning).then((confirmed) => { if (confirmed) run(); });
				else ctx.ui.notify(`Run /stardock nuke --yes to confirm. ${warning}`, "warning");
				return;
			}
			if (ctx.hasUI) ctx.ui.notify(warning, "warning");
			run();
		},
	};

	pi.registerCommand("stardock", {
		description: "Stardock - governed implementation loops",
		handler: async (args, ctx) => {
			const [cmd] = args.trim().split(/\s+/);
			const handler = commands[cmd];
			if (handler) handler(args.slice(cmd.length).trim(), ctx);
			else ctx.ui.notify(HELP, "info");
		},
	});

	pi.registerCommand("stardock-stop", {
		description: "Stop active Stardock loop (idle only)",
		handler: async (_args, ctx) => {
			if (!ctx.isIdle()) {
				if (ctx.hasUI) ctx.ui.notify("Agent is busy. Press ESC to interrupt, then run /stardock-stop.", "warning");
				return;
			}
			let state = runtime.ref.currentLoop ? loadState(ctx, runtime.ref.currentLoop) : null;
			if (!state) {
				const active = listLoops(ctx).find((l) => l.status === "active");
				if (!active) {
					if (ctx.hasUI) ctx.ui.notify("No active Stardock loop", "warning");
					return;
				}
				state = active;
			}
			if (state.status !== "active") {
				if (ctx.hasUI) ctx.ui.notify(`Loop "${state.name}" is not active`, "warning");
				return;
			}
			runtime.stopLoop(ctx, state, `Stopped Stardock loop: ${state.name} (iteration ${state.iteration})`);
		},
	});
}
