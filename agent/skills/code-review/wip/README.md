# WIP Prompt Pack: Failure-Mode-Aware Code Review

Status: draft / not wired into `SKILL.md` yet.

This folder contains a prompt pack that applies the seed failure-mode corpus from `outputs/failure-mode-corpus-build.md` to the `code-review` skill.

## Goal

Make medium reviewers, scouts, and verifiers use a shared failure-mode vocabulary **without letting the corpus become the agent's default lens**.

## Key anti-anchoring principle

The corpus should be used **late, sparsely, and conditionally**.

That means:
1. do an **unprimed first pass** before consulting the corpus,
2. use the corpus only as a **selective challenge pass**,
3. retrieve only a **small shortlist** of relevant families,
4. keep an explicit **outside-corpus** lane for concerns that do not fit existing entries,
5. require the verifier to treat **corpus-suggested findings more skeptically** than unprompted findings.

## Files

- `README.md` — this overview and routing guide
- `medium-reviewer.prompt.md` — front-door reviewer prompt with unprimed-first flow
- `scout-prompts.md` — specialized scout prompt templates
- `verifier.prompt.md` — reducer / verifier prompt with anti-anchoring checks
- `family-routing-table.md` — compact mapping from change cues to failure-mode families and entry IDs

## Design rules

1. Start with an **unprimed review pass**, not with the corpus.
2. If coverage looks weak or risk looks high, retrieve only a **small family shortlist**, not the whole corpus.
3. Use family entries as **hypothesis generators**, not verdicts.
4. Route cross-file, runtime, and environment-sensitive concerns to scouts.
5. Require the verifier to explicitly reject noise, unsupported claims, and corpus-induced forced fits.

## Intended workflow

1. Medium reviewer performs an **unprimed first pass** over the diff.
2. Only if needed, the medium reviewer uses `family-routing-table.md` to select **2–5 relevant families** as a challenge pass.
3. Medium reviewer either:
   - raises focused questions directly, or
   - dispatches specialist scouts using `scout-prompts.md`.
4. Verifier uses `verifier.prompt.md` to deduplicate, demand evidence, distinguish unprimed vs corpus-suggested concerns, and suppress speculation.

## Source artifact

The prompt pack is derived from:
- `outputs/failure-mode-corpus-build.md`

## Integration note

If this WIP proves useful, the next step is probably to:
- extract a compact corpus index into the skill folder,
- reference these prompts from `SKILL.md`, and
- add validation scenarios that check unprimed-first review, family selection discipline, and noise suppression.
