# notes

一个基于 React + Vite 的 Markdown 便签导出器。

## 本地开发

```bash
npm install
npm run backend
npm run dev
```

前端开发服务器默认运行在 `5173`，后端截图服务默认运行在 `3001`。
Vite 已经把 `/api` 代理到后端。
当前 PNG 导出只走 Node.js + Playwright 后端，不再使用浏览器端 `html-to-image`。

## 后端导出 API

启动后端：

```bash
npm run backend
```

导出接口：

```bash
POST /api/export
Content-Type: application/json
```

请求体支持：

```json
{
  "markdown": "## **0x01**\n正文内容",
  "filename": "note-export.png"
}
```

也支持本地文件路径：

```json
{
  "markdownPath": "/absolute/path/to/note.md",
  "filename": "note-export.png"
}
```

如果本机还没装 Playwright 的 Chromium，先执行：

```bash
npx playwright install chromium
```

## Docker 一键启动

项目已包含前后端容器配置。

启动：

```bash
docker compose up --build
```

访问：

- 前端页面：`http://127.0.0.1:18080`

说明：

- `frontend` 容器会构建静态站点，并通过 Nginx 提供页面
- `backend` 容器会运行 Express + Playwright，用于便签截图导出
- 前端里的 `/api` 请求会自动转发到后端容器
- 生产态只对外暴露前端 `18080`，后端 `3001` 仅在容器内网使用

## Docker 开发模式

如果你在开发阶段不想每次改完代码都重建镜像，用这套开发编排：

```bash
docker compose -f docker-compose.dev.yml up --build
```

访问：

- 前端页面：`http://127.0.0.1:5173`
- 后端导出 API：`http://127.0.0.1:3001/api/export`

特点：

- 前端源码通过 bind mount 动态挂载到容器
- Vite HMR 开启，改 React/CSS 基本会直接生效
- 后端用 `node --watch` 自动重启
- `node_modules` 放在容器 volume 里，不依赖宿主机环境

停止：

```bash
docker compose -f docker-compose.dev.yml down
```

## 静态构建

```bash
npm run build:static
```

构建产物输出到 `dist/`，可直接用于静态部署。

注意：静态构建只包含前端页面，真正的 PNG 导出仍然依赖后端 `/api/export`。

## GitHub Pages

仓库已包含 GitHub Actions 工作流：

- 工作流文件：`.github/workflows/deploy-pages.yml`
- 触发方式：推送到 `main` 或手动运行
- 发布目录：构建后的 `dist/`

首次启用时，请在仓库设置中将 Pages 的构建来源切换为 `GitHub Actions`。

注意：GitHub Pages 仅能提供静态预览页面；如果要在页面里导出 PNG，需要额外部署 Node.js 后端。
