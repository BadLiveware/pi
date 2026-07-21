# 03: Command and Dead-code Cleanup

## Goal

Remove proven-dead helpers and clarify command vocabulary/implementation without changing loop lifecycle semantics or persisted schema.

## Dependencies and Treehouse lane

- Depends on Slice 02a cleanup/API contract commit and validated stage.
- Runs in parallel with Slice 04 as lane `command-cleanup`.
- Owns `src/runtime/commands.ts`, the duplicate export in `outside-requests.ts`, and command/dead-code tests. `runtime/prompts.ts` is fan-in-owned because it also contains API-migration guidance.
- Shared README/skill/agent-profile/architecture/historical-plan files are fan-in-owned and forbidden in this lane.

## Scope

In scope:

- Dead prompt helper deletion.
- Shared loop-list implementation for status/list.
- Clear pause/abandon command names with compatibility aliases.
- Command-local help text, autocomplete, and command tests; shared docs remain fan-in-owned.

Out of scope:

- Removing old command aliases.
- Removing public tools or include flags.
- Removing `itemsPerIteration`; that lands with schema-v4 write cleanup.

## Affected areas

- `agent/extensions/private/stardock/src/outside-requests.ts`
- `agent/extensions/private/stardock/src/runtime/commands.ts`
- `agent/extensions/private/stardock/src/runtime/args.ts` only if command parsing is shared without behavior change
- Command tests; shared README/skill/historical notices are change-manifest outputs for Slice 04a only

## Required references

- [`../docs/compatibility-matrix.md`](../docs/compatibility-matrix.md)
- [`../docs/validation.md`](../docs/validation.md)

## Tasks

1. Re-run references for exported `appendOutsideRequestPromptSections()` in `outside-requests.ts`; delete it if definition-only. Report `runtime/prompts.ts:defaultReflectInstructions()` deletion to the fan-in owner instead of editing that file.
2. Extract one current-loop list formatter/handler used by both `/stardock status` and unflagged `/stardock list`. Keep `/stardock list --archived` distinct.
3. Add `/stardock pause [loop]` as the clear name for resumable pause and `/stardock abandon [loop]` as the clear idle-only terminal escape hatch.
4. Keep `/stardock stop` as a pause alias and `/stardock-stop` as an abandon alias for the remainder of this plan. Help text marks them as compatibility aliases without warnings on every use.
5. Ensure ESC guidance says interruption pauses current agent work and then directs the user to `pause` or `abandon` according to intent; do not imply ESC itself mutates loop state.
6. Update command-local help and tests. Return an exact shared-doc/capability change list for the parent fan-in; do not edit fan-in-owned README/skill/agent-profile/architecture/historical-plan files.
7. Verify cancel/archive/clean/nuke behavior remains unchanged and destructive confirmations remain intact.
8. Commit a clean lane branch and report base/head SHA, changed paths, validation, and integration notes.

## Acceptance criteria

- [ ] Dead helper exports are absent or replaced by one shared called implementation.
- [ ] Status and list current-loop output comes from one implementation and preserves list-all semantics.
- [ ] Pause and abandon are unambiguous in help/docs/tests.
- [ ] Existing stop aliases preserve their old behavior.
- [ ] ESC, cancel, archive, clean, and nuke semantics are unchanged.
- [ ] No persisted schema or tool schema changes in this slice.

## Validation

```bash
npm run typecheck --prefix agent/extensions
cd agent/extensions && node --experimental-strip-types --test \
  private/stardock/test/index.test.ts \
  private/stardock/test/lifecycle.test.ts \
  private/stardock/test/interrupt-input.test.ts \
  private/stardock/test/views.test.ts
cd ../.. && rg -n 'defaultReflectInstructions|appendOutsideRequestPromptSections' agent/extensions/private/stardock/src
```

Expected signal: tests pass; final `rg` returns only the one intentionally used prompt-section implementation and no dead reflect helper.

## Risks and split triggers

- Do not merge pause and abandon implementations merely because names are consolidated; they have different safety semantics.
- Split destructive-command cleanup out if it would alter confirmation, deletion, or readiness behavior.
