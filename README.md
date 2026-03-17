# notes

一个基于 React + Vite + Express + Playwright 的 Markdown 便签导出器。

![](./README.assets/7799cfca2928e9cee4f47c6441fa936a674b7eff2c27f1e375f7aa4f1abd86e0.png)

![](./README.assets/9a5b4bde58067218ff583c2dcd32ad457272b1d1b782c5326d8188dc996d733f.png)



README 只保留两种运行方式：`Docker 开发环境` 和 `Docker 生产环境`。

## 环境要求

- Docker
- Docker Compose

## Docker 开发环境

启动：

```bash
docker compose -f docker-compose.dev.yml up --build
```

访问地址：

- 前端：`http://127.0.0.1:5173`
- 后端导出 API：`http://127.0.0.1:3001/api/export`

说明：

- 前后端都运行在容器内
- 前端开启 Vite HMR，适合日常开发
- 后端使用 `node --watch`，修改后会自动重启
- 源码通过 volume 挂载到容器，不依赖宿主机 Node.js 环境

停止：

```bash
docker compose -f docker-compose.dev.yml down
```

## Docker 生产环境

启动：

```bash
docker compose up --build -d
```

访问地址：

- 页面：`http://127.0.0.1:18080`

说明：

- `frontend` 容器构建静态页面并通过 Nginx 提供服务
- `backend` 容器运行 Express + Playwright，负责 PNG 导出
- 生产环境只暴露前端端口 `18080`，后端仅在容器内网提供给前端调用

查看日志：

```bash
docker compose logs -f
```

停止：

```bash
docker compose down
```
