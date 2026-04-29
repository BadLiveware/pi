---
name: performance-benchmarking
description: Use when a change may affect hot paths, runtime, throughput, latency, memory use, allocation behavior, or scale-sensitive work such as scans, parsers, searches, batch inputs, rendering loops, queues, retries, caches, databases, or network/LSP/tool calls.
---

# Performance Benchmarking

Use this skill to build a cost model and measure before/after instead of reasoning by instinct. Performance awareness means understanding and bounding the work, not making every path maximally optimized.

## Reach for This Skill When
- a change touches hot paths, latency, throughput, allocations, or memory
- code walks repositories, parses files, indexes/searches source, shells out over many files, or renders frequently
- code processes unbounded or batch inputs: rows, events, messages, logs, results, retries, queues, or background loops
- code changes database/query, network, LSP/provider, cache, polling, or watcher behavior
- you see nested loops over potentially large collections or repeated scans hidden inside per-item work
- you are considering a performance optimization or need apples-to-apples comparison across revisions

## Outcome
- a cost model plus, when performance materially matters, a before/after comparison you can use to describe whether performance improved, held steady, or regressed

## Workflow
1. Identify the path likely to change and the unit of work: files, rows, symbols, requests, bytes, retries, renders, or time.
2. Name the scaling variables and bounds: max files/results/bytes, timeout, cancellation, path scope, batch size, retry count, or cache size.
3. Check whether caps bound internal work/allocation or only final output; prefer early bounds when correctness allows.
4. Create or find a representative benchmark and prefer the project-sanctioned benchmark command if one exists.
5. Run the benchmark before changes to capture a baseline when a comparison is needed.
6. Make the implementation change.
7. Run the same benchmark or representative smoke after changes.
8. Compare and summarize the result.
9. If benchmarking cannot fully run because of tooling, environment, or time constraints, say what was omitted.

## Guidance
- Prefer simple batching, streaming, scoping, cancellation, and bounded collection before complex caches or speculative micro-optimizations.
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
