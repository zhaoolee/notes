#!/usr/bin/env bash
set -euo pipefail

ENDPOINT="https://notes.fangyuanxiaozhan.com/api/export"
MARKDOWN=""
MARKDOWN_FILE=""
OUTPUT=""
FILENAME=""
THEME="default"

usage() {
  cat <<'EOF'
Usage:
  export_note.sh --markdown '## **0x01** ...' --output /abs/path/out.png
  export_note.sh --markdown-file /abs/path/note.md --output /abs/path/out.png

Options:
  --markdown TEXT         Inline markdown content
  --markdown-file PATH    UTF-8 markdown file path
  --output PATH           Output PNG path
  --filename NAME         Filename sent to API (defaults to output basename)
  --theme NAME            Optional theme: default or smartisan-dark (defaults to default)
  --endpoint URL          Override API endpoint
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --markdown)
      MARKDOWN="${2:-}"
      shift 2
      ;;
    --markdown-file)
      MARKDOWN_FILE="${2:-}"
      shift 2
      ;;
    --output)
      OUTPUT="${2:-}"
      shift 2
      ;;
    --filename)
      FILENAME="${2:-}"
      shift 2
      ;;
    --theme)
      THEME="${2:-}"
      shift 2
      ;;
    --endpoint)
      ENDPOINT="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$OUTPUT" ]]; then
  echo "--output is required" >&2
  exit 1
fi

if [[ -n "$MARKDOWN" && -n "$MARKDOWN_FILE" ]]; then
  echo "Use either --markdown or --markdown-file, not both" >&2
  exit 1
fi

if [[ -z "$MARKDOWN" && -z "$MARKDOWN_FILE" ]]; then
  echo "One of --markdown or --markdown-file is required" >&2
  exit 1
fi

if [[ -n "$MARKDOWN_FILE" ]]; then
  MARKDOWN="$(cat "$MARKDOWN_FILE")"
fi

mkdir -p "$(dirname "$OUTPUT")"

if [[ -z "$FILENAME" ]]; then
  FILENAME="$(basename "$OUTPUT")"
fi

case "$THEME" in
  default|smartisan-dark)
    ;;
  *)
    echo "--theme must be one of: default, smartisan-dark" >&2
    exit 1
    ;;
esac

JSON_PAYLOAD="$(mktemp)"
trap 'rm -f "$JSON_PAYLOAD"' EXIT

python3 - "$MARKDOWN" "$FILENAME" "$THEME" > "$JSON_PAYLOAD" <<'PY'
import json
import sys

markdown = sys.argv[1]
filename = sys.argv[2]
theme = sys.argv[3]
json.dump({"markdown": markdown, "filename": filename, "theme": theme}, sys.stdout, ensure_ascii=False)
PY

curl -sS \
  -H 'accept: image/png' \
  -H 'content-type: application/json' \
  --data-binary "@$JSON_PAYLOAD" \
  "$ENDPOINT" \
  --output "$OUTPUT"

echo "$OUTPUT"
