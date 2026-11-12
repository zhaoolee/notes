# 大工作区短便签输入卡顿：1.16.3

## 2026-11-12

- 用户反馈 Chrome 中短文本便签输入极慢。只读查看确认当前编辑区约 260 字符、无图片、预览未挂载，侧栏有 228 条便签。通过临时 PerformanceObserver 读取已有输入计时，23 个 input 样本处理耗时约 244–271ms，长任务最长 992ms。没有输入或修改用户便签；临时 observer 和 Intl 测量代理全部移除，原页面未刷新。
- 因果复现使用隔离合成账号/工作区，所有 API 在浏览器中拦截。CPU profile 指向 getNoteTitle → getMeaningfulLines → stripMarkdownDecorators：侧栏每次渲染为取标题清理每份便签的全部正文，且每个侧栏条目多次调用。保持当前短便签不变，仅把其余便签加长会显著增加输入耗时。不是本轮 GitHub disclosure 或图片高度重测导致的回归。
- 修复 src/lib/notes.ts：getNoteTitle/getNoteListTitle 逐行找到首个有效行便立即返回；保留原有修饰清理、图片行跳过、列表标题原文、38 字符截断与回退规则。CRLF 必须在修饰清理之前排除换行前的一次 CR，独立尾部 CR 规则保持原样。getNotePreview、保存时序、排序、拖拽、网络接口均未改动。
- 新增两项语义反馈用例覆盖 CRLF、仅修饰符前缀、独立图片行、原始列表标题、截断及长尾正文；最终前端 226、后端 102、DSH 17，共 345 项通过，完整构建/typecheck 通过。Pi 临时差分模糊检查 50000 份 CR/CRLF-heavy Markdown 与旧实现结果一致；root 审查发现并补充了裸 # / - 在 CRLF 下的兼容反例。
- 原有 benchmark:input 新增 --workspace-notes 和 --background-note-length，使用模拟登录/云保存与合成便签，不读取真实账号。TOOLS/README.md 有可复跑命令。相同 Chromium 145、228 条便签、后台每条 12000 字符、当前 260 字符、30 个输入/5 个预热：本地受测构建 p95 123.3→7.7ms；将背景正文增至 36000 字符后 p95 9.1ms。相同公网入口发布前后独立合成验证 p95 123.0→7.8ms。报告 /private/tmp/notes-workspace-{before,after,after-large,production-before,production-after}.json；CPU profile /private/tmp/notes-lag-{before,large-before}.cpuprofile。绝对值是浏览器 keydown 到下一 rAF，不等同于用户现场 input 处理或系统键盘到屏幕的全部延迟。
- verify-editor-input-layout.mjs 通过，覆盖重复图片节点、文本高度增长/收缩、中间及末尾中文文本插入和滚动、本地保存、桌面/手机预览、响应式宽度、分享与导出预览；未启动模拟器，中文文本插入不等同于真机输入法 composition 验收。
- 已上线 https://notes.fangyuanxiaozhan.com/，标签 1.16.3，精确源码 c79e4189e7c195e95f337d70e724020b9fe10e8c，远端分支 codex/editor-typing-latency-1.16.3。隔离副本 /private/tmp/notes-pages-release-FVl8wX 基于 1.16.2 发布线，原工作区同步同项修复但其他待办未部署。新资源 index-DvNEkGhS.js 与本地一致，/changelog 首个版本标题为 1.16.3 - 2026-11-12；本机/公网 health 正常，AI available=true。
- 仅更新前端镜像 notes-frontend:1.16.3/latest：sha256:7aa918dfa0393b6956277a3c720c9561e6260fe7a42c1eb0f7f39a95e90ab10f，前端容器 65eb5077f719。唯一后端容器 405575fb5635 未重启，仍运行 1.16.0 镜像 sha256:fcd552e614d70651f162d118f38caf92841007ee3ebedb21d1593281dd155d30；配置、凭据和持久化结构未改动。使用已验证的可信缓存构建覆盖文件，从精确源码执行 npm ci --include=dev 与 build:static；工具链来自 notes-backend:1.16.0，Nginx 来自 notes-frontend:1.16.2，不修改仓库 Dockerfile、DNS 或运行时网络。
- 上线前私有备份 /home/hermes/notes-backups/20261112-typing-1.16.3-085433，含 production.env、rollback.json、3304970240 字节 storage.tar（核验包含 notes-data.json）与 release-result.json。备份和凭据均未离开服务器。回滚源码至 1.16.2，重新标记 notes-frontend:1.16.2 为 latest 后 docker compose up -d --no-build --no-deps frontend 即可，旧镜像 sha256:e18a27ec92cc4b05b88a98f72c007717f6a399b7990e0d780340a2127c8f0a6c 保留；无需恢复用户数据。未重复未受影响的后端生产 PNG/ZIP 写入或存储重启验收。
