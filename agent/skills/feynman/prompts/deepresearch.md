---
description: Run a thorough, source-heavy investigation on a topic and produce a durable research brief with inline citations.
args: <topic>
section: Research Workflows
---
Run deep research for: $@

This is an execution request, not a request to explain or implement the workflow instructions.
Execute the workflow. Do not answer by describing the protocol, do not explain these instructions, and do not restate the protocol. Your first actions should be tool calls that create directories and write the plan artifact.

## Required Artifacts

Derive a short slug from the topic: lowercase, hyphenated, no filler words, at most 5 words.

Every run must leave these files on disk:
- `.pi/plans/<slug>.md`
- `.pi/feynman/drafts/<slug>-draft.md`
- `.pi/feynman/drafts/<slug>-cited.md`
- `.pi/feynman/outputs/<slug>.md` or `.pi/feynman/papers/<slug>.md`
- `.pi/feynman/outputs/<slug>.provenance.md` or `.pi/feynman/papers/<slug>.provenance.md`

After the user approves the plan, if any capability fails, continue in degraded mode and still write a blocked or partial final output and provenance sidecar. Never end with chat-only output after plan approval. Never end with only an explanation in chat after plan approval. Use `Verification: BLOCKED` when verification could not be completed.

## Step 1: Plan

Create `.pi/plans/<slug>.md` immediately. The plan must include:
- Key questions
- Evidence needed
- Scale decision
- Task ledger
- Verification log
- Decision log

Make the scale decision before assigning owners in the plan. If the topic is a narrow "what is X" explainer, the plan must use lead-owned direct search tasks only; do not allocate `feynman-researcher` subagents in the task ledger.

After writing the plan, stop and ask for explicit confirmation before gathering evidence. Summarize the plan briefly and ask:

`Proceed with this deep research plan? Reply "yes" to continue, or tell me what to change.`

Do not run searches, fetch sources, spawn subagents, draft, cite, review, or deliver final artifacts until the user confirms. If the user requests changes, update `.pi/plans/<slug>.md` first, then ask for confirmation again.

## Step 2: Scale

Use direct search for:
- Single fact or narrow question, including "what is X" explainers
- Work you can answer with 3-10 tool calls

For "what is X" explainer topics, you MUST NOT spawn `feynman-researcher` subagents unless the user explicitly asks for comprehensive coverage, current landscape, benchmarks, or production deployment.
Do not inflate a simple explainer into a multi-agent survey.

Use subagents only when decomposition clearly helps:
- Direct comparison of 2-3 items: 2 `feynman-researcher` subagents
- Broad survey or multi-faceted topic: 3-4 `feynman-researcher` subagents
- Complex multi-domain research: 4-6 `feynman-researcher` subagents

## Step 3: Gather Evidence

Use only tool names visible in the current tool set. For web search, call `web_search`; never call `google:search`, `google_search`, or `search_google`.

Avoid crash-prone PDF parsing in this workflow. Do not call `alpha_get_paper` and do not fetch `.pdf` URLs unless the user explicitly asks for PDF extraction. Prefer paper metadata, abstracts, HTML pages, official docs, and web snippets. If only a PDF exists, cite the PDF URL from search metadata and mark full-text PDF parsing as blocked instead of fetching it.

If direct search was chosen:
- Skip researcher spawning entirely.
- Search and fetch sources yourself.
- Use multiple search terms/angles before drafting. Minimum: 3 distinct queries for direct-mode research, covering definition/history, mechanism/formula, and current usage/comparison when relevant.
- Record the exact search terms used in `.pi/feynman/drafts/<slug>-research-direct.md`.
- Write notes to `.pi/feynman/drafts/<slug>-research-direct.md`.
- Continue to synthesis.

If subagents were chosen:
- Write a per-researcher brief first, such as `.pi/plans/<slug>-T1.md`.
- Keep `subagent` tool-call JSON small and valid.
- Do not place multi-paragraph instructions inside the `subagent` JSON.
- Use only supported `subagent` keys. Do not add extra keys such as `artifacts` unless the tool schema explicitly exposes them.
- Do not name exact tool commands in subagent tasks unless those tool names are visible in the current tool set.
- Prefer broad guidance such as "use paper search and web search"; if a PDF parser or paper fetch fails, the researcher must continue from metadata, abstracts, and web sources and mark PDF parsing as blocked.

Example shape:

```json
{
  "tasks": [
    { "agent": "feynman-researcher", "task": "Read .pi/plans/<slug>-T1.md and write <slug>-research-web.md.", "output": "<slug>-research-web.md" },
    { "agent": "feynman-researcher", "task": "Read .pi/plans/<slug>-T2.md and write <slug>-research-papers.md.", "output": "<slug>-research-papers.md" }
  ],
  "concurrency": 4
}
```

After evidence gathering, update the plan ledger and verification log. If research failed, record exactly what failed and proceed with a blocked or partial draft.

## Step 4: Draft

Write the report yourself. Do not delegate synthesis.

Save to `.pi/feynman/drafts/<slug>-draft.md`.

Include:
- Executive summary
- Findings organized by question/theme
- Evidence-backed caveats and disagreements
- Open questions
- No invented sources, results, figures, benchmarks, images, charts, or tables

Before citation, sweep the draft:
- Every critical claim, number, figure, table, or benchmark must map to a source URL, research note, raw artifact path, or command/script output.
- Remove or downgrade unsupported claims.
- Mark inferences as inferences.

## Step 5: Cite

If direct search/no `feynman-researcher` subagents was chosen:
- Do citation yourself.
- Verify reachable HTML/doc URLs with available fetch/search tools.
- Copy or rewrite `.pi/feynman/drafts/<slug>-draft.md` to `.pi/feynman/drafts/<slug>-cited.md` with inline citations and a Sources section.
- Do not spawn the `feynman-verifier` subagent for simple direct-search runs.

If `feynman-researcher` subagents were used, run the `feynman-verifier` agent after the draft exists. This step is mandatory and must complete before any reviewer runs. Do not run the `feynman-verifier` and `feynman-reviewer` in the same parallel `subagent` call.

Use this shape:

```json
{
  "agent": "feynman-verifier",
  "task": "Add inline citations to .pi/feynman/drafts/<slug>-draft.md using the research files as source material. Verify every URL. Write the complete cited brief to .pi/feynman/drafts/<slug>-cited.md.",
  "output": ".pi/feynman/drafts/<slug>-cited.md"
}
```

After the verifier returns, verify on disk that `.pi/feynman/drafts/<slug>-cited.md` exists. If the verifier wrote elsewhere, find the cited file and move or copy it to `.pi/feynman/drafts/<slug>-cited.md`.

## Step 6: Review

If direct search/no `feynman-researcher` subagents was chosen:
- Review the cited draft yourself.
- Write `.pi/feynman/drafts/<slug>-verification.md` with FATAL / MAJOR / MINOR findings and the checks performed.
- Fix FATAL issues before delivery.
- Do not spawn the `feynman-reviewer` subagent for simple direct-search runs.

If `feynman-researcher` subagents were used, only after `.pi/feynman/drafts/<slug>-cited.md` exists, run the `feynman-reviewer` agent against it.

Use this shape:

```json
{
  "agent": "feynman-reviewer",
  "task": "Verify .pi/feynman/drafts/<slug>-cited.md. Flag unsupported claims, logical gaps, single-source critical claims, and overstated confidence. This is a verification pass, not a peer review.",
  "output": "<slug>-verification.md"
}
```

If the reviewer flags FATAL issues, fix them before delivery and run one more review pass. Note MAJOR issues in Open Questions. Accept MINOR issues.

When applying reviewer fixes, do not issue one giant `edit` tool call with many replacements. Use small localized edits only for 1-3 simple corrections. For section rewrites, table rewrites, or more than 3 substantive fixes, read the cited draft and write a corrected full file to `.pi/feynman/drafts/<slug>-revised.md` instead.

After applying reviewer, verifier, audit, or PI-style fixes, run an explicit on-disk verification before saying the fixes landed. Use `rg`, `grep`, `diff`, `wc`, `stat`, or a targeted read to prove the old unsupported wording is gone and the replacement wording exists. If an `edit` or `write` tool call fails, do not describe the fix as applied; record the failure in the plan/provenance, retry with a smaller edit or a full corrected file, and verify again. Provenance may only say an issue was fixed when this post-edit verification passed.

The final candidate is `.pi/feynman/drafts/<slug>-revised.md` if it exists; otherwise it is `.pi/feynman/drafts/<slug>-cited.md`.

## Step 7: Deliver

Copy the final candidate to:
- `.pi/feynman/papers/<slug>.md` for paper-style drafts
- `.pi/feynman/outputs/<slug>.md` for everything else

Write provenance next to it as `<slug>.provenance.md`:

```markdown
# Provenance: [topic]

- **Date:** [date]
- **Rounds:** [number of research rounds]
- **Sources consulted:** [count and/or list]
- **Sources accepted:** [count and/or list]
- **Sources rejected:** [dead, unverifiable, or removed]
- **Verification:** [PASS / PASS WITH NOTES / BLOCKED]
- **Plan:** .pi/plans/<slug>.md
- **Research files:** [files used]
```

Before responding, verify on disk that all required artifacts exist. If verification could not be completed, set `Verification: BLOCKED` or `PASS WITH NOTES` and list the missing checks.

Before responding, also verify that any fixes claimed in the provenance are reflected in the final candidate. If a fix removed a phrase, number, source, or claim, run a targeted `rg`/`grep` check for the removed content and a second check for the corrected content. Do not claim "all patches applied", "all checks pass", or "fixed" unless these commands or reads succeed.

Final response should be brief: link the final file, provenance file, and any blocked checks.
