import {
	analyzeCompactionRecovery,
	analyzeRalphBranchForStall,
	assistantRequestsRalphContinuation,
	assistantStoppedForContextLimit,
	isRalphLoopPromptText,
	messageText,
	parseRalphPrompt,
} from "./src/analysis.ts";
import { WATCHDOG_NUDGE_PROMPT } from "./src/model.ts";
import { registerCompactionContinue } from "./src/runtime.ts";

export {
	analyzeCompactionRecovery,
	analyzeRalphBranchForStall,
	assistantRequestsRalphContinuation,
	assistantStoppedForContextLimit,
	isRalphLoopPromptText,
	messageText,
	parseRalphPrompt,
	WATCHDOG_NUDGE_PROMPT,
};

export default registerCompactionContinue;
