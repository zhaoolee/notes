# 开源版锤子便签


![](./README.assets/aab7c89dace491a0c90f98d04f53ab503e755968249ea9a89521f56b69eedeac.png)

![](./README.assets/e99a408cc01fdffd81fca6dcafc4152b171f0be7d7003032338443197f9e23da.png)

![](./README.assets/fdf4b92e91f316425ce457400a9219fe91afbd8d87668c32a2c488579f2ac116.png)

| 支持手机版 | 一键发送公众号 |
| --- | --- |
| ![](./README.assets/a1cc07be6396cb67288b2cebacc26b6746aa0409d976f230b762fcc467706ccc.gif) | ![](./README.assets/ef2ef8e599f5afb747e1c78f8bbb38bc4ce8209070cb699552607507dac63b6b.gif) |





- 一个锤子便签风格的导出器，预览与图片导出支持**暖白纸感**、**深夜便签**、**iPhone 备忘录深浅模式**和 **Bear 极简排版**。
- 可用来分享与openclaw的对话记录。
- 完美复刻锤子便签网页版和PC版，支持多便签，分类存储。
- 支持Docker一键私有化部署
- 纯WEB应用，无需安装任何App，打开即用
- 支持PC端和手机版，多端数据同步，支持公网部署
- 支持图片插入。
- 支持一键粘贴到公众号助手。
- 支持直接导出便签为图片，或复制为markdown格式进行分享。
- 自带浏览器持久化，关闭页面也不会丢失数据。
- 开源免费，可私有化部署。
- 工匠精神沁入AI，可以通过AI Skill直接调用工具，生成便签。
- 支持自定义底部标识（点击即可编辑）
- API原生封装支持Hermes Agent，OpenClaw直接通过skill驱动管理便签
- 支持 DeepSeek Harness（DSH），让智能体将对话导出为锤子便签。
- 支持接入DeepSeek润色书写内容，语法标点检查，重点加粗，复杂概念通俗化释义。
- 支持一键下载包含图片的Markdown资源包
- 支持下载为html离线查看

## 通过DSH调用

```
dsh plugin --profile web add @zhaoolee/dsh-notes
```

安装后请重启目标 profile，使插件生效。重启后，在 DeepSeek Harness 对话中说：**把我们的对话导出成便签**， 智能体会自动整理当前对话并调用插件生成便签。

| Deepseek Harness 生成分享便签 | 导出效果 |
| --- | --- |
| ![](./README.assets/b66a25f62ae0f1ab7f0ef0f71540594ac5c2a4c57b63bbfa4e693693fafb61dc.png) | ![](./README.assets/def783d53d1c75b1e8f74ff29c4bd4b460105d1c5c7453aa8c50615f8f92c86a.png) |




## 通过skill调用

clawhub地址 https://clawhub.ai/zhaoolee/notes-export-api

```
从clawhub安装 notes-export-api这个 skill,
联网获取最近一周 AI 相关的新闻，将新闻转化为 markdown 生成便签图片，把便签图片绝对路径返回给我，把图片往“下载”文件夹复制一份
```

## 支持自定义底部品牌标识(点击就能改)

只要你喜欢，可以把底部的「锤子便签」改成「凿子便签」或「榔头便签」


![](./README.assets/e8549f76a4254c998d4b8aa2eb5be0bef5ecfcf3ddd56ee119cb159f993a3d67.png)




## 支持下载文章，包含网页，markdown以及管理的图片资源


![](./README.assets/0c60fb3e65140f312596ea29be241881ffa7a67d50bcda49783117a8487d5fad.png)

![](./README.assets/6cfa5f69414ba904b1211b9fa1147209967c6010a6a69b4c8567a7ba90fdbfff.gif)

## 支持接入DeepSeek，修正语法错误，重点加粗，通俗化润色

![](./README.assets/44a5d5ab4aad2f44f713be9d06275c7bf8a8c73f22c124af7675bfbe81d17adb.png)

## 零配置，复制即可将权限导入hermes agent

登陆后，复制一行专属链接，粘贴给Hermes Agent或OpenClaw，即可获取包含登身份认证的skill包，实现人机协同

![](./README.assets/c7cacf577167ab7ed8ca053b1bc0f68486959ba0dd2e662e8182cee37ed5283b.png)

## 支持多用户隔离

可以给AI分配一个账号，人类分配一个账号，数据严格隔离

![](./README.assets/0c079169e397b53644b312e54561db9c1da8477806ff290fa36eb7bfb7701178.png)


## 支持一键粘贴到公众号助手

在手机的网页写完，直接一键粘贴到公众号即可发送，文本格式和图片，统统自动处理好！

## 支持子公司和各类知名主题

| 子公司主题  | 母公司主题 |
| --- | --- |
| ![](./README.assets/526e1a90ca99914fdd811d22c53202e5c22c18c103b926baaab709728abac20e.png) | ![](./README.assets/23b514e3546014b65d00b7b0b655c3350cd4546a462e152538021010a750822e.png) |


## 网页版


| 暖白纸感 | 深夜便签 |
| --- | --- |
| ![](./README.assets/9182e3af534b27a1daac8cb9d301abe6935214ded96539df96b58727830a22bb.png) | ![](./README.assets/07b3426e6f163673cd4e0a1ebaf7e88f798aafcb795b7cb87dafce4643ba766b.png) |
| ![](./README.assets/28d864deb17cb0ec9d9a7740392ca8bed1e71d3dabee8cc7cbb821d17f74176c.png) | ![](./README.assets/53da5ab92d9aaecb9d246124fd6db1592f528b3b5c1793b9c1bbdcec7beafddb.png) |


## Skill 服务地址

便签管理和 PNG 导出统一使用 `NOTES_API_BASE_URL`，可写入
`skills/notes-export-api/.env`，或通过 `--base-url` 传入：

```dotenv
NOTES_API_BASE_URL=http://127.0.0.1:18080
```

认证及完整配置见 [`skills/notes-export-api/SKILL.md`](./skills/notes-export-api/SKILL.md)。

## 使用 Docker Hub 镜像部署

单镜像同时包含 Web 前端和后端服务，便签管理、图片导入和 PNG 导出均可在本地
运行。公众号复制和 AI 等可选功能需另行配置相应服务。

需要登录、多端同步或 Skill 工作区管理时，先复制 `.env.example`，并配置
`SUPERADMIN`、`SUPERADMINPASSWORD` 和高熵 `SESSION_SECRET`：

```bash
cp .env.example .env
mkdir -p ./storage/images ./storage/data

docker run -d \
  --restart unless-stopped \
  --name notes \
  -p 127.0.0.1:18080:3001 \
  --env-file .env \
  -v "$(pwd)/storage/images:/app/storage/images" \
  -v "$(pwd)/storage/data:/app/storage/data" \
  zhaoolee/notes:latest
```

启动后访问 `http://127.0.0.1:18080`。`storage/images` 保存图片和导出的 PNG，
`storage/data` 保存账号与云端工作区，两者都应持久化和备份。仅使用匿名编辑与导出
时可省略 `--env-file .env`；需要局域网访问时可将端口映射改为
`-p 18080:3001`，公网部署应使用 HTTPS 反向代理。
