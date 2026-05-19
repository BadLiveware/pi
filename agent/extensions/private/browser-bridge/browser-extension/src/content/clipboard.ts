namespace PiBrowserBridgeContent {
	export interface ClipboardRequest {
		action: "write";
		text: string;
		requireUserConfirmation?: boolean;
	}

	export interface ClipboardResult {
		ok: boolean;
		action: "write";
		cancelled?: boolean;
		chars: number;
		summary: string;
	}

	export async function runClipboardRequest(request: ClipboardRequest): Promise<ClipboardResult> {
		if (request.action !== "write") throw new Error("Unsupported clipboard action.");
		if (typeof request.text !== "string") throw new Error("Clipboard text is required.");
		if (request.requireUserConfirmation !== false && !window.confirm(`Allow Pi to set your clipboard to ${request.text.length} character(s)?`)) {
			return { ok: false, action: "write", cancelled: true, chars: request.text.length, summary: "clipboard write cancelled" };
		}
		await writeClipboardText(request.text);
		return { ok: true, action: "write", chars: request.text.length, summary: `wrote ${request.text.length} character(s) to clipboard` };
	}

	async function writeClipboardText(text: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(text);
			return;
		} catch {
			copyWithHiddenTextArea(text);
		}
	}

	function copyWithHiddenTextArea(text: string): void {
		const textarea = document.createElement("textarea");
		textarea.value = text;
		textarea.setAttribute("readonly", "true");
		Object.assign(textarea.style, {
			position: "fixed",
			top: "0",
			left: "0",
			width: "1px",
			height: "1px",
			opacity: "0",
			pointerEvents: "none",
		});
		document.documentElement.appendChild(textarea);
		textarea.focus();
		textarea.select();
		const copied = document.execCommand("copy");
		textarea.remove();
		if (!copied) throw new Error("Browser refused clipboard write.");
	}
}
