# 可用工具

本目录记录智能体和开发者在仓库内可直接使用的工具与命令。执行前先阅读 `DOCS`，执行后运行 feedback 测试。

## Node.js

```bash
npm ci
npm run dev
npm run backend:watch
npm run typecheck
npm run build
```

## Feedback 测试

```bash
npm test
npm run test:frontend
npm run test:backend
```

前端测试位于 `frontend/tests`，后端测试位于 `backend/tests`。

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

## 便签导出 Skill

```bash
skills/notes-export-api/scripts/export_note.sh \
  --markdown-file /absolute/path/to/note.md \
  --output /absolute/path/to/note.png
```

详细参数见 `skills/notes-export-api/SKILL.md`。
