# 项目架构

## 产品目标

锤子便签 Skill 将 Markdown 实时渲染为锤子便签风格页面，并支持导出长图 PNG、下载离线归档、管理文章图片，以及一键复制为微信公众号富文本。

样式与 Markdown 行为可参考：

- <https://cloud.smartisan.com/apps/note/md.html>

## 技术栈

- 前端：React 19、Vite、TypeScript、Zustand、React Markdown、remark-gfm
- 后端：Express、TypeScript、Playwright、Multer
- 运行与发布：Docker Compose、Nginx、GitHub Actions、Docker Hub

## 代码边界

```text
src/                     前端源码与前后端共享渲染组件
server/                  Express API 与 Playwright 导出服务
frontend/tests/          前端 feedback 测试及渲染样例
backend/tests/           后端 feedback 测试
public/                  前端静态资源
storage/images/          导入图片与导出 PNG 的持久化目录
storage/data/            账号、云端工作区与匿名额度的服务端持久化目录
skills/notes-export-api/ 长图导出与登录工作区管理 API Skill
DOCS/                    项目上下文
TOOLS/                   可用工具与命令
PROMPTS/                 固定工作流 Prompt
MEMORY/                  经测试确认的长期事实
```

目前保留 `src/` 和 `server/` 的源码位置，以维持 Vite、TypeScript、Docker 和 Skill 的现有构建路径。`frontend/` 与 `backend/` 先用于清晰划分两端 feedback 测试。

## 前端

`src/App.tsx` 是页面编排入口。便签集合、当前便签、主题、导出状态和确认操作由 `src/store/useAppStore.ts` 管理。

移动端沿用原版的页面职责：设置是独立全屏偏好页，只保存背景主题等长期选项；插图和完成属于编辑态，删除和分享属于预览态。保存图片、复制 Markdown 和下载归档由分享面板统一承接。

多便签工作区包含便签 ID、Markdown 内容、创建/更新时间、普通排序、置顶、加星、
文件夹归属和回收站状态，并保存自定义文件夹集合；首次升级时会自动读取旧的
`notes.markdownDraft` 单草稿并迁移，已有 `notes.workspace.v1` 也会自动补齐新增
字段。侧栏只显示更新时间和从 Markdown 自动提取的标题或第一句话。

匿名状态继续以 `notes.workspace.v1` 写入浏览器 `localStorage`。普通用户或超级
管理员登录后，服务端以账号 ID 为边界保存独立工作区，前端在变更后延迟 650ms
保存，并每 15 秒检查一次较新的服务端版本以支持跨端同步。账号、会话、管理员
后台、登录后首次迁移和冲突边界详见 `DOCS/auth-and-sync.md`。

官方网页版前 20 条便签作为隔离测试工作区保存在 `src/fixtures/smartisan-web-test-workspace.ts`。访问 `?testData=smartisan-web-20` 使用独立的 `notes.workspace.smartisan-web-20.v1` 存储键；再加 `&resetTestData=1` 可强制恢复测试夹具，不会覆盖用户的正常工作区。重置参数是一次性指令：首次恢复夹具后会立即从地址栏移除，后续点击刷新或浏览器重载会读取已持久化的测试工作区，不会再次覆盖新建便签。桌面网页版像素和交互基线见 `DOCS/desktop-web-parity.md`。

项目只保留桌面和手机两种布局，不提供单独的 iPad / 平板布局。大于 `640px` 时使用“分类 / 便签列表 / 单一正文工作区”三栏布局；分类栏包含全部便签、加星便签、回收站和自定义文件夹，正文区默认显示 Markdown 编辑器，通过顶部“Markdown 模式 / 实时预览”下拉框互斥切换。不超过 `640px` 时使用“分类面板 / 便签列表 / 编辑 / 预览”分层工作区，点击列表顶栏的当前分类名称打开分类面板，任一时刻只显示一个主要任务。两端的颜色、Sprite、顶栏、列表、状态栏、搜索框和横线纸统一以锤子便签网页版为视觉基准；官方网页自身的 `1280px` 最小宽度不直接移植到手机，手机只保留其视觉参数并沿用原生客户端的页面级交互。详细基准见 `DOCS/mobile-ux.md`。

普通删除是软删除：便签移入回收站后不再出现在全部、加星或文件夹分类中，可从回收站恢复；永久删除只在回收站内提供。删除自定义文件夹只解除便签的文件夹归属，不删除便签内容。当前便签可在详情元数据栏切换文件夹。

`src/lib/markdown.ts` 使用二级标题 `##` 拆分便签区块，并把首个非空行的整行 `[文字]` 语法转换为不带方括号的居中正文行。这项语法只改变水平对齐，不提升为标题，也不额外改变字号、字重、颜色、行高或间距。只有文档顶部的整行方括号会触发该规则，正文中的 `[文字]`、Markdown 链接和图片保持普通 GFM 语义。`src/components/MarkdownText.tsx` 负责 GFM 渲染，并为图片输出统一的 `note-image-frame` 标记；`src/components/NoteSheet.tsx` 是网页预览、Playwright 导出和归档 HTML 共用的便签组件。普通预览、PNG 导出和离线归档通过同一组 CSS 复现安卓长图图片的暖灰细线、白色衬边和极轻阴影，选择器覆盖段落、列表项等全部 Markdown 上下文；公众号富文本则由 `WechatArticle` 输出等价内联样式。

前端通过同源 `/api` 和 `/images` 路径访问后端。开发时由 Vite 代理，双容器生产环境由 Nginx 代理，单容器生产环境由 Express 同时提供 API 和静态文件。

本地开发统一使用 `npm run dev`，由 `scripts/dev.mjs` 同时启动
`127.0.0.1:15173` 的 Vite 与 `127.0.0.1:3001` 的 Express。若只启动
Vite，普通编辑仍可使用，但 `/api/export`、`/api/archive` 和图片导入都会因
代理目标不存在而失败。

## 后端 API

- `GET /api/health`：健康检查
- `GET /api/auth/session`：读取当前签名会话
- `POST /api/auth/login`：普通用户或超级管理员从便签首页登录
- `POST /api/auth/password`：普通用户校验当前密码后修改自己的密码
- `POST /api/auth/logout`：清除当前会话
- `POST /api/superadmin/login`：使用服务端环境变量登录管理员后台
- `GET /api/superadmin/users`：管理员读取普通用户列表
- `POST /api/superadmin/users`：管理员创建普通用户并生成一次性显示的初始密码
- `POST /api/superadmin/users/:userId/reset-password`：管理员重置普通用户密码
  并一次性取得新临时密码
- `GET /api/workspace`：读取当前登录账号的云端工作区
- `PUT /api/workspace`：保存当前登录账号的云端工作区；可传
  `expectedUpdatedAt` 做乐观并发控制，版本不一致时返回 HTTP 409
- `POST /api/images/import`：上传图片或从 URL 下载图片
- `POST /api/export`：将 Markdown 导出为 PNG
- `POST /api/archive`：生成包含 Markdown、HTML、图片和字体的 ZIP
- `POST /api/wechat`：上传文章图片到七牛并生成带内联样式的公众号富文本；
  请求可携带 `footerBrand`、`footerLogoUrl` 与 `footerVia` 自定义底部署名
- `GET /images/*`：读取持久化图片与导出结果

图片内容使用 SHA-256 命名以实现去重，默认存储在 `storage/images`，单张图片最大 20 MB。

## 便签 API Skill

`skills/notes-export-api` 在原有 Markdown 长图导出能力之外，把登录、工作区读取
与条件保存、公众号富文本生成封装为统一命令，支持便签列表和全文查询、新增
Markdown 便签、文件夹分类、加星、置顶以及生成公众号 HTML。项目现有“分类”
数据结构是 `folderId`，Skill 不维护另一套标签字段。Skill 强烈建议使用用户自行
部署的本地服务；只有本地无法部署时才回退 `notes.fangyuanxiaozhan.com`
公益服，公益服没有 SLA，不保证稳定性。

新增、分类、加星和置顶仍通过 `GET/PUT /api/workspace` 保存完整工作区，但脚本会
把读取到的 `updatedAt` 作为 `expectedUpdatedAt` 提交。服务端在单进程写入队列
内部核对当前版本；若浏览器或另一调用方已经保存新版本，返回 409，脚本重新读取
后只重做目标修改，最多尝试 4 次。旧前端不传该字段时保持原有最后写入者优先
行为。

## PNG 导出链路

```text
客户端 POST /api/export
  -> Express 生成 renderMode=playwright 的前端地址
  -> 复用一个无头 Chromium 实例并创建页面
  -> Playwright 填写 Markdown 编辑器
  -> React 使用真实预览组件重新渲染
  -> 等待字体、图片和高度稳定
  -> 截取 .note-sheet
  -> 超长图片分段截图并拼接
  -> 保存到 storage/images 并返回 PNG
```

这种方式让网页预览和 PNG 使用同一套 React 组件及 CSS，避免维护第二套截图模板。

## 归档链路

归档不启动 Playwright。后端收集 Markdown 中的图片，将资源写入 ZIP，并通过 React 服务端渲染生成独立 `index.html`。OPPOSans 字体会根据文章内容裁剪为 WOFF2。

## 微信公众号复制链路

桌面分享预览和手机分享面板都提供“复制到公众号”。前端先调用
`POST /api/wechat`，后端扫描 Markdown 与内嵌 HTML 中的图片，读取本地
`/images/*`、`public/*`、Data URL 或远程图片，并用内容 SHA-256 作为对象名上传
到七牛。已经指向同一七牛域名的图片不会重复上传。底部署名使用的 Smartisan
锤子 PNG 默认引用项目生产图片服务提供的 HTTPS 直链；用户上传自定义 Logo 后，
后端把它与正文图片一起按内容哈希去重并上传，再将公众号页脚替换为 HTTPS 地址。
复制结果不包含微信会拒绝的 Data URL，也不依赖当前站点域名是否配置有效证书。

底部署名由全局设置中的两段文本控制，默认值为“由锤子便签发送”和
“via Smartisan Notes”。浏览器分别使用 `notes.footerBrand` 与
`notes.footerVia` 持久化，每段最多 `80` 个字符；URL 中同名查询参数的优先级
高于本地设置。Logo 使用 `notes.footerLogoUrl` 保存站内 `/images/*` 相对路径，
`footerLogoUrl` 查询参数可以覆盖。`NoteSheet` 预览、PNG 导出、离线归档和
`POST /api/wechat` 使用同一组值，避免屏幕预览与最终产物的署名不一致；离线
归档会把 Logo 实体写入 `html.assets/footer-logo.*`，不依赖原站继续在线。

图片处理完成后，后端通过共享 React 组件生成只有内联样式的 HTML。富文本不是
通用黑白 Markdown：外层只保留低对比暖米色纸沿，正文是一张带轻阴影和双细框
的暖白锤子便签纸，文字、标题、引用、代码块和表格都沿用项目的棕色纸感 Token，
正文固定使用常规字重与紧凑行距，底部保留上述可配置署名。首行 `[文字]` 会去除方括号，
以普通正文样式居中且不附加标题效果；其余标题、列表、引用、代码块、表格、链接
和图片继续遵循 GFM。前端使用
Clipboard API 同时写入 `text/html` 和 `text/plain`，不支持 ClipboardItem 时
回退到富文本选区复制，粘贴到微信公众号编辑器后保留排版。

公众号组件不维护另一套近似颜色：纸面、外沿、双框、标题、正文和署名分别直接
复用成品便签的 `#fffcf7`、`rgba(239,230,216,.95)`、
`#e8e4dc`、`rgba(70,53,38,.96)`、
`#665749` 和 `#d7cec1`。外框四角各包含一个独立的 `6px`
空心方格单元格，并填充不可见的不换行空格。四角和四条边使用一个 3×3 的展示
表格承载，不依赖公众号保存时会清除的绝对定位，避免四个角保存后回流成左上角
竖条。四个方格位于主框之外：左上方格以右下角、右上方格以左下角、左下方格以
右上角、右下方格以左上角连接外框，匹配 `example/程序员狠话Vol.5.JPG` 的成品
几何。中间单元格用 `3px` 内边距隔出第二条细框。纸张容器和展示表格本身不画
额外边框，只有四条定向边线组成外框，正文区再画唯一内框；因此即使公众号编辑器
展示表格辅助边界，也不会与纸张边框叠成四条细线。底部署名使用本地化的
Smartisan 圆形锤子 PNG，并改用无边框的行内元素与文字垂直居中，不再使用会被
微信编辑器显示辅助边线的展示表格。PNG 圆形之外使用透明通道，图片本身再以
`border-radius:50%` 圆形裁剪，避免微信暗黑模式将原暖白底显示成方块。署名下方
保留纸张宽度 `12%` 的响应式空白，
匹配 `example/程序员狠话Vol.5.JPG` 在内容结束后仍留下大面积暖白纸面的节奏；
复制 HTML 默认引用项目生产图片服务中内容哈希为
`d5a157fccd36ca63fc5fb53afd0223d45448263fd349a9e2f17d54fb94fe3e4d`
的有效 PNG 直链，也可通过
`WECHAT_FOOTER_HAMMER_URL` 覆盖。这样能避免 `localhost`、Data URL 和无有效
证书的 HTTP 图床进入公众号。React 服务端渲染自动生成的图片 preload `<link>`
会在写入剪贴板前移除，公众号收到的只包含可粘贴正文节点。

微信公众号会在 `**粗体**vibe` 这类行内格式结束后直接连接拉丁字符的边界强制
断行。公众号专用渲染会在代码块和行内代码之外，把不可见的 WORD JOINER 放进
粗体或斜体节点的末尾；这样它不会成为可能被微信清洗掉的独立文本节点，也不会
额外增加一个可见空格。该处理只改变复制出的 HTML，不修改用户原始 Markdown。

图片不能只依赖 `max-width`，因为公众号后台会按固有尺寸重新计算。图片紧跟有序
列表内容且中间没有空行时，GFM 会把图片放进对应的 `<li>`；此时图片的
`width:100%` 相对列表文字内容盒计算，会继承编号缩进并整体偏右。公众号专用
预处理会把列表项后紧邻的无缩进 Markdown 图片拆成顶层图片，同时让后续有序列表
从原编号继续；围栏代码块和有意缩进的列表图片不受影响。这项预处理由普通预览、
PNG 导出、离线归档和公众号复制共同复用。顶层图片装裱容器使用自动左右边距，
宽度、左右留白和中心点都相对正文卡片计算。

安卓真机 `1080 × 2400` 长图预览中，卡片中心约为 `x=540`，图片装裱框左右边界
约为 `133/947`，中心同样为 `x=540`；相对内框的左右留白约为 `60/61px`。
公众号图片仍同时写入 `width="100%"` HTML 属性、带 `!important` 的内联宽度和
自动高度，确保微信清洗样式后不越过正文内框。

七牛对象在上传前统一按图片二进制内容计算 SHA-256，并使用
`<hash>.<真实格式扩展名>` 作为对象名；同一篇便签内即使多个不同 URL 指向完全
相同的图片，也只发起一次上传，其余引用直接复用同一个公开 URL。替换 Markdown
图片地址时按源 URL 长度降序处理，避免带查询参数的地址被较短基础地址提前部分
替换。

普通用户或超级管理员登录后调用 `/api/wechat` 不受匿名额度限制，七牛对象沿用
长期存储前缀。匿名用户共享每天 500 张的上传额度，服务端按北京时间日期在
`storage/data` 中原子计数，并在北京时间 0 点切换日期键；匿名对象使用
`<QINIU_PREFIX>/temporary/<北京时间日期>/` 前缀，上传凭证写入
`deleteAfterDays: 1`。超额返回 HTTP 429，并提示联系
`zhaoolee@gmail.com` 注册。额度可用 `ANONYMOUS_DAILY_UPLOAD_LIMIT` 调整。

七牛配置按以下顺序读取：

1. 环境变量 `QINIU_ACCESS_KEY`、`QINIU_SECRET_KEY`、`QINIU_BUCKET`、
   `QINIU_DOMAIN`，可选 `QINIU_PREFIX` 和 `QINIU_UPLOAD_URL`。
2. `QINIU_CONFIG_PATH` 指向的 JSON。
3. 仓库根目录 `qiniu.json`。
4. 本地相邻项目 `../upload-local-image-to-qiniu/qiniu.json`。

兼容 JSON 使用现有图床项目的 `AK`、`SK`、`QINIU_BUCKET`、`QINIU_DOMAIN`、
`QINIU_PREFIX` 字段。仓库根目录的 `.env` 由 `npm run dev` 和 Docker Compose
自动加载，文件已被 Git 和 Docker 构建上下文忽略；可复制 `.env.example` 后填写
本地密钥。本地开发未提供 `.env` 时仍会复用相邻项目配置。生产环境应通过部署
平台的环境变量或 Secret 注入。若七牛默认上传域名返回区域提示，服务
会自动切换到提示的区域上传地址并缓存该结果。

管理员凭据只从服务端的 `SUPERADMIN`、`SUPERADMINPASSWORD` 读取；不要使用
`VITE_` 前缀。生产环境还应配置独立的高熵 `SESSION_SECRET`。账号密码只保存
scrypt 盐与哈希，登录状态使用 HttpOnly、SameSite=Lax 的签名 Cookie。

## 部署形态

- 开发双容器：`docker-compose.dev.yml`，Vite HMR 与 `tsx watch`
- 生产双容器：`docker-compose.yml`，Nginx 前端与 Playwright 后端
- 生产单镜像：`Dockerfile.app`，Express 同时托管 `dist`、API 和图片
- Docker Hub 发布：`.github/workflows/docker-publish.yml`

账号与同步数据默认位于 `storage/data/notes-data.json`。Compose 已把
`storage/data` 挂载为持久卷；其他部署形态也必须为 `DATA_STORAGE_DIR` 提供持久
存储。当前文件存储通过单进程队列和原子重命名保证一致性，因此生产环境应保持
单个后端写入实例；若要水平扩容，应先迁移到支持事务和唯一约束的数据库。

具体发布流程见 `PROMPTS/deploy-to-production.md`。
