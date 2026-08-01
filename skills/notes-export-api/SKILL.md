---
name: notes-export-api
description: 通过用户名或邮箱与密码连接调用方明确配置的锤子便签服务，管理当前账号的云端工作区并导出内容。支持便签列表与全文查询、新增、更新 Markdown、软删除、回收站恢复、显式永久删除、文件夹分类、星标、置顶、生成可粘贴到微信公众号的富文本 HTML，以及把 Markdown 或本地 .md 文件导出为带图的锤子便签长图 PNG；导出支持 default 暖白纸感、smartisan-dark 暗黑主题和自定义底部文案。用户提到锤子便签、用账号密码增删改查便签、便签查询或自动维护、分类、收藏、置顶、公众号复制格式、Markdown 转便签图片或批量长图导出时使用。服务地址没有默认值，调用方必须通过 .env 或命令行明确提供。
---

# 锤子便签 API

直接调用项目 API，不在本地重写工作区、公众号排版或长图渲染逻辑。

开源地址：`https://github.com/zhaoolee/notes`

## 配置服务

便签管理和长图导出统一使用同一个服务基础地址。推荐写入调用方自己保管、未提交
到版本库的 `.env`：

```dotenv
NOTES_API_BASE_URL=https://notes.fangyuanxiaozhan.com
NOTES_API_USERNAME=your-account
NOTES_API_PASSWORD=your-password
```

单人部署时，把项目根目录 `.env` 中 `SUPERADMIN` 和 `SUPERADMINPASSWORD` 的实际值
分别复制到 `NOTES_API_USERNAME` 和 `NOTES_API_PASSWORD`；不要写成变量引用。
普通多用户部署则填写目标普通用户的用户名/邮箱和密码。

两个脚本都可以读取该文件：

```bash
node scripts/notes_api.mjs list --env-file /abs/path/notes-api.env
scripts/export_note.sh \
  --env-file /abs/path/notes-api.env \
  --markdown '正文' \
  --output /abs/path/note.png
```

没有 `.env` 时，给命令显式传入同名参数：

```bash
node scripts/notes_api.mjs list \
  --base-url https://notes.fangyuanxiaozhan.com \
  --username your-account \
  --password your-password

scripts/export_note.sh \
  --base-url https://notes.fangyuanxiaozhan.com \
  --markdown '正文' \
  --output /abs/path/note.png
```

如果 `.env` 和命令行都没有服务地址，停止执行并请调用方补充；不得自动探测本地
端口，也不得回退到任何公网服务。

## 选择工作流

- 查询、新增、分类、星标、置顶或生成公众号格式：使用
  `scripts/notes_api.mjs`。
- 把 Markdown 导出为锤子便签长图 PNG：使用 `scripts/export_note.sh`。

## 管理云端便签

1. 用 `NOTES_API_USERNAME` 和 `NOTES_API_PASSWORD` 提供账号凭据；账号可以是用户名
   或邮箱。也可显式传 `--username` 和 `--password`，但优先用环境变量或
   `--env-file`，避免密码进入 shell 历史和进程列表。
2. 先执行 `list` 或 `folders`，取得真实的便签 ID 和文件夹 ID；不要猜测 ID。
3. 对单张便签执行 `get`、`update`、`delete`、`restore`、`classify`、`star`、
   `pin` 或 `wechat`。
4. 新增或更新便签时优先使用 `--markdown-file`，避免多行 Markdown 的命令行转义
   问题。
5. 普通 `delete` 只移入回收站。仅在调用方明确要求不可恢复地删除时，才对回收站
   便签再次执行 `delete --permanent`。
6. 读取脚本输出的 JSON；失败时把标准错误中的 `error` 原样反馈。
7. 遇到同时写入冲突时允许脚本自动重读并重试，不要盲目覆盖整个工作区。

```bash
export NOTES_API_BASE_URL=http://127.0.0.1:18080
export NOTES_API_USERNAME=your-account
export NOTES_API_PASSWORD=your-password

node scripts/notes_api.mjs list

node scripts/notes_api.mjs list --category trash

node scripts/notes_api.mjs get --note-id NOTE_ID

node scripts/notes_api.mjs add \
  --markdown-file /abs/path/note.md

node scripts/notes_api.mjs update \
  --note-id NOTE_ID \
  --markdown-file /abs/path/note.md

node scripts/notes_api.mjs delete --note-id NOTE_ID

node scripts/notes_api.mjs restore --note-id NOTE_ID

node scripts/notes_api.mjs delete \
  --note-id NOTE_ID \
  --permanent

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

Hermes 使用本 Skill 时，终端后端必须能看到 Skill 脚本和配置文件。`local` 后端可
直接使用本机路径；SSH、Docker 等隔离后端需要先把 Skill 与 env 文件同步到对应
执行环境，并使用该环境中的路径。不要假定 Hermes 会把宿主机环境变量自动转发到
远程终端。

## 导出便签长图

1. 使用与便签管理相同的 `NOTES_API_BASE_URL` 或 `--base-url`。
2. 传入 `--markdown-file` 或 `--markdown`。
3. 传入绝对输出路径 `--output`。
4. 使用 `--markdown-file` 时，让脚本自动扫描并上传相对路径、绝对路径或
   `file://` 本地图片，再回填同源 `/api/images/import` 返回的 URL。
5. 只有调用方明确要求暗色时才传 `--theme smartisan-dark`；否则使用默认
   `default` 暖白纸感，不要为主题额外追问。
6. 只有调用方要求自定义署名时才传 `--footer-brand` 或 `--footer-via`。

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

## 配置规则

- 两个脚本统一使用 `NOTES_API_BASE_URL`、`--base-url` 和 `--env-file`。
- 命令行参数覆盖 `.env`；显式 `--env-file` 优先于调用进程和 Skill 目录 `.env`。
- 管理命令额外读取 `NOTES_API_USERNAME`、`NOTES_API_PASSWORD`，或对应的
  `--username`、`--password`。
- 服务地址或管理凭据缺失时直接报错，让调用方补充，不猜测默认值。

不要输出、记录或提交密码。优先通过环境变量或已被 Git 忽略的 `.env` 提供
凭据。
