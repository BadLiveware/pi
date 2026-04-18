#!/usr/bin/env bash
set -euo pipefail

script_path="$(readlink -f -- "${BASH_SOURCE[0]}")"
script_dir="$(dirname -- "$script_path")"
script_name="$(basename -- "$script_path")"
target_dir="${1:-${PI_AGENT_DIR:-$HOME/.pi/agent}}"

echo "Source: $script_dir"
echo "Target: $target_dir"

mkdir -p -- "$target_dir"

shopt -s dotglob nullglob

linked_count=0
skipped_count=0

for item in "$script_dir"/*; do
  item_name="$(basename -- "$item")"

  if [[ "$item_name" == "$script_name" || "$item_name" == ".git" ]]; then
    echo "Skipping excluded item: $item_name"
    ((skipped_count+=1))
    continue
  fi

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
    echo "Skipping existing non-symlink: $destination" >&2
    ((skipped_count+=1))
    continue
  fi

  ln -s -- "$source_path" "$destination"
  echo "Linked: $destination -> $source_path"
  ((linked_count+=1))
done

echo "Done. Linked $linked_count item(s); skipped $skipped_count item(s)."
