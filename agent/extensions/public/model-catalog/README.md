# pi-model-catalog

Adds a `list_pi_models` tool that lets agents inspect Pi's current model registry before choosing or recommending a model.

Use it when model choice should depend on what is actually available in your Pi setup: auth status, local support notes, enabled/cycling preferences, context size, capabilities, supported thinking levels, quota guidance, and optional price data.

## Install

```bash
pi install npm:@badliveware/pi-model-catalog
```

No external services or credentials are required beyond the model credentials already configured in Pi.

## Quick use

Ask the agent to call `list_pi_models` before choosing a model, or use the UI command:

```text
/models-guide mini
/models-guide --pricing --relative-to openai-codex/gpt-5.4-mini codex
```

Tool example:

```json
{
  "query": "sonnet",
  "includePricing": true,
  "relativeTo": "openai-codex/gpt-5.4-mini"
}
```

## What it returns

Default output is intentionally compact:

- full model id, with `*` on the current model
- `auth`, `support`, and `enabled` status
- context and max output tokens
- capability marker: `text`, `think`, `img`, or `think+img`
- supported Pi thinking levels, shown as `off`, `min`, `low`, `med`, `high`, and `xhi` in the compact table
- price tier and rough relative cost
- quota/scarcity guidance

Pass `includeDetails: true` for verbose use/avoid guidance and full thinking level names. Pass `includePricing: true` for numeric input/output prices and relative ratios. Structured tool details include `thinkingLevels` and any model-specific `thinkingLevelMap`; Pi uses `off` for provider no/none thinking.

## Tool parameters

| Parameter | What it does |
| --- | --- |
| `query` | Optional substring filter such as `mini`, `codex`, or `sonnet`. |
| `includeUnavailable` | Include models without configured auth. Default: `false`. |
| `includeDetails` | Include verbose use/avoid guidance. Default: `false`. |
| `includePricing` | Include numeric registry prices in $/million tokens. Default: `false`. |
| `relativeTo` | Baseline model id for relative price ratios. |
| `unsupported` | `exclude`, `include`, or `only` locally unsupported models. Default: `exclude`. |

## Command

| Command | What it does |
| --- | --- |
| `/models-guide [query]` | Show the concise available-model table. |
| `/models-guide --verbose [query]` | Include verbose use/avoid guidance. |
| `/models-guide --pricing --relative-to <model> [query]` | Include numeric pricing and ratios. |

## Local support notes

Some providers report a model as authenticated even when a specific account cannot use it. Add local unsupported-model notes in:

```text
~/.pi/agent/model-catalog.json
```

Example:

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

Unsupported models are excluded by default so agents do not choose them accidentally.

## Price and quota caveats

`price-tier`, numeric prices, and quota labels are guidance from Pi's local model registry, not live billing or remaining quota. For subscription-backed providers, numeric prices may be nominal weights rather than direct billing.
