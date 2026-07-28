import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsPanel } from "../../src/components/SettingsPanel.js";
import { SharePanel } from "../../src/components/SharePanel.js";

test("设置页只保留长期偏好，不混入当前便签操作", () => {
  const noop = () => undefined;
  const html = renderToStaticMarkup(
    createElement(SettingsPanel, {
      selectedTheme: "default",
      onClose: noop,
      onThemeChange: noop,
    }),
  );

  assert.match(html, /id="app-settings-panel"/);
  assert.match(html, /data-settings-page="root"/);
  assert.match(html, />设置</);
  assert.match(html, /背景颜色/);
  assert.match(html, /暖白纸感/);
  assert.doesNotMatch(html, /新建空白便签/);
  assert.doesNotMatch(html, /插入图片/);
  assert.doesNotMatch(html, /加载示例/);
  assert.doesNotMatch(html, /删除当前便签/);
  assert.doesNotMatch(html, /下载归档/);
  assert.doesNotMatch(html, /复制文本/);
});

test("分享面板承接存图、复制和归档", () => {
  const noop = () => undefined;
  const html = renderToStaticMarkup(
    createElement(SharePanel, {
      copyButtonText: "已复制文本",
      isArchiving: true,
      isCopyingWechat: false,
      isExporting: false,
      onArchiveDownload: noop,
      onClose: noop,
      onCopyMarkdown: noop,
      onCopyWechat: noop,
      onExport: noop,
      wechatButtonText: "复制到公众号",
    }),
  );

  assert.match(html, /id="app-share-panel"/);
  assert.match(html, /分享与导出/);
  assert.match(html, /保存为图片/);
  assert.match(html, /已复制文本/);
  assert.match(html, /复制到公众号/);
  assert.match(html, /上传图片并复制微信公众号富文本/);
  assert.match(html, /归档中\.\.\./);
});

test("移动详情页按原版区分编辑态和预览态操作", () => {
  const appSource = readFileSync("src/App.tsx", "utf8");
  const styles = readFileSync("src/styles.css", "utf8");

  assert.match(appSource, /className="mobile-detail-action mobile-insert-image"/);
  assert.match(appSource, /className="mobile-detail-action mobile-edit-done"/);
  assert.match(appSource, /className="mobile-detail-action mobile-delete-note"/);
  assert.match(appSource, /className="share-trigger"/);
  assert.match(
    styles,
    /\.app-layout\[data-mobile-view="editor"\] \.mobile-insert-image,[\s\S]*\.app-layout\[data-mobile-view="editor"\] \.mobile-edit-done/,
  );
  assert.match(
    styles,
    /\.app-layout\[data-mobile-view="preview"\] \.mobile-delete-note,[\s\S]*\.app-layout\[data-mobile-view="preview"\] \.share-trigger/,
  );
  assert.match(
    styles,
    /\.app-layout:not\(\[data-mobile-view="notes"\]\) \.app-settings\s*\{[^}]*display:\s*none;/s,
  );

  for (const file of [
    "btn_pic.png",
    "btn_save_notes.png",
    "btn_delete_notes.png",
    "btn_share_notes.png",
  ]) {
    assert.ok(existsSync(`public/smartisan/mobile/${file}`), `${file} 应存在`);
  }
});
