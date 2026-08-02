# 部署到生产

生产环境固定使用源码 `docker compose` 部署，主机为 `hermes-v2fy`。


## 更新日志规范

任何用户可感知的功能、行为、兼容性或安全性变化，都必须同步维护项目根目录的
`CHANGELOG.md`。纯内部重构、测试和构建调整无需单独记录。格式参考
[Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本；
用户可通过 `/changelog` 查看该文件渲染后的独立页面。

固定使用以下 Markdown 层级；方括号属于格式的一部分：

```md
# 更新日志

## [未发布]

### 新增

- 用户可感知的结果。

## [1.2.3] - 2026-08-02

### 修复

- 用户可感知的结果。

[未发布]: https://github.com/<owner>/<repo>/compare/1.2.3...HEAD
[1.2.3]: https://github.com/<owner>/<repo>/compare/1.2.2...1.2.3
```

1. 开发期间把值得用户关注的变更写入置顶的 `[未发布]` 区域，不要直接粘贴 Git commit 列表。
2. 仅使用实际需要的三级分类：`新增`、`变更`、`弃用`、`移除`、`修复`、`安全`；不要保留空分类。
3. 同一分类内每项变更使用一条 Markdown 列表，描述用户可感知的结果，而不是实现细节。
4. 正式发布时，把 `[未发布]` 内容移动到 `[版本号] - YYYY-MM-DD` 标题下；日期必须使用 ISO 8601 格式，版本号必须与 `package.json`、`package-lock.json` 根节点以及本次 Git tag 一致。
5. 版本按时间倒序排列；仓库具备浏览器可访问的 tag 比较地址时，在文件底部维护 `[未发布]` 和各版本的比较链接。
6. `[未发布]` 只允许存在于开发中的源码。发布提交必须将其内容归档到本次版本并删除该标题；线上 `/changelog` 的第一个二级标题必须是本次发布版本和日期，不能显示空的或包含已发布内容的 `[未发布]` 区域。
7. 发布前必须检查：没有空分类，版本文件与 tag 一致，`/changelog` 返回 HTTP 200，且页面第一个二级标题与本次发布版本及日期一致。


## 1. 发布前检查

阅读 `DOCS`，确认本次变更与架构、账号、存储和匿名额度兼容。选择并记录精确的
版本标签或 commit SHA，不要只记录 `main`、`dev` 等可移动引用。

在可信构建环境运行：

```bash
npm ci
npm test
npm run build
git status --short
git rev-parse HEAD
```

`npm run build` 已包含 typecheck。任一步失败，或工作区存在不属于本次发布的修改，
都应停止部署。

确认变更范围后，将本次发布提交并推送到 GitHub；使用版本标签时也要推送标签。
确认远端已包含准备部署的 commit SHA，生产机才能继续部署。

## 2. 准备生产主机

进入生产仓库；首次部署时才执行 clone：

```bash
ssh hermes-v2fy
cd ~/github
test -d notes/.git || git clone https://github.com/zhaoolee/notes
cd notes
git status --short
git fetch --tags --prune
git checkout --detach <release-tag-or-full-commit-sha>
git rev-parse HEAD
```

生产机应保持干净工作区。部署前记录当前 commit、Compose 镜像 ID 和备份位置。

首次部署时初始化配置和目录，不要覆盖已有 `.env`：

```bash
test -f .env || cp .env.example .env
chmod 600 .env
mkdir -p storage/images storage/data
```

检查 `.env`：

- `SUPERADMIN`、`SUPERADMINPASSWORD`
- 独立、高熵且非空的 `SESSION_SECRET`
- `ANONYMOUS_DAILY_UPLOAD_LIMIT`，默认 `500`
- 使用公众号图片功能时所需的 `QINIU_*` 变量；`QINIU_UPLOAD_URL` 应直接使用
  Bucket 区域查询返回的优先上传域名，`QINIU_UPLOAD_TIMEOUT_MS` 默认 `30000`
- 使用 AI 审阅时所需的 `OPENAI_API_KEY`、`OPENAI_BASE_URL` 和
  `OPENAI_MODEL`

服务端变量不能使用 `VITE_` 前缀。Secret 不得写入仓库、日志、报告或 `MEMORY`。
如需设置 `WECHAT_FOOTER_HAMMER_URL`，应先确认 Compose 已将它透传给后端。

部署前将以下目录备份到仓库之外，并记录绝对路径：

- `storage/images`：导入图片和导出 PNG
- `storage/data`：账号、云工作区和匿名额度

生产环境只能运行一个后端写入实例，不得扩容 `backend`。

## 3. 部署

```bash
docker compose config -q
docker compose build --pull
docker compose up -d
docker compose ps
curl -fsS http://127.0.0.1:18080/api/health
docker compose logs --tail=200
```

普通更新不需要先执行 `docker compose down`。不得使用
`docker compose down -v`，也不得删除两个持久化目录。

`http://127.0.0.1:18080` 只是宿主机内部入口。公网必须使用 HTTPS，外层代理应保留
`Host`，并正确传递 `X-Forwarded-Proto` 和 `X-Forwarded-Host`。

## 4. 上线验证

依次确认：

1. Compose 服务稳定运行，日志中没有持续重启、Playwright 启动失败或存储权限错误。
2. 本机和公网 `/api/health` 都返回 `{"ok":true}`。
3. 配置 AI 时，本机和公网 `/api/ai/status` 都返回
   `{"available":true}`，容器日志包含启动探测成功信息且不泄露密钥。
4. 桌面和手机页面能加载，匿名编辑和刷新正常。
5. 匿名 Skill 可以生成有效 PNG：

   ```bash
   skills/notes-export-api/scripts/export_note.sh \
     --markdown '## 生产匿名导出验证' \
     --base-url http://127.0.0.1:18080 \
     --output /tmp/notes-production-smoke.png
   file /tmp/notes-production-smoke.png
   ```

6. 图片导入、带图片 PNG 导出和 ZIP 归档正常，文件写入 `storage/images`。
7. `/superadmin`、专用测试用户登录和云工作区同步正常。
8. 重启容器后，测试账号和云工作区仍然存在，`storage/data/notes-data.json` 未被
   重建或清空。
9. 配置七牛时，“复制到公众号”的匿名额度、登录用户长期对象和公网图片均正常。
10. HTTPS 登录 Cookie 包含 `Secure`，`X-Export-Url` 使用公网 HTTPS 域名。

任一关键检查失败都应停止发布或执行回滚。验证时不要破坏真实用户数据。

## 5. 回滚

应用回滚默认保留当前 `storage/images` 和 `storage/data`：

```bash
git checkout --detach <previous-release-tag-or-full-commit-sha>
docker compose config -q
docker compose up --build -d
curl -fsS http://127.0.0.1:18080/api/health
```

只有应用回滚无效且确认必须恢复数据时，才可停止唯一后端实例并使用部署前备份。
恢复前再次备份当前线上数据，并取得明确授权。

## 6. 发布报告

汇报：

- Git commit、版本标签、Compose 服务和镜像 ID
- GitHub 远端分支或标签
- `.env` 是否配置完整，但不报告任何值
- 两个持久化目录及其备份位置
- 测试、构建、健康检查和上线验证结果
- 未执行的检查、遗留问题和可用回滚版本

只把经验证且长期有效的信息更新到 `MEMORY`。
