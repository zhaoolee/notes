# 工作区 API 与命令参考

## 服务选择

- 强烈优先使用用户自行部署的本地服务，并显式设置 `NOTES_API_BASE_URL`。
- 只有本地无法部署时才使用 `https://notes.fangyuanxiaozhan.com`。
- `notes.fangyuanxiaozhan.com` 是公益服，没有 SLA，不保证持续在线、响应性能或
  稳定性。

## 认证和数据边界

- `POST /api/auth/login` 使用普通用户或超级管理员凭据，并返回 HttpOnly 会话。
- `GET /api/workspace` 读取当前账号自己的完整工作区。
- `PUT /api/workspace` 保存工作区；Skill 同时提交 `expectedUpdatedAt`，服务端在版本
  变化时返回 HTTP 409，脚本会重新读取并最多重试 4 次。
- `POST /api/wechat` 接收指定便签的 Markdown，返回公众号富文本 `html` 和图片已
  替换后的 `markdown`。
- 服务端不接受用户 ID 参数，普通用户和超级管理员的数据都由登录会话隔离。

## 命令

| 命令 | 必需参数 | 可选参数 | 结果 |
| --- | --- | --- | --- |
| `list` | 无 | `--category`、`--query`、`--limit`、`--offset`、`--include-markdown` | 便签摘要列表 |
| `get` | `--note-id` | 无 | 单张便签全文 |
| `add` | `--markdown` 或 `--markdown-file` | `--folder`、`--starred`、`--pinned` | 新便签 |
| `folders` | 无 | 无 | 文件夹与便签数量 |
| `folder-create` | `--name` | 无 | 新建或已存在的文件夹 |
| `classify` | `--note-id`、`--folder` | 无 | 更新后的便签 |
| `star` | `--note-id` | `--state on|off|toggle` | 更新后的便签 |
| `pin` | `--note-id` | `--state on|off|toggle` | 更新后的便签 |
| `wechat` | `--note-id` | `--output-html`、`--output-markdown` | 公众号 HTML 与图片信息 |

`list --category` 接受 `all`、`starred`、`trash`、`folder:<id>`、文件夹 ID 或
文件夹精确名称。默认 `all`，默认最多返回 50 条，最大 500 条。

## 模型映射

项目没有独立标签数组。“分类”使用现有 `folderId` 文件夹模型：

- `folderId: null`：未放入自定义文件夹。
- `isStarred: true`：加星。
- `pinnedAt` 为时间戳：置顶；值越新越靠前。
- `deletedAt` 为时间戳：位于回收站，不能分类、加星或置顶。

脚本只修改目标字段，并保留工作区及其他便签的全部未知字段。
