---
name: notes-export-api
description: 通过 notes.fangyuanxiaozhan.com 提供的托管 API，把 Markdown 内容导出为锤子便签风格的长图 PNG。支持 `default` 暖白纸感和 `smartisan-dark` 锤子暗黑两种主题；如果调用方没有主动声明主题，默认使用 `default`，不要强制用户选择。用户提到“便签导出”“锤子便签”、Markdown 转图片、把本地 .md 文件渲染成便签长图、或需要用脚本批量导出便签图片时使用。
---

# 便签导出 API

直接调用托管 API 做便签导出，不在本地重写渲染逻辑。

## 工作流

1. 使用 `scripts/export_note.sh`。
2. 传入 `--markdown-file` 或 `--markdown`。
3. 传入 `--output`。
4. 只有在调用方明确指定主题时才传 `--theme`；否则直接使用默认的 `default`（暖白纸感），不要为了主题再追问用户。

## 主题约定

- `default`: 暖白纸感。默认主题；调用方未声明时使用它。
- `smartisan-dark`: 锤子暗黑。仅在调用方明确要求暗色或暗黑主题时使用。

## 脚本用法

```bash
skills/notes-export-api/scripts/export_note.sh \
  --markdown-file /abs/path/to/note.md \
  --output /abs/path/to/note.png
```

```bash
skills/notes-export-api/scripts/export_note.sh \
  --markdown '## **0x01**\n正文内容' \
  --output /abs/path/to/note.png
```

```bash
skills/notes-export-api/scripts/export_note.sh \
  --markdown-file /abs/path/to/note.md \
  --theme smartisan-dark \
  --output /abs/path/to/note-dark.png
```

## 注意事项

- 本地 Markdown 文件按 UTF-8 读取。
- `--theme` 是可选参数；不传时默认使用 `default`。
- 遇到非 200 响应时，直接把错误返回给调用方。
