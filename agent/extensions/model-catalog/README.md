# pi-model-catalog

Exposes Pi's model registry to the agent as a tool so model choice can be based on the same data behind `pi --list-models`.

## Tool

Registers:

- `list_pi_models`

Parameters:

- `query` — optional substring filter such as `mini`, `codex`, or `sonnet`
- `includeUnavailable` — include models without configured auth; defaults to `false`
- `includeDetails` — include verbose use/avoid guidance; defaults to `false`
- `includePricing` — include numeric registry prices in $/million tokens; defaults to `false`
- `relativeTo` — optional baseline model id such as `openai-codex/gpt-5.4`; with `includePricing`, adds relative input/output/blended ratios
- `unsupported` — how to handle locally unsupported models: `exclude` (default), `include`, or `only`

Default returned columns are intentionally concise:

- full model id (`provider/model`, with `*` marking the current model)
- `auth`, `support`, and `enabled` status
- context and max output tokens
- compact capability marker (`text`, `think`, `img`, or `think+img`)
- price guidance tier (`price-tier`)
- combined relative cost ratio (`rel-cost`) against the current model by default, or against `relativeTo` / `--relative-to` when supplied
- quota guidance tier

Optional columns/details include:

- numeric pricing columns (`in$/M`, `out$/M`) and detailed relative ratios (`rel-in`, `rel-out`, `rel-blend`) with `includePricing`
- verbose use/avoid guidance with `includeDetails`

For model overrides, agents should choose rows with both `support: yes` and `enabled: yes` unless the user explicitly authorizes configuration changes. `auth: yes` only means credentials exist.

The `price-tier` and `quota` columns are guidance tiers, not live billing or remaining-quota data. They are meant to help the agent choose between cheap/lower-scarcity, premium low-latency, default, and scarce/strong models. `price-tier` is computed from local registry rates as `input $/M + output $/M`:

| Tier | Rule |
| --- | ---: |
| `free/local` | locally run model; no metered API cost |
| `unknown/sub` | no numeric input/output price |
| `low` | `<= $1/M` blended |
| `medium` | `<= $8/M` blended |
| `high` | `<= $30/M` blended |
| `premium` | `> $30/M` blended |
| `premium-speed` | `-spark` models, special-cased |

Local models are free but very slow; treat them as roughly around `gpt-5.4-mini` capability, maybe slightly above, and use them mainly for non-interactive/background work where latency is acceptable. They are also effectively serial/concurrency-constrained: do not plan to use multiple local models at the same time, and avoid many concurrent tasks on the same local model. In particular, `-spark` models are treated as premium very-low-latency options, not cheap defaults.

Numeric pricing comes from Pi's local model registry (`model.cost`) and is expressed in dollars per million tokens. For direct API providers this usually mirrors provider pricing; for subscription-backed providers such as Codex or Copilot, treat it as nominal cost-weight data rather than a guarantee of live billing or quota burn. A zero/blank price outside the `free/local` tier can mean unknown, bundled, or non-metered rather than free.

Example:

```json
{
  "query": "openai-codex gpt-5.4",
  "includePricing": true,
  "relativeTo": "openai-codex/gpt-5.4"
}
```

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

- `/models-guide [query]` — show the concise available-model table in the UI
- `/models-guide --verbose [query]` — include verbose use/avoid guidance
- `/models-guide --pricing --relative-to openai-codex/gpt-5.4 openai-codex gpt-5` — include numeric pricing and ratios in the UI table

## Intended use

Agents should call `list_pi_models` before choosing or recommending a model when availability, cost, quota, or capability matters. This is especially useful for subagent delegation and deciding whether to downshift routine work or upshift difficult bounded work.
