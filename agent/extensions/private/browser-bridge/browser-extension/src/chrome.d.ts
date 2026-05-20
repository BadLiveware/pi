declare namespace chrome {
	namespace runtime {
		interface Manifest {
			version: string;
		}

		interface MessageSender {
			tab?: tabs.Tab;
		}

		const lastError: { message: string } | undefined;

		function getManifest(): Manifest;
		function sendMessage<TResponse = unknown>(message: unknown): Promise<TResponse>;

		const onMessage: {
			addListener(listener: (message: unknown, sender: MessageSender, sendResponse: (response?: unknown) => void) => boolean | void): void;
		};
	}

	namespace storage {
		const local: {
			get(keys?: string[] | Record<string, unknown>): Promise<Record<string, unknown>>;
			set(items: Record<string, unknown>): Promise<void>;
			remove(keys: string | string[]): Promise<void>;
		};
	}

	namespace action {
		function setIcon(details: { path: string | Record<number, string>; tabId?: number }): Promise<void>;
		function setTitle(details: { title: string; tabId?: number }): Promise<void>;
	}

	namespace tabs {
		interface Tab {
			id?: number;
			windowId?: number;
			title?: string;
			url?: string;
			active?: boolean;
		}

		interface ActiveInfo {
			tabId: number;
			windowId: number;
		}

		interface ChangeInfo {
			url?: string;
			status?: string;
		}

		function query(queryInfo: { active?: boolean; currentWindow?: boolean; windowId?: number }): Promise<Tab[]>;
		function get(tabId: number): Promise<Tab>;
		function create(createProperties: { url: string; active?: boolean }): Promise<Tab>;
		function update(tabId: number, updateProperties: { url?: string; active?: boolean }): Promise<Tab>;
		function sendMessage<TResponse = unknown>(tabId: number, message: unknown, options?: { frameId?: number }): Promise<TResponse>;
		function captureVisibleTab(windowId?: number, options?: { format?: "png" | "jpeg"; quality?: number }): Promise<string>;

		const onActivated: {
			addListener(listener: (activeInfo: ActiveInfo) => void): void;
		};
		const onUpdated: {
			addListener(listener: (tabId: number, changeInfo: ChangeInfo, tab: Tab) => void): void;
		};
		const onRemoved: {
			addListener(listener: (tabId: number, removeInfo: { windowId: number; isWindowClosing: boolean }) => void): void;
		};
	}

	namespace windows {
		const WINDOW_ID_NONE: number;

		const onFocusChanged: {
			addListener(listener: (windowId: number) => void): void;
		};
	}

	namespace scripting {
		function executeScript(details: { target: { tabId: number; allFrames?: boolean; frameIds?: number[] }; files: string[] }): Promise<unknown[]>;
	}

	namespace contextMenus {
		type ContextType = "all" | "page" | "selection" | "link" | "editable" | "image" | "video" | "audio";

		interface OnClickData {
			menuItemId: string | number;
			editable?: boolean;
			frameId?: number;
			frameUrl?: string;
			linkUrl?: string;
			mediaType?: string;
			pageUrl?: string;
			selectionText?: string;
			srcUrl?: string;
		}

		function create(properties: { id?: string; title: string; contexts?: ContextType[]; documentUrlPatterns?: string[] }, callback?: () => void): void;
		function remove(menuItemId: string | number, callback?: () => void): void;

		const onClicked: {
			addListener(listener: (info: OnClickData, tab?: tabs.Tab) => void): void;
		};
	}
}
