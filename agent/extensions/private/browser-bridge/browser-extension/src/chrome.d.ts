declare namespace chrome {
	namespace runtime {
		interface Manifest {
			version: string;
		}

		interface MessageSender {
			tab?: tabs.Tab;
		}

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
		function sendMessage<TResponse = unknown>(tabId: number, message: unknown): Promise<TResponse>;
	}

	namespace scripting {
		function executeScript(details: { target: { tabId: number; allFrames?: boolean }; files: string[] }): Promise<unknown[]>;
	}
}
