---
name: performance-benchmarking
description: Use when a change may affect hot paths, runtime, throughput, latency, memory use, or allocation behavior and you need evidence instead of guesswork.
---

# Performance Benchmarking

Use this skill to measure before and after instead of reasoning by instinct.

## Reach for This Skill When
- a change touches hot paths, latency, throughput, allocations, or memory
- you are considering a performance optimization
- you need apples-to-apples comparison across revisions

## Outcome
- a before/after comparison you can use to describe whether performance improved, held steady, or regressed

## Workflow
1. Identify the path likely to change.
2. Create or find a representative benchmark and prefer the project-sanctioned benchmark command if one exists.
3. Run the benchmark before changes to capture a baseline.
4. Make the implementation change.
5. Run the same benchmark after changes.
6. Compare and summarize the result.
7. If benchmarking cannot fully run because of tooling, environment, or time constraints, say what was omitted.

## Guidance
- Benchmark realistic workloads where possible.
- Keep setup stable across revisions.
- Do not optimize micro-details without evidence.
- Prefer simple code unless measurement shows a need for more complexity.

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
