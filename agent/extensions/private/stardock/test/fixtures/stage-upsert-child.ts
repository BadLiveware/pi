import * as fs from "node:fs";
import { OwnershipProtocolError } from "../../src/stages/ownership-records.ts";
import { upsertExecutionGraph } from "../../src/stages/tool.ts";

const [cwd, loopName, graphPath, marker, readyPath, gatePath] = process.argv.slice(2);
const graph = JSON.parse(fs.readFileSync(graphPath, "utf-8"));
const signal = new Int32Array(new SharedArrayBuffer(4));

try {
	const saved = upsertExecutionGraph({ cwd } as never, loopName, graph, undefined, {
		beforeCreateMutation() {
			fs.writeFileSync(readyPath, marker);
			while (!fs.existsSync(gatePath)) Atomics.wait(signal, 0, 0, 5);
		},
	});
	const stage = saved.stages.find((candidate) => candidate.id === "stage");
	const lane = saved.nodes.find((candidate) => candidate.id === "lane");
	process.stdout.write(JSON.stringify({ ok: true, marker, revision: saved.revision, objective: lane?.objective, contractDigest: stage?.contractDigest }));
} catch (error) {
	if (error instanceof OwnershipProtocolError) {
		process.stdout.write(JSON.stringify({ ok: false, marker, code: error.code, message: error.message }));
		process.exitCode = 2;
	} else {
		throw error;
	}
}
