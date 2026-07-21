import { execFile, type ExecFileException } from "node:child_process";

export interface ArgumentProcessOptions {
	cwd: string;
	signal?: AbortSignal;
}

export interface ArgumentProcessResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

export type ArgumentProcessRunner = (
	command: string,
	args: readonly string[],
	options: ArgumentProcessOptions,
) => Promise<ArgumentProcessResult>;

export const defaultArgumentProcessRunner: ArgumentProcessRunner = (
	command: string,
	args: readonly string[],
	options: ArgumentProcessOptions,
): Promise<ArgumentProcessResult> => new Promise<ArgumentProcessResult>((resolve) => {
	execFile(command, [...args], { cwd: options.cwd, encoding: "utf8", signal: options.signal }, (error: ExecFileException | null, stdout: string, stderr: string) => {
		let exitCode = 0;
		if (error) {
			exitCode = 1;
			if (typeof error.code === "number") exitCode = error.code;
		}
		resolve({ exitCode, stdout, stderr });
	});
});
