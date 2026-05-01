# Rich Output Extension

Prototype timeline presentation tools for structured output in Pi.

Use normal prose for simple answers. Use `rich_output_present` when structure or visuals make the result easier to scan: validation summaries, review findings, benchmark comparisons, artifact references, and diagrams for genuinely complex flows or relationships.

## Guardrails

- Keep each entry focused; avoid duplicating a rendered diagram with a long source block.
- Mermaid diagrams are encouraged when they clarify architecture, state, sequence, dependency, or evidence flow.
- Mermaid rendering is capped to keep the agent/UI responsive: at most 4 Mermaid diagrams are rendered per entry, sources above 12k characters fall back to text, and render errors are summarized.
- Mermaid artifacts are written under `.pi/rich-output/mermaid/` in the current project when possible, with `/tmp/pi-rich-output-mermaid/` as fallback.
- The inline timeline preview is a PNG. The SVG artifact path is printed for crisp external viewing.

## Size presets

Mermaid diagram blocks accept `size`:

- `compact` — small supporting diagram
- `normal` — default
- `wide` — broad architecture/sequence diagram
- `full` — maximum capped width

`maxWidthCells` can override the preset, but is capped internally.

## Examples

### Validation summary

```json
{
  "kind": "validation",
  "title": "Validation",
  "summary": "Focused checks passed; browser smoke skipped.",
  "payload": {
    "commands": [
      { "command": "npm test", "result": "passed", "duration": "1.2s", "summary": "unit tests passed" },
      { "command": "npm run typecheck", "result": "passed", "summary": "types clean" }
    ],
    "gaps": ["Browser smoke skipped: no credentials"]
  }
}
```

### Review findings

```json
{
  "kind": "findings",
  "title": "Review findings",
  "payload": {
    "findings": [
      {
        "severity": "high",
        "location": "src/auth.ts:42",
        "title": "Expired token accepted",
        "evidence": "Targeted test failed before the fix",
        "impact": "Stale sessions can remain valid",
        "suggestedFix": "Reject expired tokens before refresh fallback"
      }
    ]
  }
}
```

### Mermaid diagram

```json
{
  "kind": "note",
  "title": "Evidence flow",
  "blocks": [
    {
      "type": "diagram",
      "format": "mermaid",
      "render": "svg",
      "size": "wide",
      "label": "Agent evidence loop",
      "text": "flowchart LR\n  Request --> Plan\n  Plan --> Implement\n  Implement --> Tests\n  Tests --> Summary"
    }
  ]
}
```

Set `showSource: true` when the Mermaid source itself is important to review.

### Benchmark comparison

```json
{
  "kind": "benchmark",
  "title": "Selector benchmark",
  "blocks": [
    { "type": "sparkline", "label": "p95 ms", "values": [41, 38, 35, 29, 27] },
    {
      "type": "table",
      "columns": ["Build", "p50", "p95", "Notes"],
      "rows": [["baseline", "22ms", "41ms", "current"], ["candidate", "16ms", "27ms", "cached"]]
    }
  ]
}
```

### Artifact link

```json
{
  "kind": "note",
  "title": "Generated artifacts",
  "blocks": [
    { "type": "link", "label": "Review report", "path": "/path/to/.pi/review/auth/report.md" },
    { "type": "callout", "tone": "info", "text": "Path is printed visibly even when terminal hyperlinks are unavailable." }
  ]
}
```
