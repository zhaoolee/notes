#!/bin/sh

set -eu

mode="${1:-}"
shift

case "$mode" in
  frontend)
    required_bin="node_modules/.bin/vite"
    ;;
  backend)
    required_bin="node_modules/.bin/tsx"
    ;;
  *)
    echo "Unknown dev mode: $mode" >&2
    exit 1
    ;;
esac

lock_hash_file="node_modules/.package-lock.sha256"
current_hash="$(sha256sum package-lock.json | awk '{print $1}')"
saved_hash=""

if [ -f "$lock_hash_file" ]; then
  saved_hash="$(cat "$lock_hash_file")"
fi

if [ ! -x "$required_bin" ] || [ "$current_hash" != "$saved_hash" ]; then
  echo "Installing dependencies for $mode container..."
  npm ci
  mkdir -p node_modules
  printf '%s' "$current_hash" > "$lock_hash_file"
fi

exec "$@"
