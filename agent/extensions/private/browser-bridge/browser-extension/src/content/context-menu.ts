namespace PiBrowserBridgeContent {
	interface ContextMenuTargetState {
		installed: boolean;
		lastTarget?: {
			element: Element;
			capturedAt: number;
			clientX: number;
			clientY: number;
			pageX: number;
			pageY: number;
		};
	}

	type ContextMenuGlobal = typeof globalThis & {
		__piBrowserBridgeContextMenuState?: ContextMenuTargetState;
	};

	const contextMenuGlobal = globalThis as ContextMenuGlobal;
	const contextMenuState = contextMenuGlobal.__piBrowserBridgeContextMenuState ??= { installed: false };

	if (!contextMenuState.installed) {
		document.addEventListener("contextmenu", rememberContextMenuTarget, true);
		contextMenuState.installed = true;
	}

	export function describeLastContextMenuTarget(options: SelectElementsOptions = { mode: "single", source: "context-menu" }): SelectElementsResponse {
		const latest = contextMenuState.lastTarget;
		const source = options.source ?? "context-menu";
		if (!latest) return { status: "cancelled", elements: [], reason: "no-context-menu-target", context: currentSelectionContext(source) };
		if (!latest.element.isConnected) return { status: "cancelled", elements: [], reason: "stale-context-menu-target", context: contextFromTarget(source, latest) };
		return { status: "selected", elements: [describeElement(latest.element, options)], context: contextFromTarget(source, latest) };
	}

	function rememberContextMenuTarget(event: MouseEvent): void {
		const element = selectableElement(event.target);
		if (!element) return;
		contextMenuState.lastTarget = {
			element,
			capturedAt: Date.now(),
			clientX: event.clientX,
			clientY: event.clientY,
			pageX: event.pageX,
			pageY: event.pageY,
		};
	}

	function contextFromTarget(source: SelectionSource, target: NonNullable<ContextMenuTargetState["lastTarget"]>): ElementSelectionContext {
		return currentSelectionContext(source, {
			selectedAt: target.capturedAt,
			clientX: target.clientX,
			clientY: target.clientY,
			pageX: target.pageX,
			pageY: target.pageY,
		});
	}
}
