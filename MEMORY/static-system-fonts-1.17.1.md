# 静态网站使用系统字体 — 1.17.1

2026-11-13 已完成生产发布与现有公开站点迁移。

## 行为

- Hugo 静态模板移除 OPPO Sans 的三个 `@font-face`，改为 `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`。
- 静态站点构建不再复制 R/M/B 三个 WOFF2 文件，ZIP、GitHub Pages 和本站镜像均适用。编辑器、PNG 导出和离线归档的字体逻辑保持原样。
- 已公开两站也立即更新；只改 CSS、对应 stylesheet URL / integrity 与托管文件清单，未发布任何未公开的草稿。

## 版本与生产

- 源码/tag：`1.17.1`，`86067b0b100aa04331bf721ab4d8e32b519e2183`。
- 远端分支：`codex/static-system-fonts-1.17.1`。源码在独立干净 checkout `/private/tmp/notes-pages-release-FVl8wX` 发布；原工作区其他未提交改动全部保留，只回填本次必要差异，原 package 版本没有被覆盖。
- 生产主机 `hermes-v2fy`，仓库 `/home/hermes/github/notes`。
- backend：`sha256:86f30f82421a76bca15234594f7f1315fb729f92626db6ece531826a4e5e7202`；容器 `56e8f8c1328e39feb611fd062389aafd74a8d640f38046a3d296134c59961e0e`。
- frontend：`sha256:1502435d195b0ddf2909fdbb530d5b38401b5bb2daaf141ed97b9e42750d64cf`；容器 `e566c847cc817f154fdd84113261848f4e44b9aa8e8cd03f80cb0101dfb67473`。
- 前端 bundle `index-uI3Pp-YH.js`，本机与生产构建一致；镜像 OCI version/revision 对应 1.17.1 / 上述 SHA。
- 沿用上次缓存运行时构建方法，以 1.17.0 为构建和运行基底，精确本次源码 `npm ci`、服务端/前端编译通过。依赖未变更；没有修改仓库 Dockerfile、网络或 DNS。
- `.env` 字节哈希前后相同，原凭据、会话和加密配置未变更，持久化目录未变更。后端日志正常且 AI 启动探测可用。

## 公开站点迁移

- 基于当时已公开 gh-pages commit `8f283aedacf213f50ef07fe00b7e5dbac7d989be` 的发布清单读取公开文件，包含用户刚发布的四篇便签；没有读取私有账号记录或当前编辑草稿。
- CSS 使用新 SHA256 指纹文件名与 SRI，14 个 HTML 页同步更新链接。先在本地验证页面/文章正常且无字体请求。
- GitHub connector 未提供本次所需的原子多文件 tree 更新，使用项目已有 `commitStaticSite` 在生产机完成所有公开文件及 HMAC 清单更新；服务凭据与签名密钥留在现有进程环境，没有打印或导出。
- App token 仅限 `zhaoolee/notes` 仓库；通过指定仓库 installation 获取，不读取账号私有授权记录。提交检查原 head，遇到外部新提交即停止，禁止用陈旧快照覆盖新内容。使用非 force ref 更新。
- GitHub 公开提交：`f9fc4d9eec91c60f9429b992298a6ae7c9931cc9`，Pages build 已确认精确 commit 为 `built`。新增 1、修改 15、删除 4、未变 18；删除旧 CSS 与三个字体。
- 本站在短暂停止唯一后端写入者后，读取当时实际公开 release，只做相同字体迁移，由 `LocalSitePublisher` 原子激活；没有把 GitHub 快照覆盖本站其他内容。保留上一版本。
- 两站各移除 `14,601,068` 字节字体资源，公开文件从 35 减至 32；新样式 `/notes/css/site.min.3d78defefe7b424feccca298cfa2e05256199374f745cc44ccdae7c91ee77859.css`。

## 验证

- 358 项全量 feedback 通过（前端 231、后端 110、DSH 17），完整 typecheck/build 通过。
- 首次沙箱全量运行因 HTTP 监听权限失败，已沙箱外重试；随后一次登录测试子进程偶发提前正常退出，单独重跑成功，最终再次全量 358 项全部通过，无测试修改掩盖失败。
- 既有隔离浏览器脚本 194 项通过，使用模拟 GitHub/临时账号，不操作生产草稿。
- 两站真实浏览器验证：首页、文章、搜索、移动布局均通过；font requests = 0，浏览器错误 = 0，资源失败 = 0，计算字体为 system-ui，CSS SRI 正确。
- GitHub 32 个公开文件与准备的字体迁移版本逐字节相同。本站旧 OPPO font URL 返回 404。编辑器工作区和 GitHub 状态 API 匿名请求继续 401。
- 公网与本机 health 正常，AI available，线上 changelog 第一个标题为 `1.17.1 - 2026-11-13`。
- 用户 Chrome 已确认渲染；截图 `/private/tmp/notes-system-fonts-live-1.17.1.jpg`，生产验证结果 `/private/tmp/notes-system-fonts-live-result.json`。
- 本次没有重新验证生产账号登录、同步或 PNG/图片写入；未改这些逻辑，相关隔离 feedback 已通过。

## 备份和回滚

- 备份目录：`/home/hermes/notes-backups/20261113-system-fonts-1.17.1-120525`；包含原环境文件、rollback.json、`3,380,131,840` 字节 storage.tar、源码 bundle、公开文件包、迁移脚本与发布结果。归档包含 `storage/images`、`storage/data`，已验证原账号数据文件条目存在，备份数据仅保留生产机。
- 主机用户无权直接读 app-owned 私有文件，备份通过原运行容器只在本机归档完成；没有导出账号数据到本地。
- 应用可回滚到 1.17.0 / `e9de8875dc699ab12a8ec96e6b988dfdf2ad773b`：backend `sha256:72371f894e4c8f31342f8fb893aca5d11cf4c09d3f26443168c42256622fc257`，frontend `sha256:8f95850c275f54011f6863b673f9b2f5581f24c540ccb4c26075a4bfd7dda44a`。保留当前 storage，不要恢复旧账号数据或删除持久化目录。
- 公开内容回滚应保留签名清单的完整一致性；可从历史已公开 commit 恢复或重新发布，不手动编辑清单。数据恢复需要另行明确授权。
