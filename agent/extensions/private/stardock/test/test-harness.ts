import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import stardockLoop from "../index.ts";

export function makeHarness(cwd: string) {
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const handlers = new Map<string, any[]>();
	const messages: Array<{ content: string; options?: unknown }> = [];
	const entries: Array<{ customType: string; data?: unknown }> = [];
	const notifications: string[] = [];
	const statuses = new Map<string, string | undefined>();
	const widgets = new Map<string, string[] | undefined>();

	const pi = {
		registerTool(tool: any) {
			tools.set(tool.name, tool);
		},
		registerCommand(name: string, options: any) {
			commands.set(name, options);
		},
		on(event: string, handler: any) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
		sendUserMessage(content: string, options?: unknown) {
			messages.push({ content, options });
		},
		appendEntry(customType: string, data?: unknown) {
			entries.push({ customType, data });
		},
	} as any;

	const ctx = {
		cwd,
		hasUI: true,
		hasPendingMessages: () => false,
		isIdle: () => true,
		ui: {
			notify(message: string) {
				notifications.push(message);
			},
			setStatus(key: string, value: string | undefined) {
				statuses.set(key, value);
			},
			setWidget(key: string, value: string[] | undefined) {
				widgets.set(key, value);
			},
			confirm: async () => false,
			theme: {
				fg: (_style: string, text: string) => text,
				bold: (text: string) => text,
			},
		},
		sessionManager: {
			getBranch: () => [],
		},
	} as any;

	stardockLoop(pi);
	return { tools, commands, handlers, messages, entries, notifications, statuses, widgets, ctx };
}

export function runDir(cwd: string, name: string, archived = false): string {
	return path.join(cwd, ".stardock", archived ? "archive" : "runs", name);
}

export function statePath(cwd: string, name: string, archived = false): string {
	return path.join(runDir(cwd, name, archived), "state.json");
}

export function taskPath(cwd: string, name: string, archived = false): string {
	return path.join(runDir(cwd, name, archived), "task.md");
}
