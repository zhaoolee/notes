# Hugo 一键发布到 GitHub Pages

## 用户流程

在“发布为网站”面板选择便签，点击“授权 GitHub 仓库”，在 GitHub 安装本部署的 GitHub App，并选择允许访问的仓库。回到 Notes 后选择发布仓库，点击面板固定底部的“发布到 GitHub Pages”（位于“生成网站 ZIP”之前）。授权、仓库选择与发布进度仍显示在默认折叠的 GitHub Pages 卡片（展开后可查看和操作）；普通用户无需申请、复制或粘贴 GitHub Token。

Notes 服务器使用已有的 Hugo 构建器和模板，把所选便签、Logo、图片、字体和搜索索引构建成完整网站，仅提交构建后的 `public/` 文件。原有“生成网站 ZIP”继续可用，与发布按钮同处面板固定底部。发布设置和便签选择仍按 Notes 账号保存。每次使用点击发布时的便签快照，发布过程中继续编辑的内容需要下一次发布才会更新。

首次发布会建立独立的 `gh-pages` 分支，并为 GitHub Pages 配置“Deploy from a branch → gh-pages → / (root)”。之后新增、修改和取消发布的便签一起增量更新。页面分别显示排队、构建、上传、提交、等待 Pages 和已发布；只有 Pages 构建的 commit SHA 与本次提交一致且状态为 `built` 才显示已上线。关闭面板不取消服务器发布任务，重新打开会恢复最新状态；网络异常可点击刷新发布状态。

仓库必须已有至少一个分支，例如创建仓库时勾选 README。GitHub 的 Git Refs API 无法为完全空的仓库创建首个引用；Notes 会明确提示初始化，不会为此写入主分支。默认分支为 `gh-pages` 的仓库不能用作发布目标。

仓库已有使用 Actions 或其他分支的 Pages 站点时，服务会停止并说明原因，不会自动切换已有站点的发布来源。可选择独立的博客仓库。没有 Notes 发布清单时，目标目录中的同名文件也不会直接被覆盖；可使用空子目录。仓库的主分支始终只读，不提交 Hugo 源码、工作流或构建产物到主分支。

## 管理员配置 GitHub App

每个 Notes 服务部署配置一个 GitHub App，用户安装这个 App 后才能授权仓库。当前实现对接 github.com；暂不支持 GitHub Enterprise 的自定义 API 域名。

1. 在 GitHub Settings → Developer settings → GitHub Apps 注册 App，记录 App ID、Slug、Client ID，生成 Client Secret 和 RSA 私钥。
2. Callback URL 和 Setup URL 都填写 `https://你的notes域名/api/site-publishing/github/callback`。启用“安装更新后重定向到 Setup URL”。**不要勾选 Request user authorization (OAuth) during installation**：安装回调后由 Notes 使用独立的 state 与 PKCE 发起 OAuth。Callback URL 不能附带查询参数。
3. Repository permissions 只需 **Contents: Read and write、Pages: Read and write、Administration: Read and write**，Metadata 为默认只读。Administration 用于首次自动开启 Pages，GitHub 要求该权限与 Pages 写权限同时具备；不需要 Actions、Workflows 写权限，不需要 GitHub 账号密码或 PAT。允许账号级安装，并根据部署用途选择 App 可被哪些账号安装。
4. 在服务端设置以下环境变量；密钥只配置在服务器，不进入前端构建变量、不写进仓库。可从 `.env.example` 复制字段。

```dotenv
GITHUB_APP_ID=你的AppID
GITHUB_APP_SLUG=你的AppSlug
GITHUB_APP_CLIENT_ID=你的ClientID
GITHUB_APP_CLIENT_SECRET=服务端Secret
GITHUB_APP_PRIVATE_KEY_PATH=/run/secrets/notes-github-app.pem
GITHUB_APP_CALLBACK_URL=https://你的notes域名/api/site-publishing/github/callback
GITHUB_PUBLISH_TOKEN_KEY=持久的32字节Base64密钥
NOTES_PUBLIC_BASE_URL=https://你的notes域名
```

用 `openssl rand -base64 32` 在服务器生成独立的 `GITHUB_PUBLISH_TOKEN_KEY`。RSA 私钥推荐用只读文件挂载；也支持 `GITHUB_APP_PRIVATE_KEY` PEM 环境变量（实际换行或 `\n`）。Compose 已传递这些变量，但私钥文件需要部署者自行只读挂载，容器内路径与 `GITHUB_APP_PRIVATE_KEY_PATH` 一致。单容器镜像也使用同一组环境变量。

App 配置缺失或非法时，服务显示“GitHub 发布未配置”，其他功能及 ZIP 导出继续可用。本机回调可使用 `http://127.0.0.1:<port>/api/site-publishing/github/callback`，其他环境必须 HTTPS。生产反向代理需要保留协议/Host，使 Notes 的同源校验与公开地址一致。

## 授权与存储

安装回调里的 `installation_id` 只作 GitHub 流程参数，不能直接绑定 Notes 账号或仓库。每次回调都要求当前 Notes Cookie 会话、与该账号关联的单次随机 state，以及同一浏览器的 HttpOnly / SameSite=Lax Cookie；OAuth 另外使用 S256 PKCE。state 十分钟过期，重复回调、缺 Cookie 或跨账号回调会被拒绝。

服务端通过 GitHub App 用户授权查询当前用户可访问的安装和仓库，过滤 App 身份、停用安装、归档/禁用仓库及缺少 push 权限的仓库。选择仓库和每次发布都重新校验用户与 App 的权限交集，不接受客户端提供的仓库 owner/name 或任意安装 ID。发布请求必须通过 `X-Notes-GitHub-Repository-Id` 确认面板当前仓库，与账号绑定不一致时返回 409，避免跨设备切换后误发；更换仓库的响应不明确时前端清除旧目标并重新读取状态。上传/提交文件与触发 Pages 构建使用仅限所选 repository ID、仅含 Contents/Pages 写权限的短期安装 Token。首次开启 Pages 时单独使用 GitHub App 用户授权，由 GitHub 验证用户的仓库管理员、维护者或 manage Pages 权限，避免把安装的管理权限提升给普通写入者；已有正确 Pages 配置不重复修改。

GitHub App 用户 access/refresh token 使用 AES-256-GCM 加密，AAD 绑定 Notes 账号；过期用户 Token 自动串行刷新，刷新身份变化或撤销授权需重新连接。安装 Token 只在任务内存中使用。浏览器、状态接口和日志都不返回 Token、App 私钥或 Client Secret。

连接、仓库和最新任务存储在 `DATA_STORAGE_DIR/github-site-publishing.json`，通过串行更新、0600 临时文件、fsync 和原子重命名写入；不会另存便签正文。备份整个数据目录时应包含这个文件，并单独安全备份 App 配置与加密密钥。恢复时必须使用相同加密密钥；更换它会使旧用户授权和分支发布清单无法解密/验证，需要重新连接和迁移目标站点，不能直接丢弃校验。

断开连接会清除 Notes 中的授权、目标仓库和任务记录，取消本服务尚未完成的授权回调；不会删除已经发布的网站，也不会卸载 GitHub App。需要彻底撤销 App 时可在 GitHub 的 Installed GitHub Apps 中操作。发布期间不允许更换账号授权、仓库或断开连接。

## 增量提交与目录

- 本地按 Git 规则计算每份静态文件的 `SHA1("blob " + 字节数 + NUL + bytes)`，包括图片、字体等二进制文件。
- 读取 `gh-pages` HEAD、commit tree 和文件 SHA；递归树被 GitHub 截断时逐层读取，不能完整读取则停止。
- 未变化的文件直接复用 SHA，不上传；相同的新文件内容也只上传一次 Blob。新增/修改通过 SHA 写入 tree，删除使用 `sha: null`。
- 使用当前 `base_tree` 保留无关文件，一次 Create Tree、一次 Create Commit、一次更新目标 ref 合并全部变化；首次使用无父提交的独立站点历史。未变化时不制造空 commit。
- 更新 ref 始终 `force: false`。并发冲突最多重新读取和合并两次；引用响应丢失时读回 HEAD，避免重复提交或误报失败。不会 force push。

根目录的 `.notes-site-publishing.json` 保存本服务生成的文件清单、Notes 账号摘要及 HMAC 签名。更新只删除旧清单中已不存在的文件，保留无关文件；清单被修改、属于另一 Notes 账号或签名密钥变化时停止。已有未受管的页面或资源即使内容完全相同也会停止发布，避免被清单接管后在后续更新中误删；站点配置所需的 `.nojekyll` 和与当前 Pages 域名一致的 `CNAME` 除外。不要手工修改该文件。手动修改本应用已经管理的静态页面会在下次发布时被构建版本替换；应在 Notes 中编辑内容。

GitHub 发布的域名以目标仓库当前 Pages 配置为准，未启用时使用标准 `<owner>.github.io/<repo>/`（用户/组织主页仓库使用根路径），不直接套用 ZIP 中的域名。已有自定义 Pages 域名会沿用并保留 CNAME，不替用户修改 DNS。

高级设置中的“部署子路径（basePath）”在一键发布时用作仓库站点内的子路径，新草稿默认为 `/notes/`：项目仓库 `https://owner.github.io/repo/` 会发布到 `https://owner.github.io/repo/notes/`，静态文件放在 `gh-pages` 的 `notes/` 下；填写 `/blog/` 会发布到 `https://owner.github.io/repo/blog/`，填写 `/` 则发布到仓库站点根。仓库 Pages 根已经是 `/notes/` 时，保存 `/notes` 或 `/notes/` 都会解析为 `https://owner.github.io/notes/`，`gh-pages` 前缀为空，不会生成 `/notes/notes/`。已填写 `/repo/notes/`、`/repo/blog/` 等包含项目名前缀的旧设置不会重复追加前缀，已保存的根路径和自定义路径也不会被新默认值自动迁移。Hugo 在构建前使用最终路径，导航、图片、CSS、字体和搜索索引都保持一致。更换子路径后旧清单中的旧文件一起清理，非本应用文件保留。

## 任务与故障恢复

当前与账号数据存储架构一致，采用单个服务进程作为写入者；不提供跨多个后端副本的分布式队列。每账号和每目标仓库最多一个发布任务，全局最多两个发布任务；ZIP 与 GitHub 发布共享 Hugo 构建并发预算（最多两个构建）。任务最长十分钟，Hugo 最长六十秒，GitHub 单次请求最长三十秒；原有正文、图片、文件数量与构建大小限制继续有效。

授权失效、限流、保护分支、空仓库、文件冲突、构建异常及 Pages 失败均返回可操作状态。GitHub 提交成功后才进入 `deploying`，Pages 成功前不报已上线；部署超时或失败保留 commit SHA 和链接，可再次发布继续确认，无变化时不会重复上传或创建 commit。Notes 进程重启后将未完成任务标为 `interrupted`，明确提示重试；不把上次状态当作成功，也不在没有正文快照时擅自重跑。

## API 与验证

全部接口位于 `/api/site-publishing/github`，要求 Notes 网页会话。除 GitHub GET 回调外还校验同源，拒绝跨站请求，所有状态为 `Cache-Control: no-store`。

| 接口 | 用途 |
| --- | --- |
| `POST /connect` | 返回带一次性 state 的 App 安装授权地址 |
| `GET /callback` | 安装与 OAuth 回调 |
| `GET /status` | 连接、目标仓库和最新发布状态（不含凭据） |
| `GET /repositories` | 当前用户与 App 共同可写的仓库 |
| `PUT /repository` | 按经过验证的 installation/repository ID 绑定 |
| `DELETE /connection` | 断开 Notes 中的连接 |
| `POST /publish` | 复用 ZIP 导出请求契约，返回 202 及后台任务 |

```bash
npm run build
npm run test:feedback
node --import tsx --test backend/tests/github-site-publishing.test.ts backend/tests/github-site-publishing-routes.test.ts frontend/tests/site-publishing-github.test.ts
SITE_PUBLISH_GITHUB_UI=1 node scripts/verify-site-publishing.mjs # 浏览器界面使用隔离模拟 GitHub，非真实上线
```

反馈测试使用隔离账号、临时数据目录、内存 GitHub API，并通过真实 Hugo 验证静态构建、首次提交、无变化更新和便签删除；浏览器 UI 验证还会检查 GitHub Pages 卡片默认折叠、键盘展开与收起、已连接时折叠卡片不影响页脚发布按钮，以及从折叠状态发布后展开可见进度；不会写入真实仓库。真实安装授权和 Pages 上线仍需要部署者配置真实 GitHub App 后联调，不能用模拟响应冒充验收。

GitHub 官方契约：[Git Trees](https://docs.github.com/en/rest/git/trees)、[Git Refs 与空仓库限制](https://docs.github.com/en/rest/git/refs)、[GitHub App 用户授权与 PKCE](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)、[安装 Token 限权](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)、[Pages 配置及构建](https://docs.github.com/en/rest/pages/pages)。
