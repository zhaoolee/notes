# 锤子便签Skill

- 一个锤子便签风格的导出器，支持**暖白纸感**，**深夜便签**两个主题。
- 可用来分享与openclaw的对话记录。
- 纯web应用，无需安装任何App。
- 支持PC端和手机版，打开即用。
- 支持图片插入。
- 支持直接导出便签为图片，或复制为markdown格式进行分享。
- 自带浏览器持久化，关闭页面也不会丢失数据。
- 开源免费，可私有化部署。
- 工匠精神沁入AI，可以通过AI Skill直接调用工具，生成便签。
- 可封装为单个 Docker 镜像，通过 GitHub Actions 自动构建并发布到 Docker Hub，开发者可直接 `docker pull` 后本地运行。

## 通过skill调用

clawhub地址 https://clawhub.ai/zhaoolee/notes-export-api

```
从clawhub安装 notes-export-api这个 skill,
联网获取最近一周 AI 相关的新闻，将新闻转化为 markdown 生成便签图片，把便签图片绝对路径返回给我，把图片往“下载”文件夹复制一份
```

![](./README.assets/3c37864955b98ac6036e757737a00e88c86c433316dbdd4260dd4dfeb8ec08e4.png)

## 网页版

地址：[https://notes.fangyuanxiaozhan.com](https://notes.fangyuanxiaozhan.com)

![](./README.assets/d88b356e6901cd2412df55a0569ba29341f0ed6955ef1dbb7cd5040b2a61d813.png)

![](./README.assets/b72b6a36d0c367f292807a59bdb41057e433efae404a83eb68e228ec63abebc5.png)

![](./README.assets/28d864deb17cb0ec9d9a7740392ca8bed1e71d3dabee8cc7cbb821d17f74176c.png)

![](./README.assets/53da5ab92d9aaecb9d246124fd6db1592f528b3b5c1793b9c1bbdcec7beafddb.png)

## 环境要求

- Docker
- Docker Compose

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

## Docker Hub 单镜像分发

这个项目已经支持打包为单个镜像，不依赖 `notes.fangyuanxiaozhan.com` 才能运行：

- 镜像内同时包含前端静态资源和后端导出服务
- 容器启动后直接访问 `http://127.0.0.1:18080`
- 导出的图片默认落在挂载出来的 `storage/images`

启动：

```bash
NOTES_EXPORTER_IMAGE=yourname/notes:latest \
docker compose -f docker-compose.hub.yml up -d
```

如果想使用 `dev` 尝鲜版：

```bash
NOTES_EXPORTER_IMAGE=yourname/notes:dev \
docker compose -f docker-compose.hub.yml up -d
```

如果还想覆盖端口：

```bash
NOTES_EXPORTER_IMAGE=yourname/notes:latest \
NOTES_EXPORTER_PORT=18080 \
docker compose -f docker-compose.hub.yml up -d
```

也可以写到仓库根目录 `.env`：

```bash
NOTES_EXPORTER_IMAGE=yourname/notes:latest
NOTES_EXPORTER_PORT=18080
```

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
DOCKERHUB_USERNAME/notes
```

## 去域名依赖说明

- Web 应用本体可完全本地自托管，不依赖 `notes.fangyuanxiaozhan.com`
- 现有 `notes-export-api` skill 脚本会优先探测本地生产入口 `18080`，再回退到线上演示地址
- 如果你希望 skill 固定走自建服务，可在 `.env` 中设置 `NOTES_EXPORT_API_BASE_URL=http://127.0.0.1:18080`
