# 部署到生产

请按以下流程部署锤子便签 Skill：

1. 阅读 `DOCS`，确认当前架构、存储和部署方式。
2. 检查工作区状态，明确本次部署包含的变更。
3. 运行 `npm test`。
4. 运行 `npm run typecheck`。
5. 运行 `npm run build`。
6. 构建生产镜像或启动生产 Compose，并检查 `/api/health`。
7. 验证页面加载、图片导入、PNG 导出和 ZIP 归档。
8. 记录部署中发现的长期有效信息到 `MEMORY`。
9. 汇报发布版本、镜像标签、验证结果和回滚方式。

## Docker Compose 生产环境

```bash
docker compose up --build -d
curl -fsS http://127.0.0.1:18080/api/health
docker compose logs
```

生产页面：`http://127.0.0.1:18080`

停止服务：

```bash
docker compose down
```

`storage/images` 必须持久化，避免容器删除后丢失导入图片和导出结果。

## Docker Hub 发布

工作流：`.github/workflows/docker-publish.yml`

仓库需要配置：

- `DOCKERHUB_USERNAME` secret
- `DOCKERHUB_TOKEN` secret
- 可选的 `DOCKERHUB_REPOSITORY` repository variable，默认值为 `notes`

触发规则：

- push 到 `dev`：发布 `:dev`
- push 到 `main`：发布 `:latest`
- push `v*` 标签：发布对应版本标签
- `workflow_dispatch`：手动触发

默认镜像名：`zhaoolee/notes`

工作流使用 `Dockerfile.app` 构建 `linux/amd64` 和 `linux/arm64` 单容器镜像。
