# pi-model-catalog

Exposes Pi's model registry to the agent as a tool so model choice can be based on the same data behind `pi --list-models`.

## Tool

Registers:

- `list_pi_models`

Parameters:

- `query` — optional substring filter such as `mini`, `codex`, or `sonnet`
- `includeUnavailable` — include models without configured auth; defaults to `false`
- `includeDetails` — include use/avoid guidance; defaults to `true`
- `unsupported` — how to handle locally unsupported models: `exclude` (default), `include`, or `only`

Returned columns include:

- provider and model id
- context and max output tokens
- thinking and image support
- whether auth is configured for the model
- whether the model is in `settings.json` `enabledModels`
- local support status
- cost guidance tier
- quota guidance tier
- usage guidance in the details section

The `cost` and `quota` columns are guidance tiers, not live billing or remaining-quota data. They are meant to help the agent choose between fast/cheap, default, and scarce/strong models.

## Locally unsupported models

Some models can appear in Pi's registry and pass auth checks but still fail for a specific account/provider pairing. For example, `openai-codex/gpt-5.1-codex-mini` is currently marked unsupported for the configured Codex ChatGPT account.

Unsupported models are excluded by default so agents do not choose them accidentally. Call `list_pi_models` with `unsupported: "include"` to show them with a `support: no` column and reason, or `unsupported: "only"` to inspect only unsupported entries.

You can add local unsupported entries in `~/.pi/agent/model-catalog.json`:

```json
{
  "unsupportedModels": [
    {
      "model": "provider/model-id",
      "reason": "short reason shown to the agent"
    }
  ]
}
```

## Command

- `/models-guide [query]` — show the available-model table in the UI

## Intended use

Agents should call `list_pi_models` before choosing or recommending a model when availability, cost, quota, or capability matters. This is especially useful for subagent delegation and deciding whether to downshift routine work or upshift difficult bounded work.
