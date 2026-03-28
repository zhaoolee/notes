---
name: notes-export-api
description: 通过可配置的 notes-export-api 导出接口，把 Markdown 内容导出为锤子便签风格的长图 PNG。默认走 `https://notes.fangyuanxiaozhan.com/api/export`；如果存在 `.env`，则读取其中的 `NOTES_EXPORT_API_BASE_URL`，可切到本地 `http://127.0.0.1:15713`。支持 `default` 暖白纸感和 `smartisan-dark` 锤子暗黑两种主题；如果调用方没有主动声明主题，默认使用 `default`，不要强制用户选择。若本地 Markdown 文件里包含相对路径或绝对路径图片，脚本会先调用同源后端的 `/api/images/import` 上传图片并回填 URL，再调用导出接口生成带图便签。用户提到“便签导出”“锤子便签”、Markdown 转图片、把本地 .md 文件渲染成便签长图、或需要用脚本批量导出便签图片时使用。
---

# 便签导出 API

直接调用导出 API 做便签导出，不在本地重写渲染逻辑。

## 工作流

1. 使用 `scripts/export_note.sh`。
2. 传入 `--markdown-file` 或 `--markdown`。
3. 若使用 `--markdown-file`，脚本会自动扫描 Markdown 内的本地图片引用：
   - `![alt](./image.png)`
   - `![alt](../assets/demo.jpg "title")`
   - `<img src="./image.png" />`
4. 对本地图片调用同源后端 `/api/images/import` 获取 URL，并把 Markdown 中的图片路径替换成可访问 URL。
5. 再把替换后的 Markdown 提交到 `/api/export`。
6. 传入 `--output`。
7. 只有在调用方明确指定主题时才传 `--theme`；否则直接使用默认的 `default`（暖白纸感），不要为了主题再追问用户。
8. 默认使用 `https://notes.fangyuanxiaozhan.com/api/export`。
9. 若需切换导出服务地址，可在仓库根目录 `.env` 或 `skills/notes-export-api/.env` 中设置：

```bash
NOTES_EXPORT_API_BASE_URL=https://notes.fangyuanxiaozhan.com
# 或本地调试
NOTES_EXPORT_API_BASE_URL=http://127.0.0.1:15713
```

## 主题约定

- `default`: 暖白纸感。默认主题；调用方未声明时使用它。
- `smartisan-dark`: 锤子暗黑。仅在调用方明确要求暗色或暗黑主题时使用。

## 脚本用法

```bash
skills/notes-export-api/scripts/export_note.sh \
  --markdown-file /abs/path/to/note.md \
  --output /abs/path/to/note.png
```

如果 `note.md` 中包含本地图片，例如：

```md
## **0x01**

配图如下：

![示意图](./images/demo.png)
```

脚本会先上传 `./images/demo.png`，再把 Markdown 中的图片链接替换成后端返回的 URL，最后导出 PNG。

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
- `--markdown-file` 模式会自动处理本地图片；`--markdown` 内联文本模式不会解析相对路径图片，内联模式下请直接传可访问 URL。
- `--theme` 是可选参数；不传时默认使用 `default`。
- 默认总是走 `https://notes.fangyuanxiaozhan.com/api/export`；只有检测到 `.env` 且其中设置了 `NOTES_EXPORT_API_BASE_URL`，才会改用该地址。
- 命令行 `--endpoint` 优先级仍然最高。
- 若 `.env` 提供的是站点根地址，脚本会自动补上 `/api/export`。
- 图片导入接口会从同一个后端地址推导得到：若导出地址是 `/api/export`，图片导入地址会自动改为 `/api/images/import`。
- 本地图片路径支持相对 `Markdown` 文件的相对路径、绝对路径，以及 `file://` 路径。
- 若 Markdown 中引用的本地图片不存在，脚本会直接报错并停止导出。
- 遇到非 200 响应时，直接把错误返回给调用方。
