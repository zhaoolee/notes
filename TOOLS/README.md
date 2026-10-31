# 可用工具

本目录记录智能体和开发者在仓库内可直接使用的工具与命令。执行前先阅读 `DOCS`，执行后运行 feedback 测试。

## Node.js

```bash
npm ci
npm run dev
npm run dev:frontend
npm run backend:watch
npm run typecheck
npm run build
```

`npm run dev` 会同时启动 Vite（`127.0.0.1:15173`）与 Express
导出服务（`127.0.0.1:3001`）。只有在需要分别调试时，才单独运行
`npm run dev:frontend` 或 `npm run backend:watch`。

## Feedback 测试

```bash
npm test
npm run test:frontend
npm run test:backend
```

前端测试位于 `frontend/tests`，后端测试位于 `backend/tests`。

## Hugo 网站导出验收

本机需有 Hugo Extended 0.162.1 或兼容版本。先构建，再运行隔离的 Chromium 端到端验收：

```bash
npm run build
node scripts/verify-site-publishing.mjs
```

该命令自建临时账号、便签与图片，验证账号菜单入口、部署子路径 basePath、自建分类、真实 ZIP 下载及生成网站的资源和搜索。截图与报告保存到输出的临时目录；不会操作日常工作区或 iOS 模拟器。Docker 后端镜像已包含固定版本 Hugo。

## 编辑器图片上传队列验收

```bash
npm run build
node scripts/verify-editor-image-uploads.mjs
```

使用隔离的 Chromium、临时 HTTP 服务和合成图片验证拖入 100 张、追加多选图片、
最多 5 张并发、真实上传进度、乱序完成、失败重试、上传期间编辑、手机布局和
取消/切换便签。截图输出到临时目录，不访问真实账号、图片服务或 iOS 模拟器。

## 正文输入延迟 Benchmark

运行真实 Chromium，在便签正文编辑器中逐字符输入，统计每次 `keydown` 到浏览器
下一次绘制机会的 p50、p95、p99、最大值和平均值：

```bash
npm run benchmark:input
```

默认会在 `127.0.0.1:15173` 不可用时临时启动前端，使用 2000 字符的初始正文、
20 次预热和 200 次正式输入。指定已运行页面、移动端视口或性能回归阈值：

```bash
npm run benchmark:input -- --url http://127.0.0.1:15173 --mobile
npm run benchmark:input -- --characters 500 --interval 8 --max-p95 50
npm run benchmark:input -- --json
```

`--max-p95` 失败时命令以状态码 `2` 退出，可用于 CI；完整选项使用
`npm run benchmark:input -- --help` 查看。benchmark 使用隔离的浏览器上下文与测试
工作区，不会读写日常浏览器中的便签。

## Docker 开发环境

```bash
docker compose -f docker-compose.dev.yml up --build
docker compose -f docker-compose.dev.yml down
```

开发入口为 `http://127.0.0.1:15173`。

## Docker 生产环境

```bash
docker compose up --build -d
docker compose logs -f
docker compose down
```

生产入口为 `http://127.0.0.1:18080`。

## 健康检查

```bash
curl -fsS http://127.0.0.1:18080/api/health
```

## 微信公众号富文本与七牛图床

本机仓库与 `/Users/zhaoolee/github/upload-local-image-to-qiniu` 相邻时，
`npm run dev` 会自动加载仓库根目录的 `.env`；复制 `.env.example` 后填入
真实配置即可。若 `.env` 没有提供七牛变量，服务仍会读取相邻项目的
`qiniu.json`。也可以显式指定配置：

```bash
QINIU_CONFIG_PATH=/absolute/path/to/qiniu.json npm run dev
```

Docker 和生产环境使用以下变量，不要将真实密钥写入仓库：

```bash
export QINIU_ACCESS_KEY=...
export QINIU_SECRET_KEY=...
export QINIU_BUCKET=...
export QINIU_DOMAIN=https://cdn.example.com
export QINIU_PREFIX=notes
export QINIU_UPLOAD_TIMEOUT_MS=30000
docker compose up --build -d
```

上传链路使用七牛官方 Node SDK，根据 AK 与 Bucket 自动查询区域，并依次尝试该区域
返回的多个上传节点。通常不要设置 `QINIU_UPLOAD_URL`；为兼容已有部署，单个七牛
标准上传域名仍可作为首选节点，SDK 会补齐同区域备用节点。诊断私有网关时可用
`QINIU_UPLOAD_URLS` 传入逗号分隔的同协议节点。单节点超时允许配置为 10000 到
300000 毫秒。

开发环境可以直接检查富文本生成接口：

```bash
curl -fsS http://127.0.0.1:3001/api/wechat \
  -H 'Content-Type: application/json' \
  --data '{"markdown":"[公众号标题]\n\n正文包含 **粗体**。","theme":"bear"}'
```

`theme` 可为 `default`、`smartisan-dark`、`apple-notes`、`apple-notes-light` 或
`bear`；省略时兼容性回退为 `default`。接口返回实际采用的 `theme`、`html`、替换
图片后的 `markdown`、图片总数和上传/复用计数。真实使用
时从桌面分享预览或手机分享面板点击“复制到公众号”，再粘贴进公众号编辑器。

## 便签导出 Skill

```bash
skills/notes-export-api/scripts/export_note.sh \
  --base-url http://127.0.0.1:18080 \
  --markdown-file /absolute/path/to/note.md \
  --output /absolute/path/to/note.png
```

详细参数见 `skills/notes-export-api/SKILL.md`。

## 多图输入性能回归

多图输入性能基准（使用隔离浏览器与合成图片，不需要后端）：

```bash
npm run benchmark:input -- --images 100 --assert-incremental-layout
npm run benchmark:input -- --images 100 --mobile --assert-incremental-layout
```

输出按键到下一次绘制机会的延迟，以及图片节点重建、文本高度读取与图片尺寸读取
次数。断言检查输入期间复用图片，文本高度读取不随图片数量线性增长。
参数 `--max-p95 <毫秒>` 可用于同一环境的延迟门槛；不要跨机器直接比较绝对耗时。

构建后的浏览器功能回归：`node scripts/verify-editor-input-layout.mjs`，检查重复图片
复用、段落高度伸缩、中间与末尾中文输入、滚动保持、本地保存、响应式预览和导出预览。
