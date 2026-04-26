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
- GitHub Actions enabled for this public repository.
- npm trusted publisher configured for each package.
- repository visibility/metadata ready for public users.
- secrets rotated and `gitleaks` checks passing.

The publish workflow uses npm trusted publishing through GitHub Actions OIDC. It requests `id-token: write`, uses `actions/setup-node@v6` with the npm registry URL, uses npm 11+, and does not need `NPM_TOKEN`.

## Bootstrap a brand-new package

npm trusted publisher configuration currently requires the package to already exist on the npm registry. For a brand-new package, do a one-time manual publish first:

```bash
cd agent/extensions/public/model-catalog
npm publish --access public --otp <one-time-password>
```

Repeat for each new package that does not exist yet. After the package exists, configure trusted publishing before using tag-triggered releases.

## Configure npm trusted publishing

For each package on npmjs.com, open package settings and add a trusted publisher:

- Provider: GitHub Actions
- Organization or user: `BadLiveware`
- Repository: `pi`
- Workflow filename: `publish-pi-extension.yml`
- Environment name: leave blank unless the workflow is later changed to use a GitHub environment

Equivalent npm CLI form, after installing npm 11.10+ and authenticating interactively:

```bash
npm trust github @badliveware/pi-model-catalog --repo BadLiveware/pi --file publish-pi-extension.yml
```

Repeat for each package. The package must already exist.

After trusted publishing works, prefer npm's package setting "Require two-factor authentication and disallow tokens" and remove unused publish tokens.

## Before tagging

1. Bump the `version` in the target package's `package.json`.
2. Commit the package changes and push them to `main`.
3. Run local validation from `agent/extensions`:

```bash
npm ci --no-audit --no-fund
npm run typecheck
npm run pack:public
```

To dry-run one package:

```bash
./scripts/pack-public.sh model-catalog
```

## Publish one package with a tag

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
npm publish --access public
```

Provenance is generated automatically by npm trusted publishing for public packages from this public GitHub repository.

## Versioning

Each package has its own `package.json` and version. Bump only the packages whose published contents changed.

If the workflow says the version already exists on npm, bump the package version, commit, and push a new tag.

## Do not publish private packages

Packages under `private/` are local-only. Move and generalize an extension into `public/` before publishing it.
