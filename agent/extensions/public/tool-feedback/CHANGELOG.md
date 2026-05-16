# Changelog

## 0.2.0

- Add per-tool feedback responses so agents can report different experiences for different watched tools in the same turn.
- Record follow-up tool categories after watched calls so feedback logs can distinguish routine verification from compensatory follow-up work.
- Update package imports and peer dependencies for the `@earendil-works/*` Pi packages.

## 0.1.1

- Clarified dogfood feedback prompts so agents call `tool_feedback` silently and avoid acknowledging the feedback request to the user.

## 0.1.0

- Initial public package release for watched-tool feedback prompts and passive turn summaries.
- Added custom feedback fields so projects can ask for domain-specific ratings such as ranking quality or latency acceptability.
- Delivered active feedback requests as Pi custom messages instead of user messages.
- Added prompt wording and README guidance that frame agent self-feedback as noisy subjective signal rather than ground truth.
