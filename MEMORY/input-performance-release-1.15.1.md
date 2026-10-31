# 1.15.1 多图便签输入性能生产发布

- 发布日期：2026-10-31。应用提交与标签 `1.15.1`：
  `8785dbf81f87e18cfcfc2315f3f7c6d058608824`，已推送 GitHub `main` 与
  `codex/input-performance-release-1.15.1`。生产机
  `hermes-v2fy:/home/hermes/github/notes` 精确检出该提交，工作区干净。
- 独立发布副本为 `/tmp/notes-input-performance-release-20261031`，从线上 1.15.0
  提取此次性能修复，未带入原工作区其他未发布功能。版本文件、标签、镜像标记与
  更新日志均为 1.15.1；公网 `/changelog` 返回 200，首节为 `1.15.1 - 2026-10-31`。
- 根项目与 DSH 插件完成干净依赖安装；296 项 feedback 全部通过（前端 211、
  后端 68、插件 17），类型检查和生产构建通过。插件导出测试依赖 dist，干净发布
  副本需先构建再执行完整测试。浏览器长文伸缩、中文输入、滚动保持、重复图片、
  标注与本地保存、桌面/手机预览、分享/导出预览和 102 图上传队列验收通过。
- 生产标准 Compose 构建在下载 Hugo 时达到 120 秒等待时限，未切换容器；随后使用
  已验证的 `notes-release-builder:1.14.1` 与当前 1.15.0 运行时构建缓存，在禁网构建
  中重新执行锁定依赖的 `npm ci --offline --no-audit`，从本次源码编译前后端。
  依赖锁只变更根版本；运行时 Dockerfile、Compose、后端源码与 `.env` 未改动。
  构建方案与日志保存在下述备份目录。
- 前端镜像：`sha256:f857f940440bde6823467b0288d7909d5b4df669412f3d2f80542227dd69580a`。
  后端镜像：`sha256:abc4cf0942e2c75e57492b2a93706b58ac09c2abf7b9ef52a82567945b4dfecb`。
  `notes-frontend-1` 与唯一的 `notes-backend-1` 均为 running，重启计数 0；镜像标注
  1.15.1 与完整应用 SHA。内部和公网健康检查正常，AI available=true，启动探测成功，
  日志未发现运行错误。容器切换期间短暂出现启动期 502，随后恢复。
- 持久化目录：`/home/hermes/github/notes/storage/images` 与
  `/home/hermes/github/notes/storage/data`。完整备份：
  `/home/hermes/backups/notes/releases/input-performance-1.15.1-20261031-predeploy/storage.tar.gz`，
  2,595,966,830 字节，权限 600，父目录权限 700，归档列表校验通过。SHA-256：
  `d4a1f634f97c0d590c4cc13267aba35db4ddf9b3b959d252fa89daf06cddb986`。
  通过现有后端容器只读归档，未改动宿主机数据权限。切换前后账号数据文件哈希一致。
- `.env` 权限 600；管理员、会话、AI、七牛必需配置均存在，未输出配置值。
  公网只读登录与云工作区读取均返回 200，切换前后恢复 215 条便签，Cookie 含
  Secure/HttpOnly，`/superadmin` 返回 200。未写入真实用户便签。
- 公网隔离浏览器验收通过：6 张不同合成图片真实上传（5 上传、1 排队），正文按
  原顺序写入正确内容哈希地址；图片公网字节一致，手机追加上传及 390×844 布局正常。
  带图 PNG 返回 200，1980×1617、65,876 字节，X-Export-Url 为公网 HTTPS；ZIP
  返回 200，84,790 字节，8 个条目，CRC 全部通过。截图与报告：
  `/tmp/notes-upload-production-1.15.1`。
- 相同公网前端 100 图基准（30 字符、5 次预热、按键间隔 10ms）：桌面 p95 从
  1.15.0 的 89.8ms 降到 9.7ms；图片节点重建从 100 降到 0，文本高度读取从
  24,038 降到 60，图片尺寸读取从 11,909 降到 0。手机浏览器视口 p95 为 7.4ms，
  图片重建与图片尺寸读取均为 0。基准使用合成图片、模拟匿名 API 和隔离本地存储，
  不代表真机输入测量；未启动 iOS 模拟器。结果保存在
  `/tmp/notes-input-production-before.json`、`/tmp/notes-input-production-after.json`、
  `/tmp/notes-input-production-mobile.json`。
- 回滚应用：`1.15.0/939dc65eb498ccbbc5073331fd9ba16cd6b5b634`。已保留
  `notes-frontend:rollback-1.15.0-before-1.15.1` 与
  `notes-backend:rollback-1.15.0-before-1.15.1`；回滚保留当前持久化目录。
  本轮未另建普通测试账号、未做云端写入/多设备冲突验证、七牛真实上传与额度回归，
  也未发布公众号草稿。容器重建已验证数据保留，未再额外手动重启。
