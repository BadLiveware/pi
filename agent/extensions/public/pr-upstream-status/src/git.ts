import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export async function runGit(pi: ExtensionAPI, cwd: string, ...args: string[]): Promise<string | undefined> {
	const result = await pi.exec("git", args, { cwd, timeout: 6_000 });
	if (result.code !== 0) return undefined;
	const value = result.stdout.trim();
	return value.length > 0 ? value : undefined;
}
