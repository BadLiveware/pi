#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
extensions_dir="$(cd -- "$script_dir/.." && pwd)"
public_dir="$extensions_dir/public"
requested_package="${1:-}"

usage() {
  cat >&2 <<'USAGE'
Usage: pack-public.sh [extension-name]

Validates public extension package contents with npm pack --dry-run.
If extension-name is omitted, validates every public extension package.
This script does not publish; publishing is done by the tag-triggered GitHub Actions workflow.
USAGE
}

if [[ "${requested_package:-}" == "-h" || "${requested_package:-}" == "--help" ]]; then
  usage
  exit 0
fi

all_packages=(
  "compaction-continue"
  "pr-upstream-status"
  "footer-framework"
  "model-catalog"
  "tool-feedback"
)

packages=()
if [[ -n "$requested_package" ]]; then
  found=false
  for package_name in "${all_packages[@]}"; do
    if [[ "$package_name" == "$requested_package" ]]; then
      found=true
      packages+=("$package_name")
      break
    fi
  done
  if [[ "$found" != true ]]; then
    echo "Unknown public extension package: $requested_package" >&2
    echo "Valid packages: ${all_packages[*]}" >&2
    exit 1
  fi
else
  packages=("${all_packages[@]}")
fi

for package_name in "${packages[@]}"; do
  package_dir="$public_dir/$package_name"
  if [[ ! -f "$package_dir/package.json" ]]; then
    echo "Missing package.json: $package_dir" >&2
    exit 1
  fi

  npm_name="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).name)' "$package_dir/package.json")"

  echo "Checking $npm_name from $package_dir"
  tmp_report="$(mktemp)"
  (cd "$package_dir" && npm pack --dry-run --json >"$tmp_report")
  node -e '
    const fs = require("fs");
    const pack = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))[0];
    console.log(JSON.stringify({ name: pack.name, version: pack.version, files: pack.files.map((file) => file.path) }, null, 2));
  ' "$tmp_report"
  rm -f "$tmp_report"

done
