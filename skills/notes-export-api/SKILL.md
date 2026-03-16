---
name: notes-export-api
description: 通过 notes.fangyuanxiaozhan.com 提供的托管 API，把 Markdown 内容导出为锤子便签风格的长图 PNG。用户提到“便签导出”“锤子便签”、Markdown 转图片、把本地 .md 文件渲染成便签长图、或需要用脚本批量导出便签图片时使用。
---

# 便签导出 API

直接调用托管 API 做便签导出，不在本地重写渲染逻辑。

## 工作流

1. 使用 `scripts/export_note.sh`。
2. 传入 `--markdown-file` 或 `--markdown`。
3. 传入 `--output`。

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

## 注意事项

- 本地 Markdown 文件按 UTF-8 读取。
- 遇到非 200 响应时，直接把错误返回给调用方。
