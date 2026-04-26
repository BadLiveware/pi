# Git hooks

This repository keeps shareable hooks in `.githooks/`.

Install them in a clone with:

```bash
git config core.hooksPath .githooks
```

## pre-commit

Runs:

```bash
gitleaks protect --staged --source . --redact --no-banner
```

If `gitleaks` is missing, commits fail closed. For an intentional one-off bypass, set:

```bash
SKIP_GITLEAKS=1 git commit ...
```
