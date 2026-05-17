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
	const terminalInputHandlers = new Set<(data: string) => { consume?: boolean; data?: string } | undefined>();
	const aborts: string[] = [];
	let idle = true;
	const eventHandlers = new Map<string, Array<(data: unknown) => void>>();
	const events = {
		on(event: string, handler: (data: unknown) => void) {
			eventHandlers.set(event, [...(eventHandlers.get(event) ?? []), handler]);
			return () => {
				const handlers = eventHandlers.get(event) ?? [];
				eventHandlers.set(event, handlers.filter((item) => item !== handler));
			};
		},
		emit(event: string, data: unknown) {
			for (const handler of [...(eventHandlers.get(event) ?? [])]) handler(data);
		},
	};

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
		events,
	} as any;

	const ctx = {
		cwd,
		hasUI: true,
		hasPendingMessages: () => false,
		isIdle: () => idle,
		abort: () => {
			aborts.push("abort");
		},
		ui: {
			notify(message: string) {
				notifications.push(message);
			},
			onTerminalInput(handler: (data: string) => { consume?: boolean; data?: string } | undefined) {
				terminalInputHandlers.add(handler);
				return () => terminalInputHandlers.delete(handler);
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
	const setIdle = (value: boolean) => {
		idle = value;
	};
	const dispatchTerminalInput = (data: string) => {
		let current = data;
		for (const handler of [...terminalInputHandlers]) {
			const result = handler(current);
			if (result?.consume) return { consumed: true, data: current };
			if (result?.data !== undefined) current = result.data;
		}
		return { consumed: false, data: current };
	};
	return { tools, commands, handlers, messages, entries, notifications, statuses, widgets, eventHandlers, events, ctx, setIdle, dispatchTerminalInput, aborts };
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
