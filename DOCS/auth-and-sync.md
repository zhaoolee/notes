# 账号、管理员与云同步

## 角色与入口

- 匿名用户：无需登录即可查看默认模板和编辑便签，工作区仅保存在当前浏览器。
- 普通用户：由管理员使用用户名或邮箱创建，登录后使用独立的服务端工作区并跨
  设备同步。
- 超级管理员：使用服务端 `.env` 中的 `SUPERADMIN`、
  `SUPERADMINPASSWORD` 登录；既可访问 `/superadmin` 创建、查看和重置普通用户
  密码，也可从便签首页登录并使用独立的云端工作区和其他登录用户能力。

桌面端在分类栏左下角原“下载锤子便签 APP”的位置提供登录入口；手机端只在设置
页的“账号与同步”入口打开同一个登录弹窗，不在手机顶栏或分类浮窗重复显示。
账号框同时接受用户名和邮箱，邮箱匹配大小写不敏感；表单使用标准
`username` / `current-password` 自动填充语义，允许浏览器
密码管理器保存凭据。登录弹窗只保留账号密码登录，不展示未实现的短信验证码入口；
密码框右侧的小眼睛可在隐藏和明文显示之间切换。“记住密码”
实际控制签名登录会话是否持久化：未勾选时是会话 Cookie，勾选时有效期为 30 天；
前端不会把明文密码写入 localStorage。

## 服务端配置

```dotenv
SUPERADMIN=
SUPERADMINPASSWORD=
SESSION_SECRET=
NOTES_PUBLIC_BASE_URL=https://notes.example.com
ANONYMOUS_DAILY_UPLOAD_LIMIT=500
```

这些变量只能由 Express 读取，不得添加 `VITE_` 前缀。生产环境必须使用部署平台
Secret 注入，并为 `SESSION_SECRET` 配置独立的高熵随机值。未配置
`SESSION_SECRET` 时，服务端会以管理员凭据派生会话密钥；若管理员凭据也不存在，
会话密钥只在当前进程生命周期内有效。`NOTES_PUBLIC_BASE_URL` 可选，用于反向代理
无法传递正确公开协议或域名时，指定写入 Hermes Skill `.env` 的服务地址。

微信公众号 AppID 与 AppSecret 不属于启动环境变量。任一普通用户或超级管理员从
便签首页登录后，都可在“设置 → 工具与扩展 → 公众号配置”中填写并保存自己的配置；
服务端通过 `GET/PUT /api/wechat/config` 按签名会话中的账号 ID 读写
`notes-data.json`，请求体不接受 ownerId，账号间严格隔离，匿名访问不能读取或修改。
为满足设置页重新打开后的完整回显，GET 响应会把该账号真实 AppSecret 返回，因此
接口和前端请求都使用 `no-store`，页面默认以密码输入框遮挡，并提供显式显示/隐藏
操作。公众号接口只使用当前登录账号的持久化配置，不读取 `AppID`、`AppSecret`
环境变量，也不做 `.env` 回退。

保存配置后，服务端会用该账号的值向微信取得接口调用凭据，并在设置页展示“连接正常”
或脱敏后的失败原因。分享面板每次打开都会通过 `GET /api/wechat/status` 检查当前会话；
只有已配置且连通的账号才显示“发布为公众号草稿”。`POST /api/wechat/draft` 同样重新
按当前会话账号 ID 取配置，不接收 ownerId，也不允许匿名或跨站调用。浏览器提交的
只有当前便签 Markdown、主题和署名偏好，AppSecret 与微信 access token 始终留在
服务端；access token 仅按配置哈希在进程内短期缓存。

普通用户名为 3–32 个中英文、数字、点、下划线或连字符；邮箱最长 254 个字符。
普通用户初始密码由服务端使用加密安全随机数生成，只在创建响应中显示一次。持久
化文件只包含 scrypt 盐和哈希，不包含管理员密码、普通用户初始密码或会话令牌。

## 密码管理

- 普通用户可从桌面账号菜单或手机设置页进入“修改密码”，提交当前密码以及两次
  一致的 8–128 字符新密码。修改成功后当前设备续签会话，其他设备的旧会话失效。
- 管理员用户列表不返回密码、盐或哈希，也不提供查看现有密码的能力。管理员只能
  二次确认后执行重置；服务端生成 16 位临时密码并只在该次响应中返回一次，原密码
  和该用户现有会话立即失效。
- 每个普通账号保存递增的 `passwordVersion`。普通用户会话包含签发时的版本号，
  受保护 API 会同时校验账号 ID、用户名和密码版本；旧数据缺少该字段时按版本 1
  兼容读取。
- 每个普通账号同时保存 `skillTokenVersion`。普通用户修改密码或管理员重置密码时，
  `passwordVersion` 与 `skillTokenVersion` 一起递增，使此前下载或生成的 Skill
  Token 立即失效。

## Skill Token 与 Hermes 下载

设置浮窗的“工具与扩展”类别提供 Hermes Skill：匿名用户看到登录引导，登录用户
点击下载后调用 `POST /api/hermes-skill/download`，返回根目录为
`notes-workspace-api/` 的 ZIP；包内 `.env` 已写入服务端公开基础地址和当前账号的
`NOTES_API_TOKEN`，解压到 `~/.hermes/skills/` 后可直接使用。

同一区域提供安装指令右上角的“复制”和底部“重置链接”。“复制”会生成一条可直接
发送给 Hermes 的完整安装指令，包含专属 ZIP 地址、安装目录、读取 `SKILL.md` 和
不得回显链接或 `.env` 凭据的要求；底部只保留包下载和链接重置。网页用登录 Cookie 调用
`POST /api/hermes-skill/install-link` 获取当前账号的安装地址：首次调用创建地址，
之后重复复制始终返回同一个地址，不会暗中轮换。Hermes Agent 无需 Cookie 即可
多次 GET 该地址，因此同一个链接可用于多台电脑。只有用户主动调用
`POST /api/hermes-skill/install-link/reset`，或修改、重置账号密码时，旧地址才会
失效。点击“重置链接”后必须先在危险操作确认框中明确确认，确认框会提示旧链接
立即失效；取消确认不得调用重置接口。已经下载并安装的 Skill 不受链接重置影响。

安装地址仅包含随机票据，不包含长期 `NOTES_API_TOKEN`。当前票据保存在权限为
`0600` 的 `notes-data.json` 中，因此服务重启后复制仍得到同一链接；链接本身仍是
敏感凭据，不应公开发布。下载时服务端才根据当前账号版本生成 ZIP 内的 Token。

Skill Token 由账号 ID、用户名、密码版本、Skill Token 版本和 `SESSION_SECRET`
签名生成。同一账号在版本不变时重复申请得到同一个 Token；服务端不保存 Token
明文。普通用户改密或重置、超级管理员凭据变化、`SESSION_SECRET` 轮换都会使旧
Token 失效。

`GET/PUT /api/workspace` 同时接受网页登录 Cookie 和
`Authorization: Bearer <NOTES_API_TOKEN>`；`POST /api/wechat` 也用它识别长期图片
上传账号。Bearer Token 不会被 `GET /api/auth/session` 识别为网页登录，也不能
调用修改密码、用户管理或 AI 接口。
`POST /api/auth/skill-token` 无 Token 时可接收一次性的用户名/邮箱和密码；两个
仓库 Skill 成功申请后会原子更新目标 `.env`、移除账号密码并设置 `0600` 权限。
如果 `.env` 不可写，本次命令继续使用内存中的 Token，但不会在终端输出 Token。

## 数据边界

服务端文件默认是 `storage/data/notes-data.json`，包含账号、工作区、匿名额度、
当前 Hermes 安装票据与公众号 AppID/AppSecret，权限为 `0600`，写入流程为：

1. 在进程内串行执行修改。
2. 把完整新状态写入同目录临时文件。
3. 用原子重命名替换正式文件。

工作区以签名会话中的账号 ID 为键：普通用户使用不可猜测的 UUID，超级管理员
使用服务端保留的固定 ID `superadmin`。`GET/PUT /api/workspace` 不接受请求体
传入用户 ID，因此任何登录账号都无法选择或覆盖其他账号的工作区。

当前实现面向单后端写入实例。Compose 已持久化挂载 `storage/data`；多副本部署前
应迁移到数据库，避免不同实例同时改写同一个 JSON 文件。

## 登录与首次同步

页面启动后先读取 `/api/auth/session`：

- 无登录会话：继续读写原来的浏览器本地工作区。
- 有普通用户或超级管理员会话且云端已有数据：云端工作区覆盖当前页面状态。
- 有登录会话但云端为空：把当前浏览器工作区作为该账号的初始云端工作区。

普通用户和超级管理员登录后的便签、文件夹或排序变更会延迟 650ms 写入各自云端
工作区；单纯切换当前便签只改变本机界面状态，不触发云端保存。没有待保存变更时，
每 15 秒读取一次云端版本。较新的 `updatedAt` 会替换便签和文件夹数据，但只要本机
当前便签 ID 在新工作区中仍然存在，就继续选中同一篇；因此另一端改变排序时，选中
状态会随该便签移动而不是停留在原列表位置。当前便签已不存在时才回退到云端工作区
中的有效当前便签或第一篇。数据冲突策略仍为服务端时间戳驱动的最后写入者优先，
不提供逐便签合并。

`skills/notes-export-api` 与 `skills/notes-workspace-api` 的工作区写操作会额外把
读取到的时间戳作为 `expectedUpdatedAt` 提交。服务端在原子写入队列中发现版本已
变化时返回 HTTP 409，Skill 重新读取最新工作区并再次应用目标便签的分类、星标、
置顶或新增操作。
这可以防止 API 自动化静默覆盖并发保存，但不会改变尚未使用条件写入的网页端
“最后写入者优先”策略。

退出登录前会尝试立即保存当前云端工作区，随后清除 HttpOnly Cookie，并恢复登录
前保存在浏览器中的匿名工作区。

## 匿名七牛额度

匿名用户调用 `/api/wechat` 时，服务端先按图片二进制内容去重，再为需要上传的
唯一图片预留全站共享额度：

- 默认全站每天 500 张。
- 日期和重置边界使用 UTC+8，北京时间 0 点自动进入新日期。
- 超额返回 HTTP 429，提示联系 `zhaoolee@gmail.com` 注册。
- 对象前缀为 `<QINIU_PREFIX>/temporary/YYYY-MM-DD/`。
- 七牛上传策略设置 `deleteAfterDays: 1`，由七牛生命周期自动清理。

已经指向当前七牛域名的图片直接复用，不产生新上传和额度消耗。普通用户和超级
管理员等已登录用户都使用长期对象前缀，不执行匿名额度检查。

## 反馈测试

- `backend/tests/auth-feedback.test.ts`：管理员可从管理入口和普通便签入口登录、
  管理员独立云工作区、用户名与邮箱建号、邮箱大小写不敏感登录、普通用户改密、
  管理员重置、密码不出现在用户列表和持久化明文中、旧会话失效，以及各账号的
  工作区隔离。
- `backend/tests/quota-feedback.test.ts`：500 张共享额度、超额提示和北京时间
  0 点重置。
- `backend/tests/api-feedback.test.ts`：匿名临时上传策略，以及普通用户和超级
  管理员的长期上传、无限额分支。
- `backend/tests/notes-export-api-skill-feedback.test.ts`：通过真实 Skill
  命令和显式账号密码验证便签增删改查、软删除、恢复、永久删除、文件夹分类、
  星标、置顶、公众号 HTML，以及过期 `expectedUpdatedAt` 返回 409。
- `backend/tests/skill-token-feedback.test.ts`：验证账号密码首次换取 Token、稳定
  Token、Bearer 工作区隔离、改密失效、`.env` 原子清理，以及网页登录下载的
  Hermes ZIP 内容。
- `frontend/tests/auth-ui.test.ts`：单一账号密码登录、浏览器密码管理语义、普通
  用户修改密码表单、管理员重置入口、管理员路由与云同步入口。
- `frontend/tests/settings-panel.test.ts` 与 `backend/tests/auth-feedback.test.ts`：
  登录账号公众号配置入口、AppSecret 完整回显、格式校验、`no-store`、账号隔离、
  匿名拒绝、持久化，以及 `.env` 中同名值不参与配置回退。
