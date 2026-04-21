可参考的网页 https://cloud.smartisan.com/apps/note/md.html


## GitHub Actions 发布到 Docker Hub

仓库已包含 [`.github/workflows/docker-publish.yml`](./.github/workflows/docker-publish.yml)。

需要在 GitHub 仓库中配置：

- `DOCKERHUB_USERNAME` secret
- `DOCKERHUB_TOKEN` secret
- 可选：`DOCKERHUB_REPOSITORY` repository variable，默认值为 `notes`

触发方式：

- push 到 `dev`，发布尝鲜镜像 `:dev`
- push 到 `main`，发布稳定镜像 `:latest`
- push `v*` 标签
- 手动运行 `workflow_dispatch`

发布后的默认镜像名为：

```text
zhaoolee/notes
```


## Docker 开发环境

启动：

```bash
docker compose -f docker-compose.dev.yml up --build
```

访问地址：

- 开发入口：`http://127.0.0.1:15173`
- 导出 API：`http://127.0.0.1:15173/api/export`

说明：

- 前后端都运行在容器内
- 前端开启 Vite HMR，适合日常开发
- 后端使用 `node --watch`，修改后会自动重启
- 源码通过 volume 挂载到容器，不依赖宿主机 Node.js 环境
- 开发环境只暴露一个端口 `15173`

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
