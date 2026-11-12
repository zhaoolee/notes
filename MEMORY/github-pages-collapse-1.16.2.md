# GitHub Pages 默认折叠 1.16.2

## 2026-11-12

- GitHub Pages 设置与发布结果改用原生 details/summary，打开网站发布面板时默认折叠，视觉、鼠标与键盘操作与相邻高级设置一致。展开/收起不会卸载控制器、清空仓库或中断状态轮询；已连接时，底部唯一发布按钮不受折叠影响。每次重新打开面板默认收起，不自动展开授权、错误或发布状态。
- 生产网址 https://notes.fangyuanxiaozhan.com/，标签 `1.16.2`，精确源码提交 `373b193c1bce38a50fe99f1b991ef613f97a106d`，远端分支 `codex/github-pages-collapse-1.16.2`。基于 1.16.1 发布线隔离制作，原工作区同步同项改动，其他待办功能没有部署。
- 完整反馈测试 343 项通过（前端 224、后端 102、DSH 17）；完整 build/typecheck 通过。隔离发布线浏览器验证 178 条通过：默认关闭、内容隐藏、键盘 Enter/Space 切换、保留仓库、重新打开恢复任务但默认折叠、关闭时点击页脚恰好发出一次发布请求并禁用、展开查看任务，保留桌面与 390×844 手机布局检查。GitHub 提供商为模拟，未发布真实便签。产物目录 `notes-site-browser-zeN1uB`，含 github-collapsed-desktop.png、github-collapsed-mobile.png、github-expanded.png。原工作区独立 build/typecheck、浏览器 181 条与相关单测 48 项通过，未将其混合源码用于发布。
- 仅更新 frontend。新镜像 `notes-frontend:1.16.2` / latest：`sha256:e18a27ec92cc4b05b88a98f72c007717f6a399b7990e0d780340a2127c8f0a6c`；OCI version/revision 对应标签与源码。前端容器 `2c8640567a01`。唯一后端容器 `405575fb5635` 未重启，仍使用 1.16.0 后端镜像 `sha256:fcd552e614d70651f162d118f38caf92841007ee3ebedb21d1593281dd155d30`。
- 沿用已验证的可信缓存构建路径：构建 Node 工具链来自 notes-backend:1.16.0，Nginx 运行时来自 notes-frontend:1.16.1，在服务器私有目录覆盖构建文件，仍从精确源码执行 npm ci --include=dev 与 build:static，并清除旧静态资源。标准仓库 Dockerfile、主机 DNS、运行时网络和凭据未变。新资源 index-D8gvI4BW.js 与本地构建一致。
- 本机/公网 health 正常，公网 AI available=true、首页与 /changelog 均 200；独立匿名渲染的 changelog 首个 h2 为 `1.16.2 - 2026-11-12`。Chrome 使用已有登录会话确认 GitHub Pages、高级设置都默认折叠，页脚依次为发布按钮与 ZIP，均可用；没有点击真实发布。生产截图 `/private/tmp/notes-github-collapsed-production-1.16.2.jpg`。后端、凭据与持久化结构不变，本次不重复生产 PNG/ZIP 写入或重启存储验证。
- 上线前服务器备份 `/home/hermes/notes-backups/20261112-collapse-1.16.2-081851`，包含权限受限的 production.env、rollback.json、3296286720 字节 storage.tar，核验含 storage/data/notes-data.json；配置与数据未离开服务器。release-result.json 保存提交、镜像及后端未重启记录。
- 回滚版本为 1.16.1：源码切回该标签，重新标记 notes-frontend:1.16.1 为 latest，然后 docker compose up -d --no-build --no-deps frontend。旧前端镜像 `sha256:842542f558607f6c23213593eda599f63d920ced5fa330ed6b086acb2c31faf9` 保留。无需恢复账号或图片数据。
