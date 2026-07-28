# 安卓版锤子便签移动素材

本目录中的素材来自用户已授权使用的安卓版锤子便签 `4.2.1` APK，用于本项目不超过 `640px` 的手机布局。

## 原始素材

- `action_bar_default.png`
- `btn_back.png`
- `btn_create.png`
- `btn_delete_notes.png`
- `btn_pic.png`
- `btn_save_notes.png`
- `btn_settings.png`
- `btn_share_notes.png`
- `icon_top_checked.png`
- `icon_top_normal.png`
- `list_item_image_icon.png`
- `note_background.png`
- `note_item_clip_normal.png`
- `note_item_star_fav.png`
- `note_item_star_invalid.png`
- `search_bar_left_icon.png`

## Web 九宫格切片

Android 9-patch 的边框标记不能直接交给浏览器渲染，因此列表纸片和搜索框去掉了外围 1px 标记，并按 APK 中的拉伸区拆为左、中、右三片：

- `list-item-normal-*`：列表普通态
- `list-item-pressed-*`：手指按下态
- `search-field-*`：搜索框

浏览器保持左右固定片的设计宽度，只横向拉伸中间片，从而保留原始圆角、页边线、纹理、细分隔线和底部阴影。

`icon_top_normal.png` 和 `icon_top_checked.png` 分别用于便签未置顶与已置顶状态；它们保持 APK 中的 `39 × 47dp` 画布和白色 / 黄色图钉视觉。
`note_item_star_invalid.png` 和 `note_item_star_fav.png` 复原列表右侧未加星与已加星状态，同样保持 APK 的 `39 × 47dp` 透明画布。

详情页按原版的编辑态 / 查看态切换使用 `btn_pic.png`、`btn_save_notes.png`、
`btn_delete_notes.png` 和 `btn_share_notes.png`，四张图片保持原始 `36 × 36dp`
按钮画布。
