# Slice 05: Markdown and Documentation Rollout

## Goal

Make Markdown a deliberate first-class documentation language in code-intel, then update user-facing and agent-facing docs so language coverage claims match actual behavior.

This slice is separated because Markdown is structurally different from code languages and because coverage documentation must be updated after implementation details settle.

## Markdown Implementation Tasks

### 1. Add Markdown language registry support

Registry row:

- id: `markdown`
- aliases: `md`, `markdown`
- extensions: `.md`, `.markdown`, `.mdx`, `.mdc`
- parser source: `scanner`
- category: `doc`
- outline: yes
- read-symbol: section/code-fence/frontmatter
- mutation: heading-section replace/insert after tests
- impact mode: doc or explicit doc fallback, according to Slice 03 decision
- diagnostics providers: markdownlint and optional link-checker

Acceptance criteria:

- Repo overview reports Markdown language and doc category.
- Explicit `language: "markdown"` is accepted by syntax/local-map where relevant.

### 2. Implement Markdown section scanner

Scanner behavior:

- Recognize YAML frontmatter delimited by `---` at file start.
- Recognize TOML frontmatter delimited by `+++` at file start.
- Recognize ATX headings, preserving heading text, level, and generated slug.
- Recognize setext headings with `=` and `-` underlines.
- Recognize fenced code blocks using backticks and tildes, preserving language info string.
- Recognize inline links/images and reference definitions.
- Track line ranges without loading more than the current file into memory.

Generated slugs:

- Lowercase heading text.
- Strip common punctuation.
- Convert whitespace to hyphen.
- Include duplicate counter in details when duplicate headings appear.
- Label slug algorithm as GitHub-compatible approximation unless exact GitHub slug compatibility is implemented and tested.

Acceptance criteria:

- Fixture with frontmatter, nested headings, duplicate headings, links, reference definitions, and code fences has stable outline rows.
- Unterminated code fence returns a diagnostic but still returns bounded rows.

### 3. Add Markdown read-symbol and mutation support

Read-symbol:

- `markdown_section`: heading line through line before next same-or-higher-level heading.
- `code_fence`: opening fence through closing fence.
- `frontmatter`: frontmatter block only.

Mutation:

- `replace_symbol` supports `markdown_section` after `oldHash` or `oldText` validation.
- `insert_relative` supports inserting before or after a heading section.
- Whole-document replacement is not exposed through symbol tools.

Acceptance criteria:

- Read-symbol returns only the selected section for nested headings.
- Replace-symbol can update a section without changing adjacent sections.
- Insert-relative can add a new section before or after an existing heading.

### 4. Add Markdown routing behavior

Depending on Slice 03 decision:

Option A docs fallback:

- Impact map explicitly reports Markdown changed files as docs and suggests outline/route/local-map next steps in coverage.

Option B doc impact:

- Impact map treats changed headings as roots and links/heading references as related doc candidates.
- Output uses a doc-specific basis and limitations.

Local-map behavior:

- Anchors/names match heading text, generated slugs, link targets, and code fence language tags.
- Literal fallback remains available.

Test-map behavior:

- Markdown files can map to docs tests, link-check configs, README snapshot tests, and examples tests via path/literal evidence.

Acceptance criteria:

- Changed Markdown behavior is tested and documented.
- Local map with `language: "markdown"` returns heading/link candidates and literal fallback.

## Documentation Tasks

### 1. Update README coverage sections

File:

- `agent/extensions/private/code-intelligence/README.md`

Updates:

- Replace the current broad Engines and Coverage prose with a registry-aligned language matrix.
- For each language, state what is syntax-only, what has exact refs, and what has diagnostics.
- Add a short explanation of zsh-as-bash-grammar support.
- Add a short explanation of Markdown as documentation structure support, not code semantics.
- Update optional provider list and missing-tool behavior.

Acceptance criteria:

- README does not imply exact semantic references from Tree-sitter output.
- README says missing providers do not break default maps.
- README examples use supported language names and aliases.

### 2. Update code-intelligence skill guidance

File:

- `agent/extensions/private/code-intelligence/skills/code-intelligence/SKILL.md`

Updates:

- Tool selection language mentions all requested languages.
- Impact-map description lists registry-driven supported languages or refers to `code_intel_state` capability details rather than a stale hard-coded list.
- Guardrails mention Markdown doc routing and zsh limitations.
- Diagnostics guidance says includeDiagnostics collects applicable touched-file providers, not just TypeScript/JavaScript, once providers are implemented.

Acceptance criteria:

- Agent guidance remains concise and trigger-focused.
- It does not teach agents to claim complete impact from syntax maps.

### 3. Update tool descriptions and compact output text

Files:

- `src/slices/impact-map/tool.ts`
- `src/slices/local-map/tool.ts`
- `src/slices/syntax-search/tool.ts`
- `src/slices/targeted-symbols/tools.ts`
- compact output files where language limitations are rendered

Updates:

- Replace hard-coded language lists with registry-derived phrasing where the tool can include dynamic details.
- Keep short descriptions readable in Pi tool listings.
- Add examples for `c#`, `zsh`, `markdown`, and `c++` aliases where helpful.

Acceptance criteria:

- Tool descriptions are truthful without being long.
- Compact output still fits normal TUI cards.

### 4. Add coverage tests for docs and state

Tests:

- State capability summary includes each requested language.
- README coverage table entries are consistent with registry ids or a small snapshot generated from registry data.
- Skill guidance avoids stale hard-coded impact list if registry is now dynamic.

Acceptance criteria:

- A future language-support change fails a test if docs/state drift in an obvious way.

## Prompt-Behavior Review

Because README, skill, and tool descriptions shape future agent behavior, run a prompt-behavior review after docs are updated.

Review prompt should ask a reviewer agent:

- Which code-intel tool would you use for a changed `.zsh` file?
- What claims can you make from Markdown impact output?
- When should you run `confirmReferences`?
- What do missing providers mean?
- Should you reread a complete `code_intel_read_symbol` segment before editing?

Acceptance criteria:

- Reviewer answers match the evidence model and do not overstate semantic proof.
- Any confusing wording is fixed before final validation.

## Validation

```bash
cd agent/extensions && npm run check:structure
cd agent/extensions && npm run typecheck
cd agent/extensions && node --experimental-strip-types --test private/code-intelligence/test/markdown.test.ts private/code-intelligence/test/index.test.ts private/code-intelligence/test/compact-output.test.ts
cd agent/extensions && npm test
```

Manual documentation checks:

- Read `README.md` coverage section top-to-bottom.
- Read `skills/code-intelligence/SKILL.md` tool selection and guardrails.
- Confirm user-facing text distinguishes syntax evidence, exact refs, diagnostics, and docs routing.

## Exit Criteria

- Markdown is intentionally supported and tested.
- User-facing and agent-facing docs match implementation.
- Future agents can answer language coverage questions from state/docs without inspecting source internals.
