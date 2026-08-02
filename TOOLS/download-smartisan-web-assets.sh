#!/usr/bin/env bash

set -euo pipefail

asset_base_url="https://static.smartisanos.cn/cloud/note/img"
asset_output_dir="public/smartisan/web"

assets=(
  "all_icons_ab3d0991b9.png"
  "all_icons_ab3d0991b9@2x.png"
  "apps_icon_859d2bb82e@2x.png"
  "bar-bg_4cfb4d66ed.png"
  "bar-bg_4cfb4d66ed@2x.png"
  "cloud_note_bg_d2def91e10.jpg"
  "create_folder_09cb2d75c6.png"
  "dialog-close_5645969d98.png"
  "edge_004e88bdf2.png"
  "filter-icon-all_50596a80bd.png"
  "filter-icon-call2_b8deac1dff.png"
  "filter-icon-call2_b8deac1dff@2x.png"
  "filter-icon-call_57ec09df3c.png"
  "filter-icon-fav_8ccfbebb47.png"
  "filter-icon-img_8556442bbe.png"
  "folder_icon_dc8a8d7563.png"
  "grid_6e4a41eefc.png"
  "markdown_icon_7ae1caee57.png"
  "markdown_icon_7ae1caee57@2x.png"
  "note_blank_icon_ac2a0a264f.png"
  "note_blank_icon_ac2a0a264f@2x.png"
  "pattern_8ca58a64e2.png"
  "search-clear_768cd37067.png"
)

mkdir -p "${asset_output_dir}"

for asset in "${assets[@]}"; do
  curl -fLsS "${asset_base_url}/${asset}" -o "${asset_output_dir}/${asset}"
done

echo "Downloaded ${#assets[@]} Smartisan Notes web UI assets to ${asset_output_dir}"
