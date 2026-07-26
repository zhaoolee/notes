# 项目架构

## 产品目标

锤子便签 Skill 将 Markdown 实时渲染为锤子便签风格页面，并支持导出长图 PNG、下载离线归档和管理文章图片。

样式与 Markdown 行为可参考：

- <https://cloud.smartisan.com/apps/note/md.html>

## 技术栈

- 前端：React 19、Vite、TypeScript、Zustand、React Markdown、remark-gfm
- 后端：Express、TypeScript、Playwright、Multer
- 运行与发布：Docker Compose、Nginx、GitHub Actions、Docker Hub

## 代码边界

```text
src/                     前端源码与前后端共享渲染组件
server/                  Express API 与 Playwright 导出服务
frontend/tests/          前端 feedback 测试及渲染样例
backend/tests/           后端 feedback 测试
public/                  前端静态资源
storage/images/          导入图片与导出 PNG 的持久化目录
skills/notes-export-api/ API 调用 Skill
DOCS/                    项目上下文
TOOLS/                   可用工具与命令
PROMPTS/                 固定工作流 Prompt
MEMORY/                  经测试确认的长期事实
```

目前保留 `src/` 和 `server/` 的源码位置，以维持 Vite、TypeScript、Docker 和 Skill 的现有构建路径。`frontend/` 与 `backend/` 先用于清晰划分两端 feedback 测试。

## 前端

`src/App.tsx` 是页面编排入口。正文、主题、导出状态和确认操作由 `src/store/useAppStore.ts` 管理；正文草稿与主题写入浏览器 `localStorage`。

`src/lib/markdown.ts` 使用二级标题 `##` 拆分便签区块。`src/components/MarkdownText.tsx` 负责 GFM 渲染，`src/components/NoteSheet.tsx` 是网页预览、Playwright 导出和归档 HTML 共用的便签组件。

前端通过同源 `/api` 和 `/images` 路径访问后端。开发时由 Vite 代理，双容器生产环境由 Nginx 代理，单容器生产环境由 Express 同时提供 API 和静态文件。

## 后端 API

- `GET /api/health`：健康检查
- `POST /api/images/import`：上传图片或从 URL 下载图片
- `POST /api/export`：将 Markdown 导出为 PNG
- `POST /api/archive`：生成包含 Markdown、HTML、图片和字体的 ZIP
- `GET /images/*`：读取持久化图片与导出结果

图片内容使用 SHA-256 命名以实现去重，默认存储在 `storage/images`，单张图片最大 20 MB。

## PNG 导出链路

```text
客户端 POST /api/export
  -> Express 生成 renderMode=playwright 的前端地址
  -> 复用一个无头 Chromium 实例并创建页面
  -> Playwright 填写 Markdown 编辑器
  -> React 使用真实预览组件重新渲染
  -> 等待字体、图片和高度稳定
  -> 截取 .note-sheet
  -> 超长图片分段截图并拼接
  -> 保存到 storage/images 并返回 PNG
```

这种方式让网页预览和 PNG 使用同一套 React 组件及 CSS，避免维护第二套截图模板。

## 归档链路

归档不启动 Playwright。后端收集 Markdown 中的图片，将资源写入 ZIP，并通过 React 服务端渲染生成独立 `index.html`。OPPOSans 字体会根据文章内容裁剪为 WOFF2。

## 部署形态

- 开发双容器：`docker-compose.dev.yml`，Vite HMR 与 `tsx watch`
- 生产双容器：`docker-compose.yml`，Nginx 前端与 Playwright 后端
- 生产单镜像：`Dockerfile.app`，Express 同时托管 `dist`、API 和图片
- Docker Hub 发布：`.github/workflows/docker-publish.yml`

具体发布流程见 `PROMPTS/deploy-to-production.md`。
