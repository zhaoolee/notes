# @zhaoolee/dsh-notes

DeepSeek Harness 插件：把用户对话导出为锤子便签。

Host 面工具插件。安装后，智能体获得一个 `notes_export_conversation` 工具，**分级模式**
工作：

1. **已配置便签服务**（`NOTES_API_BASE_URL` + Token 或用户名密码）：把对话内容整理成
   Markdown 后调用，工具通过便签服务 API 在当前账号的云端工作区**新建**一张便签，或按
   `note_id` **更新**已有便签，返回便签 ID、标题和可打开的前端链接。
2. **未配置任何用户信息**：回退到默认演示服务器 `https://notes.fangyuanxiaozhan.com` 的
   匿名导出接口，把对话渲染成锤子便签长图 PNG 保存到本地并返回文件路径——开箱即用尝鲜，
   但**不能写入便签列表**（匿名模式没有账号工作区）。

配套的开源便签服务：<https://github.com/zhaoolee/notes>

## 安装

直接从 npm 安装到目标 profile（例如 `web`）：

```sh
dsh plugin --profile web add @zhaoolee/dsh-notes
```

安装后**重启**目标 profile 生效。

本地开发时，先在本目录构建产物（产出 `lib/`）：

```sh
npm install
npm run build
```

再从源码目录安装进目标 profile：

```sh
npx -p @deepseek-ai/dsh dsh plugin --profile web add /绝对路径/dsh-plugin
```

也可以用 `--patch` 直接叠加而不安装：

```sh
dsh web --patch /绝对路径/dsh-plugin/cordis.patch.yml
```

## 配置

配置按以下优先级解析（插件配置 → 进程环境变量）：

| 配置键（插件 config） | 环境变量 | 必填 | 说明 |
| --- | --- | --- | --- |
| `baseUrl` | `NOTES_API_BASE_URL` | 否* | 便签服务基础地址，例如 `http://127.0.0.1:18080`；**未配置时自动回退默认演示服务器** |
| `token` | `NOTES_API_TOKEN` | 写入模式二选一 | 稳定 Bearer Token（`notes_sk_v1.` 开头） |
| `username` | `NOTES_API_USERNAME` | 写入模式二选一 | 无 token 时用于一次性申请 token |
| `password` | `NOTES_API_PASSWORD` | 写入模式二选一 | 同上 |
| `demoServer` | `NOTES_DEMO_SERVER` | 否 | 回退用的演示服务器，默认 `https://notes.fangyuanxiaozhan.com` |

\* 配置了 `baseUrl` 后必须同时提供 token 或用户名密码（写入模式）；只配地址不配凭据会
明确报错，不会静默降级。

示例（进程环境变量，最常用）：

```dotenv
NOTES_API_BASE_URL=http://127.0.0.1:18080
NOTES_API_TOKEN=notes_sk_v1.xxx
```

没有 token 时，插件会用用户名/密码向 `/api/auth/skill-token` 申请 token（仅保存在内存，
不落盘）。

## 使用

用户说“把我们的对话导出成便签”之类的话时，智能体会整理对话为 Markdown 并调用
`notes_export_conversation`。便签标题取自 Markdown 第一行，因此建议第一行写
`# 标题`。

工具参数：

- `markdown`（必填）：对话内容整理后的 Markdown 全文。
- `note_id`（写入模式）：更新已有便签时传它的 ID（来自上一次导出的 `note_id`）。
- `folder`（写入模式）：文件夹 ID 或精确名称；`none` / `null` / `未分类` 表示清除分类。
- `starred`（写入模式）：是否加星。
- `pinned`（写入模式）：是否置顶。
- `theme`（图片模式）：便签主题，`default` / `smartisan-dark` / `apple-notes` /
  `apple-notes-light` / `bear` / `telegraph`，默认 `default`。

返回 `{ action, note_id, title, url, file_path, updated_at, server }`：

- 写入模式：`action` 为 `created` / `updated`，`url` 为便签前端链接，`file_path` 为
  `null`。
- 图片模式：`action` 为 `exported-image`，`url` 为演示服务器上的图片链接，
  `file_path` 为本地 PNG 绝对路径，`note_id` / `updated_at` 为 `null`。
- `server` 始终标明实际使用的服务地址。

## 隐私提示

未配置便签服务时，工具会把对话内容发送到默认演示服务器
`https://notes.fangyuanxiaozhan.com` 的**匿名导出接口**用于渲染图片（该接口不留存内容
到任何账号工作区，且无法写入便签列表）。涉及敏感对话时，请配置自己的便签服务
（`NOTES_API_BASE_URL` + 凭据）后使用，避免内容经过公共服务器。

匿名导出的本地 PNG 会写入系统临时目录下随机创建的私有子目录；在支持 POSIX 权限的
系统中，目录仅允许当前用户访问（`0700`），图片仅允许当前用户读写（`0600`）。

## 说明

- 读写逻辑与仓库 `skills/notes-export-api/scripts/notes_api.mjs` 保持一致：整工作区
  读改写、`expectedUpdatedAt` 乐观并发、409 冲突自动重读并最多重试 4 次。
- 更新便签只替换 Markdown 并刷新 `updatedAt`；未显式传入的 `folder/starred/pinned`
  保留原值。
- 数据边界：写入模式只操作调用方配置的服务上**当前账号**自己的工作区，服务端不接受
  用户 ID 参数，普通用户与超级管理员数据严格隔离。

## 测试

```sh
npm test        # 本目录：单元测试（mock fetch）+ 端到端（启动真实后端、临时存储）
npm run typecheck
```

端到端测试会以临时 `DATA_STORAGE_DIR` / `IMAGE_STORAGE_DIR` 和随机端口启动仓库后端，
验证写入便签与匿名导出图片两条链路，不触碰真实 `storage/data`。
