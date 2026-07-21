# 00a: Execution Graph and Stage Contracts

## Goal

Add the persisted execution DAG and pure graph/resource validation required by later Treehouse stages, without acquiring worktrees or running parallel workers.

## Scope

In scope:

- ExecutionGraph, ExecutionNode, ExecutionStage, ExecutionAttempt, IntegrationRecord, and ResourceClaim types/defaults for newly started implementation loops.
- Whole-graph dependency/cycle validation.
- Cross-stage readiness and stage-role validation.
- Write/resource ownership validation.
- Read-only graph/status formatting and fixtures.

Out of scope:

- Treehouse process execution.
- Cross-process stage ownership.
- `runReady`, integration, reconcile, retry, or release.

## Affected areas

- New `agent/extensions/private/stardock/src/stages/contracts.ts`
- New `agent/extensions/private/stardock/src/stages/graph.ts`
- Additive pre-cutover state/default wiring used only through Slice 05
- `agent/extensions/private/stardock/test/stage-graph.test.ts`
- `agent/extensions/private/stardock/test/fixtures/` graph fixtures

## Required references

- [`../design/parallel-stages-and-treehouse.md`](../design/parallel-stages-and-treehouse.md)
- [`../docs/validation.md`](../docs/validation.md)
- Slice 00 baseline/fixtures

## Tasks

1. Add graph/node/stage/attempt/integration/resource types, including canonical brief/stage contract digests, to newly started or explicitly restarted implementation loops. Do not add a general old-run compatibility promise.
2. Implement deterministic canonicalization/digest verification plus stable-id, missing-dependency, Kahn cycle, contract/implementation/fan-in role, cross-stage edge, and topological ready-set validation. Derive initial statuses; do not trust caller-supplied ready/integrated strings.
3. Normalize write claims relative to repository root and reject overlapping writes inside one parallel stage; support fan-in-owned shared outputs.
4. Validate resource claims: identical exclusive keys conflict; shared keys require the same explicitly shared value; unique port/database/cache allocations do not conflict.
5. Validate exact immutable parent branch and equal integration-base/contract SHA fields structurally; Git checkout/head checks land in adapter/fan-in slices.
6. Add small/large DAG fixtures: serial chain, five-node wave, cross-stage dependency, missing dependency, exact cycle, write overlap, resource conflict, and ready-set progression.
7. Add pure completion/workflow-policy evaluation for nonterminal/review/fan-in/reconcile/release states and bounded graph/stage/node summary formatting; prove large graphs do not serialize full history.
8. Commit as one serial foundation checkpoint and update schema-v4 future fixtures to preserve graph state.

## Acceptance criteria

- [ ] Stardock can persist and reload a complete node-level DAG with cross-stage dependencies and explicit resource claims.
- [ ] Invalid cycles/dependencies/roles/write/resource overlaps return exact actionable errors.
- [ ] Ready-set calculation is deterministic and independent of array order.
- [ ] A newly started implementation loop persists an empty graph; nonterminal graph states block completion with exact next action.
- [ ] No Treehouse process or parallel worker starts in this slice.

## Validation

```bash
npm run typecheck --prefix agent/extensions
cd agent/extensions && node --experimental-strip-types --test \
  private/stardock/test/stage-graph.test.ts \
  private/stardock/test/lifecycle.test.ts \
  private/stardock/test/workflow-status.test.ts
```

Expected signal: graph/current-state tests pass and no Treehouse pool state changes.
