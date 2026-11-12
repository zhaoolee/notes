# GitHub Pages 页脚动作 1.16.1

## 2026-11-12

- 用户要求将“发布到 GitHub Pages”放到面板固定底部、“生成网站 ZIP”之前。现已上线到 https://notes.fangyuanxiaozhan.com/；授权、仓库选择与发布结果继续留在 GitHub Pages 卡片。仅已连接账号显示发布按钮，原有禁用、提交与发布中状态沿用同一控制器。
- 发布标签 `1.16.1`，源码提交 `8ea2f8191903444eba06c4527883f78a986b69d4`，远端分支 `codex/github-publish-footer-1.16.1`。在 `/private/tmp/notes-pages-release-FVl8wX` 基于 1.16.0 发布线制作隔离补丁；原工作区同步了这项改动，但其余未提交功能未部署。
- 完整 feedback 343 项通过（前端 224、后端 102、DSH 17），最终 GitHub/panel 专项 32 项通过，完整 build 含 TypeScript 检查通过。隔离浏览器 163 条断言通过，验证唯一 footer 按钮、位于 ZIP 前、卡片无重复按钮、桌面正文滚动后固定可见、390×844 手机双按钮全部处于视口内且无横向溢出、发布中禁用。GitHub 使用模拟提供商，未为本次验证发布真实便签。报告及桌面/手机截图目录为 `notes-site-browser-zULf6z`。
- 仅从精确源码重建并更新 frontend。沿用上次已验证的本地运行时镜像构建方法，在私有备份目录覆盖构建 Dockerfile：Node 工具链来自 `notes-backend:1.16.0`，Nginx 来自 `notes-frontend:1.16.0`，执行 npm ci --include=dev 与源码 build:static，并清除旧静态资源。仓库 Dockerfile、凭据、主机 DNS 与运行时网络未修改。
- 新前端镜像 `notes-frontend:1.16.1` / latest：`sha256:842542f558607f6c23213593eda599f63d920ced5fa330ed6b086acb2c31faf9`，OCI version/revision 对应发布标签与提交。前端容器 `6040757e56be`。唯一后端容器 `405575fb5635` 保持运行，仍使用 1.16.0 镜像 `sha256:fcd552e614d70651f162d118f38caf92841007ee3ebedb21d1593281dd155d30`，无需打断会话或发布任务。
- 生产 Git 工作区干净；本机、公网 health 正常，公网 AI available=true，首页加载与本地一致的新资源 `index-Dtaw_HkJ.js`，/changelog 返回 200，独立匿名浏览器渲染的首个版本标题为 `1.16.1 - 2026-11-12`。Chrome 使用已有登录会话打开发布面板，确认已连接账号与仓库保持不变，页脚中依次显示发布按钮、ZIP，卡片保留既有成功结果。本次不重复执行后端 PNG/ZIP、存储重启等未受影响流程的生产写入验收。
- 更新前备份位于服务器 `/home/hermes/notes-backups/20261112-footer-1.16.1-072045`，包含受限权限 production.env、rollback.json 与完整 storage.tar，已核验含 storage/data/notes-data.json。备份配置与数据没有离开服务器。release-result.json 保存镜像、提交与后端未重启证据。
- 回滚只需将生产源码切回 `1.16.0`，把 `notes-frontend:1.16.0` 重新标记为 latest，执行 `docker compose up -d --no-build --no-deps frontend`；无需恢复账号或图片数据。旧前端镜像 `sha256:d8403bf77c8e2107ce3da2324708373a42efa1cca54c4e92f8cd584e034c86d6` 保留。
