# 本地开发运维事实

## 2026-08-03：持久启动本地前后端

- `npm run dev` 由 `scripts/dev.mjs` 同时管理 Vite 与 Express；任一子进程退出，
  启动器会终止另一端。若命令依附于临时终端，终端结束产生的 `SIGTERM` 会使整套
  服务退出。
- 需要跨终端会话持续运行时，使用
  `docker compose -f docker-compose.dev.yml up --build -d`。入口为
  `http://127.0.0.1:15173`，健康检查为
  `http://127.0.0.1:15173/api/health`。
- 2026-08-03 创建的 `notes-frontend-1` 与 `notes-backend-1` 容器已通过
  `docker update --restart unless-stopped` 设置自动重启；该设置属于当前容器状态，
  执行 `docker compose down` 后重新创建容器时需要再次设置。
- 健康验证结果为首页 HTTP 200、`/api/health` 返回 `{"ok":true}`；前端 79 项
  feedback 和后端 15 项 feedback 全部通过。后端测试在受限沙箱内会因禁止监听
  `127.0.0.1` 报 `listen EPERM`，需在允许本地监听的环境重跑。
