import type { ArgumentProcessOptions, ArgumentProcessResult } from "./argument-process.ts";

export function commandDescription(command: string, args: readonly string[]): string {
	return [command, ...args].map((value) => JSON.stringify(value)).join(" ");
}

export function failureMessage(label: string, command: string, args: readonly string[], result: ArgumentProcessResult): string {
	const stderr = result.stderr.trim();
	const stdout = result.stdout.trim();
	let detail = "no output";
	if (stderr) detail = `stderr: ${stderr}`;
	else if (stdout) detail = `stdout: ${stdout}`;
	return `${label} failed with exit code ${result.exitCode} (${commandDescription(command, args)}); ${detail}.`;
}

export function processOptions(cwd: string, signal?: AbortSignal): ArgumentProcessOptions {
	const options: ArgumentProcessOptions = { cwd };
	if (signal) options.signal = signal;
	return options;
}
