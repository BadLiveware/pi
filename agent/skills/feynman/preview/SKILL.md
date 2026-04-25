---
name: preview
description: Preview Markdown, LaTeX, PDF, or code artifacts in the browser or as PDF. Use when the user wants to review a written artifact, export a report, or view a rendered document.
---

# Preview

Use available Pi preview/browser tools when present; do not assume Feynman CLI preview commands exist in this standalone integration.

## Workflow

1. Identify the artifact path to preview.
2. Prefer an available preview package or browser tool if one is loaded.
3. If no preview tool is available, use local commands such as `xdg-open`, `open`, `pandoc`, or a simple temporary HTML render when they exist.
4. If rendering is unavailable, report the missing capability and provide the artifact path for manual inspection.

## Fallback examples

```bash
xdg-open <file.md>      # Linux desktop, when available
open <file.md>          # macOS
pandoc <file.md> -o <file.pdf>
```
