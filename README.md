# notes

一个基于 React + Vite 的 Markdown 便签导出器。

## 本地开发

```bash
npm install
npm run dev
```

## 静态构建

```bash
npm run build:static
```

构建产物输出到 `dist/`，可直接用于静态部署。

## GitHub Pages

仓库已包含 GitHub Actions 工作流：

- 工作流文件：`.github/workflows/deploy-pages.yml`
- 触发方式：推送到 `main` 或手动运行
- 发布目录：构建后的 `dist/`

首次启用时，请在仓库设置中将 Pages 的构建来源切换为 `GitHub Actions`。
