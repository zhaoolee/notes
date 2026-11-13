# 发布为网站

## 入口与操作

登录后点击桌面左下角账号，在“进入管理后台”上方选择“发布为网站”。普通账号同样可以使用；手机可从设置的“工具与扩展”进入。

面板独立于编辑器。打开后主区域直接按网站分类分组展示已选便签：每个分类卡片有分类名、数量和“添加便签”，没有便签的分组只显示组头和添加入口，不铺空状态说明。宽屏显示两列分类卡片、窄屏单列；卡片内不再套独立纵向滚动，统一由面板正文滚动。点击某组的“添加便签”才在该组展开便签选择器，带搜索、checkbox 和“完成”关闭入口，只列出非回收站便签；checkbox 表示“在当前组”，勾选已属于其他组的便签会把它移动到当前分类，不会重复发布，选择器用小 badge 标出原分类。组内每条便签显示标题与紧凑的移除按钮，选择、移除与归类继续保存在原 `draft.selections` 中。站点设置与分类编辑收在默认折叠的“高级设置”里：网站标题、简介、站长名、Logo、可选站点域名、部署子路径（basePath）与网站样式（仅在多种模板时出现），以及分类改名和删除入口。默认展开的是分类分组，不需要先操作网站设置信息。

默认分类是做法、软件、硬件、项目、杂谈，分别使用 guides、software、hardware、project、log 路径。主区域底部的“添加分类”按需展开一行名称、路径与创建按钮，创建成功后收起并清空；分类改名/路径与删除入口在高级设置的分类编辑区，仍有已选便签的分类需先移出便签才能删除，默认分类不可删除。关于页不属于默认文章分类。

发布设置按登录账号保存在服务端 `notes-data.json`，包括网站标题、简介、站长名、可选域名、basePath、Logo、网站分类、已选便签 ID 及其分类。换浏览器或电脑登录同一账号后打开面板即可恢复；不会把便签正文另存进配置。当前浏览器仍缓存未同步编辑，短时离线可恢复。账号尚无配置时自动迁入当前浏览器的旧 v1 草稿；已有账号配置时优先读取账号版本，避免旧浏览器覆盖新设置。删除或移入回收站的便签不会重新勾选。界面显示“站长名”，内部仍使用 `author` 字段，与旧值、账号同步和 Hugo 模板契约一致。

编辑后自动保存，关闭面板时提交最后修改。面板只显示简短保存状态；同步失败时提供重试，不会误报已保存。底部固定操作区显示保存状态，并在已连接 GitHub 时按“发布到 GitHub Pages”“生成网站 ZIP”排列，发布按钮位于 ZIP 之前；未配置或未连接 GitHub 时只显示 ZIP。授权、仓库选择与发布进度仍在默认折叠的 GitHub Pages 卡片，展开后可查看和操作；已连接时固定底部的发布按钮不受折叠影响。退出统一使用右上角关闭按钮或 `Escape`，不保留重复的“返回编辑”。高级设置每次打开面板都默认折叠，展开编辑后再次折叠或重新打开都不会丢失已填写的值。分组卡片内的便签列表与选择器都不带独立滚动区域，全部内容随面板正文一起滚动，避免多层滚动框裁切卡片；组内标题行保持标题与小型移除按钮的紧凑对齐，长标题最多两行。新增分类的名称、路径与按钮在常规宽度下保持一行，按钮随文字收缩，只有极窄时才换行。保存采用版本比较，同一账号两端同时修改时保留当前编辑并显示“使用账号设置 / 保留当前设置”，不会自动覆盖另一设备版本。账号退出或切换会取消在途请求，旧响应不会串到其他账号。Logo 图片保存在同一服务端图片目录，配置保存其相对路径，因此换浏览器仍能预览和导出。

## 网站 Logo

网站设置中的 Logo 默认为锤子图标 `public/smartisan/web/smartisan_hammer_footer.png`，也可以上传自定义图片。默认状态只显示“上传图片”；更换后才显示“更换图片”和“恢复默认”。支持 PNG、JPEG、WebP、GIF、AVIF，单张不超过 2MB，明确拒绝 SVG；建议使用正方形图片，但面板不强制裁切。上传复用现有 `POST /api/images/import`，账号配置和浏览器缓存只保存服务端 `/images/` 图片路径，不把大图 base64 写进 localStorage，也不修改当前便签或用户全局签名 Logo。上传失败时保留原 Logo；上传过程中不能导出，避免使用尚未保存的配置。预览失效会提示并可恢复默认。

服务端导出时只读取已上传到本机图片目录的 Logo，用 sharp 解码并等比缩放到 256×256 透明背景 PNG，打包为 `static/logo.png`。生成站点的品牌 Logo 和 favicon 都使用这份文件，CSS 使用 `object-fit: contain`，非正方形图片不会拉伸。未设置自定义 Logo 时继续打包默认锤子图标。Logo 损坏、超过 2MB 或无法解码会明确报错，不会悄悄回退默认图标；导出配置和 HTML 不引用 notes 的 `/images/` 运行时路径，生成的静态站点仍可独立部署。

## 域名与部署子路径

部署子路径采用 [Next.js 官方已使用的 `basePath` 命名](https://nextjs.org/docs/app/api-reference/config/next-config-js/basePath)。位置在发布面板默认折叠的“高级设置”→“部署子路径（basePath）”。新建草稿默认 `/notes/`，也可填写 `/blog/` 等自定义子路径，根域名填写 `/`；生成网站时会统一补齐首尾斜杠。已保存的设置（包括旧根路径 `/`、自定义路径和旧 `rootPath`）仍以实际保存值为准，不会因为新默认值自动迁移、改写或重新发布。各框架的配置字段并不统一，写入 Hugo 配置时仍使用 [Hugo 官方字段 `baseURL`](https://gohugo.io/configuration/all/#baseurl)（填写域名时为完整地址，留空时为 `basePath`）。前端草稿、接口请求与导出数据只使用 `basePath`；旧版本机草稿或旧客户端仍提交 `rootPath` 时仅作兼容读取，新字段存在时以新字段为准（即使它是空串或非法路径，也保留给 UI 报错，不回退旧值）。


站点域名是可选字段，默认留空，不会预填 `example.com`。留空时，导出的 Hugo `baseURL` 直接使用规范化后的 basePath，例如新草稿的 `/notes/`、根路径 `/` 或自定义的 `/knowledge/notes/`；页面导航、分类、图片、字体、脚本、CSS 与搜索索引全部使用 `RelPermalink` 等相对当前站点的路径，不写入 `example.com`、`localhost` 或其他占位域名。此时不输出 canonical，不生成需要绝对 URL 的 RSS 与 sitemap，首页只输出 HTML 与搜索 JSON；`robots.txt` 也不会指向不存在的 sitemap。面板会显示“部署路径：/blog/”，部署时沿用当前网站域名。

填写域名时只填协议和域名，例如 `https://example.com`；basePath 新草稿默认为 `/notes/`，也可填 `/`、`/blog/` 或 `/knowledge/notes/`，会统一补齐首尾斜杠。为避免文件路径和 URL 转义歧义，basePath 只接受英文字母、数字、短横线、下划线与斜杠。空白域名会被规范化为空串；非空但不完整、带账号密码、查询参数或子路径的域名仍会明确报错，不会被静默忽略。

例如域名 `https://example.com`、basePath `/blog/`，生成后的首页地址为 `https://example.com/blog/`，并生成完整的 canonical、RSS 与 sitemap。无论是否填写域名，搜索索引都使用相对链接，由浏览器按当前静态站点地址解析。未填写域名时，同一份静态文件可以部署到不同域名的相同 basePath；修改 basePath 或已填写的域名配置时，应重新导出。

ZIP 中的 README 会按当前模式写明访问方式：填写域名时给出真实最终地址；留空时说明部署到当前网站域名的对应 basePath，不会写出 `https://example.com/blog`。Hugo 源码、`public/` 与部署说明在两种模式下都会保留。

## ZIP 内容与部署

```text
notes-hugo-site/
  hugo.json
  content/<分类>/<文章稳定ID>/index.md
  content/<分类>/<文章稳定ID>/index.assets/
  layouts/
  assets/
  static/logo.png
  static/
  public/logo.png
  public/
  .github/workflows/pages.yml
  README.md
```

`public/` 已经由服务端 Hugo 构建，可以直接部署。例如 basePath `/blog/` 时，把 **public 内的文件** 放在现有站点的 `/blog/` 对应目录，避免再多嵌套一层 public。该静态站点不依赖 notes 运行。

保留其余源码可以修改内容后用 Hugo 重新构建。ZIP 附带独立仓库的 GitHub Pages 工作流：在仓库 Settings → Pages 中选择 GitHub Actions。已有域名主站的子路径应由主站服务或发布流水线合并静态文件，不要把整个主站替换为本次 ZIP。

第一期只生成和下载 ZIP，不连接 GitHub 账号，也不自动推送或部署。

## 样式与内容转换

唯一模板 ID 是 `smartisan-blog`，显示名“经典便签博客”。模板参考 `zhaoolee/zhaoolee.github.io` 的暖色纸面、三百像素侧栏、最新与专题切换、文章目录、移动导航和代码复制。模板文件表由 `server/site-publishing/theme.ts` 管理，可按稳定 ID 扩展其他样式。

面板中的“网站样式”选项位于高级设置，由 `src/features/site-publishing/model.ts` 的 `SITE_THEMES` 元数据列表生成。当前列表只有 `smartisan-blog` 一项，因此完全不渲染样式选择区；默认 `themeId` 仍参与本机/账号保存与导出，不会因为隐藏选择区而改变导出结果。以后追加第二种模板时，选择区按列表自动出现，不需要改回硬编码开关。

字体与背景从 notes 自带资源复制，导出时不依赖 GitHub 下载模板。个人统计、广告、域名和文章不进入新网站。搜索使用 Hugo 生成的本地 JSON 索引和浏览器脚本，不需要第三方服务。

文章使用 Markdown 语法树收集内联与引用式图片，不处理代码块和行内代码中的图片示例。图片按内容哈希复制进文章包，正文替换为相对引用。相同文章内的重复图片只保存一次；不同文章的资源保持独立。

若正文首个非空行是与文章标题完全相同的 Markdown 标题，导出时去掉这一个重复标题，保留模板的文章标题；普通开头段落和后续章节不会删除。

原始 HTML 作为普通文字保留，Hugo shortcode 转义为原文显示，不能执行用户正文中的模板。标准 Markdown 标题、列表、表格、任务列表和代码块交给 Hugo 渲染；便签卡片的居中和连续空行等特殊排版不承诺逐像素迁移。

首页的网站简介只显示一次：`content/_index.md` 只把简介写入 `description` front matter（同时用于页面 meta 描述），不再写进 Markdown 正文；模板在首页标题下用 `site.Params.description` 渲染 `.home-description`，`.Content` 保持可用但首页正文为空。简介留空时首页不渲染 `.home-description`。

文章路径由便签 ID 哈希生成，改标题不会改 URL；改网站分类路径会改变文章 URL，第一期以完整重新导出为准，不自动修改已部署站点或生成历史跳转。

## 服务端结构与边界

账号配置接口为 `GET/PUT /api/site-publishing/config`，导出接口为 `POST /api/site-publishing/export`，仅允许网页登录 Cookie 会话且校验同源。请求只提交本次设置、分类及已选择便签，不提交整个工作区。私有部署仍经过现有统一鉴权。

- `src/features/site-publishing/`：数据契约、独立面板、主区域分组与组内便签选择器（`SitePublishContent.tsx`）、局部样式、本机草稿与下载客户端。
- `src/features/site-publishing/account-sync.ts`：账号配置读取、串行自动保存、版本冲突与本机缓存迁移。
- `server/site-publishing/configuration.ts`、`config-route.ts`：受限草稿结构、Cookie 同源接口与版本比较；账号数据存储沿用 `NotesDataStore` 的原子写入队列。配置总量不超过 1MB，允许保留编辑中的标题、域名和分类，导出时再严格校验；请求不能指定其他账号。
- `server/site-publishing/route.ts`：鉴权、并发限制、超时、取消和 ZIP 响应。
- `server/site-publishing/build.ts`：生成可信站点目录、处理自定义 Logo、调用 Hugo、收集源码和静态输出。
- `server/site-publishing/markdown.ts`：Markdown 图片转换和 shortcode 转义。
- `server/site-publishing/assets.ts`：受限本地图片、data URL 与公开 HTTPS 图片读取。
- `server/site-publishing/theme.ts`：可扩展的模板文件表。

每个账号同时只允许一个任务，全进程最多两个。每次至少选择一张便签，支持 1–30 个分类，不设 200 张便签上限（该限制曾由 notes 自行设置，不是 Hugo 限制），单张正文不超过 512KB、正文总计不超过 5MB；单张图片不超过 10MB、不同图片总计不超过 40MB；源码与静态文件累计不超过 80MB。请求最多运行 120 秒，Hugo 构建最多 60 秒。代理等待时间设置为 150 秒。

图片只允许图片存储目录或 public 目录内的真实图像；路径越界和指向目录外的符号链接会被拒绝。远程图片只接受 HTTPS，限制端口、大小、重定向和时间，校验 DNS 并固定实际连接地址，继续用原域名验证 TLS；拒绝内网与元数据地址。沿用项目代理兼容约定，公网域名经本机代理返回的 `198.18.0.0/15` fake-ip DNS 可以使用，直接访问该段 IP 的 URL 仍被拒绝。

Hugo 只执行随服务提供的可信模板，禁止模板启动外部命令、读取环境变量和抓取网络资源。构建子进程不继承服务凭据，使用独立临时目录，成功或失败均清理；用户关闭面板会取消请求和构建。下载失败不会产生部分 ZIP。

## 运行与验证

源码本机运行需要安装 Hugo Extended 0.162.1 或兼容版本；可通过服务端 `HUGO_BIN` 指定可执行文件路径。Docker 的后端、单容器应用及开发后端已通过 `scripts/install-hugo.sh` 安装固定 0.162.1，支持 amd64 和 arm64，校验官方和固定 SHA256。

```bash
npm run build
node --import tsx --test backend/tests/site-publishing.test.ts frontend/tests/site-publishing-panel.test.ts
node scripts/verify-site-publishing.mjs
# 空域名模式：清空站点域名并验证部署路径、搜索相对链接及无 canonical/RSS/sitemap
SITE_PUBLISH_NO_ORIGIN=1 node scripts/verify-site-publishing.mjs
```

浏览器脚本默认验证打开面板时“高级设置”折叠、五个分类分组直接可见且没有预选便签；展开后才上传/恢复 AVIF Logo、填写网站标题、域名与 basePath，折叠再展开确认不丢值；随后按组添加、移动、移除便签，新增分类并在高级设置中验证有便签的分类不可删除。关闭重开与刷新后高级设置重新折叠、分组选择仍在；用没有本机缓存的第二个浏览器上下文验证跨浏览器恢复和版本冲突；最后下载 ZIP，检查 `public/logo.png` 与 `static/logo.png` 为同一份 256×256 透明 PNG，页面品牌和 favicon 指向 basePath 下的该文件，且导出文件不含 notes 的 `/images/` 依赖。两种域名模式都会执行这些检查。

最后两条命令需要本机 Chromium 与 Hugo，使用临时账号、工作区及图片目录启动独立后端，验证实际账号菜单、分类、ZIP 下载和生成站点。默认运行填写静态域名模式，`SITE_PUBLISH_NO_ORIGIN=1` 会清空域名并按当前静态 host 解析搜索索引中的相对链接。测试截图及报告保存在命令返回的临时路径，不修改日常工作区，不启动 iOS 模拟器。

## 一键发布到 GitHub Pages

在网站发布面板的 GitHub Pages 卡片授权并选择仓库，可从固定底部操作区点击“发布到 GitHub Pages”直接发布所选便签；该按钮位于“生成网站 ZIP”之前，授权、仓库选择与发布进度仍留在默认折叠的卡片，展开后可查看和操作；已连接时固定底部的发布按钮不受折叠影响。ZIP 导出继续可用。管理员配置、目录保护和故障恢复详见 [GitHub 一键发布](github-site-publishing.md)。
