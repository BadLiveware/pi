# Future Review Skill Ideas

These ideas are promising but intentionally out of scope for the minimal v2 review skill. They are not normal-review instructions and should not be loaded during ordinary code review.

## Why punt these
- They need infrastructure, storage, or evaluation design beyond skill wording.
- They can increase anchoring, cost, latency, or false confidence if added as prompt-only rules.
- The minimal v2 should first prove value from impact mapping, deterministic evidence labels, tool-lane routing, clustering, verification, and bounded coverage-gap checks.

## 1. Scoped review learnings

### Idea
Accumulate repo/path-specific review priors from accepted findings, dismissed findings, human review comments, and explicit user corrections.

### Guardrails
- Scope learnings by repo, path, subsystem, and source.
- Treat candidate learnings as priors, not verdicts.
- Promote rules only after repeated signal or explicit user confirmation.
- Track provenance, usage, acceptance, and stale/conflicting status.
- Apply learnings after unprimed impact review so they do not anchor initial retrieval.

### Possible data shape
```json
{
  "id": "RL-001",
  "scope": {"repo": "...", "paths": ["src/auth/**"]},
  "type": "positive-rule|negative-rule|missed-issue-pattern|suppression-pattern",
  "rule": "...",
  "source": "user-correction|accepted-finding|human-review-comment",
  "status": "candidate|active|disabled",
  "usage_count": 0,
  "accept_rate": null
}
```

## 2. Incremental PR review lifecycle memory

### Idea
Track prior review runs so reruns surface only new or still-relevant findings by default.

### Potential state
- commit SHA or diff hash
- findings already reported
- root causes later addressed
- findings dismissed by humans
- comments already present on the PR

### Desired behavior
- Suppress materially duplicate findings on incremental review.
- Mark likely-addressed findings as resolved internally.
- Optionally summarize prior concerns that appear fixed.
- Keep user trust by reducing rerun noise.

## 3. Offline actionability eval set

### Idea
Create a saved corpus of diffs/PRs with human comments, accepted tool findings, dismissed findings, and final merged changes.

### Preferred metrics
- accepted/actioned finding rate
- duplicate rate
- false-positive rate on audited samples
- percent of findings with deterministic support
- incremental rerun noise rate
- time to first supported finding

### Anti-metric
Do not optimize for number of findings.

## 4. Stronger retrieval infrastructure

### Idea
Move beyond manual grep by adding deterministic symbol and context retrieval.

### Candidates
- local symbol/xref indexer for changed exported symbols
- language-server reference adapters
- route/schema/config graph extraction
- generated impact-map artifacts for large PRs
- optional cross-repo context when contracts span repositories

### Guardrails
- Retrieval logs should show what was inspected and skipped.
- Keep context compact and anchored to impact-map targets.
- Avoid dumping whole files or whole-repo graphs into every reviewer prompt.

## 5. Productized tool lanes

### Idea
Turn the non-authoritative tool-lane menu into repo-aware adapters.

### Candidates
- configured `ast-grep` rule packs for review-specific patterns
- configured `semgrep` policies where useful
- language-specific changed-symbol detectors
- targeted test selection helpers
- safe generated verification script harness

### Guardrails
- Project-native commands remain the source of truth.
- Generic analyzer output must be diff-connected before it becomes a review candidate.
- New tools should be opt-in or project-configured, not silently installed.

## 6. Optional skeptic / reverse-audit expansion

### Idea
Experiment with a skeptic pass that checks verifier decisions and coverage gaps.

### Guardrails
- Keep it late and bounded.
- Focus on missed high-risk paths, not random extra issues.
- Measure whether it improves accepted findings without increasing noise.
- Do not replace retrieval/evidence improvements with debate.

## 7. Sandboxed execution lane

### Idea
For high-risk reviews, run generated verification scripts or broader integration checks in an isolated environment.

### Guardrails
- Require explicit safety and cost checks.
- Avoid external side effects and destructive operations.
- Record environment assumptions, credentials gaps, and reproducibility steps.

## 8. Comment lifecycle integration

### Idea
If connected to a PR platform, integrate with existing comments and review threads.

### Desired behavior
- Avoid repeating existing human or bot comments.
- Detect addressed comments when the diff changes.
- Separate inline comments from summary-only observations.
- Support strictness levels or comment thresholds without hiding verified serious issues.

## 9. Split shallow/self-review from deep PR review

### Idea
If the minimal v2 feels too dense in practice, split normal usage into two clearer paths: a shallow/self-review path and a deep/PR-review path.

### Shallow / self-review path
- Local diff review plus obvious callers, tests, and config.
- No delegation by default.
- Minimal impact sketch instead of a formal impact map.
- Fix safe supported in-scope issues before reporting.
- Avoid tool-lane ceremony unless concrete risk appears.

### Deep / PR-review path
- Explicit impact map and compact context packet.
- Deterministic evidence lanes where relevant.
- Triage/scouts/verifier flow.
- Candidate clustering and dedupe.
- Bounded coverage-gap pass.
- Fuller reporting of evidence, skipped lanes, plausible risks, and validation gaps.

### Guardrails
- Do not split prematurely; first observe whether the current depth model causes real ritual overhead.
- Keep the trigger simple so agents do not spend review time deciding which document to load.
- Preserve escalation from shallow to deep when concrete high-risk triggers appear.

## Suggested rollout order
1. Measure minimal v2 behavior on real reviews.
2. Add scoped review learnings only after deciding storage/provenance rules.
3. Add incremental lifecycle memory before making reviews more aggressive.
4. Build offline evals before optimizing prompts or adding skeptic passes.
5. Add richer retrieval/tool adapters where evidence shows missed issues remain.
