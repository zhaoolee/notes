# 工作区 API 与命令参考

## 服务配置

- 便签管理与长图导出统一使用 `NOTES_API_BASE_URL` 或 `--base-url`。
- 地址填写服务基础地址，不附加 `/api`，例如
  `NOTES_API_BASE_URL=http://127.0.0.1:18080`；使用自有域名时可写为
  `NOTES_API_BASE_URL=https://notes.example.com`。
- 指定 `--env-file` 时，文件中的 `NOTES_API_*` 优先于进程环境变量；命令行
  `--base-url/--token/--username/--password` 仍具有最高优先级。
- 单人部署可把项目 `.env` 中 `SUPERADMIN`、`SUPERADMINPASSWORD` 的实际值复制为
  `NOTES_API_USERNAME`、`NOTES_API_PASSWORD`；`.env` 变量引用不会被展开。
- 没有服务地址时脚本直接报错；不探测本地端口，也不回退公网服务。

## 认证和数据边界

- `NOTES_API_TOKEN` 或 `--token` 存在时，脚本直接使用 Bearer Token，不读取账号
  密码。
- Token 缺失时，`POST /api/auth/skill-token` 使用普通用户或超级管理员的用户名/
  邮箱和密码申请稳定的账号 Token。成功后脚本原子更新目标 `.env`，移除
  `NOTES_API_USERNAME` 和 `NOTES_API_PASSWORD`，并把文件权限设为 `0600`。
- `GET /api/workspace` 读取当前账号自己的完整工作区。
- `PUT /api/workspace` 保存工作区；Skill 同时提交 `expectedUpdatedAt`，服务端在版本
  变化时返回 HTTP 409，脚本会重新读取并最多重试 4 次。
- 服务端不接受用户 ID 参数，普通用户和超级管理员的数据都由登录会话隔离。

## 命令

| 命令 | 必需参数 | 可选参数 | 结果 |
| --- | --- | --- | --- |
| `list` | 无 | `--category`、`--query`、`--limit`、`--offset`、`--include-markdown` | 便签摘要列表 |
| `get` | `--note-id` | 无 | 单张便签全文 |
| `add` | `--markdown` 或 `--markdown-file` | `--folder`、`--starred`、`--pinned` | 新便签 |
| `update` | `--note-id`，以及 `--markdown` 或 `--markdown-file` | 无 | 更新便签 Markdown，保留 ID、创建时间和其他属性 |
| `delete` | `--note-id` | `--permanent` | 默认移入回收站；显式永久删除回收站便签 |
| `restore` | `--note-id` | 无 | 从回收站恢复便签 |
| `folders` | 无 | 无 | 文件夹与便签数量 |
| `folder-create` | `--name` | 无 | 新建或已存在的文件夹 |
| `classify` | `--note-id`、`--folder` | 无 | 更新后的便签 |
| `star` | `--note-id` | `--state on|off|toggle` | 更新后的便签 |
| `pin` | `--note-id` | `--state on|off|toggle` | 更新后的便签 |

`list --category` 接受 `all`、`starred`、`trash`、`folder:<id>`、文件夹 ID 或
文件夹精确名称。默认 `all`，默认最多返回 50 条，最大 500 条。

## 模型映射

项目没有独立标签数组。“分类”使用现有 `folderId` 文件夹模型：

- `folderId: null`：未放入自定义文件夹。
- `isStarred: true`：加星。
- `pinnedAt` 为时间戳：置顶；值越新越靠前。
- `deletedAt` 为时间戳：位于回收站，不能分类、加星或置顶。

`update` 只替换目标便签 Markdown 并刷新其 `updatedAt`。普通 `delete` 保留 Markdown、
分类和星标，只设置 `deletedAt` 并取消置顶；`restore` 保留原内容且不会自动重新置顶。
永久删除只接受已经位于回收站的便签。脚本始终保留工作区及其他便签的全部未知
字段；删除最后一张正常便签时会创建一个空白便签，保持工作区可继续编辑。
