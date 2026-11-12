# GitHub Pages 1.16.0 生产发布

## 2026-11-12

- 生产网址：`https://notes.fangyuanxiaozhan.com/`。部署标签 `1.16.0`，精确提交 `8a0b8d35f1286fa756158e1d26c6ecbbe06c544e`；远端发布分支为 `codex/github-pages-release-1.16.0`。发布基于生产 1.15.1 的 `8785dbf81f87e18cfcfc2315f3f7c6d058608824`，隔离 checkout 位于 `/private/tmp/notes-pages-release-FVl8wX`，未提交或部署原工作区的 AI 审阅、文件夹分类迁移等其他待办修改。
- 本次只增加 GitHub App 连接、仓库选择、显式发布与后台进度、增量 gh-pages 提交及文件所有权保护。原有默认分类与 ZIP 导出保持兼容。普通用户无需填写 Token；部署 App 为 `zhaoolee-notes`，安装范围目前仅限其所有者账号。
- 本地 `npm ci`、完整 `npm test` 343 项通过（前端 224、后端 102、DSH 17），生产构建含全部 TypeScript 检查通过。DSH 测试需先在 `dsh-plugin/` 安装其独立开发依赖。真实浏览器隔离验证 151 项通过，临时报告目录 `notes-site-browser-bU8L2k`；GitHub 提交/Pages 状态使用模拟提供商，不代表已发布真实便签。
- 生产构建遇到官方 Hugo 归档 GET 停滞与 Docker Hub registry 连接超时。仅在服务器私有备份目录生成构建覆盖文件：后端复用现有可信生产镜像中的 Hugo Extended 0.162.1，复制前后 SHA-256 均为 `c50474410d63d60e6addd259d4310eac4bc67ed16248c69017c68cc0280ed5f9`；前端从旧后端镜像使用已有 Node 工具链，使用旧前端镜像的 Nginx 运行时，仍从本次源码执行 npm ci/typecheck/Vite。生产生成的 `index-Qoivpad4.js` 与本地受测构建一致。未修改仓库 Dockerfile、主机 DNS 或运行时网络；覆盖文件和来源记录留在备份目录，可审计。正常联网环境仍使用仓库内标准 Dockerfile。
- 新镜像均加注 1.16.0 与部署提交的 OCI 标签：backend `sha256:fcd552e614d70651f162d118f38caf92841007ee3ebedb21d1593281dd155d30`；frontend `sha256:d8403bf77c8e2107ce3da2324708373a42efa1cca54c4e92f8cd584e034c86d6`。通过标准 `docker compose up -d --no-build` 激活，仍只有一个后端写入实例。
- 生产 GitHub App 配置已合并进受限权限 `.env`，保留原账号、会话、七牛、AI 及其他配置，不输出任何密钥。真实 GitHub GET /app 校验 App 身份与私钥通过；Client ID/Secret 的只读 token-check 请求使用不存在的测试 Token，返回官方预期的 404，而非凭据拒绝的 401。OAuth 用户安装与授权仍待用户实际操作。
- 公网 /api/health、HTTPS 登录及 Secure Cookie、GitHub status enabled、匿名拒绝与跨站 connect 拒绝均通过；connect 生成正确 App 安装链接。真实 PNG 导出 65058 字节，Hugo ZIP 导出 29208436 字节，账号工作区读取成功，AI available=true。公网 /changelog 首个版本为 `1.16.0 - 2026-11-12`，Chrome 已确认。
- 上线前后账号身份与工作区内容摘要完全一致：1 个普通账号、2 份工作区。未自动安装 App、绑定仓库或公开真实便签；只用合成文字生成烟雾测试 PNG/ZIP。
- 备份保存在服务器 `/home/hermes/notes-backups/20261112-github-pages-1.16.0-035421`，包含旧环境配置、回滚镜像 ID 与 3285852160 字节的 storage.tar（1657 条目，含受保护的 notes-data.json）。使用运行中的后端容器读取其已有挂载完成备份；未改变数据权限。`rollback.py` 可恢复旧源码、环境与镜像，不恢复或覆盖账号/图片数据；未执行回滚。部署与验证日志、构建覆盖文件、Hugo 来源记录也在该私有目录。
- 原始工作区仍有其他未提交修改，其 package.json 版本不是本次发布版本；后续部署应以此次远端标签/发布分支为基线，不能直接把原工作区当作线上最新源码。
