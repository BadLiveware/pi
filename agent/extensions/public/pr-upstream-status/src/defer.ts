export function deferExtensionWork(work: () => void | Promise<void>): void {
	setTimeout(() => {
		void Promise.resolve().then(work).catch(() => {});
	}, 0);
}
