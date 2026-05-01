# Review Tool Lanes

This is a non-authoritative evidence menu for `standard`, `full`, and `audit` reviews. It is not exhaustive and does not override project guidance.

## Core Policy
- Prefer repo-sanctioned commands from README, CI, package scripts, Makefile, justfile, taskfile, tox/nox, cargo aliases, or solution files.
- Use language/tool examples only when no better project command exists.
- Do not install, add, or configure host tools without permission. If an unavailable tool is high-value enough, prefer an ephemeral container runner over mutating the host or repository.
- Use lanes to support or reject concrete review candidates; do not turn unrelated tool output into review comments.
- Scope commands to changed packages, impacted tests, or narrow queries when possible.
- Record skipped lanes when they would matter but were unavailable, too slow, unsafe, missing credentials, or likely noisy.

## Evidence Labels
- `supported-deterministic`: compiler, analyzer, linter, test, build, or reproducible script evidence.
- `supported-trace`: deterministic caller/callee/xref/config/schema trace without runtime failure.
- `plausible-but-unverified`: LLM reasoning only.
- `rejected`: verifier could not support the claim.

## Question-to-Evidence Map

Use this to choose an evidence style, not to create a checklist. Prefer project-native or already-available tools first; escalate only when the question is important enough.

| Review question | Evidence style |
| --- | --- |
| Can this state machine reach an illegal state? | TLA+/PlusCal/Alloy, lightweight transition model, or property-test model |
| Do random or adversarial inputs break invariants? | Property tests, fuzzing, generated corpus tests, boundary tables |
| Are tests sensitive to the suspected bug? | Mutation testing, manual mutation, negative controls |
| Are there data races or unsafe interleavings? | Race detectors, stress tests, scheduler/loom-style tests, formal model |
| Did a public API, persisted behavior, or protocol stay compatible? | Contract tests, golden/approval tests, compatibility fixtures, differential tests |
| Does this implementation match a trusted implementation or spec? | Differential/oracle testing, replay fixtures, conformance tests |
| Is this security rule bypassable? | Threat model, authz/authn matrix tests, narrow SAST/policy queries |
| Is this path too slow or unbounded? | Benchmarks, profilers, flamegraphs, allocation/resource tracing, stress tests |
| Can schema/config/migration drift break users? | Migration tests, schema validation, config/default compatibility search |

## Lane Types

### Lane A — Native compile/type/lint
Cheap, high-signal, project-native checks.

Examples: typecheck, compiler check, lint, build, language analyzer already configured by the project.

### Lane B — Structural AST/policy
Custom structural rules and risky syntax/pattern checks.

Examples: existing `ast-grep` or `semgrep` rules, `code_intel_syntax_search` when available, or a narrow one-off query for a specific suspected pattern. Avoid broad generic scans unless doing `audit` or the repo already configures them.

### Lane C — Symbol/xref impact
Cross-file impact analysis for changed contracts, types, interfaces, routes, config, schemas, and public APIs.

Examples: grep/code search, language server references, local symbol/xref tooling, `code_intel_symbol_context` / `code_intel_references` / `code_intel_impact_map` when available, importer/caller searches, implementer searches.

### Lane D — Targeted build/test
Run impacted tests or package/module builds only.

Examples: nearest test file, changed package test, focused integration test, package-level build.

### Lane E — Security/config
Use for auth, trust-boundary, config, protocol, serialization, infra, or secret-related changes.

Examples: configured SAST/security checks, config compatibility search, auth wrapper inspection, secret scanning if already available.

### Lane F — Escalation
Slow or expensive verification.

Examples: mutation testing, fuzzing/property tests, generated verification scripts, race/stress tests, broader integration sweeps, or a small formal/executable model such as TLA+/PlusCal for critical state-machine or concurrency invariants. Use only when high risk, cheap enough for the context, or explicitly requested.

## Ephemeral Container Runners

Use this only when a high-value review lane needs a tool that is not already available through project-native commands or the host environment. The goal is to avoid installing half the system package ecosystem for one review.

Preferred pattern:

1. Create a temporary directory outside the repo with `mktemp -d`.
2. Write a minimal Dockerfile there with pinned-ish base image and tool version.
3. Build with the temp directory as build context, not the repo, unless the tool truly needs repo files at build time.
4. Run with the repository mounted read-only by default.
5. Mount a separate temp output directory if the tool must write artifacts.
6. Record the image/tool/version and command in validation notes.

Example shape:

```bash
tmp="$(mktemp -d)"
cat > "$tmp/Dockerfile" <<'EOF'
FROM node:22-bookworm
WORKDIR /work
RUN npm install -g some-review-tool@1.2.3
ENTRYPOINT ["some-review-tool"]
EOF

docker buildx build -t tmp-review-tool:some-review-tool-1.2.3 -f "$tmp/Dockerfile" "$tmp"
docker run --rm -v "$PWD:/work:ro" tmp-review-tool:some-review-tool-1.2.3 ...
```

Safety rules:

- Do not put temporary Dockerfiles or generated runner files in the repo unless the user wants them kept.
- Do not pass secrets, credentials, SSH agents, host Docker socket, or privileged flags unless explicitly approved.
- Do not use broad/unpinned images for consequential findings without noting the reproducibility gap.
- Ask before long builds, large downloads, network-heavy scans, or writable repo mounts.
- Clean up temporary directories and obvious temporary images/containers when practical.

## Trigger Matrix by Change Family

| Change family | Default lanes | Notes |
| --- | --- | --- |
| API / contract | A, C, D | Inspect callers/implementers and impacted tests. |
| Auth / security boundary | A, B/E, D | Use configured security checks or narrow trust-boundary queries. |
| Config / protocol / env | A, B, C, D | Search compatibility flags, defaults, schemas, and consumers. |
| Persistence / schema / query | A, B, C, D | Inspect migrations, models, serializers, queries, fixtures. |
| Concurrency / lifecycle / perf-sensitive | A, B, D | Escalate to race/stress/property/formal-model checks only when justified. |
| UI-only / docs-only / test-only | Maybe A | Skip heavier lanes unless shared contracts/config changed. |

## Language Menus

These are examples, not required commands.

### TypeScript
- Lane A: `tsc --noEmit`, project `typecheck`, `eslint`, `typescript-eslint`.
- Lane B: existing `ast-grep` or `semgrep` rules; narrow async/error/config queries.
- Lane C: importers/callers of changed exports, route/controller wrappers, config/env consumers.
- Lane D: nearest or impacted test command, package-level build/test.

### Python
- Lane A: `ruff`, `mypy`, `pyright`, project `pytest`/tox/nox checks.
- Lane B: existing `ast-grep` or `semgrep` rules; narrow exception/config/query checks.
- Lane C: callers of changed public functions/classes, route/view handlers, ORM models, settings consumers.
- Lane D: targeted `pytest` selection where practical.

### Go
- Lane A: `go vet`, configured `golangci-lint`, package build/test.
- Lane B: existing structural/security checks.
- Lane C: `gopls` references, callers/implementers of exported functions/interfaces, config/protocol consumers.
- Lane D: targeted `go test`; use `-race` only for justified concurrency risk.

### Rust
- Lane A: `cargo check`, `cargo clippy`, targeted `cargo test`.
- Lane B: existing structural/security checks, especially around `unsafe`, locks, parser/serde/config code.
- Lane C: callers/implementers of public fns/traits/types.
- Lane D/F: targeted tests; fuzz/property tests only if present and justified.

### C#
- Lane A: `dotnet build`, configured Roslyn/.NET analyzers, targeted `dotnet test`.
- Lane B/E: existing analyzers or narrow ASP.NET/auth/config/serialization checks.
- Lane C: interface/service implementations, DI consumers, controller/action/middleware routes, options binding consumers.
- Lane D: targeted project/solution tests.
