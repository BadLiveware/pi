---
name: performance-benchmarking
description: Establishes before/after performance baselines and revision-to-revision comparisons for changes that may affect speed, memory use, throughput, or latency.
---

# Performance Benchmarking

Use this skill when a planned change could affect runtime performance, memory behavior, throughput, or latency.

## Goals
- Measure instead of guessing
- Detect regressions before finalizing changes
- Validate optimizations with reproducible evidence

## Workflow
1. Identify the behavior or path likely to change.
2. Create or locate a representative benchmark.
3. Run the benchmark before changes to capture a baseline.
4. Make the implementation change.
5. Run the same benchmark after changes.
6. Compare and summarize the result.

## Guidance
- Benchmark realistic workloads where possible.
- Keep benchmark setup stable across revisions.
- Do not optimize micro-details without evidence.
- Prefer simple code unless measurement shows a need for more complex optimization.

## Tooling
If available, use `badliveware/Benchmark-revision-compare` to compare the pre-change revision and post-change revision directly.

## Output Template

```md
## Benchmark Target
- ...

## Baseline
- ...

## After Change
- ...

## Result
- improved / unchanged / regressed
```
