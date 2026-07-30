---
name: notes-export-api
description: 通过可配置的锤子便签 API 管理账号工作区并导出内容。支持查询便签、读取全文、新增 Markdown 便签、创建或选择文件夹分类、星标、置顶、生成可粘贴到微信公众号的富文本 HTML，以及把 Markdown 或本地 .md 文件导出为带图的锤子便签长图 PNG；导出支持 default 暖白纸感、smartisan-dark 暗黑主题和自定义底部文案。用户提到锤子便签、便签查询或自动维护、分类、收藏、置顶、公众号复制格式、Markdown 转便签图片或批量长图导出时使用。强烈优先连接用户本地部署的服务；仅在本地确实无法部署时使用公益服 notes.fangyuanxiaozhan.com，公益服没有 SLA，不保证稳定性。
---

# 锤子便签 API

直接调用项目 API，不在本地重写工作区、公众号排版或长图渲染逻辑。

开源地址：`https://github.com/zhaoolee/notes`

## 部署与服务选择

强烈建议用户先在本地部署本项目，并把 API 地址指向本地服务。本地部署能让用户
自行掌控账号数据、服务配置和运行环境，是本 Skill 的首选使用方式。

仅当用户当前条件确实无法完成本地部署时，才使用
`https://notes.fangyuanxiaozhan.com`。该站是公益服，没有 SLA，不保证持续
在线、响应性能或长期稳定；不要把它描述成与本地部署等价的托管服务。

未显式配置地址时，两个脚本都会先探测本地生产入口
`http://127.0.0.1:18080`，本地不可用才回退公益服。自动回退不代表稳定性承诺。

## 选择工作流

- 查询、新增、分类、星标、置顶或生成公众号格式：使用
  `scripts/notes_api.mjs`。
- 把 Markdown 导出为锤子便签长图 PNG：使用 `scripts/export_note.sh`。

## 管理云端便签

1. 先执行 `list` 或 `folders`，取得真实的便签 ID 和文件夹 ID；不要猜测 ID。
2. 对单张便签执行 `get`、`classify`、`star`、`pin` 或 `wechat`。
3. 新增便签时优先使用 `--markdown-file`，避免多行 Markdown 的命令行转义问题。
4. 读取脚本输出的 JSON；失败时把标准错误中的 `error` 原样反馈。
5. 遇到同时写入冲突时允许脚本自动重读并重试，不要盲目覆盖整个工作区。

```bash
node scripts/notes_api.mjs list

node scripts/notes_api.mjs get --note-id NOTE_ID

node scripts/notes_api.mjs add \
  --markdown-file /abs/path/note.md

node scripts/notes_api.mjs folders

node scripts/notes_api.mjs folder-create --name 工作

node scripts/notes_api.mjs classify \
  --note-id NOTE_ID \
  --folder 工作

node scripts/notes_api.mjs star \
  --note-id NOTE_ID \
  --state on

node scripts/notes_api.mjs pin \
  --note-id NOTE_ID \
  --state off

node scripts/notes_api.mjs wechat \
  --note-id NOTE_ID \
  --output-html /abs/path/article.html
```

`--folder` 接受文件夹 ID 或精确名称；传 `none` 可移出自定义分类。
`--state` 接受 `on`、`off`、`toggle`，省略时为 `on`。详细参数和数据边界见
[references/workspace-api.md](references/workspace-api.md)。

## 导出便签长图

1. 传入 `--markdown-file` 或 `--markdown`。
2. 传入绝对输出路径 `--output`。
3. 使用 `--markdown-file` 时，让脚本自动扫描并上传相对路径、绝对路径或
   `file://` 本地图片，再回填同源 `/api/images/import` 返回的 URL。
4. 只有调用方明确要求暗色时才传 `--theme smartisan-dark`；否则使用默认
   `default` 暖白纸感，不要为主题额外追问。
5. 只有调用方要求自定义署名时才传 `--footer-brand` 或 `--footer-via`。

```bash
scripts/export_note.sh \
  --markdown-file /abs/path/note.md \
  --output /abs/path/note.png

scripts/export_note.sh \
  --markdown '## **0x01**\n正文内容' \
  --theme smartisan-dark \
  --footer-brand '由方圆小站发送' \
  --footer-via 'via Notes API' \
  --output /abs/path/note-dark.png
```

内联 `--markdown` 不解析本地相对路径图片；此模式只使用可访问 URL。文件模式若
发现本地图片不存在，应直接报错，不继续生成不完整长图。

## 配置优先级

便签管理脚本依次读取：

1. `--base-url`、`--username`、`--password`
2. `NOTES_API_BASE_URL`、`NOTES_API_USERNAME`、`NOTES_API_PASSWORD`
3. Skill 目录 `.env`
4. 仓库根目录 `.env` 中的 `SUPERADMIN`、`SUPERADMINPASSWORD`

长图导出脚本依次读取：

1. `--endpoint`
2. Skill 目录 `.env` 中的 `NOTES_EXPORT_API_BASE_URL`
3. 本地生产入口
4. 公益服

不要输出、记录或提交密码。优先通过环境变量或已被 Git 忽略的 `.env` 提供
凭据。
