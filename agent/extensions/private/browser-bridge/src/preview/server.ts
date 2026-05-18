import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { BROWSER_BRIDGE_HOST, type BrowserBridgeState } from "../core/state.ts";
import { makeBridgeId } from "../core/ids.ts";

export interface PreviewArtifact {
	url: string;
	path: string;
}

export class PreviewServer {
	private server: Server | undefined;
	private root: string | undefined;
	private readonly state: BrowserBridgeState;

	constructor(state: BrowserBridgeState) {
		this.state = state;
	}

	async ensureStarted(): Promise<{ urlRoot: string; root: string }> {
		if (!this.root) this.root = await mkdtemp(path.join(tmpdir(), "pi-browser-bridge-preview-"));
		await mkdir(this.root, { recursive: true });
		if (!this.server) {
			this.server = createServer((request, response) => {
				void this.handleRequest(request.url ?? "/", response);
			});
			await new Promise<void>((resolve, reject) => {
				this.server!.once("error", reject);
				this.server!.listen(0, BROWSER_BRIDGE_HOST, () => resolve());
			});
		}
		const port = this.port();
		this.state.previewServer = { enabled: true, host: BROWSER_BRIDGE_HOST, port, artifactRoot: this.root };
		return { urlRoot: `http://${BROWSER_BRIDGE_HOST}:${port}`, root: this.root };
	}

	async writeHtml(title: string | undefined, html: string): Promise<PreviewArtifact> {
		const { urlRoot, root } = await this.ensureStarted();
		const fileName = `${safeSlug(title ?? "preview")}-${makeBridgeId("page")}.html`;
		const filePath = path.join(root, fileName);
		await writeFile(filePath, html, "utf8");
		return { path: filePath, url: `${urlRoot}/${encodeURIComponent(fileName)}` };
	}

	async copyWorkspaceFile(cwd: string, rawPath: string): Promise<PreviewArtifact> {
		const source = resolveWorkspacePath(cwd, rawPath);
		const html = await readFile(source, "utf8");
		return await this.writeHtml(path.basename(source, path.extname(source)), html);
	}

	async stop(): Promise<void> {
		const server = this.server;
		this.server = undefined;
		if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
		if (this.root) await rm(this.root, { recursive: true, force: true });
		this.root = undefined;
		this.state.previewServer = undefined;
	}

	private async handleRequest(url: string, response: import("node:http").ServerResponse): Promise<void> {
		try {
			if (!this.root) throw new Error("Preview root is unavailable.");
			const parsed = new URL(url, "http://127.0.0.1");
			const fileName = path.basename(decodeURIComponent(parsed.pathname));
			const filePath = path.join(this.root, fileName);
			if (!filePath.startsWith(this.root)) throw new Error("Invalid preview path.");
			const body = await readFile(filePath);
			response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
			response.end(body);
		} catch {
			response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
			response.end("Preview not found");
		}
	}

	private port(): number {
		const address = this.server?.address();
		if (!address || typeof address === "string") throw new Error("Preview server address is unavailable.");
		return address.port;
	}
}

export function resolveWorkspacePath(cwd: string, rawPath: string): string {
	const withoutAt = rawPath.startsWith("@") ? rawPath.slice(1) : rawPath;
	const resolved = path.resolve(cwd, withoutAt);
	const relative = path.relative(cwd, resolved);
	if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Preview path must stay inside the current workspace.");
	return resolved;
}

function safeSlug(value: string): string {
	const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
	return slug || "preview";
}
