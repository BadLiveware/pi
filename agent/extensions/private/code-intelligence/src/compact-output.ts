function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rows(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? value.filter(isRecord) : [];
}

function asRecord(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {};
}

function str(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function loc(row: Record<string, unknown>): string {
	const line = num(row.line);
	const endLine = num(row.endLine);
	if (!line) return "";
	return endLine && endLine !== line ? `:${line}-${endLine}` : `:${line}`;
}

function compactRange(range: Record<string, unknown>): string | undefined {
	const start = num(range.startLine);
	const end = num(range.endLine);
	if (!start) return undefined;
	return end && end !== start ? `${start}-${end}` : `${start}`;
}

function shortRef(target: Record<string, unknown>): string | undefined {
	const ref = str(target.targetRef) ?? str(target.rangeId) ?? str(target.symbolRef);
	if (!ref) return undefined;
	return ref.includes("@") ? ref.split("@").pop() : ref;
}

function readHintText(row: Record<string, unknown>): string | undefined {
	const hint = asRecord(row.readHint);
	const offset = num(hint.offset);
	const limit = num(hint.limit);
	return offset && limit ? `${offset}+${limit}` : undefined;
}

function compactKind(kind: unknown, owner?: unknown): string {
	const text = String(kind ?? "item");
	if (owner) {
		if (text.includes("field")) return "field";
		return "method";
	}
	if (text.includes("class")) return "class";
	if (text.includes("struct")) return "struct";
	if (text.includes("enum")) return "enum";
	if (text.includes("interface")) return "iface";
	if (text.includes("type")) return "type";
	if (text.includes("field")) return "field";
	if (text.includes("constant")) return "const";
	if (text.includes("variable")) return "var";
	if (text.includes("function") || text.includes("method")) return "fn";
	return text.replace(/_declaration|_definition|_specifier/g, "") || "item";
}

function declarationLine(row: Record<string, unknown>): string {
	const target = asRecord(row.symbolTarget);
	const owner = str(row.containerName) ?? str(row.owner) ?? str(target.containerName) ?? str(target.owner);
	const name = str(row.name) ?? str(target.name) ?? "(anonymous)";
	const qname = owner ? `${owner}::${name}` : name;
	const targetRange = asRecord(target.range);
	const range = compactRange(targetRange) ?? loc(row).replace(/^:/, "");
	const ref = shortRef(target);
	const read = readHintText(row);
	const meta = [ref ? `ref=${ref}` : undefined, read ? `read=${read}` : undefined].filter(Boolean).join(" ");
	return `  ${compactKind(row.kind, owner)} ${qname}${range ? `:${range}` : ""}${meta ? ` ${meta}` : ""}`;
}

function header(tool: string, payload: Record<string, unknown>): string {
	const ok = payload.ok === false ? "FAIL" : "OK";
	const elapsed = num(payload.elapsedMs);
	return `${ok} ${tool}${elapsed !== undefined ? ` ${elapsed}ms` : ""}`;
}

function compactState(payload: Record<string, unknown>): string {
	const backends = isRecord(payload.backends) ? payload.backends : {};
	const lsps = isRecord(payload.languageServers) ? payload.languageServers : {};
	const backendText = Object.entries(backends).map(([key, value]) => `${key}:${String(isRecord(value) ? value.available ?? "?" : "?")}`).join(" ");
	const lspText = Object.entries(lsps).map(([key, value]) => `${key}:${String(isRecord(value) ? value.available ?? "?" : "?")}`).join(" ");
	return [header("state", payload), `repo: ${String(payload.repoRoot ?? "?")}`, `backends: ${backendText}`, `languageServers: ${lspText}`].join("\n");
}

function compactOverview(payload: Record<string, unknown>): string {
	const summary = isRecord(payload.summary) ? payload.summary : {};
	const coverage = isRecord(payload.coverage) ? payload.coverage : {};
	const lines = [
		`${header("repo_overview", payload)} tier=${String(payload.tier ?? "?")} roots=${rows(payload.roots).length || (Array.isArray(payload.roots) ? payload.roots.join(",") : "?")}`,
		`summary: dirs=${summary.dirCount ?? "?"} files=${summary.fileCount ?? "?"} source=${summary.sourceFileCount ?? "?"} tests=${summary.testFileCount ?? "?"} parsed=${summary.parsedFileCount ?? 0} truncated=${coverage.truncated === true}`,
	];
	const excluded = isRecord(coverage.excludedDirs) ? Object.entries(coverage.excludedDirs).map(([k, v]) => `${k}=${v}`).join(" ") : "";
	if (excluded) lines.push(`excluded: ${excluded}`);
	for (const dir of rows(payload.directories).slice(0, 20)) appendDir(lines, dir, 0);
	return lines.join("\n");
}

function langText(dir: Record<string, unknown>): string {
	const langs = rows(dir.dominantLanguages).slice(0, 4).map((lang) => `${lang.language}:${lang.files}`).join(",");
	return langs ? ` lang=${langs}` : "";
}

function appendDir(lines: string[], dir: Record<string, unknown>, indent: number): void {
	const pad = "  ".repeat(indent);
	lines.push(`${pad}${String(dir.path ?? ".")} dirs=${dir.dirs ?? 0} files=${dir.files ?? 0} src=${dir.sourceFiles ?? 0} test=${dir.testFiles ?? 0}${langText(dir)}${dir.truncated ? " trunc" : ""}`);
	for (const file of rows(dir.fileEntries).slice(0, 20)) {
		lines.push(`${pad}  ${String(file.path ?? "?")} ${file.language ?? ""} ${file.category ?? ""}${file.truncated ? " trunc" : ""}`.trimEnd());
		for (const decl of rows(file.declarations).slice(0, 8)) lines.push(`${pad}${declarationLine(decl)}`);
	}
	for (const child of rows(dir.children).slice(0, 20)) appendDir(lines, child, indent + 1);
}

function compactOutline(payload: Record<string, unknown>): string {
	const summary = isRecord(payload.summary) ? payload.summary : {};
	const coverage = isRecord(payload.coverage) ? payload.coverage : {};
	const lines = [
		`${header("file_outline", payload)} ${String(payload.language ?? "?")} ${String(payload.file ?? "?")}`,
		`summary: decls=${summary.declarationCount ?? "?"} imports=${summary.importCount ?? 0} truncated=${coverage.truncated === true}`,
	];
	const imports = Array.isArray(payload.imports) ? payload.imports.map(String) : [];
	if (imports.length) lines.push(`imports: ${imports.slice(0, 8).join(", ")}${imports.length > 8 ? ` … ${imports.length - 8} more` : ""}`);
	lines.push("declarations:");
	for (const decl of rows(payload.declarations).slice(0, 80)) lines.push(declarationLine(decl));
	return lines.join("\n");
}

function compactRoute(payload: Record<string, unknown>): string {
	const summary = isRecord(payload.summary) ? payload.summary : {};
	const coverage = isRecord(payload.coverage) ? payload.coverage : {};
	const lines = [
		`${header("repo_route", payload)} terms=${Array.isArray(payload.terms) ? payload.terms.join(",") : "?"}`,
		`summary: candidates=${summary.candidateCount ?? "?"} returned=${summary.returnedCount ?? "?"} scanned=${summary.filesScanned ?? "?"} truncated=${coverage.truncated === true}`,
	];
	let index = 1;
	for (const candidate of rows(payload.candidates).slice(0, 30)) {
		lines.push(`${index++}. ${String(candidate.file ?? "?")} score=${candidate.score ?? "?"}`);
		const evidence = rows(candidate.evidence);
		const pathTerms = evidence.filter((row) => row.kind === "path" || row.kind === "basename").map((row) => `${row.kind}:${row.term}`).join(",");
		const literals = evidence.filter((row) => row.kind === "literal").map((row) => `${row.term}@${row.line}`).join(", ");
		if (pathTerms) lines.push(`   path: ${pathTerms}`);
		if (literals) lines.push(`   literal: ${literals}`);
	}
	return lines.join("\n");
}

function compactTestMap(payload: Record<string, unknown>): string {
	const summary = isRecord(payload.summary) ? payload.summary : {};
	const coverage = isRecord(payload.coverage) ? payload.coverage : {};
	const target = isRecord(payload.target) ? payload.target : {};
	const lines = [
		`${header("test_map", payload)} target=${String(target.path ?? "?")}`,
		`summary: candidates=${summary.candidateCount ?? "?"} returned=${summary.returnedCount ?? "?"} scanned=${coverage.searchedFileCount ?? "?"} truncated=${coverage.truncated === true}`,
	];
	let index = 1;
	for (const candidate of rows(payload.candidates).slice(0, 30)) {
		lines.push(`${index++}. ${String(candidate.file ?? "?")} score=${candidate.score ?? "?"}`);
		const evidence = rows(candidate.evidence);
		const pathTerms = evidence.filter((row) => row.kind === "path_term" || row.kind === "path_basename").map((row) => row.term).join(",");
		const literals = evidence.filter((row) => row.kind === "literal_match").map((row) => `${row.term}@${row.line}`).join(", ");
		if (pathTerms) lines.push(`   path: ${pathTerms}`);
		if (literals) lines.push(`   literal: ${literals}`);
	}
	return lines.join("\n");
}

function compactImpact(payload: Record<string, unknown>): string {
	const summary = isRecord(payload.summary) ? payload.summary : {};
	const coverage = isRecord(payload.coverage) ? payload.coverage : {};
	const lines = [
		`${header("impact_map", payload)} roots=${Array.isArray(payload.rootSymbols) ? payload.rootSymbols.join(",") : ""}`,
		`summary: rootFiles=${summary.rootFileCount ?? "?"} relatedFiles=${summary.relatedFileCount ?? "?"} related=${rows(payload.related).length} parsed=${coverage.filesParsed ?? "?"} truncated=${coverage.truncated === true}`,
	];
	if (str(payload.reason)) lines.push(`reason: ${str(payload.reason)}`);
	for (const root of rows(payload.roots).slice(0, 20)) lines.push(`root ${String(root.file ?? "")}${loc(root)} ${compactKind(root.kind)} ${String(root.name ?? "?")}`.trim());
	for (const row of rows(payload.related).slice(0, 40)) lines.push(`rel ${String(row.file ?? "")}${loc(row)} ${String(row.kind ?? "?")} ${String(row.name ?? "?")} root=${String(row.rootSymbol ?? "?")}`.trim());
	const refs = isRecord(payload.referenceConfirmation) ? payload.referenceConfirmation : undefined;
	if (refs) lines.push(`refs ${refs.backend ?? "?"}: ok=${refs.ok !== false} count=${rows(refs.references).length}`);
	return lines.join("\n");
}

function compactLocal(payload: Record<string, unknown>): string {
	const summary = isRecord(payload.summary) ? payload.summary : {};
	const coverage = isRecord(payload.coverage) ? payload.coverage : {};
	const lines = [`${header("local_map", payload)}`, `summary: files=${rows(summary.suggestedFiles).length} truncated=${coverage.truncated === true}`];
	for (const file of rows(summary.suggestedFiles).slice(0, 40)) lines.push(`${String(file.file ?? "?")} count=${file.count ?? "?"} reasons=${Array.isArray(file.reasons) ? file.reasons.slice(0, 3).join(";") : ""}`);
	return lines.join("\n");
}

function compactSyntax(payload: Record<string, unknown>): string {
	const summary = isRecord(payload.summary) ? payload.summary : {};
	const lines = [`${header("syntax_search", payload)}`, `summary: matches=${summary.matchCount ?? rows(payload.matches).length} files=${summary.fileCount ?? "?"}`];
	for (const match of rows(payload.matches).slice(0, 50)) lines.push(`${String(match.file ?? "")}${loc(match)} ${String(match.kind ?? "match")} ${String(match.name ?? match.text ?? "")}`.trim());
	return lines.join("\n");
}

function compactReadSymbol(payload: Record<string, unknown>): string {
	const summary = isRecord(payload.summary) ? payload.summary : {};
	const target = isRecord(payload.target) ? payload.target : {};
	const ref = shortRef(target);
	const owner = target.containerName ?? target.owner;
	const targetName = `${owner ? `${String(owner)}::` : ""}${String(target.name ?? "?")}`;
	const lines = [
		`${header("read_symbol", payload)} ${String(payload.language ?? "?")} ${String(payload.file ?? "?")}`,
		`target: ${compactKind(target.kind, target.containerName ?? target.owner)} ${targetName}${compactRange(asRecord(target.range)) ? `:${compactRange(asRecord(target.range))}` : ""}${ref ? ` ref=${ref}` : ""} ${String(payload.sourceCompleteness ?? "?")}`,
		`context: ${summary.contextSegmentCount ?? 0} segment(s), deferred=${summary.deferredReferenceCount ?? 0}`,
	];
	for (const segment of [asRecord(payload.targetSegment), ...rows(payload.contextSegments)].filter((row) => Object.keys(row).length > 0).slice(0, 12)) {
		const segmentTarget = asRecord(segment.target);
		const range = asRecord(segment.range);
		const segmentRef = shortRef(segmentTarget);
		const hash = str(segment.oldHash);
		const label = String(segment.kind ?? "segment");
		const completeness = segment.truncated ? " partial" : "";
		lines.push("", `--- ${label} ${String(segmentTarget.path ?? payload.file ?? "")}:${compactRange(range) ?? "?"}${segmentRef ? ` ref=${segmentRef}` : ""}${hash ? ` hash=${hash}` : ""}${completeness} ---`);
		lines.push(String(segment.source ?? ""));
	}
	return lines.join("\n");
}

function compactMutation(payload: Record<string, unknown>, label: string): string {
	const target = asRecord(payload.target ?? payload.anchor);
	const range = asRecord(target.range);
	const name = str(target.name) ?? "?";
	const ref = shortRef(target);
	const summary = asRecord(payload.summary);
	return [
		`${header(label, payload)} ${String(payload.file ?? target.path ?? "?")}`,
		`${String(payload.operation ?? label)} ${name}${compactRange(range) ? `:${compactRange(range)}` : ""}${ref ? ` ref=${ref}` : ""} hash=${String(payload.oldHash ?? payload.anchorHash ?? "?")}`,
		`summary: bytes=${String(summary.byteDelta ?? "?")} changed=${payload.changed === true}`,
	].join("\n");
}

function compactPostEdit(payload: Record<string, unknown>): string {
	const summary = isRecord(payload.summary) ? payload.summary : {};
	const lines = [
		`${header("post_edit_map", payload)} files=${Array.isArray(payload.changedFiles) ? payload.changedFiles.length : 0}`,
		`summary: changed=${summary.changedSymbolCount ?? 0} related=${summary.relatedCount ?? 0} tests=${summary.testCandidateCount ?? 0} diagnostics=${summary.diagnosticTargetCount ?? 0}`,
	];
	for (const row of rows(payload.changedSymbols).slice(0, 12)) {
		const target = asRecord(row.target);
		const range = asRecord(target.range);
		lines.push(`changed ${String(target.path ?? "")}:${String(range.startLine ?? "?")}-${String(range.endLine ?? "?")} ${String(target.name ?? "?")}`.trim());
	}
	for (const row of rows(payload.diagnosticTargets).slice(0, 8)) {
		const target = asRecord(row.target);
		const diagnostic = asRecord(row.diagnostic);
		lines.push(`diagnostic ${String(target.path ?? diagnostic.path ?? "")}:${String(diagnostic.line ?? "?")} ${String(diagnostic.severity ?? "?")} ${String(target.name ?? "?")}`.trim());
	}
	return lines.join("\n");
}

export function compactCodeIntelOutput(kind: "state" | "overview" | "outline" | "tests" | "route" | "impact" | "local" | "syntax" | "read_symbol" | "post_edit" | "replace_symbol" | "insert_relative", payload: Record<string, unknown>): string {
	if (kind === "state") return compactState(payload);
	if (kind === "overview") return compactOverview(payload);
	if (kind === "outline") return compactOutline(payload);
	if (kind === "tests") return compactTestMap(payload);
	if (kind === "route") return compactRoute(payload);
	if (kind === "impact") return compactImpact(payload);
	if (kind === "local") return compactLocal(payload);
	if (kind === "read_symbol") return compactReadSymbol(payload);
	if (kind === "post_edit") return compactPostEdit(payload);
	if (kind === "replace_symbol") return compactMutation(payload, "replace_symbol");
	if (kind === "insert_relative") return compactMutation(payload, "insert_relative");
	return compactSyntax(payload);
}
