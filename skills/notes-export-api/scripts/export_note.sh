#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SKILL_DIR/../.." && pwd)"
DEFAULT_ENDPOINT="https://notes.fangyuanxiaozhan.com/api/export"
ENDPOINT="$DEFAULT_ENDPOINT"
IMAGE_IMPORT_ENDPOINT=""
MARKDOWN=""
MARKDOWN_FILE=""
OUTPUT=""
FILENAME=""
THEME="default"
ENV_FILE_FOUND="false"
TEMP_FILES=()

cleanup() {
  if [[ "${#TEMP_FILES[@]}" -eq 0 ]]; then
    return
  fi

  rm -f "${TEMP_FILES[@]}"
}

trap cleanup EXIT

load_env_file() {
  local env_file="$1"

  if [[ ! -f "$env_file" ]]; then
    return 1
  fi

  ENV_FILE_FOUND="true"
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
}

normalize_endpoint() {
  local value="$1"

  if [[ -z "$value" ]]; then
    echo "$DEFAULT_ENDPOINT"
    return
  fi

  case "$value" in
    */api/export)
      echo "$value"
      ;;
    *)
      echo "${value%/}/api/export"
      ;;
  esac
}

normalize_image_import_endpoint() {
  local value="$1"

  if [[ -z "$value" ]]; then
    echo "${DEFAULT_ENDPOINT%/api/export}/api/images/import"
    return
  fi

  case "$value" in
    */api/images/import)
      echo "$value"
      ;;
    */api/export)
      echo "${value%/api/export}/api/images/import"
      ;;
    *)
      echo "${value%/}/api/images/import"
      ;;
  esac
}

load_endpoint_from_env() {
  if [[ "$ENV_FILE_FOUND" != "true" ]]; then
    return
  fi

  if [[ -n "${NOTES_EXPORT_API_BASE_URL:-}" ]]; then
    ENDPOINT="$(normalize_endpoint "$NOTES_EXPORT_API_BASE_URL")"
  fi
}

for env_file in "$REPO_ROOT/.env" "$SKILL_DIR/.env"; do
  load_env_file "$env_file" || true
done

load_endpoint_from_env

usage() {
  cat <<'EOF'
Usage:
  export_note.sh --markdown '## **0x01** ...' --output /abs/path/out.png
  export_note.sh --markdown-file /abs/path/note.md --output /abs/path/out.png

Options:
  --markdown TEXT         Inline markdown content
  --markdown-file PATH    UTF-8 markdown file path; local images are auto-uploaded
  --output PATH           Output PNG path
  --filename NAME         Filename sent to API (defaults to output basename)
  --theme NAME            Optional theme: default or smartisan-dark (defaults to default)
  --endpoint URL          Override API endpoint or base URL

.env:
  NOTES_EXPORT_API_BASE_URL=https://notes.fangyuanxiaozhan.com
  NOTES_EXPORT_API_BASE_URL=http://127.0.0.1:15713
EOF
}

rewrite_markdown_local_images() {
  local markdown_file="$1"
  local output_file="$2"

  python3 - "$markdown_file" "$IMAGE_IMPORT_ENDPOINT" > "$output_file" <<'PY'
import json
import mimetypes
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

markdown_file = os.path.abspath(sys.argv[1])
image_import_endpoint = sys.argv[2]
markdown_dir = os.path.dirname(markdown_file)

MARKDOWN_IMAGE_RE = re.compile(r'(!\[[^\]]*]\()(?P<dest><[^>\n]+>|[^)\n]+)(\))')
HTML_IMAGE_RE = re.compile(r'(<img\b[^>]*\bsrc\s*=\s*)(?P<quote>["\'])(?P<dest>[^"\']+)(?P=quote)', re.IGNORECASE)


def read_markdown() -> str:
    with open(markdown_file, "r", encoding="utf-8") as handle:
        return handle.read()


def is_remote_reference(value: str) -> bool:
    normalized = value.strip().lower()
    return normalized.startswith(("http://", "https://", "data:", "blob:"))


def split_markdown_destination(raw_value: str) -> tuple[str, str]:
    stripped = raw_value.strip()

    if stripped.startswith("<"):
        end_index = stripped.find(">")
        if end_index != -1:
            return stripped[1:end_index], stripped[end_index + 1 :]

    parts = stripped.split(None, 1)

    if not parts:
        return "", ""

    destination = parts[0]
    suffix = stripped[len(destination) :]
    return destination, suffix


def resolve_local_path(reference: str) -> str:
    trimmed = reference.strip()

    if trimmed.lower().startswith("file://"):
        parsed = urllib.parse.urlparse(trimmed)
        return os.path.abspath(urllib.request.url2pathname(parsed.path))

    expanded = os.path.expanduser(trimmed)

    if os.path.isabs(expanded):
        return expanded

    return os.path.abspath(os.path.join(markdown_dir, expanded))


def upload_image(file_path: str) -> str:
    filename = os.path.basename(file_path)
    mime_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"

    with open(file_path, "rb") as handle:
        payload = handle.read()

    boundary = f"----notes-export-{uuid.uuid4().hex}"
    body = b"".join(
        [
            f"--{boundary}\r\n".encode("utf-8"),
            f'Content-Disposition: form-data; name="image"; filename="{filename}"\r\n'.encode("utf-8"),
            f"Content-Type: {mime_type}\r\n\r\n".encode("utf-8"),
            payload,
            f"\r\n--{boundary}--\r\n".encode("utf-8"),
        ]
    )

    request = urllib.request.Request(image_import_endpoint, data=body, method="POST")
    request.add_header("Accept", "application/json")
    request.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")

    try:
        with urllib.request.urlopen(request) as response:
            charset = response.headers.get_content_charset() or "utf-8"
            payload_text = response.read().decode(charset)
    except urllib.error.HTTPError as error:
        payload_text = error.read().decode("utf-8", errors="replace")
        try:
            data = json.loads(payload_text)
        except json.JSONDecodeError:
            data = None

        message = data.get("error") if isinstance(data, dict) else None
        raise SystemExit(message or f"图片上传失败（HTTP {error.code}）")
    except urllib.error.URLError as error:
        reason = getattr(error, "reason", error)
        raise SystemExit(f"图片上传失败：{reason}")

    try:
        data = json.loads(payload_text)
    except json.JSONDecodeError as error:
        raise SystemExit(f"图片上传成功但返回了无效响应：{error}")

    image_url = (data.get("path") or data.get("url")) if isinstance(data, dict) else None

    if not image_url:
        raise SystemExit("图片上传成功但响应中缺少 path/url。")

    return image_url


def build_upload_map(markdown: str) -> dict[str, str]:
    references: list[str] = []

    for match in MARKDOWN_IMAGE_RE.finditer(markdown):
        destination, _ = split_markdown_destination(match.group("dest"))
        if destination:
            references.append(destination)

    for match in HTML_IMAGE_RE.finditer(markdown):
        references.append(match.group("dest").strip())

    replacements: dict[str, str] = {}

    for reference in references:
        if not reference or is_remote_reference(reference) or reference in replacements:
            continue

        resolved_path = resolve_local_path(reference)

        if not os.path.isfile(resolved_path):
            raise SystemExit(
                f"Markdown 中引用的图片不存在：{reference}（解析路径：{resolved_path}）"
            )

        replacements[reference] = upload_image(resolved_path)

    return replacements


def replace_markdown_image(match: re.Match[str], replacements: dict[str, str]) -> str:
    destination, suffix = split_markdown_destination(match.group("dest"))
    replacement = replacements.get(destination)

    if not replacement:
        return match.group(0)

    wrapped_destination = f"<{replacement}>" if match.group("dest").strip().startswith("<") else replacement
    return f"{match.group(1)}{wrapped_destination}{suffix})"


def replace_html_image(match: re.Match[str], replacements: dict[str, str]) -> str:
    destination = match.group("dest").strip()
    replacement = replacements.get(destination)

    if not replacement:
        return match.group(0)

    quote = match.group("quote")
    return f"{match.group(1)}{quote}{replacement}{quote}"


markdown = read_markdown()
upload_map = build_upload_map(markdown)
markdown = MARKDOWN_IMAGE_RE.sub(lambda match: replace_markdown_image(match, upload_map), markdown)
markdown = HTML_IMAGE_RE.sub(lambda match: replace_html_image(match, upload_map), markdown)
print(markdown, end="")
PY
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
  if [[ ! -f "$MARKDOWN_FILE" ]]; then
    echo "--markdown-file does not exist: $MARKDOWN_FILE" >&2
    exit 1
  fi
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

ENDPOINT="$(normalize_endpoint "$ENDPOINT")"
IMAGE_IMPORT_ENDPOINT="$(normalize_image_import_endpoint "$ENDPOINT")"

if [[ -n "$MARKDOWN_FILE" ]]; then
  PROCESSED_MARKDOWN_FILE="$(mktemp)"
  TEMP_FILES+=("$PROCESSED_MARKDOWN_FILE")
  rewrite_markdown_local_images "$MARKDOWN_FILE" "$PROCESSED_MARKDOWN_FILE"
  MARKDOWN="$(cat "$PROCESSED_MARKDOWN_FILE")"
fi

JSON_PAYLOAD="$(mktemp)"
TEMP_FILES+=("$JSON_PAYLOAD")

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
