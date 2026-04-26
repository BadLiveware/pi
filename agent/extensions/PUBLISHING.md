# Publishing Pi Extensions

Public extensions are published individually from `agent/extensions/public/*`. There is no public bundle package.

Publishing is intentionally manual and tag-triggered. Pushing to `main` does **not** publish anything.

## Publishable packages

| Extension tag segment | npm package |
| --- | --- |
| `compaction-continue` | `@badliveware/pi-compaction-continue` |
| `pr-upstream-status` | `@badliveware/pi-pr-upstream-status` |
| `footer-framework` | `@badliveware/pi-footer-framework` |
| `model-catalog` | `@badliveware/pi-model-catalog` |

## Prerequisites

- npm account with publish rights to the `@badliveware` scope.
- GitHub repository secret `NPM_TOKEN` with npm publish permission.
- GitHub Actions enabled for the repository.
- repository visibility/metadata ready for public users.
- secrets rotated and `gitleaks` checks passing.

The publish workflow uses npm provenance (`npm publish --provenance`), so it requests GitHub OIDC `id-token: write` permission.

## Before tagging

1. Bump the `version` in the target package's `package.json`.
2. Commit the package changes and push them to `main`.
3. Run local validation from `agent/extensions`:

```bash
npm install --no-audit --no-fund
npm run typecheck
npm run pack:public
```

To dry-run one package:

```bash
./scripts/pack-public.sh model-catalog
```

## Publish one package

Create and push a tag with this format:

```text
pi-ext/<extension-name>/v<package-version>
```

Examples:

```bash
git tag pi-ext/model-catalog/v0.1.0
git push origin pi-ext/model-catalog/v0.1.0
```

```bash
git tag pi-ext/footer-framework/v0.1.0
git push origin pi-ext/footer-framework/v0.1.0
```

The GitHub Actions workflow verifies that:

- the extension name is one of the publishable packages;
- the tag version matches that package's `package.json` version;
- TypeScript checks pass;
- `npm pack --dry-run` succeeds for the target package;
- the package version is not already published on npm.

Then it publishes only that package with:

```bash
npm publish --access public --provenance
```

## Versioning

Each package has its own `package.json` and version. Bump only the packages whose published contents changed.

If the workflow says the version already exists on npm, bump the package version, commit, and push a new tag.

## Do not publish private packages

Packages under `private/` are local-only. Move and generalize an extension into `public/` before publishing it.
