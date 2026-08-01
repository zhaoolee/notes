---
name: notes-workspace-api
description: 连接明确配置的锤子便签服务，查询和维护当前账号的云端工作区。支持便签列表、全文查询、新增、更新、软删除、恢复、显式永久删除、文件夹分类、星标和置顶；用户提到用 Hermes 或 AI 管理锤子便签、查找便签、写入 Markdown、整理分类、收藏、置顶或处理回收站时使用。优先使用 NOTES_API_TOKEN；仅在 Token 缺失时用用户名和密码自动申请 Token 并安全更新 .env。
---

# 锤子便签工作区 API

通过服务端 API 管理登录账号自己的云端便签，不在本地维护另一份工作区。

## 配置认证

要求调用方明确提供 `NOTES_API_BASE_URL`。优先从 Skill 目录 `.env` 读取：

```dotenv
NOTES_API_BASE_URL=https://notes.example.com
NOTES_API_TOKEN=notes_sk_v1.xxx
```

如果没有 Token，可在首次运行前临时配置：

```dotenv
NOTES_API_BASE_URL=https://notes.example.com
NOTES_API_USERNAME=your-account
NOTES_API_PASSWORD=your-password
```

脚本会向同源 `/api/auth/skill-token` 申请 Token，原子更新 `.env`，并移除用户名和
密码。Token 已存在时不得回退到账号密码；Token 失效时先告知用户删除或更换旧
Token，不要静默重新授权。不要输出、记录或提交任何凭据。

## 执行命令

从 Skill 目录运行脚本。Hermes 中使用 `${HERMES_SKILL_DIR}`：

```bash
node ${HERMES_SKILL_DIR}/scripts/notes_api.mjs list
node ${HERMES_SKILL_DIR}/scripts/notes_api.mjs list --query 关键词
node ${HERMES_SKILL_DIR}/scripts/notes_api.mjs get --note-id NOTE_ID
node ${HERMES_SKILL_DIR}/scripts/notes_api.mjs add --markdown-file /abs/note.md
node ${HERMES_SKILL_DIR}/scripts/notes_api.mjs update --note-id NOTE_ID --markdown-file /abs/note.md
node ${HERMES_SKILL_DIR}/scripts/notes_api.mjs delete --note-id NOTE_ID
node ${HERMES_SKILL_DIR}/scripts/notes_api.mjs restore --note-id NOTE_ID
node ${HERMES_SKILL_DIR}/scripts/notes_api.mjs folders
node ${HERMES_SKILL_DIR}/scripts/notes_api.mjs folder-create --name 工作
node ${HERMES_SKILL_DIR}/scripts/notes_api.mjs classify --note-id NOTE_ID --folder 工作
node ${HERMES_SKILL_DIR}/scripts/notes_api.mjs star --note-id NOTE_ID --state on
node ${HERMES_SKILL_DIR}/scripts/notes_api.mjs pin --note-id NOTE_ID --state on
```

先执行 `list`、`get` 或 `folders` 取得真实 ID，不要猜测。新增或更新优先使用
`--markdown-file`。普通 `delete` 只移入回收站；仅在用户明确要求不可恢复删除时，
才对回收站便签执行 `delete --permanent`。

## 保持并发安全

写操作会提交服务端返回的 `expectedUpdatedAt`。遇到 HTTP 409 时让脚本自动重读并
最多重试四次，不要手工覆盖整个工作区。

需要完整参数、分类模型或数据边界时读取
[references/workspace-api.md](references/workspace-api.md)。
