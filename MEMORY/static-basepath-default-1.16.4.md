# 静态网站默认部署子路径 1.16.4

## 2026-11-13

- 用户要求静态网站支持配置项目子路径，默认 /notes，与已发布的 GitHub Pages 地址一致。已有 basePath 能力继续使用：发布为网站 → 高级设置 → 部署子路径（basePath）。新草稿默认常量 DEFAULT_SITE_BASE_PATH 为 /notes/，输入 /notes 在构建时规范化为 /notes/；可以替换为 /blog/、更深路径或根路径 /。站点域名继续可选。
- 只改变新草稿默认值与帮助文字。账号/本机保存过的 /、自定义路径、旧 rootPath、显式空串与无效草稿输入仍保留，不自动迁移或重新发布。不修改用户的 GitHub Pages 分支、签名清单、域名、仓库绑定或现有账号配置。
- githubSiteLocation 的既有映射逻辑不变且补充了回归：Pages 项目根 /notes/ 配置 /notes 或 /notes/ 最终仍是 /notes/，gh-pages 文件前缀为空；/notes/blog/ 与 /blog/ 在该项目下都映射 /notes/blog/。根域名 Pages https://blog.example.com/ 配置 /notes/ 则是 https://blog.example.com/notes/，文件前缀 notes/。避免混淆项目路径和站内子目录，也避免 /notes/notes/。
- 完整反馈 348 项通过（前端 227、后端 104、DSH 17），完整构建/typecheck 通过。新增真实 Hugo 默认 /notes/ 空域名集成检查配置、Logo、导航、文章与搜索路径；保留根路径/嵌套路径与有无域名的既有构建验证。根路径路由用例显式指定 /，不依赖新默认值。账号同步与草稿保存覆盖默认、根路径、自定义路径和旧输入的兼容。
- 隔离发布线浏览器 182 条断言通过，临时产物 notes-site-browser-KgL4VS，GitHub 使用模拟提供商，实际 Hugo/ZIP 生成与静态资源验证保持可用；原工作区首次浏览器 185 条通过，最终路径映射与账号同步专项两边均通过。未安装依赖或启动模拟器。
- 部署标签 1.16.4，精确源码 d0493c466815fe85f5777ddd082c8edf475b7388，远端分支 codex/static-basepath-default-1.16.4。隔离副本 /private/tmp/notes-pages-release-FVl8wX 基于 1.16.3 发布线；原工作区同步该改动，其他待办与文件夹迁移未部署。
- 仅更新 frontend：notes-frontend:1.16.4/latest 镜像 sha256:69b6b632718d15504445d7e09ee50f35a0f26008b2c44cfdb19071cc06c9b8d3，容器 9cfda4053e39。唯一后端容器 405575fb5635 未重启，继续使用 1.16.0 镜像 sha256:fcd552e614d70651f162d118f38caf92841007ee3ebedb21d1593281dd155d30；后端已有路径构建与发布能力，接口/验证无需更新，前端传递显式设置。保留现有凭据、持久化结构和运行时网络。
- 继续使用私有目录中的可信缓存构建覆盖文件：Node 工具链来自 notes-backend:1.16.0，Nginx 来自 notes-frontend:1.16.3；从本次精确源码 npm ci --include=dev、typecheck 与 build:static，清除旧静态资源，不改仓库标准 Dockerfile、主机 DNS。新资源 index-DNtfGKDs.js 与本地一致，OCI version/revision 对应本次标签与源码。
- 本机/公网 health 正常，AI available=true，首页与 /changelog 均 200。生产前端隔离浏览器使用全部拦截的合成账号 API 验证 freshDefault=/notes/、savedRootPreserved=true、实际加载新资源以及首个 changelog h2 为 1.16.4 - 2026-11-13；没有读写真实账号。截图 /private/tmp/notes-basepath-production-1.16.4.png 可见路径输入、帮助和预览；报告 /private/tmp/notes-basepath-production-check.json。
- 上线前私有服务器备份 /home/hermes/notes-backups/20261113-basepath-1.16.4-011126，含 production.env、rollback.json、3333601280 字节 storage.tar（核验包含 notes-data.json）与 release-result.json；备份和凭据未离开服务器。回滚源码到 1.16.3，重新标记 notes-frontend:1.16.3 为 latest，然后 docker compose up -d --no-build --no-deps frontend。旧前端 sha256:7aa918dfa0393b6956277a3c720c9561e6260fe7a42c1eb0f7f39a95e90ab10f 保留；无需恢复用户数据。未重复不受影响的后端生产 PNG/ZIP 写入或存储重启验收。
