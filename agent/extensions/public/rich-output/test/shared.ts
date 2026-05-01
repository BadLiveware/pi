import { resetCapabilitiesCache, setCapabilities } from "@mariozechner/pi-tui";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import richOutput from "../index.ts";

export function loadExtension() {
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const renderers = new Map<string, any>();
	const messages: unknown[] = [];
	const entries: Array<{ customType: string; data: unknown }> = [];
	const pi = {
		registerTool(tool: any) {
			tools.set(tool.name, tool);
		},
		registerCommand(name: string, command: any) {
			commands.set(name, command);
		},
		registerMessageRenderer(type: string, renderer: any) {
			renderers.set(type, renderer);
		},
		sendMessage(message: unknown) {
			messages.push(message);
		},
		appendEntry(customType: string, data: unknown) {
			entries.push({ customType, data });
		},
	} as any;
	richOutput(pi);
	return { tools, commands, renderers, messages, entries };
}

export const theme = {
	fg: (_style: string, text: string) => text,
	bg: (_style: string, text: string) => text,
	bold: (text: string) => text,
};

export function pngDimensions(path: string): { width: number; height: number } {
	const buffer = readFileSync(path);
	return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

export { resetCapabilitiesCache, setCapabilities, mkdtempSync, tmpdir, join, existsSync, readFileSync, writeFileSync };
