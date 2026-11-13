# 本站静态站点自动发布 — 1.17.0

验证日期：2026-11-13。

## 行为和边界

- 发布到 GitHub Pages 成功后，指定账号自动把同一份已选择内容发布到 `https://notes.fangyuanxiaozhan.com/notes/`。GitHub 与本站分别报告状态；GitHub 没有文件变化时仍可重试本站更新。
- 本站单独使用部署公网 origin 与固定 `/notes/` 重新运行 Hugo 构建，因此不依赖 GitHub 仓库子路径。发布只读取本次请求快照，不自动发布后续编辑。
- 本站发布通过 `SITE_PUBLISH_LOCAL_ENABLED` 开启，`SITE_PUBLISH_LOCAL_OWNER_ID` 绑定唯一账号，生产绑定内置 `superadmin`。其他账号不能覆盖该站点；已存在站点还持久绑定 owner hash。
- 仅静态构建输出公开。`storage/data/published-site` 内的私有指针原子切换到完整 release，保留上一版本；构建、GitHub 发布或激活前失败不替换当前站点。重启将未完成的本站任务标记失败，用户可重试。
- Nginx 精确处理 `/notes` 重定向并代理 `/notes/`；缺失文件返回 404，不回退编辑器。公开静态站点带 CSP 与 nosniff，编辑器/API 原有登录限制保留。

## 发布与生产

- 发布分支：`codex/local-static-publishing-1.17.0`；版本 tag：`1.17.0`。
- 部署源码：`e9de8875dc699ab12a8ec96e6b988dfdf2ad773b`，分支/tag 远端已核对。
- 主机：`hermes-v2fy`；目录：`/home/hermes/github/notes`；前后端都运行 1.17.0。
- backend 镜像：`sha256:72371f894e4c8f31342f8fb893aca5d11cf4c09d3f26443168c42256622fc257`，容器 `81bb3335265e`。
- frontend 镜像：`sha256:8f95850c275f54011f6863b673f9b2f5581f24c540ccb4c26075a4bfd7dda44a`，容器 `6dd8ea86c8a9`。
- 前端 bundle：`index-CXZ83aTE.js`；OCI 标签记录相同版本和源码 SHA。
- 备份：`/home/hermes/notes-backups/20261113-local-site-1.17.0-033231`。包含原生产环境文件、回滚镜像记录及 `3350538240` 字节 storage.tar，已确认含原账号数据文件。备份只在生产机保存。
- 原有凭据、会话和加密配置保持原值，只启用两项本站发布配置；原持久化目录保持不变。
- 外部 Docker/Hugo 下载受阻时，在生产机从已存在可信运行镜像构建：backend 1.16.0 的 Node/Hugo/生产依赖与 frontend 1.16.4 的 Nginx；npm ci 与服务端/前端编译均使用精确本次源码。生产依赖 lock 与原 backend 一致，仅版本字段变化。覆盖旧编译产物后打 1.17.0 标签；临时构建文件位于备份目录，不改变仓库 Dockerfile 或网络配置。

## 初始内容

- 为立即提供新网址，从已经公开且构建成功的 GitHub Pages commit `e238ad9089a7b03a54c7b0bc32a83d4d8f315157` 初始化 34 个公开文件。
- 仅复制该公开提交中发布清单管理的静态文件，跳过 `.nojekyll` 与 CNAME；没有读取私有账号发布记录，没有触发真实 GitHub 发布，没有发布当前草稿修改。
- 初始化通过新镜像离线单次执行完成，只挂载独立 published-site 目录和公开文件包，拒绝覆盖已有 current.json。
- 初始文件保持原 GitHub 字节内容（含原站 canonical）；下次正常发布会针对本站 origin 重新构建 canonical。文章、资源与搜索链接均已使用 `/notes/`。

## 验证

- 全量 feedback：358 通过（前端 231、后端 110、DSH 17）；完整 build/typecheck 通过。
- 隔离浏览器验证 194 项通过，包括独立本站成功/构建/失败状态；无真实 GitHub 写入，无未处理浏览器异常。
- 后端涵盖真实 Hugo 双站构建、不同 GitHub 子路径、唯一 owner、GitHub 失败保护、本站失败保留、无变更重试、原子文件读取与重启恢复。
- 生产匿名检查 50 项通过：34 个公开文件逐字节一致、首页/文章/搜索、手机无横向溢出、静态缺失 404、保留 query 的相对 308 重定向、CSP、编辑器 API 匿名 401、健康与 AI 可用、changelog 首个版本标题 1.17.0 / 2026-11-13。没有资源请求失败、浏览器脚本或 CSP 错误。
- 用户 Chrome 已确认新网址显示静态便签站点，截图 `/private/tmp/notes-local-site-live-1.17.0.jpg`；生产检查结果 `/private/tmp/notes-live-verification-1.17.0.json`。
- 本次没有对真实账号草稿、登录凭据或 GitHub 仓库进行验证性发布。匿名导出、账号同步与存量数据写入未做生产变更测试；完整隔离反馈通过。

## 回滚

- 回滚源码/tag：1.16.4，`d0493c466815fe85f5777ddd082c8edf475b7388`。
- 发布前实际 backend 镜像为 1.16.0：`sha256:fcd552e614d70651f162d118f38caf92841007ee3ebedb21d1593281dd155d30`。
- 发布前实际 frontend 镜像为 1.16.4：`sha256:69b6b632718d15504445d7e09ee50f35a0f26008b2c44cfdb19071cc06c9b8d3`。
- 应用回滚恢复备份环境配置及以上镜像，保留当前 storage。不要覆盖账号数据或删除持久化目录；如需要恢复数据，须另行明确授权。

## 工作区隔离

原工作区含大量其他未提交功能，全部保留；本次只把必要差异回填。发布在 `/private/tmp/notes-pages-release-FVl8wX` 的干净独立 checkout 完成，未合并或提交原工作区的其他改动。
