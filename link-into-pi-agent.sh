#!/usr/bin/env bash
set -euo pipefail

script_path="$(readlink -f -- "${BASH_SOURCE[0]}")"
repo_dir="$(dirname -- "$script_path")"
source_dir="${PI_AGENT_SOURCE_DIR:-$repo_dir/agent}"
force=false
target_dir="${PI_AGENT_DIR:-$HOME/.pi/agent}"

usage() {
  echo "Usage: $0 [--force] [target-dir]" >&2
}

while (($# > 0)); do
  case "$1" in
    --force)
      force=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
    *)
      if [[ "$target_dir" != "${PI_AGENT_DIR:-$HOME/.pi/agent}" ]]; then
        echo "Target directory already provided: $target_dir" >&2
        usage
        exit 1
      fi
      target_dir="$1"
      shift
      ;;
  esac
done

if [[ ! -d "$source_dir" ]]; then
  echo "Source directory does not exist: $source_dir" >&2
  exit 1
fi

echo "Repository: $repo_dir"
echo "Source: $source_dir"
echo "Target: $target_dir"
echo "Force: $force"

mkdir -p -- "$target_dir"

shopt -s dotglob nullglob

linked_count=0
skipped_count=0
removed_count=0

for destination in "$target_dir"/*; do
  [[ -L "$destination" ]] || continue

  item_name="$(basename -- "$destination")"
  source_candidate="$source_dir/$item_name"
  existing_target="$(readlink -f -- "$destination" || true)"

  if [[ -n "$existing_target" && "$existing_target" == "$repo_dir"/* && ! -e "$source_candidate" ]]; then
    rm -f -- "$destination"
    echo "Removed stale link: $destination"
    ((removed_count+=1))
  fi
done

for item in "$source_dir"/*; do
  item_name="$(basename -- "$item")"
  destination="$target_dir/$item_name"
  source_path="$(readlink -f -- "$item")"

  if [[ -L "$destination" ]]; then
    existing_target="$(readlink -f -- "$destination" || true)"
    if [[ "$existing_target" == "$source_path" ]]; then
      echo "Already linked: $destination -> $source_path"
      ((skipped_count+=1))
      continue
    fi

    rm -f -- "$destination"
  elif [[ -e "$destination" ]]; then
    if [[ "$force" == true ]]; then
      rm -rf -- "$destination"
      echo "Replaced existing path due to --force: $destination"
      ((removed_count+=1))
    else
      echo "Skipping existing non-symlink: $destination (use --force to replace)" >&2
      ((skipped_count+=1))
      continue
    fi
  fi

  ln -s -- "$source_path" "$destination"
  echo "Linked: $destination -> $source_path"
  ((linked_count+=1))
done

extensions_dir="$source_dir/extensions"
if [[ -f "$extensions_dir/package.json" ]]; then
  if command -v pi >/dev/null 2>&1; then
    extensions_source="$(readlink -f -- "$extensions_dir")"
    echo "Installing extensions from: $extensions_source"
    pi install "$extensions_source"
  else
    echo "Skipping extension install: pi command not found in PATH." >&2
  fi
fi

echo "Done. Linked $linked_count item(s); removed $removed_count stale/replaced item(s); skipped $skipped_count item(s)."
