# WIP Prompt Pack: Failure-Mode-Aware Code Review

Status: draft / not wired into `SKILL.md` as a default. Used as a late, sparse challenge pass.

This folder contains the failure-mode corpus and the prompt pack that applies it to the `review` skill.

## Goal

Make medium reviewers, scouts, and verifiers use a shared failure-mode vocabulary **without letting the corpus become the agent's default lens**.

## Why this corpus exists

Three evidence streams support a corpus like this.

1. **Empirical review literature** shows that modern code review is partly about defect finding but heavily depends on code and change understanding, and that some bug families are repeatedly missed in review (Bacchelli & Bird 2013; Sami et al. 2022).
2. **Recent AI-review benchmarks** show category skew, weak cross-file reasoning, and a precision/noise problem; they also suggest that impact analysis and change decomposition have become under-emphasized in LLM-era evaluation (Khan et al. 2026; Pereira et al., CR-Bench 2026; c-CRAB 2026).
3. **Practical engineering evidence** shows that naïve one-shot AI review is noisy and that stage-aware, specialized review is more workable in production (Cloudflare 2026).

See `sources.md` for direct URLs.

The corpus is therefore a **heuristic pattern library** with explicit evidence labels, not a universal checklist.

## Key anti-anchoring principle

The corpus must be used **late, sparsely, and conditionally**.

That means:
1. do an **unprimed first pass** before consulting the corpus,
2. use the corpus only as a **selective challenge pass**,
3. retrieve only a **small shortlist** of relevant families,
4. keep an explicit **outside-corpus** lane for concerns that do not fit existing entries,
5. require the verifier to treat **corpus-suggested findings more skeptically** than unprompted findings.

## Files

- `README.md` — this overview, design principles, and how to extend
- `family-routing-table.md` — index from change cues to family files and pattern anchors
- `families/<family>.md` — one file per failure-mode family (12 total); each holds 1–3 named patterns
- `medium-reviewer.prompt.md` — front-door reviewer prompt with unprimed-first flow
- `scout-prompts.md` — specialist scout prompt templates
- `verifier.prompt.md` — reducer / verifier prompt with anti-anchoring checks
- `sources.md` — citations behind the corpus

## Family files

Each family file uses front-matter for routing metadata and a section per named pattern. Patterns are addressable as `families/<family>.md#<anchor>` (for example, `families/security-boundary.md#privilege-broadened`). Use this form in scout assignments, verifier output, and any cross-reference. Use `outside-corpus` when no family fits well.

Per-pattern fields:
- **Pattern** — short description of the failure mode
- **Signals** — diff or review cues that make the pattern plausible
- **Scope** — `local`, `cross-file`, `repo`, or `runtime`
- **Likely consequence** — what failure this could produce
- **Recommended stage** — `medium-reviewer`, `specialist-scout`, or `verifier`
- **Investigation questions** — checks that raise or lower confidence
- **False-positive traps** — common ways to overclaim the pattern

Per-family front matter also carries:
- **evidence_strength** — `empirical`, `benchmark-supported`, or `practical-heuristic`
- **default_stages** — typical routing for this family

## Evidence strength legend

- `empirical` — directly supported by empirical code-review or missed-bug literature
- `benchmark-supported` — strongly motivated by recent LLM / agent benchmark behavior
- `practical-heuristic` — mainly supported by engineering practice or synthesis

A verifier should apply **more skepticism** to candidates from `practical-heuristic` families when the diff alone supports the claim.

## Intended workflow

1. Medium reviewer performs an **unprimed first pass** over the diff.
2. Only if needed, the medium reviewer uses `family-routing-table.md` to select **2–5 relevant families** as a challenge pass and loads only those family files.
3. Medium reviewer either:
   - raises focused questions directly, or
   - dispatches specialist scouts using `scout-prompts.md`.
4. Verifier uses `verifier.prompt.md` to deduplicate, demand evidence, distinguish unprimed vs corpus-suggested concerns, and suppress speculation.

## Design rules

1. **Patterns, not verdicts.** A pattern names a suspicious failure mode; it does not prove a bug exists.
2. **Operational use only.** Every pattern includes signals, investigation questions, and false-positive traps.
3. **Selective use.** Do not load this whole corpus into every review. Retrieve only the most relevant families for the current change.
4. **Cross-file and runtime humility.** Many high-value patterns require repository or runtime evidence and should trigger a scout, not a direct final comment.

## How to extend

Add new patterns or families only when at least one of the following is true:
1. The pattern recurs across multiple code reviews or incidents.
2. The pattern appears in empirical review literature or benchmark analyses.
3. The pattern repeatedly causes useful high-signal findings in your own workflow.

When adding a pattern:
- prefer a narrow pattern over a broad slogan,
- include at least one false-positive trap,
- mark evidence strength conservatively,
- note whether the pattern is best checked locally, cross-file, or at runtime,
- pick a semantic anchor (`#kebab-case`) that names the failure mode, not its index.

When adding a family, also add a row to `family-routing-table.md` and update the escalation defaults if relevant.

## Known gaps

1. The corpus does not include repo-specific variants; layer those on separately.
2. Many configuration, migration, and rollout patterns are `practical-heuristic`, not benchmark-proven.
3. Runtime families such as concurrency and resource lifetime remain hard to validate from diffs alone.
4. There is no measured precision/recall data per family in a real review pipeline yet.
5. The corpus is intentionally compact; many sub-variants are collapsed into broader pattern entries.
