import * as fs from "node:fs";
import { acquireMutationMutex, type StateMutationRecord } from "../../src/stages/ownership-records.ts";

const [cwd, loopName, graphId, stageId, sessionId, tokenDigest, readyPath] = process.argv.slice(2);
const record: StateMutationRecord = {
	version: 1,
	graphId,
	stageId,
	sessionId,
	pid: process.pid,
	tokenDigest,
	acquiredAt: new Date().toISOString(),
};
acquireMutationMutex({ cwd } as never, loopName, record);
fs.writeFileSync(readyPath, String(process.pid), "utf-8");
setInterval(() => undefined, 1_000);
