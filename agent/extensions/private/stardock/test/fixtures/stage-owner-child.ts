import * as fs from "node:fs";
import { acquireStageOwnership } from "../../src/stages/ownership.ts";
import { OwnershipProtocolError } from "../../src/stages/ownership-records.ts";

const [cwd, loopName, graphId, stageId, revisionText, sessionId, gatePath] = process.argv.slice(2);
const signal = new Int32Array(new SharedArrayBuffer(4));
while (!fs.existsSync(gatePath)) Atomics.wait(signal, 0, 0, 5);

try {
	const result = acquireStageOwnership({ cwd } as never, {
		loopName,
		graphId,
		stageId,
		expectedGraphRevision: Number(revisionText),
		sessionId,
	});
	process.stdout.write(JSON.stringify({ ok: true, stateRevision: result.stateRevision }));
} catch (error) {
	if (error instanceof OwnershipProtocolError) {
		process.stdout.write(JSON.stringify({ ok: false, code: error.code }));
		process.exitCode = 2;
	} else {
		throw error;
	}
}
