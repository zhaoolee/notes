# 项目长期事实

本文件只记录已从代码或 feedback 测试中确认、预计会影响后续任务的信息。临时调试输出和未经验证的推测不写入这里。

## 2026-07-26：Harness 目录落地

- 智能体入口为根目录 `AGENTS.md`。
- 项目上下文位于 `DOCS`。
- 仓库工具说明位于 `TOOLS`。
- 固定流程位于 `PROMPTS`。
- 前端 feedback 测试位于 `frontend/tests`。
- 后端 feedback 测试位于 `backend/tests`。
- 统一 feedback 命令为 `npm test`。

## 架构事实

- 前端源码当前位于 `src`，后端源码当前位于 `server`。
- `NoteSheet` 和 Markdown 分段逻辑由前端预览、Playwright PNG 导出和离线归档共同复用。
- PNG 导出依赖 Playwright Chromium 打开可访问的前端页面。
- 单容器镜像由 Express 提供前端静态文件；双容器生产环境由 Nginx 代理 API 和图片。
- `storage/images` 是导入图片与已生成 PNG 的持久化边界。
- 项目当前没有数据库、账号系统或鉴权层。

## 2026-07-26：Markdown 视觉兼容性测试

- 可重复使用的测试数据位于 `frontend/tests/markdown-support-visual.md`。
- 自动语义测试位于 `frontend/tests/markdown-support.test.ts`。
- 截图和逐项评判位于 `frontend/tests/markdown-support-report.md`。
- 已确认支持常用标题、强调、删除线、链接、引用、列表、代码块、GFM 表格、图片、脚注和复合嵌套。
- `##` 是项目的便签区段分隔符，不按标准 H2 内容渲染。
- 单个软换行会被项目插件拆成手动换行段落，和 CommonMark 默认行为不同。
- 原始 HTML 不会生成 HTML 元素，而是按字面文本显示。
- 任务列表同时显示列表圆点和复选框。
- 默认主题下链接对纸张背景的对比度约为 2.93:1，引用文字约为 1.97:1。
- 脚注功能可用，但 `Footnotes` 辅助标题因缺少隐藏样式而可见。

## 2026-07-26：全局操作收纳

- 顶栏只保留主要操作“存图”和右上角齿轮设置入口。
- 主题、新建空白便签、插入图片、加载示例、下载归档和复制文本统一收纳在设置面板。
- 设置面板按“便签主题 / 内容 / 分享与归档”分组。
- 便签底部品牌文案仍在预览中就地编辑，不属于全局工具栏。
- `EditorPanel` 通过 `EditorPanelHandle.openImagePicker()` 向设置面板暴露图片选择能力，粘贴和拖放图片流程保持不变。
- 移动端设置面板固定在顶栏下方，左右各保留 12px，内容超出时在面板内滚动。
