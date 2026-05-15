type FeedbackFieldValue = string | number | boolean;

const allowedBaseFields = new Set([
	"perceivedUsefulness",
	"wouldUseAgainSameSituation",
	"followupWasRoutine",
	"followupNeededBecauseToolWasInsufficient",
	"outputSeemedTooNoisy",
	"outputSeemedIncomplete",
	"missedImportantContext",
	"confidence",
	"improvement",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function scalar(value: unknown): FeedbackFieldValue | undefined {
	if (typeof value === "string" || typeof value === "boolean") return value;
	if (typeof value === "number" && Number.isFinite(value)) return value;
	return undefined;
}

function sanitizeFieldResponses(value: unknown): Record<string, FeedbackFieldValue> | undefined {
	if (!isRecord(value)) return undefined;
	const output: Record<string, FeedbackFieldValue> = {};
	for (const [name, raw] of Object.entries(value)) {
		const item = scalar(raw);
		if (item !== undefined) output[name] = item;
	}
	return Object.keys(output).length > 0 ? output : undefined;
}

export function sanitizePerToolResponses(input: unknown): Record<string, Record<string, unknown>> | undefined {
	if (!isRecord(input)) return undefined;
	const output: Record<string, Record<string, unknown>> = {};
	for (const [toolName, rawResponse] of Object.entries(input)) {
		if (!toolName.trim() || !isRecord(rawResponse)) continue;
		const response: Record<string, unknown> = {};
		for (const [name, raw] of Object.entries(rawResponse)) {
			if (allowedBaseFields.has(name)) {
				const item = scalar(raw);
				if (item !== undefined) response[name] = item;
			}
		}
		const fieldResponses = sanitizeFieldResponses(rawResponse.fieldResponses);
		if (fieldResponses) response.fieldResponses = fieldResponses;
		if (Object.keys(response).length > 0) output[toolName.trim()] = response;
	}
	return Object.keys(output).length > 0 ? output : undefined;
}
