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
skills/notes-workspace-api/ Hermes 云端工作区管理 Skill 与下载模板
DOCS/                    项目上下文
TOOLS/                   可用工具与命令
PROMPTS/                 固定工作流 Prompt
MEMORY/                  经测试确认的长期事实
```

目前保留 `src/` 和 `server/` 的源码位置，以维持 Vite、TypeScript、Docker 和 Skill 的现有构建路径。`frontend/` 与 `backend/` 先用于清晰划分两端 feedback 测试。

## 前端

`src/App.tsx` 是页面编排入口。便签集合、当前便签、主题、导出状态和确认操作由 `src/store/useAppStore.ts` 管理。

页面入口会根据访问 Host 设置浏览器标题：域名（包括生产域名）使用“开源版锤子便签”，IPv4 或 IPv6 地址访问时使用“本地化开源版锤子便签”。所有前端路由共用这条规则，子页面不能再次覆盖标题。

主题设置区分持久化的“偏好”和实际渲染的“主题”：偏好可为 `system`、`default`
或 `smartisan-dark`，其中 `system` 通过 `prefers-color-scheme` 解析为后两者之一并
监听系统明暗变化。页面 CSS 使用解析后的全局主题；预览卡片另有持久化的
`notes.previewCardTheme` 覆盖值，当前可为 `default`、`smartisan-dark`、
`apple-notes`、`apple-notes-light`、`bear` 或 `telegraph`。浮动主题选择器只在 `.preview-card-theme` 边界内
重定义便签纸、正文、边框、图片和页脚 Token，不改变木纹舞台或页面其余区域。
选项的展示顺序由 `NOTE_CARD_THEME_OPTIONS` 唯一决定；Apple 两项固定为
`apple-notes-light` 在前、`apple-notes` 在后，调整顺序不能改写主题 ID 或存储值。
PNG 导出使用当前卡片主题，Playwright 也只接收最终的
`default | smartisan-dark | apple-notes | apple-notes-light | bear | telegraph`，不能把 `system`
发送给后端导出接口。`apple-notes*`、`bear` 与 `telegraph` 只属于卡片主题，不能用作页面全局外观偏好；Playwright 页面从
`theme` 查询参数优先恢复卡片主题，保证该配色可由后端稳定导出。
保存 PNG、下载当前便签离线归档和复制到公众号都会显式传递同一个最终卡片主题。
`/api/export` 与 `/api/archive` 分别用 `X-Export-Theme`、`X-Archive-Theme` 回显
实际采用的主题；`/api/wechat` 在 JSON 中返回 `theme`。前端逐字比对请求值与回显值，
缺失或不一致表示后端仍是旧版本，必须中止保存、下载或复制并提示重启服务。三个
接口收到显式但未知的主题时都返回 `400`，不能静默回退到 `default`。

Apple 深浅主题的纸张外层保留 `12px × note-scale` 左右内边距，正文内层不再重复
增加水平内边距，使标题、段落与顶部“备忘录”工具栏共用同一条左右对齐线；网页
预览、PNG 导出和离线归档必须保持一致。工具栏文字和两个官方矢量图标都以 Apple
导航栏的逻辑尺寸定义，再由 `note-scale` 统一放大；默认 2 倍画布不能把图标尺寸
预先减半，否则会在 660px 宽纸张上呈现为明显偏小的装饰。

`telegraph` 是独立的出版排版布局：正文使用 Georgia/Cambria/Times 衬线字体栈和
`18px / 1.58` 节奏，标题使用 Lucida Grande/系统无衬线字体，Markdown 空行映射为
原站 `12px` 段距；链接使用继承色下边线，引用使用 `3px` 黑色左线，并从正文左边界
向内留出 `3px × note-scale` 的轻微缩进；代码块使用 `#f5f8fc`。该主题在
`src/styles.css`、离线归档内嵌 CSS 与 `WechatArticle` 中分别
以 `telegraph` 作用域实现，不能复用 Bear 或锤子便签的排版选择器。

Bear 的正文粗体与链接共用 `#dd4c4f` 强调色，并保持 `700` 字重；这条规则必须分别
同步到网页预览与 PNG、离线归档内嵌 CSS、公众号内联样式，且只能在 `bear` 作用域
生效，另外五种主题的粗体继续继承各自正文颜色。

卡片主题选择器的视觉图标仍由主题自身作用域控制。Bear 使用
`public/bear-theme-icon.png`，同一资源同时用于右下角当前主题按钮与展开后的主题
列表；CSS 必须使用 `/bear-theme-icon.png` 的 public 根路径，不能把图片编码进样式表。
锤子便签明暗主题共用 `public/smartisan-theme-icon.png`：`default` 入口直接显示原图，
`smartisan-dark` 入口在同一路径上叠加半透明黑色渐变；两处均使用
`center / cover`，不能维护两份明暗位图。
Apple 深浅主题共用 `public/apple-notes-theme-icon.png`：浅色入口直接显示原图，深色
入口在同一路径上叠加半透明黑色渐变；两处均使用 `center / cover`，不能维护两份可能
漂移的明暗位图。
Telegra.ph 使用其官网 `og:image` 声明的 `512 × 512` 黑色 T 标识，落盘为
`public/telegraph-theme-icon.png`，并通过 `/telegraph-theme-icon.png` 同时用于上述
两个入口；不要再用 CSS 横线模拟该站图标。

`/changelog` 是独立的前端页面入口。Vite 构建时把项目根目录的 `CHANGELOG.md`
作为原始 Markdown 打包进页面，`ChangelogPage` 使用与普通预览相同的
`splitSections`、`MarkdownText` 和 `NoteSheet` 渲染链路，并复用当前主题与响应式
便签缩放；桌面端把页面固定在动态视口高度内，由 `.changelog-main` 承担唯一的纵向
滚动，保证顶栏固定且鼠标滚轮不会被非滚动的内层容器截断。开发服务器、Nginx SPA
回退和 Express 单容器回退均可直接访问该路径。两个前端生产 Dockerfile 必须把
`CHANGELOG.md` 复制进构建上下文。

页面滚动条统一由 `src/lib/auto-hide-scrollbars.ts` 监听滚动状态，并由
`src/styles.css` 控制可见性：滚动期间、滚动区域悬停或键盘聚焦时显示，停止滚动
约 900ms 后隐藏。深色模式和独立页面只覆盖滚动条颜色，不能重新设置为常驻显示。

`/promo/editor` 和 `/promo/pages` 是两个独立的宣传截图制作页。两页都在前端
Canvas 内以固定 `2048 × 920` 像素绘制并用 `canvas.toBlob()` 下载 PNG，不调用后端
上传接口，也不把用户选择的图片写入工作区或浏览器持久化存储。
Vite 生产构建必须使用站点根路径 `/` 作为 `base`，使这两个嵌套路由继续从
`/assets/*` 加载脚本和样式；不能使用 `./`，否则浏览器会把资源错误解析为
`/promo/assets/*` 并显示空白页。
两页的背景色均可通过原生颜色选择器或六位十六进制文本输入设置；文本接受带或不带
`#` 的格式，只有完整合法值才实时写入 Canvas，失焦时非法或不完整输入恢复为上一
个有效颜色，不能把无效 CSS 颜色传入绘制链路。
前者使用单张图片按画框宽度等比缩放，始终完整保留图片宽度并从顶部开始绘制；图片
高于画框时只裁切纵向内容，用 `0%–100%` 滑杆从顶部连续移动到底部；图片低于画框
时锚定顶部，余下区域保持白色，不提供会破坏完整宽度的额外缩放或水平偏移。页面把
`public/promo-script-texture.png` 的透明手写纹理重复铺在左侧深色背景，和右下方长
笔画一起直接绘入 Canvas，因此预览与下载 PNG 必须一致；纹理加载失败时才使用简化
曲线回退。后者最多读取三张图片，以仿透视
仿射变换生成从后到前的多页层叠构图。多页图片默认使用 `contain` 完整显示，保证
上传后的整张截图不被裁切，此时比例差产生的多余区域保留白色；用户仍可手动选择
`cover` 铺满页面。多页模式的取景尺寸必须使用仿射变换后水平与垂直向量的真实
长度，不能继续使用变换前的竖向逻辑页宽和页高，否则横图会在拉伸前被错误裁成
竖条。`cover` 默认从图片顶部开始向下取景，前、中、后三层图片各自保存独立的
`0%–100%` 纵向取景位置，分别对应顶部到图片底部；未上传的层级保持禁用，
`contain` 始终显示完整图片，不应用这些位移。上传后的图片顺序可用“前移 / 后移”
调整，索引 `0 / 1 / 2` 继续对应前 / 中 / 后层；重排时图片来源、文件名、已加载图片
和该图片自己的纵向取景位置必须一起移动，不能只换画面而遗留旧参数。
三层纸张共用 `60%–140%` 的宽度和高度缩放值，缩放只改变
从各自左上角延伸出的水平与垂直向量，不改变层级顺序和倾斜方向。上传图片后默认
读取第一张图的自然宽高比，将三层纸张的垂直向量统一换算为该比例；比例限制在
`0.45–2.4`，防止极端长条图片破坏画布，宽高滑杆继续作为自动比例后的二次缩放。
共用的取景与裁切数学位于
`src/lib/promo-image.ts`，页面编排与 Canvas 绘制位于
`src/components/PromoStudioPage.tsx`。

移动端沿用原版的页面职责：设置是独立全屏偏好页，只保存背景主题等长期选项；插图和完成属于编辑态，删除和分享属于预览态。保存图片、复制 Markdown 和下载归档由分享面板统一承接。

多便签工作区包含便签 ID、Markdown 内容、创建/更新时间、普通排序、置顶、加星、
文件夹归属和回收站状态，并保存自定义文件夹集合；首次升级时会自动读取旧的
`notes.markdownDraft` 单草稿并迁移，已有 `notes.workspace.v1` 也会自动补齐新增
字段。侧栏只显示更新时间和从 Markdown 自动提取的标题或第一句话。

便签详情状态同时写入 URL hash：
`#note=<便签 ID>&view=editor|preview`。刷新和浏览器历史导航会在工作区初始化后按
ID 恢复当前便签及编辑 / 预览状态；无效 ID 回到列表。hash 与现有查询参数分开，
不会覆盖测试工作区、主题或页脚配置。

匿名状态继续以 `notes.workspace.v1` 写入浏览器 `localStorage`。普通用户或超级
管理员登录后，服务端以账号 ID 为边界保存独立工作区，前端在变更后延迟 650ms
保存，并每 15 秒检查一次较新的服务端版本以支持跨端同步。当前便签属于设备本地
界面状态：单纯切换便签不触发云端写入，合并较新的云端文章与排序时也会优先保留
本机仍然有效的便签 ID。账号、会话、管理员后台、登录后首次迁移和冲突边界详见
`DOCS/auth-and-sync.md`。

官方网页版前 20 条便签作为隔离测试工作区保存在 `src/fixtures/smartisan-web-test-workspace.ts`。访问 `?testData=smartisan-web-20` 使用独立的 `notes.workspace.smartisan-web-20.v1` 存储键；再加 `&resetTestData=1` 可强制恢复测试夹具，不会覆盖用户的正常工作区。重置参数是一次性指令：首次恢复夹具后会立即从地址栏移除，后续点击刷新或浏览器重载会读取已持久化的测试工作区，不会再次覆盖新建便签。桌面网页版像素和交互基线见 `DOCS/desktop-web-parity.md`。

项目只保留桌面和手机两种布局，不提供单独的 iPad / 平板布局。大于 `640px` 时使用“分类 / 便签列表 / 单一正文工作区”三栏布局；分类栏包含全部便签、加星便签、回收站和自定义文件夹，正文区默认显示 Markdown 编辑器，通过顶部“Markdown 模式 / 实时预览”下拉框互斥切换。不超过 `640px` 时使用“分类面板 / 便签列表 / 编辑 / 预览”分层工作区，点击列表顶栏的当前分类名称打开分类面板，任一时刻只显示一个主要任务。两端的颜色、Sprite、顶栏、列表、状态栏、搜索框和横线纸统一以锤子便签网页版为视觉基准；官方网页自身的 `1280px` 最小宽度不直接移植到手机，手机只保留其视觉参数并沿用原生客户端的页面级交互。详细基准见 `DOCS/mobile-ux.md`。

桌面状态栏右侧提供与官方网页版一致的专注编辑入口。专注状态会隐藏分类栏、
便签列表和棕色顶栏，在木纹舞台中央保留最大 `1120px` 宽的浅色状态栏与 Markdown
编辑纸；再次点击、左侧短返回箭头或按 `Escape` 恢复原桌面布局。该入口只在 PC
断点显示，移动端继续使用列表、编辑、预览三态，不提供专注放大。桌面实时预览及
整页分享预览同样用 `Escape` 返回编辑，浮层存在时则由浮层优先消费按键。

普通删除是软删除：便签移入回收站后不再出现在全部、加星或文件夹分类中，可从回收站恢复；永久删除只在回收站内提供。删除自定义文件夹只解除便签的文件夹归属，不删除便签内容。当前便签可在详情元数据栏切换文件夹。

`src/lib/markdown.ts` 使用二级标题 `##` 拆分便签区块，并把首个非空行的整行 `[文字]` 语法转换为不带方括号的居中正文行。这项语法只改变水平对齐，不提升为标题，也不额外改变字号、字重、颜色、行高或间距。只有文档顶部的整行方括号会触发该规则，正文中的 `[文字]`、Markdown 链接和图片保持普通 GFM 语义。`src/components/MarkdownText.tsx` 负责 GFM 渲染，并为图片输出统一的 `note-image-frame` 标记；`src/components/NoteSheet.tsx` 是网页预览、Playwright 导出和归档 HTML 共用的便签组件。普通预览、PNG 导出和离线归档使用同一主题身份与排版结构；`src/lib/note-card-theme-styles.ts` 为归档和公众号提供五套不可变颜色配置。公众号富文本由 `WechatArticle` 按请求主题创建独立的内联样式上下文，不能使用模块级可变主题或复用上一次请求的颜色。

前端通过同源 `/api` 和 `/images` 路径访问后端。开发时由 Vite 代理，双容器生产环境由 Nginx 代理，单容器生产环境由 Express 同时提供 API 和静态文件。

本地开发统一使用 `npm run dev`，由 `scripts/dev.mjs` 同时启动
`127.0.0.1:15173` 的 Vite 与 `127.0.0.1:3001` 的 Express。若只启动
Vite，普通编辑仍可使用，但 `/api/export`、`/api/archive` 和图片导入都会因
代理目标不存在而失败。

## 后端 API

- `GET /api/health`：健康检查
- `GET /api/auth/session`：读取当前签名会话
- `POST /api/auth/login`：普通用户或超级管理员从便签首页登录
- `POST /api/auth/skill-token`：使用当前网页登录会话，或一次性的用户名和密码，
  取得稳定的账号级 Skill Token
- `POST /api/auth/password`：普通用户校验当前密码后修改自己的密码
- `POST /api/auth/logout`：清除当前会话
- `POST /api/hermes-skill/download`：登录用户下载已写入服务地址和 Skill Token 的
  `notes-workspace-api.zip`
- `POST /api/hermes-skill/install-link`：获取或首次创建当前账号可复用的 Hermes
  安装链接；重复调用返回同一地址
- `POST /api/hermes-skill/install-link/reset`：用户主动轮换当前安装链接，使旧地址
  失效但不影响已经安装的 Skill
- `HEAD/GET /api/hermes-skill/install/:ticket/notes-workspace-api.zip`：无需 Cookie
  探测或下载 Skill，同一当前链接可供多台设备重复使用
- `POST /api/superadmin/login`：使用服务端环境变量登录管理员后台
- `GET /api/superadmin/users`：管理员读取普通用户列表
- `POST /api/superadmin/users`：管理员创建普通用户并生成一次性显示的初始密码
- `POST /api/superadmin/users/:userId/reset-password`：管理员重置普通用户密码
  并一次性取得新临时密码
- `GET /api/workspace`：读取当前登录账号的云端工作区
- `PUT /api/workspace`：保存当前登录账号的云端工作区；可传
  `expectedUpdatedAt` 做乐观并发控制，版本不一致时返回 HTTP 409
- `GET /api/ai/status`：返回服务端启动时探测到的 AI 可用状态，不暴露模型地址、
  密钥或上游错误正文
- `POST /api/ai/suggestions`：登录用户提交当前 Markdown 与人类审阅要求，取得
  可逐条确认的原子修改建议；接口本身不写工作区
- `GET /api/wechat/config`：登录账号读取自己服务端持久化的公众号 AppID 与
  AppSecret；响应禁止缓存
- `PUT /api/wechat/config`：登录账号保存并立即替换自己的公众号 AppID 与
  AppSecret；配置按会话账号 ID 写入 `storage/data/notes-data.json`，不接受请求体
  指定其他账号，也不读取 `.env` 回退值；保存后会立即验证微信接口连通性
- `GET /api/wechat/status`：使用当前登录账号自己的配置取得并缓存微信接口调用凭据，
  只返回是否已配置、是否连通和脱敏后的错误信息，不返回接口调用凭据
- `POST /api/images/import`：上传图片或从 URL 下载图片
- `POST /api/export`：将 Markdown 导出为 PNG
- `POST /api/archive`：按 `theme` 生成包含 Markdown、主题化 HTML、图片和字体的 ZIP
- `POST /api/workspace/archive`：提交当前完整工作区并创建整体导出任务
- `GET /api/workspace/archive/:jobId`：读取整体导出的便签收集、压缩与就绪进度
- `GET /api/workspace/archive/:jobId/download`：下载已完成的工作区 ZIP
- `POST /api/wechat`：上传文章图片到七牛并按 `theme` 生成带内联样式的公众号富文本；
  请求可携带 `footerBrand`、`footerLogoUrl` 与 `footerVia` 自定义底部署名，响应回显
  实际采用的 `theme`
- `POST /api/wechat/draft`：登录账号把当前 Markdown、所选 `theme` 和底部署名先交给
  `/api/wechat` 同源渲染链路生成公众号富文本，再将正文图片上传到微信、准备永久
  封面并保存到该账号的微信公众号草稿箱
- `GET /images/*`：读取持久化图片与导出结果

图片内容使用 SHA-256 命名以实现去重，默认存储在 `storage/images`，单张图片最大 20 MB。

## 便签 API Skill

`skills/notes-workspace-api` 专门提供便签工作区查询、增删改、回收站、分类、星标
和置顶，既是可独立安装的 Skill，也是网页一键下载 ZIP 的白名单模板。
`skills/notes-export-api` 在原有 Markdown 长图导出能力之外，把认证、工作区读取
与条件保存、公众号富文本生成封装为统一命令，支持便签列表和全文查询、新增
或更新 Markdown 便签、软删除、回收站恢复、显式永久删除、文件夹分类、加星、
置顶以及生成公众号 HTML。两个 Skill 都优先使用 `NOTES_API_TOKEN`；只有 Token
缺失时才用用户名/邮箱和密码调用 `/api/auth/skill-token`，成功后原子改写 `.env`
并移除账号密码。项目现有“分类”数据结构是 `folderId`，
Skill 不维护另一套标签字段。便签管理和长图导出统一读取调用方明确提供的
`NOTES_API_BASE_URL` 或 `--base-url`；缺失时直接报错，不自动探测本地端口，也不
回退到公网服务。

所有便签写操作仍通过 `GET/PUT /api/workspace` 保存完整工作区，但脚本会把读取到
的 `updatedAt` 作为 `expectedUpdatedAt` 提交。服务端在单进程写入队列内部核对
当前版本；若浏览器或另一调用方已经保存新版本，返回 409，脚本重新读取后只重做
目标修改，最多尝试 4 次。旧前端不传该字段时保持原有最后写入者优先行为。

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
归档页面的内嵌 CSS 由 `server/index.ts` 独立生成，因此卡片排版变更必须与
`src/styles.css` 同步维护；Bear 的 `15px / 1.755` 正文和 `0.704em` 有效块间距
在两处保持一致，不能让下载后的 HTML 回退到旧排版。

设置“账号与同步”中的整体导出面向完整工作区，与分享面板的当前便签离线归档相互
独立。前端显式提交当前浏览器中的 `NoteWorkspace`，因此匿名用户也能导出只存在于
`localStorage` 的便签；登录用户提交的则是已经在页面中完成云同步的当前工作区
快照。后端异步逐张收集 Markdown 图片并提供任务进度，完成后生成以下结构：

```text
锤子便签-<时间>/
  导出说明.md
  <自定义文件夹>/
    <便签标题>.md
    <便签标题>.assets/<相关图片>
  _未分类/
  _回收站/
```

Markdown 内的图片地址会改写为同名 `.assets` 目录中的相对路径；重复标题和文件夹名
会追加序号，路径分隔符和跨平台非法字符会被安全替换。空文件夹会保留。整体导出
包含回收站中尚可恢复的便签；任一相关图片无法读取时任务明确失败，不能静默生成
缺图归档。当前任务并发限制为 2 个、单次最多 2,000 张便签、压缩前最多 512MB，
服务端最多暂存 8 个任务且 ZIP 总量不超过 640MB；成功下载后立即释放，未下载结果
最多保留 30 分钟。

## 微信公众号复制链路

桌面分享预览和手机分享面板都提供“复制到公众号”。前端先调用
`POST /api/wechat`，后端扫描 Markdown 与内嵌 HTML 中的图片，读取本地
`/images/*`、`public/*`、Data URL 或远程图片，并用内容 SHA-256 作为对象名上传
到七牛。已经指向同一七牛域名的图片不会重复上传。底部署名使用的 Smartisan
锤子 PNG 默认引用项目生产图片服务提供的 HTTPS 直链；用户上传自定义 Logo 后，
后端把它与正文图片一起按内容哈希去重并上传。按当前产品约定，公众号正文和
自定义 Logo 的七牛对象直接使用 `QINIU_DOMAIN` 返回的公开地址；生产配置明确为
`http://tmp-blog.fangyuanxiaozhan.com`，不再改写成本站 `/qiniu/` HTTPS 代理。
七牛上传使用官方 Node SDK：默认根据 AK 与 Bucket 查询区域，并在区域查询服务和
上传服务返回的多个节点之间故障转移；某个节点发生 DNS、连接或响应错误后会继续
尝试下一节点，不再对同一固定域名重试三次后直接失败。单节点完整请求默认保留
30 秒，可通过 `QINIU_UPLOAD_TIMEOUT_MS` 在 10 秒到 5 分钟之间调整。已有部署的
`QINIU_UPLOAD_URL` 只作为兼容首选节点；当它是七牛标准区域域名时，SDK 仍会补齐
同区域备用节点。上传地址的 HTTPS 与 `QINIU_DOMAIN` 返回给公众号的公开 HTTP
地址职责独立，公开地址和对象键保持不变。
内置页脚锤子图和编辑器、预览、同步使用的普通图片仍保留
`https://notes.fangyuanxiaozhan.com/images/...`。复制结果不包含微信会拒绝的
Data URL。
如果 Markdown 或自定义 Logo 使用当前站点的完整
`https://<本站>/images/...` 地址，服务端按请求的公开 Host 识别为同源图片并直接
从 `IMAGE_STORAGE_DIR` 读取；不能再通过公网 `fetch` 回环访问自身。只有真正的
外站图片才走远程下载。

底部署名由全局设置中的两段文本控制，默认值为“由开源版锤子便签发送”和
“Powered by zhaoolee/notes”。浏览器分别使用 `notes.footerBrand` 与
`notes.footerVia` 持久化，每段最多 `80` 个字符；URL 中同名查询参数的优先级
高于本地设置。Logo 使用 `notes.footerLogoUrl` 保存站内 `/images/*` 相对路径，
`footerLogoUrl` 查询参数可以覆盖。`NoteSheet` 预览、PNG 导出、离线归档和
`POST /api/wechat` 使用同一组值，避免屏幕预览与最终产物的署名不一致；离线
归档会把 Logo 实体写入 `html.assets/footer-logo.*`，不依赖原站继续在线。
内置锤子 Logo 在暗黑主题下会通过低亮度、低不透明度滤镜压到与署名文字相近的
对比层级，避免暖白圆标形成亮斑；该规则通过独立类名识别内置资源，不会强制
改色用户上传的自定义 Logo。设置缩略图和成品预览共用同一规则。内置 PNG 使用
完整 RGBA 通道，四个角像素均须透明，不能依赖暖白纸面掩盖不完整的 Alpha。

图片处理完成后，后端通过共享 React 组件生成只有内联样式的 HTML。富文本不是
通用黑白 Markdown：最外层容器不留边距且保持透明，正文按当前卡片主题分别使用
暖白锤子、暗黑锤子、Apple 深色、Apple 浅色或 Bear 的纸面、文字、强调色、引用、
代码、表格、图片和页脚 Token。锤子两色保留双细框，Apple 两色使用直角无框纸面
并带金色工具栏，Bear 使用直角白页、红色强调与无装裱图片。公众号 HTML 的纸张、
框体留白、段落空行、图片衬边和署名继续使用 `1.4×` 移动
布局比例，纸张最大宽度为 `462px`；文字不再随框体同步放大，正文固定为
`15px / 1.75`，H1 为 `22px / 1.32`，H2 为 `17px / 1.4`，引用为
`15px / 1.64`；Bear 正文沿用 `15px / 1.755` 与普通标题字重，但它的 Markdown
空行和 `##` 分节间隔独立收紧为 `0.704em`，不把完整正文行框重复叠加到块间距。
公众号正文不添加
文字描边，非 Bear 主题的标题和 Markdown 粗体使用 `600` 字重，避免系统字体回退
后出现整篇偏粗；同时继续避免旧版标题下划线和引用色块。底部保留
上述可配置署名。首行 `[文字]` 会去除方括号，
以普通正文样式居中且不附加标题效果；其余标题、列表、引用、代码块、表格、链接
和图片继续遵循 GFM。前端使用
Clipboard API 同时写入 `text/html` 和 `text/plain`，不支持 ClipboardItem 时
回退到富文本选区复制，粘贴到微信公众号编辑器后保留排版。

## 微信公众号草稿发布链路

分享入口打开时，前端使用 `GET /api/wechat/status` 检查当前登录账号自己的配置。
只有 AppID 与 AppSecret 都存在且服务端成功取得微信接口调用凭据时，才在
“复制到公众号”正下方显示“发布为公众号草稿”；未登录、未配置或连通失败时不显示，
设置页会展示连通结果和可操作的错误原因。调用凭据只在服务端内存中按配置哈希缓存，
不会返回浏览器。

点击发布后，`POST /api/wechat/draft` 先调用与“复制到公众号”相同的
`prepareWechatArticle`，确保当前 Markdown、卡片主题、署名、图片预处理和内联样式
完全一致。由于微信草稿接口会过滤外部图片，服务端继续扫描渲染后的 HTML，把图片
自动旋转、缩放并转成小于 1MB 的 JPG/PNG，再上传至 `/cgi-bin/media/uploadimg`，
按转换后内容哈希去重并将 `src` 替换为微信返回的地址。封面优先使用文章首图，通过
`/cgi-bin/material/add_material?type=image` 上传为永久素材；首图不符合永久素材
要求或文章无图时使用 `public/header/logo.png` 默认封面。最后服务端从当前便签标题
生成不超过 32 字的草稿标题，携带主题化 HTML 和 `thumb_media_id` 调用
`/cgi-bin/draft/add`。响应只向浏览器返回草稿 `mediaId`、标题、主题和微信正文图片数。

该接口只接受当前页面的同源请求并强制登录，只从签名会话账号 ID 读取配置，不能由
请求体指定其他账号。微信官方限制正文少于 2 万字符且小于 1MB；超限、图片格式不符、
IP 白名单未放行或凭据错误都会停止发布并在页面显示原因，不会降级为另一个账号或
`.env` 凭据。无法解码或反复压缩后仍超过 1MB 的图片会给出明确错误。

公众号 HTML 继续使用内联样式以适配微信编辑器，但正文段落会从文章容器继承相同的
字体、字号、颜色、字重、行高、字间距和断行规则，不会在每一个段落与空行上重复写入
整套声明。长度校验在这种无损收紧之后执行，因此真实正文仍受 2 万字符限制，而十节
左右的常规长文不会仅因主题样式重复而被误判超限。

公众号组件不维护一套固定的暖白近似色，而是从五主题共享配置逐次读取当前主题，
每次服务端渲染都创建新的闭包上下文，避免并发请求或连续切换主题时串色。默认
暖白主题的纸面、双框、标题、正文和署名仍分别为 `#fffcf7`、`#e8e4dc`、
`rgba(70,53,38,.96)`、`#665749` 和 `#d7cec1`。仅锤子主题显示的外框四角各包含一个独立的 `6px`
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
`b5d3bd9587fa9a1226b25a0709ff61a450df29d96ca2f127c6afc0b8e193a60e`
的有效 PNG 直链，也可通过
`WECHAT_FOOTER_HAMMER_URL` 覆盖。这样能避免 `localhost` 和 Data URL 进入
内置署名；正文七牛图片则遵循上述 HTTP 直链产品约定。React 服务端渲染自动生成
的图片 preload `<link>` 会在写入剪贴板前移除，公众号收到的只包含可粘贴正文
节点。

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
   `QINIU_DOMAIN`，可选 `QINIU_PREFIX`、`QINIU_UPLOAD_TIMEOUT_MS`；兼容首选节点
   使用 `QINIU_UPLOAD_URL`，诊断私有网关时可用 `QINIU_UPLOAD_URLS` 提供逗号分隔
   的同协议节点。
2. `QINIU_CONFIG_PATH` 指向的 JSON。
3. 仓库根目录 `qiniu.json`。
4. 本地相邻项目 `../upload-local-image-to-qiniu/qiniu.json`。

兼容 JSON 使用现有图床项目的 `AK`、`SK`、`QINIU_BUCKET`、`QINIU_DOMAIN`、
`QINIU_PREFIX` 字段。仓库根目录的 `.env` 由 `npm run dev` 和 Docker Compose
自动加载，文件已被 Git 和 Docker 构建上下文忽略；可复制 `.env.example` 后填写
本地密钥。本地开发未提供 `.env` 时仍会复用相邻项目配置。生产环境应通过部署
平台的环境变量或 Secret 注入。没有上传地址覆盖时，由官方 SDK 查询 Bucket 区域
并使用查询结果中的主备上传节点；旧配置中的标准区域域名也不会成为唯一节点。

管理员凭据只从服务端的 `SUPERADMIN`、`SUPERADMINPASSWORD` 读取；不要使用
`VITE_` 前缀。生产环境还应配置独立的高熵 `SESSION_SECRET`。账号密码只保存
scrypt 盐与哈希，登录状态使用 HttpOnly、SameSite=Lax 的签名 Cookie。

AI 辅助审阅同样只读取服务端的 `OPENAI_API_KEY`、`OPENAI_BASE_URL` 和可选
`OPENAI_MODEL`，变量不得使用 `VITE_` 前缀。服务启动时会以有限时
`GET /models` 探测配置和鉴权；失败只关闭设置“工具与扩展”中的 AI 选项，不影响便签服务。
DeepSeek 当前默认选择 `deepseek-v4-flash` 并关闭 thinking。AI 消耗接口只允许
普通用户或 superadmin 登录后调用，并限制正文长度、并发与频率。

模型只返回 `original / replacement / reason` 原子建议。后端再次验证原文片段在
提交快照中唯一存在、建议互不重叠后，才派生可信的 `start / end`。前端内置“纠正
标点语法”“重点加粗”“通俗化润色”三种审阅要求，其中通俗化模式会把复杂长句拆成
易读短句，并把专业术语、抽象表达和行业黑话换成公众易懂的简单概念；不扩写且保留
原意、事实、语气和 Markdown 结构。收到建议时不调用 `setMarkdown`，每张建议卡
分别提供“确认修改”和“忽略”。原文与建议文本使用字符级 Diff：删除内容以红色
背景和删除线标注，新增内容以绿色背景和下划线标注，并显示修改处数，不能只靠
颜色传达差异。弹窗底部固定显示“接受剩余 N 条”，只批量接受仍待处理的建议，
保留已忽略项，并与逐条确认一样从原始快照重建正文。若当前便签、正文或云同步
版本在审阅期间发生变化，旧建议立即失效，不允许覆盖人工编辑。
模型没有发现需要修改的地方时必须返回合法的空建议数组，不能用空白响应表示；
“纠正标点语法”的空结果显示“大模型已检查，无需纠正”，其余模式显示
“大模型已检查，暂无修改建议”，正文均保持不变。
模型返回加粗建议后，前后端都会在展示或应用建议前把 `**正文 **`、`** 正文**`
这类标记内侧的空格移到标记外；行内代码和围栏代码保持原样。这样既保留原有空白，
又保证 CommonMark 能把建议稳定渲染为粗体，而不是把星号直接显示在预览中。

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
