# 锤子便签网页版 UI 资源快照

这些文件用于本开源项目的界面兼容性与像素对照验证，抓取自锤子便签网页版实际加载的静态资源。

- 对照页面：<https://yun.smartisan.com/?from=snote#/notes>
- 页面应用：<https://yun.smartisan.com/apps/note/>
- 样式快照：<https://static.smartisanos.cn/cloud/note/css/note-all_4bbfbe751b.css>
- 图片根路径：<https://static.smartisanos.cn/cloud/note/img/>
- 抓取日期：2026-07-27
- 下载脚本：`TOOLS/download-smartisan-web-assets.sh`

本目录没有改变原素材的权利归属。发布或二次分发前，应由项目维护者按实际授权范围再次确认。

## 当前界面使用的资源

- `all_icons_ab3d0991b9.png` / `all_icons_ab3d0991b9@2x.png`：顶栏、搜索、文件夹、加星等 Sprite
- `grid_6e4a41eefc.png`：正文横线纸
- `edge_004e88bdf2.png`：正文左侧纸边
- `cloud_note_bg_d2def91e10.jpg`：网页版木纹背景
- `bar-bg_4cfb4d66ed.png` / `bar-bg_4cfb4d66ed@2x.png`：顶栏纹理
- `filter-icon-*.png`：分类图标
- `create_folder_09cb2d75c6.png`：新建文件夹按钮
- `folder_icon_dc8a8d7563.png`：文件夹图标
- `smartisan_hammer_footer.png`：底部署名使用的 48 × 48px 圆形锤子标志；
  轮廓参考 [AnimaUI 的 Smartisan 图标](https://www.veryicon.com/icons/application/animaui/smartisan-fill-round.html)
  （页面标注可免费商用），并重新映射为便签纸的 `#d7cec1 / #fefcf6` 色值。
  圆形之外使用透明通道，避免微信公众号暗黑模式把图标显示成浅色方块。
