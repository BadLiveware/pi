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

	namespace tabs {
		interface Tab {
			id?: number;
			title?: string;
			url?: string;
			active?: boolean;
		}

		function query(queryInfo: { active?: boolean; currentWindow?: boolean }): Promise<Tab[]>;
		function create(createProperties: { url: string; active?: boolean }): Promise<Tab>;
		function update(tabId: number, updateProperties: { url?: string; active?: boolean }): Promise<Tab>;
		function sendMessage<TResponse = unknown>(tabId: number, message: unknown, options?: { frameId?: number }): Promise<TResponse>;
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
