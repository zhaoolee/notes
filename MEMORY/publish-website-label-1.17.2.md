# 发布按钮文案 — 1.17.2

2026-11-13，固定页脚的空闲发布按钮改为“发布到网站”；发布中/提交中状态、GitHub Pages 卡片说明、ZIP 按钮、禁用条件与发布行为均不变。相应文档引用和既有浏览器选择器同步更新。

- tag/source：`1.17.2` / `89734a48c7739fb849730b5c0846c8f9eb53e768`；远端分支 `codex/publish-website-label-1.17.2`，已核对远端 SHA。
- 仅部署 frontend；镜像 `sha256:abfeddd76d7c08ec571ea7af0f2bb88807188266f6e1d7cde05c324e2108bc31`，容器 `1330cabb9b6ba574b29f2d68ad6193af1ceb1b7e9758fb200957df2d3ddbce48`。公网 bundle `index-BAeSnUvK.js`。
- backend 保持 1.17.1，容器 `56e8f8c1328e39feb611fd062389aafd74a8d640f38046a3d296134c59961e0e` 未重启；镜像 `sha256:86f30f82421a76bca15234594f7f1315fb729f92626db6ece531826a4e5e7202`。生产 `.env` 哈希前后一致；没有发布、修改或读取私有草稿。
- 验证：前端 feedback 231 项、既有隔离浏览器 194 项通过，build:static/typecheck:app 通过；原工作区重点前端 21 项通过。浏览器桌面/手机布局验证确认新文案在 ZIP 前，没有重复按钮。没有新增镜像实现的冗余测试。
- 公网健康检查正常，公开静态站点 CSS 保持 system-ui 且无 @font-face；编辑器工作区匿名访问继续 401；公网前端 bundle 与已测试构建逐字节一致，线上 changelog 首个标题为 1.17.2 / 2026-11-13。
- 首次部署检查错误地固定了之前的静态 CSS 文件名，遇到已更新的公开样式后自动回滚。已改为读取当前 HTML 的实际 CSS 并验证 system-ui，再使用同一个已测试镜像重新部署成功。静态网站与 GitHub 分支未作任何改动，后端始终保持运行。
- 备份/回滚记录：`/home/hermes/notes-backups/20261113-publish-label-1.17.2-130256`，含原环境配置、前后端镜像/容器记录与发布结果。此次前端更新前保存了从上一份完整备份开始以来的 storage 修改，变化归档 `storage-since-full-backup.tar` 为 1,382,400 字节，仅保留生产机。完整基底为 `/home/hermes/notes-backups/20261113-system-fonts-1.17.1-120525/storage.tar`（3,380,131,840 字节）；变更时间起点 2026-11-13 12:05:25 +0800。该增量归档记录修改文件，不是独立全量备份；不要用于自动清空/重建当前数据。
- 前端回滚：1.17.1 源码 `86067b0b100aa04331bf721ab4d8e32b519e2183` 与镜像 `sha256:1502435d195b0ddf2909fdbb530d5b38401b5bb2daaf141ed97b9e42750d64cf`，仅 `docker compose up -d --no-build --no-deps frontend`，保留当前 backend/storage。
- 隔离验收截图：`/var/folders/sc/4hjtvbg91wl5cpy8210tf1_w0000gn/T/notes-site-browser-ZyakD1/footer-desktop.png`（模拟 GitHub，不是生产账号页面）。
- 发布在独立 checkout `/private/tmp/notes-pages-release-FVl8wX` 完成；原工作区只回填对应文案、选择器、文档及未发布日志，原 package 文件和其他未提交功能保留。
