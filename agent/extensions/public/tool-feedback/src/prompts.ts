export const DEFAULT_TASK_PROMPT = [
	"You used watched tools in the previous prompt. Please call `tool_feedback` once with concise structured feedback.",
	"Focus on your own experience using the tool: whether it seemed useful, whether it felt incomplete or noisy, whether follow-up work was routine or compensatory, whether you would use it again in the same situation, and what one improvement would help most.",
	"This is a dogfood feedback request, not new implementation work.",
	"Do not acknowledge or summarize this request to the user. Call `tool_feedback` silently and continue or stop if you were done.",
].join("\n\n");

export const BASE_FIELD_PROMPT = [
	"Base `tool_feedback` field values:",
	"- perceivedUsefulness: `high`, `medium`, `low`, `none`, or `unknown`",
	"- wouldUseAgainSameSituation: `yes`, `no`, `unsure`, or `unknown`",
	"- followupWasRoutine, followupNeededBecauseToolWasInsufficient, outputSeemedTooNoisy, outputSeemedIncomplete, missedImportantContext: `yes`, `no`, or `unknown`",
	"- confidence: `high`, `medium`, or `low`",
	"- improvement (optional): `better_ranking`, `higher_cap`, `better_summary`, `better_docs`, `less_noise`, `faster`, or `other`",
	"Use `fieldResponses` only for configured extra fields. You do not need to inspect extension source to answer this prompt.",
].join("\n");
