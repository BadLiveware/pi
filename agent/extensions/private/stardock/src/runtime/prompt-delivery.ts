/** Provenance-preserving delivery for Stardock-generated prompts. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const STARDOCK_PROMPT_CUSTOM_TYPE = "stardock";

export function queueStardockPrompt(pi: ExtensionAPI, content: string): void {
	pi.sendMessage(
		{
			customType: STARDOCK_PROMPT_CUSTOM_TYPE,
			content,
			display: true,
		},
		{
			deliverAs: "followUp",
			triggerTurn: true,
		},
	);
}
