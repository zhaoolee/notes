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
