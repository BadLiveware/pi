interface PopupResponse<T = unknown> {
	ok: boolean;
	state?: RuntimeState;
	tab?: ActivatedTab;
	error?: string;
}

interface RuntimeState {
	connected: boolean;
	url?: string;
	clientId?: string;
	lastError?: string;
	activatedTabs: ActivatedTab[];
}

interface ActivatedTab {
	tabId: number;
	title?: string;
	origin?: string;
	capabilities: string[];
	activatedAt: number;
}

const statusEl = requireElement("status");
const urlInput = requireInput("bridge-url");
const tokenInput = requireInput("pairing-token");
const messageEl = requireElement("message");
const connectButton = requireButton("connect");
const disconnectButton = requireButton("disconnect");
const activateButton = requireButton("activate");

connectButton.addEventListener("click", () => {
	void runAction(async () => {
		const response = await send<PopupResponse<RuntimeState>>({ type: "bridge:connect", url: urlInput.value, token: tokenInput.value });
		handleResponse(response, "Connected to Pi bridge.");
	});
});

disconnectButton.addEventListener("click", () => {
	void runAction(async () => {
		const response = await send<PopupResponse<RuntimeState>>({ type: "bridge:disconnect" });
		handleResponse(response, "Disconnected.");
	});
});

activateButton.addEventListener("click", () => {
	void runAction(async () => {
		const response = await send<PopupResponse<ActivatedTab>>({ type: "tabs:activateCurrent" });
		handleResponse(response, response.tab ? `Activated tab ${response.tab.tabId}.` : "Activated current tab.");
	});
});

void refresh();

async function refresh(): Promise<void> {
	const response = await send<PopupResponse<RuntimeState>>({ type: "bridge:getState" });
	if (!response.ok || !response.state) {
		setMessage(response.error ?? "Could not load bridge state.", true);
		return;
	}
	renderState(response.state);
}

async function runAction(action: () => Promise<void>): Promise<void> {
	setBusy(true);
	try {
		await action();
	} catch (error) {
		setMessage(error instanceof Error ? error.message : String(error), true);
	} finally {
		setBusy(false);
		await refresh();
	}
}

function handleResponse(response: PopupResponse, successMessage: string): void {
	if (!response.ok) {
		setMessage(response.error ?? "Browser bridge action failed.", true);
		void refresh();
		return;
	}
	if (response.state) renderState(response.state);
	setMessage(successMessage, false);
}

function renderState(state: RuntimeState): void {
	if (state.url && !urlInput.value) urlInput.value = state.url;
	const lines = [
		`Connection: ${state.connected ? "connected" : "disconnected"}`,
		`Client: ${state.clientId ?? "not paired"}`,
		`Activated tabs: ${state.activatedTabs.length}`,
	];
	if (state.lastError) lines.push(`Last error: ${state.lastError}`);
	if (state.activatedTabs.length > 0) {
		for (const tab of state.activatedTabs.slice(-3)) {
			lines.push(`- ${tab.title ?? "Untitled"} (${tab.origin ?? "unknown origin"})`);
		}
	}
	statusEl.textContent = lines.join("\n");
	connectButton.disabled = state.connected;
	disconnectButton.disabled = !state.connected;
	activateButton.disabled = !state.connected;
}

function setBusy(busy: boolean): void {
	if (!busy) return;
	connectButton.disabled = true;
	disconnectButton.disabled = true;
	activateButton.disabled = true;
}

function setMessage(message: string, isError: boolean): void {
	messageEl.textContent = message;
	messageEl.classList.toggle("error", isError);
}

async function send<T>(message: unknown): Promise<T> {
	return await chrome.runtime.sendMessage<T>(message);
}

function requireElement(id: string): HTMLElement {
	const element = document.getElementById(id);
	if (!element) throw new Error(`Missing popup element #${id}.`);
	return element;
}

function requireInput(id: string): HTMLInputElement {
	const element = requireElement(id);
	if (!(element instanceof HTMLInputElement)) throw new Error(`Popup element #${id} is not an input.`);
	return element;
}

function requireButton(id: string): HTMLButtonElement {
	const element = requireElement(id);
	if (!(element instanceof HTMLButtonElement)) throw new Error(`Popup element #${id} is not a button.`);
	return element;
}
