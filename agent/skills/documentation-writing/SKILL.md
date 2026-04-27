---
name: documentation-writing
description: Use when writing or editing user-facing documentation, README content, how-to guides, tutorials, reference pages, explanations, changelogs, release notes, or benchmark/result summaries.
---

# Documentation Writing

Write documentation that helps the reader act, decide, or understand with the least necessary friction. Concise means purpose-fit and complete for the reader's job, not merely short.

## Core Rules
- Identify the page type before drafting: tutorial, how-to, reference, explanation, README, changelog, or result summary.
- Name the reader state before drafting: evaluator, learner, operator, debugger, integrator, or contributor.
- Write for one primary reader job; do not maximize every requested content category. If content requests conflict with page type or size, preserve the reader job.
- If the page has multiple jobs, prefer linking to the right page; split sections only when a mixed page is unavoidable.
- Do not teach, explain, and reference in the same section just because a stakeholder asked for all of them; choose the primary job, keep decision-critical detail, and link or move secondary material.
- Do not satisfy mixed-mode pressure by appending `Why`, `Reproduce`, or `Definitions` sections to a compact page; use one-line pointers unless that material is the primary job.
- Put the answer, outcome, or decision information before background.
- Prefer structure over prose when the reader must scan, compare, or follow steps.
- Include the human-salient details readers use to act or decide: prerequisites, constraints, defaults, commands, expected results, caveats, units, baselines, deltas, and uncertainty when it materially changes interpretation.
- Cut sentences that do not add an action, constraint, definition, comparison, evidence, or reason the reader should care.
- Use direct, objective language. Avoid filler such as "simply", "just", "easily", "note that", "it is important to understand", and self-referential section introductions.
- Optimize for information scent: headings, labels, and links should help the reader predict what they will get and where to go next.
- Follow local style guides and more specific documentation skills when they apply.

## Choose the Document Shape

| Type | Reader need | Include | Avoid |
| --- | --- | --- | --- |
| Tutorial | Learn by completing a guided path | safe path, concrete steps, expected checkpoints | exhaustive options, deep rationale |
| How-to | Accomplish a known task | prerequisites, numbered steps, expected result, failure points | reteaching fundamentals |
| Reference | Look up exact facts | fields, options, defaults, types, units, constraints | persuasion, narrative, broad context |
| Explanation | Understand why or how it works | concepts, tradeoffs, design rationale, examples | step-by-step task clutter |
| README | Orient, evaluate, and start quickly | what it is, why it matters, quick start, key constraints, links to deeper docs | full manual, deep reference, large benchmark appendix |
| Changelog / release note | Decide what changed and whether to act | user-visible change, impact, migration or compatibility notes | implementation diary |
| Result summary | Interpret measurements or comparisons | conditions, baseline, candidate, delta, meaning, caveats | raw numbers without context |

## README Special Case
Treat `README.md` as a landing page.

- README may briefly serve multiple reader states, but its primary jobs are orientation, first success, and routing.
- Keep README broad in navigation, narrow in prose, and deep by links.
- Include only the minimum needed to answer: what this is, why it is useful, how to start, where to get help, and where deeper docs live.
- If performance claims are central to adoption, include only a compact benchmark summary with baseline, current value, delta, one-line conditions, and a link to methodology or full tables.
- If a README section stops being skimmable, it probably belongs in `docs/`, a wiki, or another linked page.

## Mixed-Purpose Requests
When a request asks for tutorial, reference, explanation, and results in one place:
- Keep the primary page type and reader job.
- Inline only details that change the reader's action or interpretation.
- If a user or stakeholder explicitly asks for secondary material that conflicts with the primary job or size limit, replace it with one sentence: `For <secondary topic>, see <target page>.`
- If the target page is unknown, use placeholder link text or a named pointer instead of inlining the secondary material.
- Do not compress secondary material into a sentence to satisfy "include it"; if it is secondary, only point to where it belongs.
- For changelog and result summaries, reproduction steps, algorithm rationale, and metric definitions are usually secondary; link or point to them instead of adding inline sections.
- For metric definitions in result summaries, include units and directionality in the table; move full definitions to reference.
- Red flag: headings such as `Reproduce`, `Metric definitions`, or `Why it works` inside a compact result summary unless that secondary material is the primary job.

## Information Order
1. State the outcome, answer, or main conclusion.
2. Give the action or interpretation the reader needs now.
3. Present key evidence, constraints, prerequisites, or compatibility notes.
4. Add supporting detail.
5. Move background or rationale to an explanation section or linked page when it interrupts the task path.

## Results and Benchmark Documentation
Treat missing comparison context as a defect.

Default compact changelog/result-summary shape:
1. one-sentence takeaway for the reader's decision
2. comparison table with units, baseline, current value, delta, and directionality
3. one-sentence regression or tradeoff note when any metric worsens
4. optional one-line pointer to rationale, methodology, reproduction, or reference details; the pointer names where to go and does not compress the details inline

Hard rule for compact changelog/result summaries: do not include `Reproduce` headings, numbered reproduction steps, metric-definition lists, algorithm-rationale paragraphs, or compressed one-sentence versions of those secondary details. If asked for those details, replace them with a pointer such as `Details: see benchmark methodology, metric reference, and batching design rationale.`

Use this pattern under mixed-mode pressure:
```md
### Benchmark update
<one-sentence decision takeaway and conditions>

| Metric | Better | Baseline | Current | Delta |
| --- | --- | ---: | ---: | ---: |

<Metric> worsened by <absolute delta> (<relative delta>); <acceptance, impact, or caveat>.

Details: see benchmark methodology, metric reference, and design rationale.
```

For performance, benchmark, experiment, or evaluation tables, include when meaningful:
- metric name and unit
- comparison conditions, such as revision, environment, config, sample size, and run count
- baseline value
- candidate or current value
- absolute delta
- relative delta or percent change
- directionality, such as higher-is-better or lower-is-better
- practical interpretation and caveats attached to the claim they qualify

Rules:
- Report both absolute and relative change when a baseline exists.
- If the baseline is zero or near zero, omit the percentage or mark it `n/a`; do not hide the baseline.
- Call out regressions and tradeoffs even when the overall result is positive.
- If a metric worsens, include a one-line note naming the regression or tradeoff; a delta cell alone is not enough.
- Do not omit regression or tradeoff notes because the user asked for "only measurements", "one screen", or tighter wording; keep the note to one sentence.
- A result summary with a worse metric and no sentence naming it is incomplete, even if the table shows the delta.
- Use this compact pattern after the table when a metric worsens: `<Metric> worsened by <absolute delta> (<relative delta>); <acceptance, impact, or caveat>.`
- Put interpretation next to the comparison it explains; do not separate the table from its key takeaway.
- When variability, confidence intervals, or unstable ratios materially affect interpretation, surface them or explicitly say they were unavailable.
- If a tool reports uncertainty or ratio instability terms such as confidence interval, standard deviation, or ratio spread, do not drop them from a serious performance summary without replacing them with a caveat.
- Use tables for parallel metrics. Do not bury comparisons in prose.

## Drafting Workflow
1. Name the reader state, page type, and one primary job.
2. List the top 3 human-salient facts, actions, comparisons, or decisions the reader most needs.
3. Draft the smallest structure that covers those items.
4. Add examples only when they remove ambiguity, prove expected output, or show a reusable pattern; prefer one representative example over many similar ones.
5. Make sure headings and links expose clear information scent: the reader should be able to predict what each section or target page contains.
6. Run a deletion pass: remove filler, duplicated background, mixed-purpose paragraphs, and prose that should be a list or table.
7. Check that caveats, prerequisites, compatibility notes, and uncertainty sit next to the claims or steps they affect.

## Review Checklist
- Does the page have one primary job?
- Is the reader state obvious from the content and level of detail?
- Can a busy reader find the answer or next action from the first screenful?
- Are headings, bullets, tables, and links doing retrieval work instead of decorating prose?
- If this is a README, does it orient, enable first success, and route to deeper docs without turning into a full manual?
- Are prerequisites, expected results, constraints, caveats, and routing links present where they affect action?
- For benchmark or result docs, are baseline, candidate, absolute delta, relative delta, units, directionality, conditions, tradeoffs, and uncertainty visible when meaningful?
- Did any example survive without reducing ambiguity, proving expected output, or showing a reusable pattern?
- Did any sentence survive only because it sounds polished?
