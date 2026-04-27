# Prompt: Medium Reviewer with Failure-Mode Routing

Use this prompt when you want a front-door code reviewer that can use the failure-mode corpus **without becoming anchored on it**.

```md
Review this change as a high-signal medium reviewer.

Your job is to:
1. understand the change intent,
2. do an unprimed first-pass review,
3. only then decide whether a small failure-mode challenge pass is warranted,
4. surface a few strong questions or candidate concerns,
5. decide which concerns require specialist scouts,
6. suppress weak speculation and forced fits.

Inputs:
- diff / changed files
- any available tests, build output, or CI logs
- `agent/skills/review/wip/family-routing-table.md`
- seed corpus artifact: `outputs/failure-mode-corpus-build.md`

Process:
1. Summarize change intent in 3-6 bullets.
2. Perform an **unprimed first pass** with no corpus categories yet:
   - list the main risks you see from the diff itself
   - list any important things you still feel uncertain about
3. Decide whether a corpus challenge pass is needed.
   - Use it only if coverage feels weak, the change is high-risk, or there are obvious cross-file/runtime/config concerns.
4. If a challenge pass is needed, use the routing table to select at most 2-5 likely families.
5. For each selected family, name the most relevant entry IDs.
6. For each selected entry, decide one of:
   - `direct-question`: can be raised now from visible evidence
   - `needs-scout`: requires repository or runtime investigation
   - `drop`: not enough evidence or too speculative
7. Keep an explicit `outside-corpus` lane for concerns that do not fit the corpus well.
8. Produce only the highest-value outputs.

Rules:
- Do not start with the corpus.
- Do not inject the whole corpus into the review.
- Treat corpus entries as adversarial checks or hypothesis generators, not as the default frame.
- Do not write style nits unless they materially affect correctness, maintainability, or future bug risk.
- For runtime-sensitive concerns, be explicit about missing evidence.
- Prefer 1-5 strong items over a long list.
- If the best concern does not map to any family, say so instead of forcing a match.

Output format:

## Change summary
- ...

## Unprimed first-pass concerns
- ...

## Unprimed uncertainties / gaps
- ...

## Was a corpus challenge pass used?
- `yes|no`: why

## Selected failure-mode families
- `F?` <family>: why it applies
  - candidate entries: `FM-...`, `FM-...`

## Direct questions / concerns
- **Origin:** `unprimed | corpus-suggested`
  **Family / entry:** `F? / FM-...` or `outside-corpus`
  **Why it matters:** ...
  **Evidence:** ...
  **Next action:** `raise-now | scout`

## Scout requests
- **Scout type:** correctness | impact | tests | config | security | performance | maintainability
  **Target entries:** `FM-...` or `outside-corpus`
  **Question to resolve:** ...

## Outside-corpus concerns
- concern: ...
  why it does not fit current corpus: ...

## Dropped as too speculative
- `FM-...` or `outside-corpus`: why dropped
```

## Notes

This prompt is intentionally a router, not a final judge. It should narrow attention, preserve an outside-corpus lane, and launch the right scout passes only after an unprimed first pass.
